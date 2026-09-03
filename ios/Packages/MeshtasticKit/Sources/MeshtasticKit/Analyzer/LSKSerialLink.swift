//
//  LSKSerialLink.swift
//  MeshtasticKit
//
//  The analyzer link over USB CDC. macOS only, and deliberately so — see
//  LSKUSBAvailability and LSK.md for what iOS can and cannot do here.
//

#if os(macOS)
import Combine
import Foundation
import IOKit
import IOKit.serial
import os.log

/// Opens a T-Deck's analyzer link over USB, sends `LSK HELLO`, and publishes
/// every line the deck streams back as a decoded `LSKLine`.
///
/// This is the Mac's half of what `webapp/src/lib/deviceLink.ts` does in a
/// browser, and it keeps that file's hard-won opening sequence: deassert
/// DTR/RTS so the board does not land in the bootloader, wait for `setup()`
/// to finish before the first HELLO, keep asking, and treat the first dropped
/// stream as the ESP32-S3 re-enumerating rather than as a failure.
///
/// Threading: the file descriptor and every write live on `queue`; the read
/// loop runs on a background thread and hands bytes back to `queue`; the
/// `@Published` properties and `lines` are updated on the main thread, because
/// they exist to drive a view.
public final class LSKSerialLink: ObservableObject {
    private static let logger = Logger(subsystem: "com.lilyshark.meshtastickit", category: "LSK")

    // MARK: Published state

    @Published public private(set) var state: LSKLinkState = .off
    @Published public private(set) var availablePorts: [LSKSerialPort] = []
    /// The most recent raw line, LSK or not. Shown while connecting so that a
    /// port which opens and then says nothing is visibly saying nothing.
    @Published public private(set) var lastRawLine: String?

    /// Every decoded line, in arrival order.
    public let lines = PassthroughSubject<LSKLine, Never>()
    /// Lines that were analyzer traffic but did not decode — a clipped print,
    /// almost always. Published rather than swallowed so a stream that is
    /// mostly rubbish cannot look like a healthy quiet one.
    public let malformedKinds = PassthroughSubject<String, Never>()

    // MARK: Private

    private let timing: LSKLinkTiming
    private let queue = DispatchQueue(label: "com.lilyshark.lsk.serial", qos: .userInitiated)

    /// Everything below is touched only on `queue`.
    private var fileDescriptor: Int32 = -1
    private var assembler = LSKLineAssembler()
    private var helloTimer: DispatchSourceTimer?
    private var timeoutTimer: DispatchSourceTimer?
    /// True while a close is one we asked for, so the read loop ending is not
    /// reported as the deck going away.
    private var closingDeliberately = false
    private var attempt = 0
    private var identified = false

    public init(timing: LSKLinkTiming = .deck) {
        self.timing = timing
    }

    deinit {
        let fd = fileDescriptor
        if fd >= 0 { close(fd) }
    }

    // MARK: - Discovery

    /// Every callout serial device on this Mac, with the USB vendor behind it.
    ///
    /// Synchronous and free of side effects, so a caller can filter or rank the
    /// result without waiting on the object.
    public static func scanPorts() -> [LSKSerialPort] {
        let matching = IOServiceMatching(kIOSerialBSDServiceValue) as NSMutableDictionary
        matching[kIOSerialBSDTypeKey] = kIOSerialBSDAllTypes

        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator) == KERN_SUCCESS
        else {
            logger.warning("IOKit would not enumerate serial ports")
            return []
        }
        defer { IOObjectRelease(iterator) }

        var ports: [LSKSerialPort] = []
        var service = IOIteratorNext(iterator)
        while service != 0 {
            if let path = registryString(service, kIOCalloutDeviceKey), path.hasPrefix("/dev/cu.") {
                ports.append(LSKSerialPort(
                    path: path,
                    name: registryString(service, kIOTTYDeviceKey)
                        ?? String(path.dropFirst("/dev/cu.".count)),
                    usbVendorID: usbIdentifier(service, "idVendor"),
                    usbProductID: usbIdentifier(service, "idProduct")
                ))
            }
            IOObjectRelease(service)
            service = IOIteratorNext(iterator)
        }
        return LSKSerialPort.ranked(ports)
    }

    /// Refresh `availablePorts`.
    public func refreshPorts() {
        let ports = Self.scanPorts()
        DispatchQueue.main.async { self.availablePorts = ports }
    }

    private static func registryString(_ service: io_object_t, _ key: String) -> String? {
        IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?
            .takeRetainedValue() as? String
    }

    /// The USB descriptor values live on an ancestor of the serial node, so the
    /// lookup walks up the IOService plane rather than reading this node alone.
    private static func usbIdentifier(_ service: io_object_t, _ key: String) -> UInt16? {
        let options = IOOptionBits(kIORegistryIterateRecursively | kIORegistryIterateParents)
        guard let value = IORegistryEntrySearchCFProperty(
            service, kIOServicePlane, key as CFString, kCFAllocatorDefault, options
        ) as? NSNumber else { return nil }
        return UInt16(truncatingIfNeeded: value.intValue)
    }

    // MARK: - Link lifecycle

    /// Open one port and hold the link until `disconnect()` or the cable goes.
    public func connect(to path: String) {
        queue.async { [self] in
            if fileDescriptor >= 0 { teardownPort(sendingGoodbye: false) }
            attempt = 0
            beginAttempt(path: path)
        }
    }

    /// Try the plausible ports in order and keep the first that identifies.
    ///
    /// Ports with no USB vendor are skipped entirely: they open without
    /// complaint and then never answer, and twenty seconds of that per port
    /// looks to an operator like the app has hung.
    public func connectToFirstDeck() {
        let candidates = Self.scanPorts().filter(\.couldBeADeck)
        guard let first = candidates.first else {
            queue.async { [self] in
                publishState(.failed(
                    "no USB serial device is plugged in — connect the T-Deck and try again"
                ))
            }
            return
        }
        connect(to: first.path)
    }

    /// Say goodbye and close. The deck stops streaming and logs the parting;
    /// without it, it keeps printing to a port nobody is reading.
    public func disconnect() {
        queue.async { [self] in
            guard fileDescriptor >= 0 else {
                publishState(.off)
                return
            }
            teardownPort(sendingGoodbye: true)
            publishState(.off)
        }
    }

    /// Write one command. Throws before anything reaches the cable if the deck
    /// would refuse it or silently drop it.
    public func send(_ command: LSKCommand) throws {
        let encoded = try command.encoded()
        queue.async { [self] in
            guard identified else {
                // The command itself is not logged: a direct message is one of
                // these, and its text is the operator's, not ours to record.
                Self.logger.error("dropped a command: the link is not up")
                return
            }
            writeLine(encoded)
        }
    }

    // MARK: - One attempt

    private func beginAttempt(path: String) {
        closingDeliberately = false
        identified = false
        assembler.reset()

        // O_NONBLOCK for the open itself so a port with no carrier cannot
        // block the queue forever, then cleared so the configured VMIN/VTIME
        // decide how long a read waits.
        let fd = open(path, O_RDWR | O_NOCTTY | O_NONBLOCK)
        guard fd >= 0 else {
            let reason = String(cString: strerror(errno))
            Self.logger.error("open \(path, privacy: .public) failed: \(reason, privacy: .public)")
            publishState(.failed(
                "\(path) would not open (\(reason)) — close any serial monitor or other "
                + "Lilyshark window holding it, then try again"
            ))
            return
        }
        _ = fcntl(fd, F_SETFL, 0)

        var options = termios()
        tcgetattr(fd, &options)
        cfmakeraw(&options)
        options.c_cflag |= UInt(CLOCAL | CREAD)
        // VMIN 0 with VTIME 2 gives each read a 200 ms ceiling, which is what
        // lets the read loop notice that the link was closed.
        options.c_cc.16 = 0
        options.c_cc.17 = 2
        cfsetispeed(&options, speed_t(B115200))
        cfsetospeed(&options, speed_t(B115200))
        tcsetattr(fd, TCSANOW, &options)
        tcflush(fd, TCIOFLUSH)

        // Release reset and boot. Too late to prevent the CDC reset that the
        // open itself causes, but it keeps the board out of the bootloader,
        // where it would answer nothing at all.
        var modemBits: CInt = TIOCM_DTR | TIOCM_RTS
        _ = ioctl(fd, TIOCMBIC, &modemBits)

        fileDescriptor = fd
        publishState(.connecting(port: path))
        startReadLoop(fd: fd)
        startHelloTimer()
        startTimeoutTimer(path: path)
    }

    private func startReadLoop(fd: Int32) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var buffer = [UInt8](repeating: 0, count: 1024)
            while true {
                guard let self else { return }
                // Reading `fileDescriptor` off-queue is a deliberate cheap
                // check: it only ever changes to -1 or to a new descriptor, and
                // either way this loop's job is to stop.
                guard self.fileDescriptor == fd else { break }
                let count = read(fd, &buffer, buffer.count)
                if count > 0 {
                    let chunk = Data(buffer[0..<count])
                    self.queue.async { self.ingest(chunk, from: fd) }
                } else if count == 0 {
                    // With VMIN 0 this is a 200 ms timeout on a live port, and
                    // an end-of-file on a port whose other side has gone. The
                    // two are indistinguishable here, so the loop keeps going
                    // and the identify timeout is what eventually decides.
                    continue
                } else if errno == EAGAIN || errno == EINTR {
                    continue
                } else {
                    break
                }
            }
            self?.queue.async { self?.streamEnded(fd: fd) }
        }
    }

    private func ingest(_ chunk: Data, from fd: Int32) {
        guard fileDescriptor == fd else { return }
        for text in assembler.append(chunk) {
            DispatchQueue.main.async { self.lastRawLine = text }
            switch LSKDecoder.decode(text) {
            case .notAnalyzerTraffic:
                continue
            case .malformed(let kind):
                Self.logger.debug("malformed LSK \(kind, privacy: .public) line")
                DispatchQueue.main.async { self.malformedKinds.send(kind) }
            case .line(let line):
                if case .identity(let identity) = line { markIdentified(identity) }
                DispatchQueue.main.async { self.lines.send(line) }
            }
        }
    }

    private func markIdentified(_ identity: LSKIdentity) {
        guard !identified else { return }
        // A port that answers but is not running this firmware is a wrong
        // choice, not a link. Saying so beats streaming another board's logs
        // into the analyzer.
        guard identity.isLilyshark else {
            Self.logger.error("port answered as \(identity.app, privacy: .public), not lilyshark")
            let path = fileDescriptor >= 0 ? currentPath : "the port"
            teardownPort(sendingGoodbye: false)
            publishState(.failed(
                "\(path) answered, but as \"\(identity.app)\" rather than a Lilyshark deck"
            ))
            return
        }
        identified = true
        helloTimer?.cancel()
        helloTimer = nil
        timeoutTimer?.cancel()
        timeoutTimer = nil
        publishState(.linked(port: currentPath, identity: identity))
    }

    private func streamEnded(fd: Int32) {
        guard fileDescriptor == fd else { return }
        let path = currentPath
        let wasIdentified = identified
        let deliberate = closingDeliberately
        teardownPort(sendingGoodbye: false)
        if deliberate { return }
        if wasIdentified {
            // A link that was up and is now gone is the cable, not the
            // handshake. Retrying would silently reopen a port the operator
            // may have unplugged on purpose.
            publishState(.failed("the deck stopped answering on \(path) — check the cable"))
            return
        }
        applyPolicy(event: .streamDropped, path: path)
    }

    private func identifyTimedOut(path: String) {
        guard fileDescriptor >= 0, !identified else { return }
        teardownPort(sendingGoodbye: false)
        applyPolicy(event: .timedOut, path: path)
    }

    private func applyPolicy(event: LSKHandshakePolicy.Event, path: String) {
        switch LSKHandshakePolicy.action(
            for: event,
            deliberate: false,
            attempt: attempt,
            maximumAttempts: timing.maximumAttempts
        ) {
        case .ignore:
            return
        case .retry:
            attempt += 1
            publishState(.connecting(port: path))
            queue.asyncAfter(deadline: .now() + timing.reenumerateWait) { [weak self] in
                self?.beginAttempt(path: path)
            }
        case .giveUp:
            publishState(.failed(
                "\(path) never answered. Opening USB reboots the board, so leave it plugged "
                + "in and try again; close any other window or serial monitor holding the port."
            ))
        }
    }

    // MARK: - Timers and writes

    private func startHelloTimer() {
        helloTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(
            deadline: .now() + timing.helloAfterOpen,
            repeating: timing.helloRepeat
        )
        timer.setEventHandler { [weak self] in
            guard let self, self.fileDescriptor >= 0, !self.identified else { return }
            self.writeLine(LSKCommand.hello.line + "\n")
        }
        helloTimer = timer
        timer.resume()
    }

    private func startTimeoutTimer(path: String) {
        timeoutTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + timing.identifyTimeout)
        timer.setEventHandler { [weak self] in self?.identifyTimedOut(path: path) }
        timeoutTimer = timer
        timer.resume()
    }

    private func writeLine(_ text: String) {
        let fd = fileDescriptor
        guard fd >= 0, let data = text.data(using: .utf8) else { return }
        let written = data.withUnsafeBytes { pointer -> Int in
            guard let base = pointer.baseAddress else { return -1 }
            return Darwin.write(fd, base, data.count)
        }
        if written != data.count {
            Self.logger.error("short write: \(written)/\(data.count) bytes, errno \(errno)")
        }
    }

    private func teardownPort(sendingGoodbye: Bool) {
        helloTimer?.cancel()
        helloTimer = nil
        timeoutTimer?.cancel()
        timeoutTimer = nil
        let fd = fileDescriptor
        guard fd >= 0 else {
            identified = false
            return
        }
        if sendingGoodbye {
            closingDeliberately = true
            // Written before the descriptor is dropped, and the descriptor is
            // not actually closed for another 300 ms, which is what gives the
            // goodbye time to leave. tcdrain would be the exact tool and is not
            // used here: on a pty with a slow reader it blocks this queue.
            writeLine(LSKCommand.goodbye.line + "\n")
        }
        fileDescriptor = -1
        identified = false
        assembler.reset()
        // The read loop wakes at most 200 ms from now and sees the descriptor
        // has changed; closing before then would let a reconnect reuse the
        // number while that loop is still reading it.
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.3) { close(fd) }
    }

    private var currentPath: String {
        // Read on `queue`, where `state` is only ever written through
        // publishState, so this is the path of the attempt in flight.
        pathInFlight ?? "the port"
    }

    private var pathInFlight: String?

    private func publishState(_ next: LSKLinkState) {
        pathInFlight = next.port ?? pathInFlight
        DispatchQueue.main.async { self.state = next }
    }
}
#endif
