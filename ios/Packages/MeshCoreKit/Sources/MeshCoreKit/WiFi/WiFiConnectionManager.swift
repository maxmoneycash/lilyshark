//
//  WiFiConnectionManager.swift
//  MeshCoreKit
//
//  TCP socket connection to MeshCore radios over WiFi.
//
//  The MeshCore firmware (SerialWifiInterface) never closes TCP connections —
//  it polls client.connected() in its main loop. However the ESP32's lwIP
//  stack sends a TCP FIN when the connection goes idle. This manager handles
//  that by silently re-establishing the TCP socket without changing the
//  external isConnected state, so the rest of the app sees a stable connection.
//
//  Created by Michael P. Bedworth on 3/17/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import Combine
import Network
import os.log

/// Manages WiFi/TCP connections to MeshCore devices.
/// Uses the same binary framing as USB serial: `<` (0x3C) + length(2 LE) + payload (inbound),
/// `>` (0x3E) + length(2 LE) + payload (outbound).
public final class WiFiConnectionManager: ObservableObject {
    private static let logger = Logger(subsystem: "com.pommecore", category: "WiFi")

    @Published public private(set) var isConnected: Bool = false
    @Published public private(set) var connectedHost: String?

    /// Publisher for incoming binary frames.
    public let receivedDataSubject = PassthroughSubject<Data, Never>()

    private var connection: NWConnection?
    private var readBuffer = Data()
    private let queue = DispatchQueue(label: "com.meshcore.wifi", qos: .userInitiated)

    /// Auto-reconnect state
    public private(set) var lastHost: String?
    public private(set) var lastPort: UInt16?
    public private(set) var isUserDisconnect = false

    /// Silent reconnect counter — incremented on each attempt, reset only
    /// when real data flows through the connection (not just on TCP .ready).
    /// This prevents infinite loops when TCP connects then immediately closes.
    private var silentReconnectAttempts = 0
    private static let maxSilentReconnects = 10

    public init() {}

    // MARK: - TCP Options

    private func makeTCPParams() -> NWParameters {
        let tcp = NWProtocolTCP.Options()
        tcp.enableKeepalive = true
        tcp.keepaliveIdle = 10
        tcp.keepaliveInterval = 5
        tcp.keepaliveCount = 3
        tcp.connectionTimeout = 10
        tcp.noDelay = true
        return NWParameters(tls: nil, tcp: tcp)
    }

    // MARK: - Connect / Disconnect

    /// User-initiated connection to a WiFi device.
    public func connect(host: String, port: UInt16 = 5000) {
        isUserDisconnect = false
        silentReconnectAttempts = 0
        lastHost = host
        lastPort = port
        establishTCP(host: host, port: port, silent: false)
    }

    public func disconnect() {
        isUserDisconnect = true
        silentReconnectAttempts = 0
        let conn = connection
        connection = nil
        // Cancel and clear buffer on the WiFi queue to avoid racing with receiveLoop.
        queue.async { [weak self] in
            conn?.cancel()
            self?.readBuffer = Data()
        }
        DispatchQueue.main.async {
            self.isConnected = false
            self.connectedHost = nil
        }
    }

    // MARK: - Internal TCP lifecycle

    /// Create a new NWConnection. If `silent`, don't change isConnected on success —
    /// the app already thinks we're connected.
    private func establishTCP(host: String, port: UInt16, silent: Bool) {
        connection?.cancel()
        connection = nil
        readBuffer = Data()

        let nwHost = NWEndpoint.Host(host)
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { return }

        let conn = NWConnection(host: nwHost, port: nwPort, using: makeTCPParams())
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                if silent {
                    Self.logger.info("WiFi TCP re-established to \(host):\(port)")
                    DebugLogger.shared.log("WIFI: TCP re-established (silent)", level: .info)
                    // Don't reset silentReconnectAttempts here — only reset when
                    // real data arrives in receiveLoop, to prevent infinite loops
                    // when TCP connects then immediately closes.
                } else {
                    Self.logger.info("WiFi connected to \(host):\(port)")
                    DebugLogger.shared.log("WIFI: connected to \(host):\(port)", level: .info)
                    DispatchQueue.main.async {
                        self.silentReconnectAttempts = 0
                        self.isConnected = true
                        self.connectedHost = host
                    }
                }
                self.receiveLoop()

            case .failed(let error):
                Self.logger.error("WiFi TCP failed: \(error)")
                if silent {
                    self.handleSilentReconnectFailure()
                } else {
                    DispatchQueue.main.async {
                        self.isConnected = false
                        self.connectedHost = nil
                    }
                }

            case .cancelled:
                if !silent {
                    DispatchQueue.main.async {
                        self.isConnected = false
                        self.connectedHost = nil
                    }
                }

            default:
                break
            }
        }
        conn.start(queue: queue)
        connection = conn
    }

    /// Called when a silent TCP re-establish fails.
    private func handleSilentReconnectFailure() {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.isUserDisconnect else { return }
            if self.silentReconnectAttempts < Self.maxSilentReconnects,
               let host = self.lastHost, let port = self.lastPort {
                let attempt = self.silentReconnectAttempts
                Self.logger.info("WiFi silent reconnect retry \(attempt)/\(Self.maxSilentReconnects)")
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    guard let self, !self.isUserDisconnect else { return }
                    self.establishTCP(host: host, port: port, silent: true)
                }
            } else {
                // Exhausted — surface the disconnect to the app
                Self.logger.warning("WiFi silent reconnect exhausted — disconnecting")
                DebugLogger.shared.log("WIFI: silent reconnect exhausted", level: .warning)
                self.isConnected = false
                self.connectedHost = nil
            }
        }
    }

    // MARK: - Send

    /// Send a binary frame with framing: `<` + length(2 LE) + frame data.
    public func sendFrame(_ frame: Data) {
        guard let connection, connection.state == .ready else { return }
        var framedData = Data([0x3C])
        var length = UInt16(frame.count).littleEndian
        framedData.append(Data(bytes: &length, count: 2))
        framedData.append(frame)

        connection.send(content: framedData, completion: .contentProcessed { error in
            if let error {
                Self.logger.error("WiFi send error: \(error)")
            }
        })
        Self.logger.debug("TX WiFi [\(frame.count) bytes]")
    }

    // MARK: - Receive

    /// Runs on the WiFi queue — reads data and parses frames.
    private func receiveLoop() {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                self.readBuffer.append(data)
                self.parseBinaryFrames()
                // Real data flowing — reset the silent reconnect counter.
                // This is the ONLY place it resets for silent reconnects,
                // preventing loops where TCP connects but immediately closes.
                DispatchQueue.main.async { self.silentReconnectAttempts = 0 }
            }
            if let error {
                // Real error — surface to app
                Self.logger.warning("WiFi connection error: \(error)")
                DebugLogger.shared.log("WIFI: connection error: \(error)", level: .warning)
                DispatchQueue.main.async {
                    guard !self.isUserDisconnect else { return }
                    self.connection?.cancel()
                    self.connection = nil
                    self.readBuffer = Data()
                    self.isConnected = false
                    self.connectedHost = nil
                }
                return
            }
            if isComplete {
                // TCP FIN from ESP32 lwIP idle — silently re-establish without
                // changing isConnected. The app never sees this drop.
                Self.logger.info("WiFi TCP closed by remote (idle) — re-establishing")
                DebugLogger.shared.log("WIFI: TCP idle close — re-establishing silently", level: .info)
                self.connection?.cancel()
                self.connection = nil
                self.readBuffer = Data()
                DispatchQueue.main.async {
                    self.silentReconnectAttempts += 1
                    guard self.silentReconnectAttempts <= Self.maxSilentReconnects,
                          let host = self.lastHost, let port = self.lastPort,
                          !self.isUserDisconnect else {
                        if self.silentReconnectAttempts > Self.maxSilentReconnects {
                            Self.logger.warning("WiFi silent reconnect exhausted (isComplete loop)")
                            DebugLogger.shared.log("WIFI: silent reconnect exhausted", level: .warning)
                            self.isConnected = false
                            self.connectedHost = nil
                        }
                        return
                    }
                    self.establishTCP(host: host, port: port, silent: true)
                }
                return
            }
            self.receiveLoop()
        }
    }

    /// Parses `>` (0x3E) + length(2 LE) + payload frames from readBuffer.
    /// Runs on the WiFi queue.
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
            guard readBuffer.count >= totalNeeded else { return }

            let frameData = Data(readBuffer[(si + 3)..<(si + totalNeeded)])
            readBuffer.removeFirst(totalNeeded)

            Self.logger.debug("RX WiFi frame [\(frameData.count) bytes]")
            DispatchQueue.main.async { [weak self] in
                self?.receivedDataSubject.send(frameData)
            }
        }
    }
}
