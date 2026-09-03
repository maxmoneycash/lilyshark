//
//  USBSerialManager.swift
//  MeshCoreKit
//
//  macOS USB serial communication: port discovery, binary and CLI mode detection.
//
//  Created by Michael P. Bedworth on 3/16/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

// USB Serial on iOS/iPadOS: NOT currently possible.
// iOS does not expose CDC ACM serial devices to apps. The ExternalAccessory framework
// requires MFi certification (ESP32/Heltec devices are not MFi-certified). IOKit is
// macOS-only. As of iOS 18, there is no public API for USB serial communication with
// generic USB CDC ACM devices. Meshtastic iOS uses BLE only, not USB serial.
// If Apple adds DriverKit for iOS or exposes USB serial APIs in a future iOS version,
// this would need a separate USBSerialManager implementation using that framework.

#if os(macOS) || targetEnvironment(macCatalyst)
import Foundation
import Combine
import IOKit
import IOKit.serial
import os.log

/// Manages USB serial communication with MeshCore devices.
///
/// Supports two modes:
/// - **Binary (companion)**: Frames wrapped with `<` (0x3C) + length(2 LE) + payload (inbound)
///   and `>` (0x3E) + length(2 LE) + payload (outbound).
/// - **CLI (repeater/room)**: Plain text commands terminated by newline.
///
/// Thread safety: All readBuffer and write operations are serialized on `serialQueue`.
/// Published state is updated on main thread. The read loop runs on a background thread
/// and dispatches received data to serialQueue for parsing.
public final class USBSerialManager: ObservableObject {
    private static let logger = Logger(subsystem: "com.pommecore", category: "USB")

    // MARK: - Published State

    @Published public private(set) var availablePorts: [String] = []
    @Published public private(set) var isConnected: Bool = false
    @Published public private(set) var connectedPort: String?
    @Published public private(set) var detectedMode: DeviceMode = .unknown

    /// Publisher for incoming binary frames (companion mode).
    public let receivedDataSubject = PassthroughSubject<Data, Never>()

    /// Publisher for incoming CLI text lines (CLI mode).
    public let receivedLineSubject = PassthroughSubject<String, Never>()

    public enum DeviceMode: Equatable, Sendable {
        case unknown
        case binary   // Companion radio — binary protocol
        case cli      // Repeater/room server — text CLI
    }

    // MARK: - Private

    private var fileDescriptor: Int32 = -1
    /// All readBuffer access MUST happen on serialQueue to prevent races between
    /// the background read loop and main-thread disconnect/cleanup.
    private var readBuffer = Data()
    private let serialQueue = DispatchQueue(label: "com.meshcore.serial", qos: .userInitiated)
    /// Mode flag — accessed from serialQueue (read loop dispatches there) and main thread
    /// (probes set it). Safe because probes check fileDescriptor first and read loop
    /// dispatches to serialQueue before reading it.
    private var resolvedMode: DeviceMode = .unknown
    /// True while the background read loop is active — prevents FD reuse races on reconnect.
    private var readLoopActive = false
    /// CLI command queue — all access on main thread.
    private var cliQueue: [String] = []
    private var cliQueueProcessing = false
    /// Minimum delay between CLI commands (milliseconds).
    private let cliCommandDelayMs: UInt64 = 500

    public init() {}

    // MARK: - Port Discovery

    /// Scan for available serial ports using IOKit.
    public func scanPorts() {
        var ports: [String] = []
        let matchingDict = IOServiceMatching(kIOSerialBSDServiceValue) as NSMutableDictionary
        matchingDict[kIOSerialBSDTypeKey] = kIOSerialBSDAllTypes

        var iterator: io_iterator_t = 0
        let result = IOServiceGetMatchingServices(kIOMainPortDefault, matchingDict, &iterator)
        guard result == KERN_SUCCESS else {
            Self.logger.warning("Failed to enumerate serial ports: \(result)")
            DebugLogger.shared.log("USB SCAN: IOKit enumeration failed (\(result))", level: .error)
            return
        }

        var allPaths: [String] = []
        var service = IOIteratorNext(iterator)
        while service != 0 {
            if let cfPath = IORegistryEntryCreateCFProperty(
                service, kIOCalloutDeviceKey as CFString, kCFAllocatorDefault, 0
            )?.takeRetainedValue() as? String {
                allPaths.append(cfPath)
                // Include all /dev/cu.* devices (callout ports)
                // Common USB-serial chips: CP2102, CH340, CH9102, FTDI
                // Port names: cu.usbmodem*, cu.usbserial*, cu.SLAB_USBtoUART*, cu.wchusbserial*
                if cfPath.contains("/dev/cu.") {
                    ports.append(cfPath)
                }
            }
            IOObjectRelease(service)
            service = IOIteratorNext(iterator)
        }
        IOObjectRelease(iterator)

        DispatchQueue.main.async {
            self.availablePorts = ports.sorted()
            Self.logger.info("Found \(ports.count) serial port(s)")
            DebugLogger.shared.log("USB SCAN: \(ports.count) ports found: \(ports.isEmpty ? "(none)" : ports.joined(separator: ", "))", level: .info)
            if !allPaths.isEmpty && ports.isEmpty {
                DebugLogger.shared.log("USB SCAN: IOKit found \(allPaths.count) devices but none matched /dev/cu.*: \(allPaths.joined(separator: ", "))", level: .warning)
            }
        }
    }

    // MARK: - Connect / Disconnect

    /// Connect to a serial port at the given baud rate.
    public func connect(to port: String, baudRate: speed_t = 115200) {
        guard fileDescriptor < 0 else {
            Self.logger.warning("Already connected")
            return
        }
        guard !readLoopActive else {
            Self.logger.warning("Read loop still active from previous connection — try again shortly")
            DebugLogger.shared.log("USB: connect blocked — read loop still exiting", level: .warning)
            return
        }

        // Open WITHOUT O_NONBLOCK — some USB CDC devices don't work with it
        let fd = open(port, O_RDWR | O_NOCTTY)
        guard fd >= 0 else {
            let err = String(cString: strerror(errno))
            Self.logger.error("Failed to open \(port): \(err)")
            DebugLogger.shared.log("USB: open failed: \(err)", level: .error)
            // Notify observers so connectionState can reset from .connecting
            DispatchQueue.main.async { [weak self] in
                self?.isConnected = false
                self?.connectedPort = nil
                self?.detectedMode = .unknown
            }
            return
        }

        // Configure: raw mode, VMIN=0 VTIME=2 (200ms read timeout) so reads don't block forever.
        // This allows the read loop to check the exit condition periodically.
        var options = termios()
        tcgetattr(fd, &options)
        cfmakeraw(&options)
        options.c_cflag |= UInt(CLOCAL | CREAD)
        options.c_cc.16 = 0  // VMIN — return immediately when data available
        options.c_cc.17 = 2  // VTIME — 200ms timeout (units of 0.1s)
        tcsetattr(fd, TCSANOW, &options)

        DebugLogger.shared.log("USB: port opened (blocking, raw mode, no baud set)", level: .info)

        fileDescriptor = fd
        serialQueue.async { self.readBuffer = Data() }
        resolvedMode = .unknown

        DispatchQueue.main.async {
            self.isConnected = true
            self.connectedPort = port
            self.detectedMode = .unknown
            DebugLogger.shared.log("USB: connected to \(port)", level: .info)
        }

        // Send a bare newline to flush any pending input buffer on the device
        serialQueue.async { [weak self] in
            guard let self, self.fileDescriptor >= 0 else { return }
            "\r\n".data(using: .utf8)!.withUnsafeBytes { ptr in
                if let base = ptr.baseAddress {
                    _ = write(fd, base, 2)
                }
            }
            DebugLogger.shared.log("USB: sent \\r\\n to flush device input buffer", level: .tx)
        }

        // Synchronous read loop on background thread.
        // Use fd (local, captured at connect time) for both the loop check and read calls
        // to avoid race conditions with disconnect() setting fileDescriptor = -1.
        // Received data is dispatched to serialQueue for thread-safe parsing.
        readLoopActive = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var buffer = [UInt8](repeating: 0, count: 1024)
            DebugLogger.shared.log("USB: sync read loop started on fd=\(fd)", level: .info)

            while self.fileDescriptor == fd {
                let bytesRead = read(fd, &buffer, 1024)
                if bytesRead > 0 {
                    let data = Data(buffer[0..<bytesRead])
                    DebugLogger.shared.log("USB RX: \(bytesRead) bytes: \(data.hexFormatted(maxBytes: 40))", level: .rx)
                    // Dispatch to serialQueue for thread-safe buffer access
                    self.serialQueue.async {
                        self.handleReceivedData(data)
                    }
                } else if bytesRead == 0 {
                    // VMIN=0/VTIME=2: bytesRead==0 means timeout (no data), not EOF.
                    // Just loop back to check fileDescriptor == fd exit condition.
                    continue
                } else if errno == EAGAIN || errno == EWOULDBLOCK {
                    continue
                } else {
                    // Real error (EIO, ENXIO, EBADF) — device disconnected or port closed
                    let errMsg = "USB: read error \(errno): \(String(cString: strerror(errno))) — device disconnected"
                    Self.logger.error("\(errMsg)")
                    DebugLogger.shared.log(errMsg, level: .error)
                    break
                }
            }

            self.readLoopActive = false
            Self.logger.info("USB: read loop ended (fd=\(fd), current fd=\(self.fileDescriptor))")
            DebugLogger.shared.log("USB: read loop ended", level: .info)
            DispatchQueue.main.async { [weak self] in
                self?.disconnect()
            }
        }

        // Escalating probe sequence — each approach tries a different method
        let probes: [(delay: Double, label: String, action: (USBSerialManager) -> Void)] = [
            (1.0, "sending $$ (CLI probe)", { $0.probeDeviceType() }),
            (3.0, "sending framed binary CMD_DEVICE_QUERY", { $0.sendFrame(Data([0x16, 0x03])) }),
            (5.0, "sending RAW binary (no framing): 16 03", { mgr in
                let raw = Data([0x16, 0x03])
                mgr.serialQueue.async {
                    guard mgr.fileDescriptor >= 0 else { return }
                    raw.withUnsafeBytes { ptr in
                        guard let base = ptr.baseAddress else { return }
                        _ = write(mgr.fileDescriptor, base, raw.count)
                    }
                }
            }),
            (7.0, "asserting DTR/RTS + framed binary probe", { mgr in
                mgr.serialQueue.async {
                    guard mgr.fileDescriptor >= 0 else { return }
                    var modemBits: CInt = TIOCM_DTR | TIOCM_RTS
                    _ = ioctl(mgr.fileDescriptor, TIOCMBIS, &modemBits)
                }
                mgr.sendFrame(Data([0x16, 0x03]))
            }),
        ]

        for (index, probe) in probes.enumerated() {
            serialQueue.asyncAfter(deadline: .now() + probe.delay) { [weak self] in
                guard let self, self.resolvedMode == .unknown, self.fileDescriptor >= 0 else { return }
                DebugLogger.shared.log("USB PROBE \(index + 1): \(probe.label)", level: .tx)
                probe.action(self)
            }
        }

        // Final timeout — disconnect if device never responded
        serialQueue.asyncAfter(deadline: .now() + 10.0) { [weak self] in
            guard let self, self.resolvedMode == .unknown, self.fileDescriptor >= 0 else { return }
            DebugLogger.shared.log("USB: ALL PROBES FAILED after 10s — disconnecting. Try: 1) unplug/replug device 2) press reset button 3) check if another app has the port open", level: .error)
            DispatchQueue.main.async {
                self.disconnect()
            }
        }
    }

    /// Disconnect from the current serial port.
    /// Sets fileDescriptor = -1 first so the read loop exits on its next VTIME cycle,
    /// then closes the fd on a background thread to avoid blocking the main thread.
    public func disconnect() {
        guard isConnected || fileDescriptor >= 0 else { return }

        let stack = Thread.callStackSymbols.prefix(6).joined(separator: "\n")
        Self.logger.warning("USB: disconnect called, fd=\(self.fileDescriptor)")
        DebugLogger.shared.log("USB: disconnect called from:\n\(stack)", level: .warning)

        resolvedMode = .unknown
        clearCLIQueue()

        // Capture fd and clear it immediately — the read loop checks
        // `self.fileDescriptor == fd` every 200ms and will exit.
        let fd = fileDescriptor
        fileDescriptor = -1

        // Clear readBuffer on serialQueue to avoid racing with the read loop
        serialQueue.async { self.readBuffer.removeAll() }

        if fd >= 0 {
            // Wait 300ms for read loop to exit (VTIME=200ms), then close.
            // Must complete before a reconnect open() to avoid port contention.
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.3) {
                close(fd)
                DebugLogger.shared.log("USB: fd \(fd) closed", level: .info)
            }
        }

        DispatchQueue.main.async {
            self.isConnected = false
            self.connectedPort = nil
            self.detectedMode = .unknown
            Self.logger.info("Disconnected")
            DebugLogger.shared.log("USB: disconnected — state cleared", level: .info)
        }
    }

    // MARK: - Send

    /// Send a binary frame with USB serial framing: `<` + length(2 LE) + frame data.
    public func sendFrame(_ frame: Data) {
        let fd = fileDescriptor
        guard fd >= 0 else { return }
        var framedData = Data([0x3C]) // '<' inbound marker
        var length = UInt16(frame.count).littleEndian
        framedData.append(Data(bytes: &length, count: 2))
        framedData.append(frame)

        DebugLogger.shared.log("USB RAW TX: \(framedData.count) bytes: \(framedData.hexFormatted())", level: .tx)

        serialQueue.async { [weak self] in
            guard let self, self.fileDescriptor == fd else { return }
            framedData.withUnsafeBytes { ptr in
                guard let base = ptr.baseAddress else { return }
                _ = write(fd, base, framedData.count)
            }
            Self.logger.debug("TX [\(frame.count) bytes]")
        }
    }

    /// Queue a CLI command for sequential execution.
    /// Commands are sent one at a time, waiting for a response or minimum delay between each.
    public func sendCLI(_ command: String) {
        guard fileDescriptor >= 0 else { return }
        cliQueue.append(command)
        processNextCLICommand()
    }

    /// Send a CLI command immediately, bypassing the queue.
    /// Use for settings fetch (which has its own pacing) and internal probes.
    public func sendCLIDirect(_ command: String) {
        sendCLIImmediate(command)
    }

    /// Send a keepalive byte to keep the serial port active without triggering a CLI command.
    public func sendKeepalive() {
        let fd = fileDescriptor
        guard fd >= 0 else { return }
        serialQueue.async { [weak self] in
            guard let self, self.fileDescriptor == fd else { return }
            var byte: UInt8 = 0x00
            _ = write(fd, &byte, 1)
        }
    }

    private func sendCLIImmediate(_ command: String) {
        let fd = fileDescriptor
        guard fd >= 0 else { return }
        guard let data = "\(command)\r\n".data(using: .utf8) else { return }

        serialQueue.async { [weak self] in
            guard let self, self.fileDescriptor == fd else { return }
            let written = data.withUnsafeBytes { ptr -> Int in
                guard let base = ptr.baseAddress else { return -1 }
                return write(fd, base, data.count)
            }
            if written != data.count {
                Self.logger.error("USB TX ERROR: wrote \(written)/\(data.count) bytes, errno=\(errno)")
                DebugLogger.shared.log("USB TX ERROR: wrote \(written)/\(data.count) bytes, errno=\(errno): \(String(cString: strerror(errno)))", level: .error)
            }
            Self.logger.info("TX CLI: \(command) (\(written)/\(data.count) bytes)")
            DebugLogger.shared.log("TX CLI: \(command) (\(written) bytes written)", level: .tx)
        }
    }

    private func processNextCLICommand() {
        guard !cliQueueProcessing, !cliQueue.isEmpty else { return }
        cliQueueProcessing = true

        let command = cliQueue.removeFirst()
        let remaining = cliQueue.count
        DebugLogger.shared.log("USB QUEUE: sending '\(command)' (\(remaining) queued)", level: .tx)
        sendCLIImmediate(command)

        // Always wait the minimum delay before sending the next command.
        // The device needs time to process each command, even if it echoes immediately.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(cliCommandDelayMs))) { [weak self] in
            guard let self else { return }
            self.cliQueueProcessing = false
            if !self.cliQueue.isEmpty {
                DebugLogger.shared.log("USB QUEUE: delay done, processing next (\(self.cliQueue.count) remaining)", level: .info)
                self.processNextCLICommand()
            }
        }
    }

    /// Clear any pending queued commands (e.g. on disconnect).
    public func clearQueue() {
        clearCLIQueue()
    }

    private func clearCLIQueue() {
        cliQueue.removeAll()
        cliQueueProcessing = false
    }

    // MARK: - Read (all methods called on serialQueue)

    /// Called on serialQueue with received data from the read loop.
    private func handleReceivedData(_ data: Data) {
        readBuffer.append(data)

        switch resolvedMode {
        case .unknown:
            detectMode()
        case .binary:
            parseBinaryFrames()
        case .cli:
            parseCLILines()
        }
    }

    // MARK: - Device Detection

    /// Send `$$` to probe if this is a CLI device or binary companion.
    private func probeDeviceType() {
        let fd = fileDescriptor
        guard fd >= 0 else { return }
        // Send $$ which triggers a response on CLI devices
        let probe = "$$\r\n".data(using: .utf8)!
        serialQueue.async { [weak self] in
            guard let self, self.fileDescriptor == fd else { return }
            probe.withUnsafeBytes { ptr in
                guard let base = ptr.baseAddress else { return }
                _ = write(fd, base, probe.count)
            }
            Self.logger.info("Sent probe '$$' to detect device type")
            DebugLogger.shared.log("USB: sent probe '$$' for mode detection", level: .tx)
        }
    }

    /// Called on serialQueue.
    private func detectMode() {
        guard !readBuffer.isEmpty else { return }

        DebugLogger.shared.log("USB DETECT: \(readBuffer.count) bytes, startIndex=\(readBuffer.startIndex): \(Data(readBuffer.prefix(20)).hexFormatted())", level: .rx)

        let firstByte = readBuffer[readBuffer.startIndex]

        if firstByte == 0x3E {
            // Binary frame marker `>` — companion radio
            resolvedMode = .binary
            DispatchQueue.main.async {
                self.detectedMode = .binary
                Self.logger.info("Detected binary companion mode")
                DebugLogger.shared.log("USB: detected BINARY mode (companion radio)", level: .info)
            }
            parseBinaryFrames()
            return
        }

        // Check if data looks like ASCII text (printable chars or line endings)
        let hasText = readBuffer.contains(where: { ($0 >= 0x20 && $0 < 0x7F) || $0 == 0x0A || $0 == 0x0D })
        if hasText {
            resolvedMode = .cli
            let text = String(data: readBuffer.prefix(80), encoding: .utf8) ?? "(non-UTF8)"
            DebugLogger.shared.log("USB DETECT: CLI mode — text: '\(text.prefix(50))'", level: .info)
            // Discard probe response data — it's from the \r\n flush and $$ probe,
            // not from real commands. Keeping it causes response misalignment.
            readBuffer.removeAll()
            // Also flush the kernel's serial input buffer to discard any in-flight probe data
            if fileDescriptor >= 0 { tcflush(fileDescriptor, TCIFLUSH) }
            DebugLogger.shared.log("USB DETECT: cleared readBuffer + kernel buffer (discarded probe data)", level: .info)
            DispatchQueue.main.async {
                self.detectedMode = .cli
                Self.logger.info("Detected CLI mode")
                DebugLogger.shared.log("USB: detected CLI mode (repeater/room)", level: .info)
            }
        } else {
            DebugLogger.shared.log("USB DETECT: unrecognized first byte 0x\(String(format: "%02X", firstByte)), waiting for more data", level: .warning)
        }
    }

    /// Called on serialQueue.
    private func parseBinaryFrames() {
        while readBuffer.count >= 3 {
            let si = readBuffer.startIndex
            guard readBuffer[si] == 0x3E else {
                // Skip garbage bytes until we find a frame marker
                if let idx = readBuffer.firstIndex(of: 0x3E) {
                    let skip = readBuffer.distance(from: si, to: idx)
                    readBuffer.removeFirst(skip)
                } else {
                    readBuffer.removeAll()
                    return
                }
                continue
            }

            var length: UInt16 = 0
            _ = withUnsafeMutableBytes(of: &length) { dest in
                readBuffer.copyBytes(to: dest, from: (si + 1)..<(si + 3))
            }
            length = UInt16(littleEndian: length)

            let totalNeeded = 3 + Int(length)
            guard readBuffer.count >= totalNeeded else { return } // Wait for more data

            let frameData = Data(readBuffer[(si + 3)..<(si + totalNeeded)])
            readBuffer.removeFirst(totalNeeded)

            DebugLogger.shared.log("USB RX FRAME: \(frameData.count) bytes: \(frameData.hexFormatted(maxBytes: 20))", level: .rx)
            Self.logger.debug("RX binary frame [\(frameData.count) bytes]")
            DispatchQueue.main.async { [weak self] in
                self?.receivedDataSubject.send(frameData)
            }
        }
    }

    /// Called on serialQueue.
    private func parseCLILines() {
        while let newlineIdx = readBuffer.firstIndex(of: 0x0A) {
            let si = readBuffer.startIndex
            let lineData = Data(readBuffer[si..<newlineIdx])
            let consumed = readBuffer.distance(from: si, to: newlineIdx) + 1
            readBuffer.removeFirst(consumed)

            if let line = String(data: lineData, encoding: .utf8)?
                .trimmingCharacters(in: .controlCharacters) {
                guard !line.isEmpty else { continue }
                Self.logger.debug("RX CLI: \(line)")
                DebugLogger.shared.log("USB CLI RX: \(line)", level: .rx)
                DispatchQueue.main.async { [weak self] in
                    self?.receivedLineSubject.send(line)
                }
            }
        }
    }
}
#endif
