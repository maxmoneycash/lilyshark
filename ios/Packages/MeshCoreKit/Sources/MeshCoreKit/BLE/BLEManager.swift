//
//  BLEManager.swift
//  MeshCoreKit
//
//  CoreBluetooth central manager, scanning, connection, and data transport.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import CoreBluetooth
import Combine
import os.log
#if os(iOS) || targetEnvironment(macCatalyst)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Connection state for BLE device.
public enum BLEConnectionState: Equatable, Sendable {
    case disconnected
    case scanning
    case connecting
    case connected
    case ready // NUS service discovered, TX subscribed
}

/// A discovered MeshCore BLE peripheral.
public struct DiscoveredPeripheral: Identifiable, Equatable {
    public let id: UUID
    public let peripheral: CBPeripheral
    public let name: String
    public let rssi: Int

    public static func == (lhs: DiscoveredPeripheral, rhs: DiscoveredPeripheral) -> Bool {
        lhs.id == rhs.id && lhs.rssi == rhs.rssi
    }
}

/// Manages BLE communication with MeshCore devices via Nordic UART Service.
///
/// Handles scanning, connecting, service/characteristic discovery, background state
/// restoration, and auto-reconnect on disconnect.
public final class BLEManager: NSObject, ObservableObject {
    private static let logger = Logger(subsystem: "com.pommecore", category: "BLE")

    // MARK: - Published State

    @Published public private(set) var connectionState: BLEConnectionState = .disconnected
    @Published public private(set) var discoveredPeripherals: [DiscoveredPeripheral] = []
    @Published public private(set) var connectedDeviceName: String?
    @Published public private(set) var isPoweredOn: Bool = false

    /// User-facing BLE status message for error states (nil when no issue).
    @Published public private(set) var bleStatusMessage: String?

    // MARK: - Private Properties

    private var centralManager: CBCentralManager!
    private var connectedPeripheral: CBPeripheral?
    private var rxCharacteristic: CBCharacteristic?
    private var txCharacteristic: CBCharacteristic?
    private let bleQueue = DispatchQueue(label: BLEConstants.bleQueueLabel, qos: .userInitiated)

    /// When true, auto-reconnect on disconnect. Set to false on user-initiated disconnect.
    private var shouldAutoReconnect = false

    /// Number of auto-reconnect attempts remaining for unexpected disconnects.
    private var reconnectAttemptsRemaining = 0

    /// Maximum auto-reconnect attempts before giving up.
    private static let maxReconnectAttempts = 3

    /// Work item for the reconnect timeout (cancelled on successful reconnect).
    private var reconnectTimeoutWork: DispatchWorkItem?

    /// Set when an encryption/pairing error occurs — prevents auto-reconnect loop.
    private var pairingFailed = false

    /// True when scanning was started implicitly for reconnect (not by explicit user action).
    /// Only auto-connect on discover when this is true — prevents hijacking a deliberate device-switch scan.
    private var isAutoReconnectScan = false

    private static let savedPeripheralUUIDKey = "BLEManager.savedPeripheralUUID"

    private var savedPeripheralUUID: UUID? {
        get {
            guard let str = UserDefaults.standard.string(forKey: Self.savedPeripheralUUIDKey) else { return nil }
            return UUID(uuidString: str)
        }
        set {
            if let uuid = newValue {
                UserDefaults.standard.set(uuid.uuidString, forKey: Self.savedPeripheralUUIDKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.savedPeripheralUUIDKey)
            }
        }
    }

    /// Publisher for incoming data frames from the device TX characteristic.
    public let receivedDataSubject = PassthroughSubject<Data, Never>()

    // MARK: - Init

    public override init() {
        super.init()
    }

    /// Create the CBCentralManager. Call after onboarding to avoid premature BLE permission prompt.
    /// Safe to call multiple times — only initializes once.
    public func activate() {
        guard centralManager == nil else { return }
        centralManager = CBCentralManager(
            delegate: self,
            queue: bleQueue,
            options: [
                CBCentralManagerOptionRestoreIdentifierKey: BLEConstants.centralManagerRestoreIdentifier
            ]
        )

        #if os(macOS)
        // Clean disconnect before sleep to prevent stale BLE state on the radio
        // NSWorkspace is AppKit-only (not available in Catalyst)
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            DebugLogger.shared.log("macOS sleep — disconnecting BLE cleanly", level: .info)
            if let peripheral = self.connectedPeripheral {
                self.centralManager.cancelPeripheralConnection(peripheral)
            }
        }

        // Fresh scan on wake — BLE stack needs a moment to recover
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            DebugLogger.shared.log("macOS wake detected — resetting BLE", level: .info)

            // Cancel any stale connection
            if let peripheral = self.connectedPeripheral {
                self.centralManager.cancelPeripheralConnection(peripheral)
            }

            // Clear all state
            self.connectedPeripheral = nil
            self.rxCharacteristic = nil
            self.txCharacteristic = nil
            self.shouldAutoReconnect = false
            self.reconnectAttemptsRemaining = 0

            DispatchQueue.main.async {
                self.connectionState = .disconnected
                self.connectedDeviceName = nil
            }

            // Wait for BLE stack to reset after wake, then scan
            self.bleQueue.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                guard let self, self.centralManager.state == .poweredOn else { return }
                DebugLogger.shared.log("macOS wake: starting fresh scan", level: .info)
                self.startScanning()
            }
        }
        #endif
    }

    // MARK: - Public API

    /// Start scanning for MeshCore devices.
    /// Safe to call while connected — will not change connection state.
    /// Pass `forReconnect: true` when scanning is triggered internally to reconnect a known peripheral —
    /// this allows didDiscover to auto-connect. User-initiated scans leave it false so the user can
    /// freely pick any device without the app hijacking the selection.
    public func startScanning(forReconnect: Bool = false) {
        guard centralManager.state == .poweredOn else {
            Self.logger.warning("Cannot scan — Bluetooth not powered on (state: \(String(describing: self.centralManager.state.rawValue)))")
            return
        }

        #if os(iOS)
        // Don't scan if we have a pending reconnect — CoreBluetooth manages it
        if connectedPeripheral != nil && connectionState == .connecting {
            Self.logger.info("Skipping scan — reconnect pending for \(self.connectedPeripheral?.name ?? "unknown")")
            return
        }
        #endif

        DispatchQueue.main.async {
            self.discoveredPeripherals.removeAll()
            if self.connectionState != .ready && self.connectionState != .connected && self.connectionState != .connecting {
                self.connectionState = .scanning
            }
        }

        centralManager.scanForPeripherals(
            withServices: [BLEConstants.nusServiceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )

        isAutoReconnectScan = forReconnect
        Self.logger.info("Started scanning for MeshCore devices (forReconnect: \(forReconnect))")
    }

    /// Stop scanning. Safe to call at any time — only changes state if currently scanning.
    public func stopScanning() {
        centralManager.stopScan()
        DispatchQueue.main.async {
            // Only reset to disconnected if we were purely scanning (not connected)
            if self.connectionState == .scanning {
                self.connectionState = .disconnected
            }
        }
        Self.logger.info("Stopped scanning")
    }

    /// Connect to a discovered peripheral.
    public func connect(to peripheral: CBPeripheral) {
        stopScanning()

        DispatchQueue.main.async {
            self.connectionState = .connecting
        }

        shouldAutoReconnect = true
        pairingFailed = false
        reconnectAttemptsRemaining = Self.maxReconnectAttempts
        connectedPeripheral = peripheral
        peripheral.delegate = self
        savedPeripheralUUID = peripheral.identifier
        centralManager.connect(peripheral, options: nil)

        Self.logger.info("Connecting to \(peripheral.name ?? "unknown")")
        DebugLogger.shared.log("BLE: connecting to \(peripheral.name ?? "unknown")", level: .info)
    }

    /// Disconnect from the current peripheral.
    public func disconnect() {
        guard let peripheral = connectedPeripheral else { return }
        shouldAutoReconnect = false
        savedPeripheralUUID = nil
        centralManager.cancelPeripheralConnection(peripheral)
        Self.logger.info("Disconnecting from \(peripheral.name ?? "unknown")")
        DebugLogger.shared.log("BLE: disconnecting from \(peripheral.name ?? "unknown")", level: .info)
    }

    /// Clean disconnect for app termination — prevents stale BLE state on the radio.
    public func disconnectForTermination() {
        guard let peripheral = connectedPeripheral else { return }
        centralManager.cancelPeripheralConnection(peripheral)
        Self.logger.info("BLE: clean disconnect on app termination")
    }

    /// Write data to the device RX characteristic.
    public func send(data: Data) {
        guard let peripheral = connectedPeripheral,
              let rx = rxCharacteristic else {
            Self.logger.warning("Cannot send — not connected or RX characteristic not found")
            return
        }

        let writeType: CBCharacteristicWriteType = rx.properties.contains(.writeWithoutResponse)
            ? .withoutResponse
            : .withResponse

        peripheral.writeValue(data, for: rx, type: writeType)
        Self.logger.debug("Sent \(data.count) bytes to device")
    }
}

// MARK: - CBCentralManagerDelegate

extension BLEManager: CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Self.logger.info("Central manager state: \(String(describing: central.state.rawValue))")

        switch central.state {
        case .poweredOn:
            DispatchQueue.main.async {
                self.isPoweredOn = true
                self.bleStatusMessage = nil
            }
            // If we had a connected peripheral from restoration, re-discover services
            if let peripheral = connectedPeripheral {
                peripheral.delegate = self
                if peripheral.state == .connected {
                    peripheral.discoverServices([BLEConstants.nusServiceUUID])
                } else {
                    central.connect(peripheral, options: nil)
                }
            } else if let uuid = savedPeripheralUUID, !pairingFailed {
                // Force-kill → relaunch: retrieve the known peripheral by UUID and reconnect.
                // retrievePeripherals only works if the peripheral is already in this CBCentralManager
                // instance's cache. After force-kill the cache is empty, so we fall back to scanning
                // and let didDiscover auto-connect when the peripheral is found.
                let known = central.retrievePeripherals(withIdentifiers: [uuid])
                if let peripheral = known.first {
                    Self.logger.info("BLE: retrieved saved peripheral \(peripheral.name ?? uuid.uuidString) — reconnecting")
                    DispatchQueue.main.async { self.connectionState = .connecting }
                    shouldAutoReconnect = true
                    reconnectAttemptsRemaining = Self.maxReconnectAttempts
                    connectedPeripheral = peripheral
                    peripheral.delegate = self
                    central.connect(peripheral, options: nil)
                } else {
                    Self.logger.info("BLE: saved peripheral \(uuid) not in cache — scanning to rediscover")
                    shouldAutoReconnect = true
                    startScanning(forReconnect: true)
                }
            }
        case .poweredOff:
            Self.logger.warning("Bluetooth is powered off")
            DispatchQueue.main.async {
                self.isPoweredOn = false
                self.bleStatusMessage = String(localized: "Bluetooth is turned off. Enable Bluetooth in Settings to connect to your radio.")
                self.connectionState = .disconnected
                self.connectedPeripheral = nil
                self.rxCharacteristic = nil
                self.txCharacteristic = nil
            }
        case .unauthorized:
            Self.logger.warning("Bluetooth permission denied")
            DispatchQueue.main.async {
                self.isPoweredOn = false
                self.bleStatusMessage = String(localized: "Bluetooth access denied. Enable Bluetooth for MeshCore in Settings → Privacy → Bluetooth.")
                self.connectionState = .disconnected
                self.connectedPeripheral = nil
                self.rxCharacteristic = nil
                self.txCharacteristic = nil
            }
        case .unsupported:
            Self.logger.warning("Bluetooth not supported on this device")
            DispatchQueue.main.async {
                self.isPoweredOn = false
                self.bleStatusMessage = String(localized: "This device does not support Bluetooth Low Energy.")
                self.connectionState = .disconnected
                self.connectedPeripheral = nil
                self.rxCharacteristic = nil
                self.txCharacteristic = nil
            }
        default:
            break
        }
    }

    /// State restoration — called when iOS relaunches app after termination.
    public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        Self.logger.info("Restoring BLE state")

        if let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral],
           let peripheral = peripherals.first {
            peripheral.delegate = self
            connectedPeripheral = peripheral
            shouldAutoReconnect = true

            DispatchQueue.main.async {
                self.connectedDeviceName = peripheral.name
                self.connectionState = .connected
            }

            // Re-discover services to re-subscribe to TX notifications
            if peripheral.state == .connected {
                Self.logger.info("Restored connected peripheral — re-discovering services")
                peripheral.discoverServices([BLEConstants.nusServiceUUID])
            } else {
                Self.logger.info("Restored disconnected peripheral — queuing reconnect")
                central.connect(peripheral, options: nil)
                DispatchQueue.main.async {
                    self.connectionState = .connecting
                }

                // Timeout — don't stay stuck if peripheral never reconnects.
                // 30s allows for radio BLE advert intervals up to ~20s.
                bleQueue.asyncAfter(deadline: .now() + 30.0) { [weak self] in
                    guard let self else { return }
                    if self.connectionState != .ready && self.connectionState != .connected {
                        Self.logger.info("BLE RESTORE: timeout — giving up and scanning")
                        central.cancelPeripheralConnection(peripheral)
                        self.shouldAutoReconnect = false
                        DispatchQueue.main.async {
                            self.connectedPeripheral = nil
                            self.connectionState = .disconnected
                        }
                        self.bleQueue.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                            self?.startScanning(forReconnect: true)
                        }
                    }
                }
            }

            Self.logger.info("Restored peripheral: \(peripheral.name ?? "unknown"), state: \(peripheral.state.rawValue)")
        }
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        // We scan with NUS service UUID filter, so any device found here speaks NUS.
        // peripheral.name is often nil on the first callback — fall back to advertisement data.
        let name = peripheral.name
            ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String
            ?? "MeshCore Device"

        // Auto-connect to the previously-connected peripheral when rediscovered during a reconnect scan.
        // isAutoReconnectScan is false for user-initiated scans so deliberate device-switching is never hijacked.
        if isAutoReconnectScan, let saved = savedPeripheralUUID, peripheral.identifier == saved, !pairingFailed {
            Self.logger.info("BLE: rediscovered saved peripheral \(name) — auto-connecting")
            shouldAutoReconnect = true
            reconnectAttemptsRemaining = Self.maxReconnectAttempts
            connectedPeripheral = peripheral
            peripheral.delegate = self
            central.stopScan()
            DispatchQueue.main.async {
                self.connectionState = .connecting
            }
            central.connect(peripheral, options: nil)
            return
        }

        let discovered = DiscoveredPeripheral(
            id: peripheral.identifier,
            peripheral: peripheral,
            name: name,
            rssi: RSSI.intValue
        )

        DispatchQueue.main.async {
            if let index = self.discoveredPeripherals.firstIndex(where: { $0.id == discovered.id }) {
                self.discoveredPeripherals[index] = discovered
            } else {
                self.discoveredPeripherals.append(discovered)
            }
        }

        Self.logger.info("Discovered \(name) (RSSI: \(RSSI.intValue))")
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        #if os(iOS)
        let bgState = DispatchQueue.main.sync { UIApplication.shared.applicationState }
        let isBackground = bgState != .active
        Self.logger.info("Connected to \(peripheral.name ?? "unknown") (background: \(isBackground))")
        #else
        Self.logger.info("Connected to \(peripheral.name ?? "unknown")")
        #endif

        reconnectAttemptsRemaining = Self.maxReconnectAttempts
        reconnectTimeoutWork?.cancel()
        reconnectTimeoutWork = nil

        DispatchQueue.main.async {
            self.connectionState = .connected
            self.connectedDeviceName = peripheral.name
        }

        peripheral.discoverServices([BLEConstants.nusServiceUUID])
    }

    public func centralManager(
        _ central: CBCentralManager,
        didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        Self.logger.error("Failed to connect: \(error?.localizedDescription ?? "unknown error")")
        DebugLogger.shared.log("BLE: connect failed — \(error?.localizedDescription ?? "unknown")", level: .error)

        // Don't retry on pairing/auth failures
        let desc = error?.localizedDescription.lowercased() ?? ""
        let isPairingFailure = desc.contains("pair") || desc.contains("auth") || desc.contains("encrypt")

        #if os(iOS)
        if shouldAutoReconnect && !isPairingFailure {
            Self.logger.info("iOS: re-queuing connect after failure")
            central.connect(peripheral, options: nil)
            return
        }
        #endif

        DispatchQueue.main.async {
            self.connectionState = .disconnected
            self.connectedPeripheral = nil
        }
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDisconnectPeripheral peripheral: CBPeripheral,
        error: Error?
    ) {
        #if os(iOS)
        let bgState = DispatchQueue.main.sync { UIApplication.shared.applicationState }
        let isBackground = bgState != .active
        Self.logger.info("Disconnected from \(peripheral.name ?? "unknown") (background: \(isBackground), error: \(error?.localizedDescription ?? "none"))")
        #else
        Self.logger.info("Disconnected from \(peripheral.name ?? "unknown"), error: \(error?.localizedDescription ?? "none")")
        #endif
        DebugLogger.shared.log("BLE: disconnected from \(peripheral.name ?? "unknown")\(error != nil ? " (unexpected)" : "")", level: error != nil ? .warning : .info)

        DispatchQueue.main.async {
            self.rxCharacteristic = nil
            self.txCharacteristic = nil
        }

        // Detect pairing/authentication failures — don't auto-reconnect (would loop the PIN prompt)
        if pairingFailed {
            Self.logger.warning("BLE: pairing/auth failure — stopping auto-reconnect")
            DebugLogger.shared.log("BLE: pairing cancelled or failed — tap a device to retry", level: .warning)
            pairingFailed = false
            shouldAutoReconnect = false
            reconnectAttemptsRemaining = 0
            reconnectTimeoutWork?.cancel()
            reconnectTimeoutWork = nil
            DispatchQueue.main.async {
                self.connectionState = .disconnected
                self.connectedPeripheral = nil
                self.connectedDeviceName = nil
            }
            self.bleQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.startScanning()
            }
            return
        }

        let isUnexpected = error != nil && shouldAutoReconnect

        #if os(iOS)
        if shouldAutoReconnect {
            // iOS: ALWAYS queue reconnect for unexpected disconnects.
            // CoreBluetooth manages the reconnect queue even while the app is suspended.
            // This is the key to background BLE — never give up, never clear connectedPeripheral.
            Self.logger.info("iOS: queuing reconnect for \(peripheral.name ?? "unknown") (background-safe)")

            DispatchQueue.main.async {
                self.connectionState = .connecting
            }
            // CoreBluetooth will connect when the device becomes available again
            central.connect(peripheral, options: nil)

            // Safety timeout — if reconnect hasn't succeeded after 60s, cancel and scan.
            // This prevents stuck .connecting state if the radio is powered off or out of range.
            reconnectTimeoutWork?.cancel()
            let timeout = DispatchWorkItem { [weak self] in
                guard let self else { return }
                guard self.connectionState == .connecting else { return }
                Self.logger.warning("iOS: reconnect timeout after 60s — cancelling and scanning")
                DebugLogger.shared.log("BLE: reconnect timeout — scanning for devices", level: .warning)
                central.cancelPeripheralConnection(peripheral)
                self.shouldAutoReconnect = false
                DispatchQueue.main.async {
                    self.connectionState = .disconnected
                    self.connectedPeripheral = nil
                    self.connectedDeviceName = nil
                }
                self.bleQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                    self?.startScanning(forReconnect: true)
                }
            }
            reconnectTimeoutWork = timeout
            bleQueue.asyncAfter(deadline: .now() + 60.0, execute: timeout)
        } else {
            // User-initiated disconnect — clean up fully and auto-scan
            reconnectTimeoutWork?.cancel()
            reconnectTimeoutWork = nil

            DispatchQueue.main.async {
                self.connectionState = .disconnected
                self.connectedPeripheral = nil
                self.connectedDeviceName = nil
            }

            self.bleQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                guard let self, self.centralManager.state == .poweredOn,
                      self.connectionState == .disconnected else { return }
                Self.logger.info("iOS: auto-scanning after user disconnect")
                self.startScanning()
            }
        }
        #else
        if isUnexpected && reconnectAttemptsRemaining > 0 {
            // Unexpected disconnect — retry up to 3 times with 2-second delays
            reconnectAttemptsRemaining -= 1
            let attempt = Self.maxReconnectAttempts - reconnectAttemptsRemaining
            Self.logger.info("Auto-reconnect attempt \(attempt)/\(Self.maxReconnectAttempts) for \(peripheral.name ?? "unknown")")

            DispatchQueue.main.async {
                self.connectionState = .connecting
            }

            self.bleQueue.asyncAfter(deadline: .now() + 2.0) {
                central.connect(peripheral, options: nil)
            }
        } else {
            // User-initiated disconnect OR reconnect attempts exhausted
            shouldAutoReconnect = false
            reconnectAttemptsRemaining = 0

            DispatchQueue.main.async {
                self.connectionState = .disconnected
                // Keep connectedPeripheral on exhausted reconnect so scan+didDiscover can auto-reconnect.
                // Only clear on user-initiated disconnect (isUnexpected == false).
                if !isUnexpected { self.connectedPeripheral = nil }
                self.connectedDeviceName = nil
            }

            // Auto-scan after 2 seconds so the device is re-discoverable
            self.bleQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                guard let self, self.centralManager.state == .poweredOn,
                      self.connectionState == .disconnected else { return }
                Self.logger.info("Auto-scanning after disconnect")
                self.startScanning()
            }
        }
        #endif
    }
}

// MARK: - CBPeripheralDelegate

extension BLEManager: CBPeripheralDelegate {
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            Self.logger.error("Service discovery error: \(error.localizedDescription)")
            return
        }

        guard let service = peripheral.services?.first(where: { $0.uuid == BLEConstants.nusServiceUUID }) else {
            Self.logger.warning("NUS service not found on peripheral")
            return
        }

        peripheral.discoverCharacteristics(
            [BLEConstants.nusRXCharacteristicUUID, BLEConstants.nusTXCharacteristicUUID],
            for: service
        )
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        if let error {
            Self.logger.error("Characteristic discovery error: \(error.localizedDescription)")
            return
        }

        guard let characteristics = service.characteristics else { return }

        for characteristic in characteristics {
            switch characteristic.uuid {
            case BLEConstants.nusRXCharacteristicUUID:
                rxCharacteristic = characteristic
                Self.logger.info("Found NUS RX characteristic")

            case BLEConstants.nusTXCharacteristicUUID:
                txCharacteristic = characteristic
                peripheral.setNotifyValue(true, for: characteristic)
                Self.logger.info("Found NUS TX characteristic — subscribing to notifications")

            default:
                break
            }
        }

        if rxCharacteristic != nil && txCharacteristic != nil {
            DispatchQueue.main.async {
                self.connectionState = .ready
            }
            Self.logger.info("NUS service ready — device is fully connected")
            DebugLogger.shared.log("BLE: connected and ready", level: .info)
        }
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        if let error {
            Self.logger.error("Characteristic update error: \(error.localizedDescription)")
            return
        }

        guard characteristic.uuid == BLEConstants.nusTXCharacteristicUUID,
              let data = characteristic.value else { return }

        Self.logger.debug("Received \(data.count) bytes from device")
        receivedDataSubject.send(data)
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        if let error {
            Self.logger.error("Notification state error: \(error.localizedDescription)")
            // "Encryption is insufficient" means pairing was cancelled or failed.
            // Clear the saved UUID so a force-kill + relaunch doesn't loop back to this peripheral.
            if error.localizedDescription.lowercased().contains("encrypt") {
                pairingFailed = true
                savedPeripheralUUID = nil
            }
            return
        }

        Self.logger.info("Notification state updated for \(characteristic.uuid): \(characteristic.isNotifying)")
    }
}
