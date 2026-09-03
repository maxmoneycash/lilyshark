//
//  MeshtasticBLEManager.swift
//  MeshtasticKit
//
//  CoreBluetooth central for the Meshtastic client GATT service: scan, connect,
//  drain FromRadio, write ToRadio.
//

import Combine
import CoreBluetooth
import Foundation
import os.log

/// Connection state for a Meshtastic BLE peripheral.
///
/// Mirrors `MeshCoreKit.BLEConnectionState` case for case so the app can hold
/// one state variable for either transport, but it is a separate type: the two
/// managers reach `.ready` on different evidence and must not be able to
/// silently stand in for each other.
public enum MeshtasticBLEConnectionState: Equatable, Sendable {
    case disconnected
    case scanning
    case connecting
    /// Link is up; the three characteristics are still being discovered.
    case connected
    /// ToRadio and FromRadio are in hand and FromNum notifications are live.
    case ready
}

/// A discovered peripheral advertising the Meshtastic client service.
public struct DiscoveredMeshtasticDevice: Identifiable, Equatable {
    public let id: UUID
    public let peripheral: CBPeripheral
    public let name: String
    public let rssi: Int

    public init(id: UUID, peripheral: CBPeripheral, name: String, rssi: Int) {
        self.id = id
        self.peripheral = peripheral
        self.name = name
        self.rssi = rssi
    }

    public static func == (lhs: DiscoveredMeshtasticDevice, rhs: DiscoveredMeshtasticDevice) -> Bool {
        lhs.id == rhs.id && lhs.rssi == rhs.rssi
    }
}

/// Manages BLE communication with a Meshtastic-speaking radio — including a
/// Lilyshark deck, which presents exactly this service.
///
/// The conversation is not the Nordic UART framing `MeshCoreKit.BLEManager`
/// speaks. There is no notifying data characteristic: the radio queues
/// protobufs, bumps a counter on FromNum to say "come look", and the client
/// reads FromRadio over and over until a read comes back empty. Writes go the
/// other way one protobuf per ATT write. That difference is why this lives
/// beside `BLEManager` rather than inside it.
///
/// This class is the transport only. It hands whole FromRadio payloads to
/// `fromRadioSubject` and takes whole ToRadio payloads from `send(toRadio:)`;
/// it never inspects a protobuf, so it stays independent of the protocol layer.
public final class MeshtasticBLEManager: NSObject, ObservableObject {
    private static let logger = Logger(subsystem: "com.lilyshark.meshtastic", category: "BLE")

    // MARK: - Published State

    @Published public private(set) var connectionState: MeshtasticBLEConnectionState = .disconnected
    @Published public private(set) var discoveredDevices: [DiscoveredMeshtasticDevice] = []
    @Published public private(set) var connectedDeviceName: String?
    @Published public private(set) var isPoweredOn: Bool = false

    /// User-facing status for error states (nil when there is nothing to say).
    @Published public private(set) var statusMessage: String?

    /// Latest FromNum counter. Purely diagnostic — gaps in it are normal, since
    /// one drain can carry away several notifications' worth of packets.
    @Published public private(set) var lastFromNum: UInt32 = 0

    /// One event per FromRadio protobuf, in the order the radio queued them.
    /// Delivered on the BLE queue; subscribers that touch UI must hop to main.
    public let fromRadioSubject = PassthroughSubject<Data, Never>()

    // MARK: - Configuration

    /// Backstop drain interval while connected. FromNum is the primary signal;
    /// this exists because the firmware only raises it while it believes a phone
    /// is connected, so a packet queued in the gap between the link coming up
    /// and the radio noticing would otherwise sit unread until the next one
    /// arrived. Set to nil to rely on notifications alone.
    public var backstopDrainInterval: TimeInterval? = 30.0

    // MARK: - Private Properties

    private var centralManager: CBCentralManager?
    private var connectedPeripheral: CBPeripheral?
    private var toRadioCharacteristic: CBCharacteristic?
    private var fromRadioCharacteristic: CBCharacteristic?
    private var fromNumCharacteristic: CBCharacteristic?
    private let bleQueue = DispatchQueue(label: MeshtasticBLEConstants.bleQueueLabel, qos: .userInitiated)

    /// When true, reconnect on an unexpected disconnect. Cleared on a
    /// user-initiated disconnect so walking away stays walked away.
    private var shouldAutoReconnect = false

    /// Watchdog for a reconnect that never lands, cancelled once it does.
    private var reconnectTimeoutWork: DispatchWorkItem?

    /// Seconds to wait for a queued reconnect before giving up and scanning.
    /// CoreBluetooth will wait forever on its own, which reads to the operator
    /// as a hung app when the deck is simply switched off.
    private static let reconnectTimeout: TimeInterval = 60.0

    /// True when the current scan exists to find a known peripheral again. Only
    /// then may discovery auto-connect — a scan the operator started is theirs
    /// to choose from.
    private var isAutoReconnectScan = false

    /// A FromRadio read is outstanding.
    private var isDraining = false

    /// A reason to drain arrived while one was already running.
    private var drainPending = false

    /// Reads issued in the current drain pass, against `maxReadsPerDrain`.
    private var readsThisDrain = 0

    /// ToRadio payloads waiting for the link. CoreBluetooth serialises writes
    /// itself, but the queue is what lets `send` report a backlog instead of
    /// handing the radio more than its eight-deep inbox can hold.
    private var pendingWrites: [Data] = []
    private var isWriting = false

    /// Set when the payload now going out is the parting word — the link is
    /// dropped as soon as its write completes.
    private var isWritingFarewell = false

    private var backstopDrainTimer: DispatchSourceTimer?

    private static let savedPeripheralUUIDKey = "MeshtasticBLEManager.savedPeripheralUUID"

    private var savedPeripheralUUID: UUID? {
        get {
            guard let raw = UserDefaults.standard.string(forKey: Self.savedPeripheralUUIDKey) else { return nil }
            return UUID(uuidString: raw)
        }
        set {
            if let uuid = newValue {
                UserDefaults.standard.set(uuid.uuidString, forKey: Self.savedPeripheralUUIDKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.savedPeripheralUUIDKey)
            }
        }
    }

    // MARK: - Init

    public override init() {
        super.init()
    }

    /// Create the CBCentralManager. Kept out of `init` so the app can finish
    /// onboarding before iOS shows the Bluetooth permission prompt. Safe to
    /// call more than once.
    public func activate() {
        guard centralManager == nil else { return }
        centralManager = CBCentralManager(
            delegate: self,
            queue: bleQueue,
            options: [
                CBCentralManagerOptionRestoreIdentifierKey: MeshtasticBLEConstants.centralManagerRestoreIdentifier
            ]
        )
    }

    // MARK: - Public API

    /// Scan for radios advertising the Meshtastic client service.
    ///
    /// Pass `forReconnect: true` only for scans the app started by itself to
    /// find a known deck again; that is the one case where discovery may
    /// connect without the operator choosing.
    public func startScanning(forReconnect: Bool = false) {
        guard let central = centralManager else {
            Self.logger.warning("Cannot scan — activate() has not been called")
            return
        }
        guard central.state == .poweredOn else {
            Self.logger.warning("Cannot scan — Bluetooth not powered on (state: \(central.state.rawValue))")
            return
        }

        DispatchQueue.main.async {
            self.discoveredDevices.removeAll()
            switch self.connectionState {
            case .disconnected, .scanning:
                self.connectionState = .scanning
            case .connecting, .connected, .ready:
                break
            }
        }

        isAutoReconnectScan = forReconnect
        central.scanForPeripherals(
            withServices: [MeshtasticBLEConstants.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
        Self.logger.info("Scanning for Meshtastic radios (forReconnect: \(forReconnect))")
    }

    /// Stop scanning. Only clears state when scanning was all that was running.
    public func stopScanning() {
        centralManager?.stopScan()
        isAutoReconnectScan = false
        DispatchQueue.main.async {
            if self.connectionState == .scanning {
                self.connectionState = .disconnected
            }
        }
    }

    /// Connect to a discovered radio.
    public func connect(to peripheral: CBPeripheral) {
        guard let central = centralManager else { return }
        stopScanning()

        DispatchQueue.main.async { self.connectionState = .connecting }

        shouldAutoReconnect = true
        connectedPeripheral = peripheral
        peripheral.delegate = self
        savedPeripheralUUID = peripheral.identifier
        central.connect(peripheral, options: nil)

        Self.logger.info("Connecting to \(peripheral.name ?? "unknown")")
    }

    /// Disconnect at the operator's request.
    ///
    /// `farewell` is written before the link drops — a Meshtastic client is
    /// expected to send `ToRadio{disconnect: true}` so the radio stops queuing
    /// for a phone that has gone. The bytes are opaque here; encoding them is
    /// the protocol layer's job.
    public func disconnect(farewell: Data? = nil) {
        guard let peripheral = connectedPeripheral else { return }
        shouldAutoReconnect = false
        savedPeripheralUUID = nil

        guard let farewell, !farewell.isEmpty else {
            centralManager?.cancelPeripheralConnection(peripheral)
            Self.logger.info("Disconnecting from \(peripheral.name ?? "unknown")")
            return
        }

        bleQueue.async { [weak self] in
            guard let self else { return }
            // Commands queued for a session the operator is ending have no one
            // left to answer them, and the farewell must be the write in flight
            // when the completion arrives or the link would drop on the wrong one.
            self.pendingWrites = [farewell]
            self.isWritingFarewell = true
            self.pumpWritesLocked()
            // A radio that never acknowledges the farewell must not be able to
            // hold the app connected; drop the link regardless.
            self.bleQueue.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                guard let self, self.isWritingFarewell else { return }
                self.isWritingFarewell = false
                self.centralManager?.cancelPeripheralConnection(peripheral)
            }
        }
    }

    /// Drop the link without ceremony, for app termination. Leaves the saved
    /// peripheral in place so the next launch reconnects.
    public func disconnectForTermination() {
        guard let peripheral = connectedPeripheral else { return }
        centralManager?.cancelPeripheralConnection(peripheral)
        Self.logger.info("Clean disconnect on termination")
    }

    /// Queue one ToRadio protobuf.
    ///
    /// Returns false when the payload is refused outright — too large for the
    /// radio to accept, or nowhere to send it. A false return means nothing was
    /// queued; a true return means it was accepted for delivery, not that it
    /// arrived.
    @discardableResult
    public func send(toRadio payload: Data) -> Bool {
        guard !payload.isEmpty else { return false }
        guard payload.count <= MeshtasticBLEConstants.maxToRadioPayload else {
            Self.logger.error("Refusing \(payload.count)-byte ToRadio write — radio accepts at most \(MeshtasticBLEConstants.maxToRadioPayload)")
            return false
        }
        guard connectedPeripheral != nil else {
            Self.logger.warning("Cannot send — no connected radio")
            return false
        }

        bleQueue.async { [weak self] in
            guard let self else { return }
            guard self.pendingWrites.count < MeshtasticBLEConstants.maxPendingWrites else {
                Self.logger.error("Dropping ToRadio write — \(self.pendingWrites.count) already waiting, link is not draining")
                DispatchQueue.main.async {
                    self.statusMessage = String(localized: "The radio has stopped accepting messages. Disconnect and reconnect to recover.")
                }
                return
            }
            self.pendingWrites.append(payload)
            self.pumpWritesLocked()
        }
        return true
    }

    /// Read FromRadio until it comes back empty.
    ///
    /// Called automatically on every FromNum notification and once the link is
    /// ready. Exposed because the protocol layer sometimes knows to look
    /// without being told — after writing `want_config_id`, for instance.
    public func requestDrain() {
        bleQueue.async { [weak self] in self?.startDrainLocked() }
    }

    // MARK: - Draining FromRadio

    /// Begin or extend a drain pass. Must run on `bleQueue`.
    private func startDrainLocked() {
        guard let peripheral = connectedPeripheral,
              let fromRadio = fromRadioCharacteristic,
              peripheral.state == .connected else { return }

        // Only one read may be outstanding: a second `readValue` would return
        // the *next* queued protobuf, and the two responses would be
        // indistinguishable at the delegate.
        guard !isDraining else {
            drainPending = true
            return
        }

        isDraining = true
        readsThisDrain = 0
        peripheral.readValue(for: fromRadio)
    }

    /// End the current pass, starting another if something asked while it ran.
    private func finishDrainLocked() {
        isDraining = false
        readsThisDrain = 0
        guard drainPending else { return }
        drainPending = false
        startDrainLocked()
    }

    private func handleFromRadioValue(_ value: Data?, on peripheral: CBPeripheral) {
        guard isDraining else {
            // A read nobody asked for: the radio has already handed the payload
            // over and dropped it, so it must still be published or it is lost.
            if let value, !value.isEmpty { fromRadioSubject.send(value) }
            return
        }

        guard let value, !value.isEmpty else {
            Self.logger.debug("FromRadio drained after \(self.readsThisDrain) packets")
            finishDrainLocked()
            return
        }

        warnIfPayloadNeededLongRead(value, on: peripheral)
        fromRadioSubject.send(value)
        readsThisDrain += 1

        guard readsThisDrain < MeshtasticBLEConstants.maxReadsPerDrain else {
            // The radio's own outbound queue is eight deep and the whole config
            // dump is under twenty messages, so passing this cap means it is
            // refilling as fast as we read. Resuming after a pause is what makes
            // that a slow loop with a warning in it rather than a pegged CPU.
            Self.logger.warning("FromRadio still returning data after \(MeshtasticBLEConstants.maxReadsPerDrain) reads — pausing before the next pass")
            isDraining = false
            readsThisDrain = 0
            drainPending = false
            bleQueue.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                self?.startDrainLocked()
            }
            return
        }

        guard let fromRadio = fromRadioCharacteristic else {
            finishDrainLocked()
            return
        }
        peripheral.readValue(for: fromRadio)
    }

    /// Flag a payload that could not have fitted in one ATT read response.
    ///
    /// A value longer than ATT_MTU-1 makes CoreBluetooth issue a blob read, and
    /// the Lilyshark firmware pops a fresh protobuf on every read callback
    /// rather than serving offsets into the one it already handed out. The
    /// continuation therefore carries the *next* message's bytes: one packet
    /// arrives corrupt and another vanishes. Nothing on this side can prevent
    /// it, so the least dishonest thing is to say so in the log.
    private func warnIfPayloadNeededLongRead(_ value: Data, on peripheral: CBPeripheral) {
        // maximumWriteValueLength(for: .withoutResponse) is ATT_MTU-3, so the
        // largest single read response is that plus two.
        let singleReadCapacity = peripheral.maximumWriteValueLength(for: .withoutResponse) + 2
        guard value.count > singleReadCapacity else { return }
        Self.logger.error("FromRadio payload of \(value.count) bytes exceeds the \(singleReadCapacity)-byte read response — it was reassembled from a blob read and is probably spliced with the next packet")
    }

    // MARK: - Writing ToRadio

    /// Send the next queued payload if the link is idle. Must run on `bleQueue`.
    private func pumpWritesLocked() {
        guard !isWriting,
              !pendingWrites.isEmpty,
              let peripheral = connectedPeripheral,
              let toRadio = toRadioCharacteristic,
              peripheral.state == .connected else { return }

        let payload = pendingWrites.removeFirst()
        isWriting = true
        // The firmware declares ToRadio write-only with no
        // write-without-response property, and one protobuf per write is the
        // whole framing, so an unacknowledged write would lose the only signal
        // that the radio took it.
        peripheral.writeValue(payload, for: toRadio, type: .withResponse)
    }

    // MARK: - Backstop Drain

    private func startBackstopDrainLocked() {
        stopBackstopDrainLocked()
        guard let interval = backstopDrainInterval else { return }
        let timer = DispatchSource.makeTimerSource(queue: bleQueue)
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in self?.startDrainLocked() }
        timer.resume()
        backstopDrainTimer = timer
    }

    private func stopBackstopDrainLocked() {
        backstopDrainTimer?.cancel()
        backstopDrainTimer = nil
    }

    // MARK: - Teardown

    /// Forget everything tied to a link that is gone. Must run on `bleQueue`.
    private func clearLinkStateLocked() {
        stopBackstopDrainLocked()
        toRadioCharacteristic = nil
        fromRadioCharacteristic = nil
        fromNumCharacteristic = nil
        isDraining = false
        drainPending = false
        readsThisDrain = 0
        isWriting = false
        isWritingFarewell = false
        // Queued writes belong to a conversation that no longer exists;
        // replaying them on the next link would resend stale commands.
        pendingWrites.removeAll()
    }
}

// MARK: - CBCentralManagerDelegate

extension MeshtasticBLEManager: CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Self.logger.info("Central state: \(central.state.rawValue)")

        switch central.state {
        case .poweredOn:
            DispatchQueue.main.async {
                self.isPoweredOn = true
                self.statusMessage = nil
            }
            if let peripheral = connectedPeripheral {
                peripheral.delegate = self
                if peripheral.state == .connected {
                    peripheral.discoverServices([MeshtasticBLEConstants.serviceUUID])
                } else {
                    central.connect(peripheral, options: nil)
                }
            } else if let uuid = savedPeripheralUUID {
                // After a force-quit the central's cache is empty, so the
                // retrieve fails and scanning is the only way back to a deck
                // the operator already chose.
                if let peripheral = central.retrievePeripherals(withIdentifiers: [uuid]).first {
                    Self.logger.info("Reconnecting saved radio \(peripheral.name ?? uuid.uuidString)")
                    shouldAutoReconnect = true
                    connectedPeripheral = peripheral
                    peripheral.delegate = self
                    DispatchQueue.main.async { self.connectionState = .connecting }
                    central.connect(peripheral, options: nil)
                } else {
                    shouldAutoReconnect = true
                    startScanning(forReconnect: true)
                }
            }

        case .poweredOff:
            reportUnavailable(String(localized: "Bluetooth is turned off. Enable Bluetooth in Settings to connect to your deck."))

        case .unauthorized:
            reportUnavailable(String(localized: "Bluetooth access denied. Enable Bluetooth for this app in Settings → Privacy → Bluetooth."))

        case .unsupported:
            reportUnavailable(String(localized: "This device does not support Bluetooth Low Energy."))

        default:
            break
        }
    }

    private func reportUnavailable(_ message: String) {
        Self.logger.warning("Bluetooth unavailable: \(message)")
        clearLinkStateLocked()
        DispatchQueue.main.async {
            self.isPoweredOn = false
            self.statusMessage = message
            self.connectionState = .disconnected
            self.connectedDeviceName = nil
        }
        connectedPeripheral = nil
    }

    /// Called when iOS relaunches the app because of a BLE event.
    public func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        guard let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral],
              let peripheral = peripherals.first else {
            Self.logger.info("Nothing to restore")
            return
        }

        peripheral.delegate = self
        connectedPeripheral = peripheral
        shouldAutoReconnect = true

        DispatchQueue.main.async {
            self.connectedDeviceName = peripheral.name
            self.connectionState = peripheral.state == .connected ? .connected : .connecting
        }

        if peripheral.state == .connected {
            // Restoration returns the link but not the subscription, and a
            // FromNum we are not subscribed to is a packet we never hear about.
            peripheral.discoverServices([MeshtasticBLEConstants.serviceUUID])
        } else {
            central.connect(peripheral, options: nil)
            scheduleReconnectWatchdog(for: peripheral, on: central)
        }
        Self.logger.info("Restored \(peripheral.name ?? "unknown") (state: \(peripheral.state.rawValue))")
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        // The scan is filtered to the Meshtastic service, so anything here
        // speaks it. `peripheral.name` is often nil on the first callback.
        let name = peripheral.name
            ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String
            ?? MeshtasticBLEConstants.defaultDeviceName

        if isAutoReconnectScan, peripheral.identifier == savedPeripheralUUID {
            Self.logger.info("Rediscovered saved radio \(name) — connecting")
            central.stopScan()
            isAutoReconnectScan = false
            shouldAutoReconnect = true
            connectedPeripheral = peripheral
            peripheral.delegate = self
            DispatchQueue.main.async { self.connectionState = .connecting }
            central.connect(peripheral, options: nil)
            return
        }

        let discovered = DiscoveredMeshtasticDevice(
            id: peripheral.identifier,
            peripheral: peripheral,
            name: name,
            rssi: RSSI.intValue
        )

        DispatchQueue.main.async {
            if let index = self.discoveredDevices.firstIndex(where: { $0.id == discovered.id }) {
                self.discoveredDevices[index] = discovered
            } else {
                self.discoveredDevices.append(discovered)
            }
        }
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        Self.logger.info("Connected to \(peripheral.name ?? "unknown")")
        reconnectTimeoutWork?.cancel()
        reconnectTimeoutWork = nil

        DispatchQueue.main.async {
            self.connectionState = .connected
            self.connectedDeviceName = peripheral.name
        }

        peripheral.discoverServices([MeshtasticBLEConstants.serviceUUID])
    }

    public func centralManager(
        _ central: CBCentralManager,
        didFailToConnect peripheral: CBPeripheral,
        error: Error?
    ) {
        Self.logger.error("Connect failed: \(error?.localizedDescription ?? "unknown error")")

        if shouldAutoReconnect {
            central.connect(peripheral, options: nil)
            scheduleReconnectWatchdog(for: peripheral, on: central)
            return
        }

        connectedPeripheral = nil
        DispatchQueue.main.async { self.connectionState = .disconnected }
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDisconnectPeripheral peripheral: CBPeripheral,
        error: Error?
    ) {
        Self.logger.info("Disconnected from \(peripheral.name ?? "unknown") (error: \(error?.localizedDescription ?? "none"))")
        clearLinkStateLocked()

        guard shouldAutoReconnect else {
            connectedPeripheral = nil
            reconnectTimeoutWork?.cancel()
            reconnectTimeoutWork = nil
            DispatchQueue.main.async {
                self.connectionState = .disconnected
                self.connectedDeviceName = nil
            }
            return
        }

        // CoreBluetooth honours a connect request for a peripheral that is not
        // there yet and completes it whenever the radio comes back, including
        // while the app is suspended. Keeping the peripheral is what makes a
        // deck that went out of range reconnect by itself.
        DispatchQueue.main.async { self.connectionState = .connecting }
        central.connect(peripheral, options: nil)
        scheduleReconnectWatchdog(for: peripheral, on: central)
    }

    /// Give up on a pending reconnect after `reconnectTimeout` and go back to
    /// scanning, so a deck that was switched off does not leave the app
    /// pretending it is about to reappear.
    private func scheduleReconnectWatchdog(for peripheral: CBPeripheral, on central: CBCentralManager) {
        reconnectTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            // CoreBluetooth owns `peripheral.state`, so it answers "did the link
            // come back" without reading published state off the main queue.
            guard let self, peripheral.state != .connected else { return }
            Self.logger.warning("Reconnect timed out — scanning instead")
            central.cancelPeripheralConnection(peripheral)
            self.shouldAutoReconnect = false
            self.connectedPeripheral = nil
            DispatchQueue.main.async {
                self.connectionState = .disconnected
                self.connectedDeviceName = nil
            }
            self.bleQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.startScanning(forReconnect: true)
            }
        }
        reconnectTimeoutWork = work
        bleQueue.asyncAfter(deadline: .now() + Self.reconnectTimeout, execute: work)
    }
}

// MARK: - CBPeripheralDelegate

extension MeshtasticBLEManager: CBPeripheralDelegate {
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            Self.logger.error("Service discovery failed: \(error.localizedDescription)")
            return
        }

        guard let service = peripheral.services?.first(where: { $0.uuid == MeshtasticBLEConstants.serviceUUID }) else {
            Self.logger.warning("Meshtastic service absent — this radio speaks something else")
            DispatchQueue.main.async {
                self.statusMessage = String(localized: "That device is not running a Meshtastic-compatible radio.")
            }
            return
        }

        peripheral.discoverCharacteristics(
            [
                MeshtasticBLEConstants.toRadioUUID,
                MeshtasticBLEConstants.fromRadioUUID,
                MeshtasticBLEConstants.fromNumUUID
            ],
            for: service
        )
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        if let error {
            Self.logger.error("Characteristic discovery failed: \(error.localizedDescription)")
            return
        }

        for characteristic in service.characteristics ?? [] {
            switch characteristic.uuid {
            case MeshtasticBLEConstants.toRadioUUID:
                toRadioCharacteristic = characteristic
            case MeshtasticBLEConstants.fromRadioUUID:
                fromRadioCharacteristic = characteristic
            case MeshtasticBLEConstants.fromNumUUID:
                fromNumCharacteristic = characteristic
                peripheral.setNotifyValue(true, for: characteristic)
            default:
                break
            }
        }

        guard toRadioCharacteristic != nil, fromRadioCharacteristic != nil, fromNumCharacteristic != nil else {
            Self.logger.warning("Meshtastic service is missing one of its three characteristics")
            return
        }
        Self.logger.info("Meshtastic characteristics discovered — waiting on FromNum subscription")
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard characteristic.uuid == MeshtasticBLEConstants.fromNumUUID else { return }

        if let error {
            Self.logger.error("FromNum subscription failed: \(error.localizedDescription)")
            // "Encryption is insufficient" is a radio that wants bonding and a
            // pairing the operator cancelled or that failed. Reconnecting would
            // put the system PIN prompt straight back on screen, so this is the
            // one failure that stops the auto-reconnect for good.
            if error.localizedDescription.lowercased().contains("encrypt") {
                shouldAutoReconnect = false
                savedPeripheralUUID = nil
                DispatchQueue.main.async {
                    self.statusMessage = String(localized: "Pairing with this radio was not completed. Tap it again to retry.")
                }
                return
            }
            DispatchQueue.main.async {
                self.statusMessage = String(localized: "The deck accepted the connection but would not report incoming packets.")
            }
            return
        }

        guard characteristic.isNotifying else { return }

        DispatchQueue.main.async { self.connectionState = .ready }
        startBackstopDrainLocked()
        // A caller that sent while the link was still coming up left its payload
        // in the queue with nowhere to go; this is the first moment it can move.
        pumpWritesLocked()
        // Anything the radio queued before this subscription existed raised a
        // notification nobody was listening for, so the first look has to be
        // ours rather than the radio's.
        startDrainLocked()
        Self.logger.info("Subscribed to FromNum — draining anything already queued")
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didUpdateValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        if let error {
            Self.logger.error("Read failed on \(characteristic.uuid): \(error.localizedDescription)")
            if characteristic.uuid == MeshtasticBLEConstants.fromRadioUUID {
                finishDrainLocked()
            }
            return
        }

        switch characteristic.uuid {
        case MeshtasticBLEConstants.fromRadioUUID:
            handleFromRadioValue(characteristic.value, on: peripheral)

        case MeshtasticBLEConstants.fromNumUUID:
            let counter = Self.decodeFromNum(characteristic.value)
            DispatchQueue.main.async { self.lastFromNum = counter }
            // The counter is only a doorbell. What changed is whatever the next
            // reads return, so never try to infer packet count from the delta.
            startDrainLocked()

        default:
            break
        }
    }

    public func peripheral(
        _ peripheral: CBPeripheral,
        didWriteValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard characteristic.uuid == MeshtasticBLEConstants.toRadioUUID else { return }

        if let error {
            Self.logger.error("ToRadio write failed: \(error.localizedDescription)")
        }

        isWriting = false

        if isWritingFarewell {
            isWritingFarewell = false
            centralManager?.cancelPeripheralConnection(peripheral)
            return
        }

        pumpWritesLocked()
        // A write the radio acted on usually produces something to collect —
        // the config dump, or the Routing result that marks a message sent.
        startDrainLocked()
    }

    /// FromNum carries a little-endian UInt32. A radio that sends fewer bytes
    /// is still ringing the doorbell, so the value is read leniently.
    private static func decodeFromNum(_ value: Data?) -> UInt32 {
        guard let value, !value.isEmpty else { return 0 }
        var counter: UInt32 = 0
        for (index, byte) in value.prefix(4).enumerated() {
            counter |= UInt32(byte) << (8 * index)
        }
        return counter
    }
}
