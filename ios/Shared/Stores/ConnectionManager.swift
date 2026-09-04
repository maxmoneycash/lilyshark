//
//  ConnectionManager.swift
//  PommeCore
//
//  BLE/WiFi/USB transport, scanning, connection state, and protocol commands.
//
//  Created by Michael P. Bedworth on 3/20/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import Combine
import os.log
import MeshCoreKit
// MeshtasticKit is a second local package, and the committed Xcode project does
// not link it yet -- see the note beside `meshtasticManager` below. Everything
// that needs the package is written against `canImport` so this file builds
// either way, and the MeshCore path is byte-for-byte what it was when the
// package is absent.
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif
#if !os(watchOS)
import CoreLocation
#endif

/// Connection transport type.
///
/// `.ble` is MeshCore over the Nordic UART service; `.meshtastic` is a Lilyshark
/// deck over Meshtastic's client GATT service. They are different protocols end
/// to end, not two dialects of one, so a frame built for either is never valid
/// on the other.
enum Transport { case ble, usb, wifi, meshtastic }

#if !os(watchOS)
/// Shared CLLocationManager — reused across all GPS operations to avoid
/// repeated initialization overhead and redundant hardware activation.
enum SharedLocation {
    static let manager = CLLocationManager()
}
#endif

// MARK: - Radio Config Verification Types

struct RadioConfigVerification: Identifiable {
    let id = UUID()
    let frequency: String
    let bandwidth: String
    let spreadingFactor: Int
    let codingRate: Int
    let txPower: String
    let battery: String
    let firmware: String
    let regionCheck: RegionCheck
    let regionMessage: String
}
enum RegionCheck { case pass, warning, fail }
enum RadioRegion { case americas, europe, japan, india, unknown }

/// Observable store for transport state, scanning, connect/disconnect, and sendCommand routing.
/// Extracted from PommeCoreViewModel to enable fine-grained view observation.
@MainActor @Observable
final class ConnectionManager {
    private static let logger = Logger(subsystem: "com.pommecore", category: "ConnectionManager")

    // MARK: - Public State

    var isScanning = false
    var discoveredPeripherals: [DiscoveredPeripheral] = []
    var connectionState: BLEConnectionState = .disconnected
    var connectedDeviceName: String?
    var bleStatusMessage: String?
    var scanRetryCount: Int = 0
    var requestShowScanner = false
    var isInBackground = false
    /// Last error message from device — displayed as an alert in ContentView.
    var lastErrorMessage: String?

    /// Legal frequency ranges for this device's region (from CMD_GET_ALLOWED_REPEAT_FREQ).
    var allowedFreqRanges: [FrequencyRange] = []

    /// Radio config verification state.
    var isVerifyingConfig = false
    var lastConfigVerification: RadioConfigVerification?

    /// True while a Lilyshark deck is connected over the Meshtastic service and
    /// ready to take a ToRadio write.
    ///
    /// Stored rather than derived from `meshtasticState` because every transport
    /// decision below reads it, and in a build without MeshtasticKit it stays
    /// false — which is what makes all of them read exactly as they did before.
    private(set) var isMeshtasticReady = false

    /// True from the moment a deck is chosen until the link to it is gone,
    /// including while it is still coming up. `isMeshtasticReady` narrows that
    /// to the part where the deck can actually be talked to.
    private(set) var isMeshtasticLinkActive = false

    /// True when the app has an active binary connection via any transport.
    var isActivelyConnected: Bool {
        if isMeshtasticReady { return true }
        if connectionState == .connected || connectionState == .ready { return true }
        if wifiManager.isConnected { return true }
        #if os(macOS) || targetEnvironment(macCatalyst)
        if usbManager.isConnected && usbManager.detectedMode == .binary { return true }
        #endif
        return false
    }

    /// Active connection transport, derived from sendCommand routing priority.
    /// A connected deck comes first: it is an explicit operator choice and must
    /// not be shadowed by a WiFi session left over from another radio.
    var activeTransport: Transport {
        if isMeshtasticReady { return .meshtastic }
        if wifiManager.isConnected { return .wifi }
        #if os(macOS) || targetEnvironment(macCatalyst)
        if usbManager.isConnected && usbManager.detectedMode == .binary { return .usb }
        #endif
        return .ble
    }

    // MARK: - Transport Managers

    let bleManager = BLEManager()
    let wifiManager = WiFiConnectionManager()

    #if canImport(MeshtasticKit)
    /// A second CoreBluetooth central, for radios speaking Meshtastic's client
    /// service. It sits beside `bleManager` rather than inside it because the
    /// conversation is not Nordic UART: the radio queues protobufs and the phone
    /// drains a read characteristic, where MeshCore notifies framed bytes.
    ///
    /// Nothing in the app reaches this until the package is linked into the
    /// Xcode project — `ios/PommeCore.xcodeproj` and `ios/project.yml` both
    /// still list MeshCoreKit alone.
    let meshtasticManager = MeshtasticBLEManager()

    /// Decks the Meshtastic central has found. Deliberately not merged into
    /// `discoveredPeripherals`: the two lists hold CBPeripherals owned by
    /// different centrals, and connecting through the wrong one fails in a way
    /// that looks like a flaky radio.
    var discoveredMeshtasticDevices: [DiscoveredMeshtasticDevice] = []

    private(set) var meshtasticState: MeshtasticBLEConnectionState = .disconnected
    #endif
    #if os(macOS) || targetEnvironment(macCatalyst)
    let usbManager = USBSerialManager()
    /// USB serial ports — bridged from USBSerialManager @Published for @Observable tracking.
    var usbAvailablePorts: [String] = []
    /// Last connected USB port — kept across disconnect for reconnect polling.
    private var usbLastConnectedPort: String?
    #endif


    // MARK: - Dependencies (set by coordinator)

    /// Reference to device config for optimistic UI updates when sending settings commands.
    var deviceConfig: DeviceConfig?

    /// Called when a binary frame is received from any transport.
    var onFrameReceived: ((Data) -> Void)?

    /// Called with one whole FromRadio protobuf from a connected deck.
    ///
    /// Separate from `onFrameReceived` because that payload is handed to
    /// `MeshCoreKit.FrameParser`, which would read a protobuf as a corrupt
    /// MeshCore frame and act on whatever its first byte happened to be.
    var onFromRadioFrameReceived: ((Data) -> Void)?

    /// Called when connection state transitions to .ready (binary mode device connected).
    var onDeviceReady: (() -> Void)?

    /// Called when USB CLI mode is detected.
    var onUSBCLIReady: (() -> Void)?

    /// Called when connection transitions from connected/ready → disconnected.
    var onDisconnected: ((BLEConnectionState) -> Void)?

    /// Called when a USB CLI text line is received.
    var onUSBCLILineReceived: ((String) -> Void)?

    // MARK: - Private State

    private var pendingAutoScan = false
    private let maxScanRetries = 3
    private var scanRetryTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()

    /// Routine commands that don't need hex dumps in the in-app debug log.
    private static let routineLabels: Set<String> = [
        "GET_BATT", "GET_TIME", "GET_TUNING", "GET_CUSTOM_VARS", "GET_STATS(0)",
        "GET_STATS(1)", "GET_STATS(2)", "GET_AUTOADD", "APP_START", "DEVICE_QUERY",
    ]

    // MARK: - Init

    init() {
        setupSubscriptions()
    }

    // MARK: - Bluetooth Activation

    /// Create the CoreBluetooth centrals. Kept out of `init` so onboarding can
    /// finish before iOS shows the Bluetooth prompt; both centrals live in one
    /// process and share the one system permission, so this prompts once.
    func activateBluetooth() {
        bleManager.activate()
        #if canImport(MeshtasticKit)
        meshtasticManager.activate()
        #endif
    }

    /// Drop every live link without ceremony, for app termination.
    func disconnectForTermination() {
        bleManager.disconnectForTermination()
        #if canImport(MeshtasticKit)
        meshtasticManager.disconnectForTermination()
        #endif
    }

    // MARK: - Send Command

    /// Route a command frame to the active transport (WiFi > USB binary > BLE).
    func sendCommand(_ data: Data, label: String) {
        let verbose = !Self.routineLabels.contains(label)

        // A deck cannot parse a MeshCore frame. Unhandled, this would fall
        // through to `bleManager.send`, which drops it silently because there is
        // no MeshCore link to write on — a no-op that reads to the operator as
        // the app being broken. Refuse it loudly instead.
        if isMeshtasticReady {
            Self.logger.warning("Refusing \(label) — a MeshCore frame is not valid on a Meshtastic deck")
            DebugLogger.shared.log("TX BLOCKED \(label) — deck speaks Meshtastic", level: .error)
            return
        }

        if wifiManager.isConnected {
            let hex = data.hexFormatted()
            Self.logger.info("TX(WiFi) \(label) [\(data.count) bytes]: \(hex)")
            if verbose { DebugLogger.shared.log("TX(WiFi) \(label) [\(data.count)B] \(hex)", level: .tx) }
            wifiManager.sendFrame(data)
            return
        }
        #if os(macOS) || targetEnvironment(macCatalyst)
        if usbManager.isConnected && usbManager.detectedMode == .binary {
            let hex = data.hexFormatted()
            Self.logger.info("TX(USB) \(label) [\(data.count) bytes]: \(hex)")
            if verbose { DebugLogger.shared.log("TX(USB) \(label) [\(data.count)B] \(hex)", level: .tx) }
            usbManager.sendFrame(data)
            return
        }
        #endif
        guard connectionState == .ready || connectionState == .connected else {
            Self.logger.warning("Cannot send \(label) — not connected (state: \(String(describing: self.connectionState)))")
            DebugLogger.shared.log("TX FAIL \(label) — not connected", level: .error)
            return
        }
        let hex = data.hexFormatted()
        Self.logger.info("TX \(label) [\(data.count) bytes]: \(hex)")
        if verbose { DebugLogger.shared.log("TX \(label) [\(data.count)B] \(hex)", level: .tx) }
        bleManager.send(data: data)
    }

    #if canImport(MeshtasticKit)
    /// Send one already-encoded ToRadio protobuf to a connected deck.
    ///
    /// Deliberately not part of `sendCommand`: the bytes come from
    /// `MeshtasticProto`, not `MeshCoreProtocol`, and confusing the two is the
    /// one mistake this transport pair makes easy. Returns false when the
    /// payload was refused outright — no deck, or too large for its inbox.
    /// Give a connected deck the phone's position, if the user has agreed to
    /// share it.
    ///
    /// The deck's GPS is a patch antenna behind plastic and often never fixes
    /// indoors. A deck with no fix beacons no position and is unplaceable on
    /// every other operator's map, which is the difference between being on
    /// the mesh and being on it and findable. The firmware treats this as a
    /// FALLBACK -- its own GPS wins whenever it has one -- so this can never
    /// move a deck that knows better where it is.
    ///
    /// Gated on exactly the same policy and privacy radius as the MeshCore
    /// advert path above. Location sharing is one decision the operator makes
    /// once; a second protocol is not a second chance to ask, and certainly
    /// not a way around a `no`.
    ///
    /// Returns false when nothing was sent, including the ordinary cases: no
    /// permission, no fix yet, no deck.
    @discardableResult
    func shareLocationWithDeck() -> Bool {
        #if os(watchOS)
        return false
        #else
        guard deviceConfig?.advertLocPolicy == 1 else { return false }
        guard let location = SharedLocation.manager.location else { return false }

        var latitude = location.coordinate.latitude
        var longitude = location.coordinate.longitude
        if UserDefaults.standard.double(forKey: "locationPrivacyRadius") > 0 {
            (latitude, longitude) = PommeCoreViewModel.fudgeLocation(
                lat: latitude, lon: longitude
            )
        }
        // 0,0 is a real place in the Gulf of Guinea and also what an
        // uninitialised coordinate looks like. The firmware rejects it as
        // "no fix" for that reason; there is no point spending airtime on a
        // packet we know the other end will throw away.
        guard latitude != 0 || longitude != 0 else { return false }

        return sendToRadio(
            MeshtasticProto.encodePositionPacket(
                latitude: latitude,
                longitude: longitude,
                packetID: UInt32.random(in: 1...UInt32.max)
            ),
            label: "POSITION"
        )
        #endif
    }

    @discardableResult
    func sendToRadio(_ data: Data, label: String) -> Bool {
        guard isMeshtasticReady else {
            Self.logger.warning("Cannot send \(label) — no deck connected")
            DebugLogger.shared.log("TX(MT) FAIL \(label) — no deck connected", level: .error)
            return false
        }
        Self.logger.info("TX(Meshtastic) \(label) [\(data.count) bytes]")
        DebugLogger.shared.log("TX(MT) \(label) [\(data.count)B]", level: .tx)
        return meshtasticManager.send(toRadio: data)
    }
    #endif

    // MARK: - Protocol Convenience Commands

    /// Send a self-advert. If device is sharing location in adverts (advertLocPolicy == 1),
    /// updates the device's coordinates from the phone's GPS first. Applies privacy fudge
    /// if a privacy radius is configured.
    func sendAdvertise(type: UInt8 = 0) {
        #if !os(watchOS)
        if deviceConfig?.advertLocPolicy == 1, let location = SharedLocation.manager.location {
            let radius = UserDefaults.standard.double(forKey: "locationPrivacyRadius")
            if radius > 0 {
                let (fLat, fLon) = PommeCoreViewModel.fudgeLocation(lat: location.coordinate.latitude, lon: location.coordinate.longitude)
                sendCommand(MeshCoreProtocol.buildSetAdvertLatLon(latitude: fLat, longitude: fLon), label: "FUDGE_LATLON")
                DebugLogger.shared.log("ADVERT: fudged GPS applied before advert", level: .tx)
            } else {
                sendCommand(MeshCoreProtocol.buildSetAdvertLatLon(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude), label: "SET_LATLON")
                DebugLogger.shared.log("ADVERT: phone GPS applied before advert", level: .tx)
            }
        }
        #endif
        sendCommand(MeshCoreProtocol.buildSendSelfAdvert(advertType: type), label: "SELF_ADVERT")
    }

    /// Import a contact from a meshcore:// URL string. Sends CMD_IMPORT_CONTACT.
    /// Validates URL format, hex content, and reasonable length before sending to firmware.
    func importContact(url: String) {
        guard url.lowercased().hasPrefix("meshcore://") else {
            Self.logger.warning("IMPORT: rejected — not a meshcore:// URL")
            lastErrorMessage = "Invalid contact link format."
            return
        }
        let hex = String(url.dropFirst("meshcore://".count))
        guard !hex.isEmpty, hex.count <= 512, hex.allSatisfy({ $0.isHexDigit }) else {
            Self.logger.warning("IMPORT: rejected — invalid hex payload (len=\(hex.count))")
            lastErrorMessage = "Invalid contact link data."
            return
        }
        let frame = MeshCoreProtocol.buildImportContact(url: url)
        sendCommand(frame, label: "IMPORT_CONTACT")
    }

    /// Export a contact as a meshcore:// URL. Result arrives as .exportedContact response.
    func exportContact(_ contact: Contact) {
        let keyHex = Data(contact.publicKey.prefix(6)).hexCompact
        Self.logger.info("EXPORT: requesting export for '\(contact.name)' key=\(keyHex) fullKeyLen=\(contact.publicKey.count)")
        let frame = MeshCoreProtocol.buildExportContact(publicKey: contact.publicKey)
        Self.logger.info("EXPORT: frame=[\(frame.count) bytes] \(frame.hexFormatted())")
        sendCommand(frame, label: "EXPORT_CONTACT")
    }

    /// Export self as a meshcore:// URL (send code byte only, no public key).
    func exportSelfContact() {
        Self.logger.info("EXPORT: requesting self contact export (frame=[1 byte] 11)")
        let frame = Data([0x11])
        sendCommand(frame, label: "EXPORT_SELF")
    }

    // MARK: - Settings Commands

    func setRadioParams(frequency: UInt32, bandwidth: UInt32, spreadingFactor: UInt8, codingRate: UInt8, repeatMode: Bool) {
        sendCommand(MeshCoreProtocol.buildSetRadioParams(
            frequency: frequency, bandwidth: bandwidth,
            spreadingFactor: spreadingFactor, codingRate: codingRate,
            repeatMode: repeatMode
        ), label: "SET_RADIO")
        deviceConfig?.radioFrequency = frequency
        deviceConfig?.radioBandwidth = bandwidth
        deviceConfig?.radioSpreadingFactor = spreadingFactor
        deviceConfig?.radioCodingRate = codingRate
        deviceConfig?.repeatMode = repeatMode
    }

    func setRadioTXPower(_ power: UInt8) {
        sendCommand(MeshCoreProtocol.buildSetRadioTXPower(power), label: "SET_TX_POWER")
        deviceConfig?.radioTXPower = power
    }

    func setTuningParams(rxDelayBase: UInt32, airtimeFactor: UInt32) {
        let frame = MeshCoreProtocol.buildSetTuningParams(rxDelayBase: rxDelayBase, airtimeFactor: airtimeFactor)
        sendCommand(frame, label: "SET_TUNING")
        deviceConfig?.rxDelayBase = rxDelayBase
        deviceConfig?.airtimeFactor = airtimeFactor
        // Read back after firmware processes
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            self?.sendCommand(MeshCoreProtocol.buildGetTuningParams(), label: "GET_TUNING")
        }
    }

    func setOtherParams(manualAddContacts: UInt8, telemetryBase: UInt8, telemetryLocation: UInt8, advertLocPolicy: UInt8, multiACK: UInt8) {
        DebugLogger.shared.log("SET_OTHER_PARAMS: manual=\(manualAddContacts) telBase=\(telemetryBase) telLoc=\(telemetryLocation) advLoc=\(advertLocPolicy) multiACK=\(multiACK)", level: .tx)
        deviceConfig?.manualAddContacts = manualAddContacts
        deviceConfig?.telemetryBase = telemetryBase
        deviceConfig?.telemetryLocation = telemetryLocation
        deviceConfig?.advertLocPolicy = advertLocPolicy
        deviceConfig?.multiACK = multiACK
        sendCommand(MeshCoreProtocol.buildSetOtherParams(
            manualAddContacts: manualAddContacts, telemetryBase: telemetryBase,
            telemetryLocation: telemetryLocation, advertLocPolicy: advertLocPolicy,
            multiACK: multiACK
        ), label: "SET_OTHER_PARAMS")
    }

    func setAdvertName(_ name: String) {
        sendCommand(MeshCoreProtocol.buildSetAdvertName(name), label: "SET_ADVERT_NAME")
        deviceConfig?.deviceName = name
        // Name change requires reboot to take effect (same as radio params)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            sendCommand(MeshCoreProtocol.buildReboot(), label: "REBOOT")
        }
    }

    func setAdvertLatLon(latitude: Double, longitude: Double) {
        let (fLat, fLon) = PommeCoreViewModel.fudgeLocation(lat: latitude, lon: longitude)
        sendCommand(MeshCoreProtocol.buildSetAdvertLatLon(latitude: fLat, longitude: fLon), label: "SET_LATLON")
        deviceConfig?.latitude = fLat
        deviceConfig?.longitude = fLon
    }

    func setAutoAddConfig(bitmask: UInt8) {
        sendCommand(MeshCoreProtocol.buildSetAutoAddConfig(bitmask: bitmask), label: "SET_AUTOADD(0x\(String(format: "%02x", bitmask)))")
        deviceConfig?.autoAddBitmask = bitmask
    }

    func setDevicePIN(_ pin: UInt32) {
        sendCommand(MeshCoreProtocol.buildSetDevicePIN(pin), label: "SET_PIN")
        deviceConfig?.blePIN = pin
    }

    func setCustomVar(name: String, value: String) {
        sendCommand(MeshCoreProtocol.buildSetCustomVar(name: name, value: value), label: "SET_CUSTOM_VAR")
    }

    func sendPathDiscoveryRequest(contact: Contact) {
        sendCommand(MeshCoreProtocol.buildSendPathDiscoveryReq(publicKey: contact.publicKey), label: "PATH_DISCOVERY")
    }

    func requestCustomVars() {
        sendCommand(MeshCoreProtocol.buildGetCustomVars(), label: "GET_CUSTOM_VARS")
    }

    func requestStats(subType: UInt8) {
        sendCommand(MeshCoreProtocol.buildGetStats(subType: subType), label: "GET_STATS(\(subType))")
    }

    func requestAllowedRepeatFreq() {
        sendCommand(MeshCoreProtocol.buildGetAllowedRepeatFreq(), label: "GET_ALLOWED_REPEAT_FREQ")
    }

    func requestDeviceInfo() {
        sendCommand(MeshCoreProtocol.buildDeviceQuery(), label: "DEVICE_QUERY")
    }

    func requestBattAndStorage() {
        sendCommand(MeshCoreProtocol.buildGetBattAndStorage(), label: "GET_BATT")
    }

    func requestDeviceTime() {
        sendCommand(MeshCoreProtocol.buildGetDeviceTime(), label: "GET_TIME")
    }

    func requestTuningParams() {
        sendCommand(MeshCoreProtocol.buildGetTuningParams(), label: "GET_TUNING")
    }

    func requestAutoAddConfig() {
        sendCommand(MeshCoreProtocol.buildGetAutoAddConfig(), label: "GET_AUTOADD")
    }

    func getDefaultFloodScope() {
        sendCommand(MeshCoreProtocol.buildGetDefaultFloodScope(), label: "GET_FLOOD_SCOPE")
    }

    func setDefaultFloodScope(_ name: String) {
        sendCommand(MeshCoreProtocol.buildSetDefaultFloodScope(name: name), label: "SET_FLOOD_SCOPE")
        deviceConfig?.defaultFloodScope = name
    }

    func sendAppStart() {
        sendCommand(MeshCoreProtocol.buildAppStart(), label: "APP_START")
    }

    /// Refresh all device settings by sending all request commands.
    func refreshAllSettings() {
        deviceConfig?.isLoading = true
        deviceConfig?.loadedSections = []
        requestDeviceInfo()
        sendAppStart()
        requestBattAndStorage()
        requestDeviceTime()
        requestTuningParams()
        requestCustomVars()
        requestStats(subType: 0)
        requestStats(subType: 1)
        requestStats(subType: 2)
        requestAutoAddConfig()
        getDefaultFloodScope()
        requestAllowedRepeatFreq()
    }

    /// Refresh contacts, channels, and all settings.
    func refreshAll(contactStore: ContactStore) {
        guard connectionState == .ready else { return }
        refreshAllSettings()
        contactStore.requestContacts(fullSync: true)
    }

    // MARK: - Radio Config Verification

    func verifyRadioConfig() {
        DebugLogger.shared.log("=== RADIO CONFIG VERIFICATION START ===", level: .info)
        isVerifyingConfig = true
        requestDeviceInfo()
        sendAppStart()
        requestTuningParams()
        requestBattAndStorage()
        requestDeviceTime()
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard let self else { return }
            DebugLogger.shared.log("=== RADIO CONFIG VERIFICATION COMPLETE ===", level: .info)
            self.isVerifyingConfig = false
            self.lastConfigVerification = self.buildConfigVerification()
        }
    }

    private func buildConfigVerification() -> RadioConfigVerification {
        guard let c = deviceConfig else { return RadioConfigVerification(frequency: "?", bandwidth: "?", spreadingFactor: 0, codingRate: 0, txPower: "?", battery: "?", firmware: "?", regionCheck: .warning, regionMessage: "No device config") }
        let bwKHz = Double(c.radioBandwidth) / 1000.0
        let battV = formatBatteryVoltage(c.batteryMillivolts)
        let battPct = c.batteryPercent()
        let (regionCheck, regionMsg) = checkFrequencyForRegion(freqHz: c.radioFrequency, lat: c.latitude, lon: c.longitude)
        return RadioConfigVerification(
            frequency: formatFrequency(Double(c.radioFrequency)),
            bandwidth: String(format: "%.1f kHz", bwKHz),
            spreadingFactor: Int(c.radioSpreadingFactor),
            codingRate: Int(c.radioCodingRate),
            txPower: "\(c.radioTXPower)/\(c.maxTXPower) dBm",
            battery: battPct > 0 ? "\(battV) (\(battPct)%)" : battV,
            firmware: c.semanticVersion.isEmpty ? "v\(c.firmwareVersion)" : c.semanticVersion,
            regionCheck: regionCheck,
            regionMessage: regionMsg
        )
    }

    private func checkFrequencyForRegion(freqHz: UInt32, lat: Double, lon: Double) -> (RegionCheck, String) {
        let freqMHz = Double(freqHz) / 1000.0
        let freqStr = formatFrequency(Double(freqHz))
        let region = (lat != 0 || lon != 0) ? regionFromCoordinates(lat: lat, lon: lon) : .unknown
        if freqMHz >= 902 && freqMHz <= 928 {
            return region == .europe ? (.fail, "Frequency \(freqStr) is Americas band but GPS shows Europe") :
                (.pass, "Frequency \(freqStr) — Americas band (902-928 MHz)")
        } else if freqMHz >= 863 && freqMHz <= 870 {
            return region == .americas ? (.fail, "Frequency \(freqStr) is EU band but GPS shows Americas") :
                (.pass, "Frequency \(freqStr) — Europe band (863-870 MHz)")
        } else if freqMHz >= 920 && freqMHz <= 928 {
            return (.pass, "Frequency \(freqStr) — Japan band (920-928 MHz)")
        } else if freqMHz >= 865 && freqMHz <= 867 {
            return (.pass, "Frequency \(freqStr) — India band (865-867 MHz)")
        }
        return (.warning, "Frequency \(freqStr) — verify manually for your region")
    }

    private func regionFromCoordinates(lat: Double, lon: Double) -> RadioRegion {
        if lat >= -60 && lat <= 72 && lon >= -170 && lon <= -30 { return .americas }
        if lat >= -48 && lat <= -10 && lon >= 110 && lon <= 180 { return .americas }
        if lat >= 35 && lat <= 72 && lon >= -10 && lon <= 40 { return .europe }
        if lat >= 24 && lat <= 46 && lon >= 122 && lon <= 154 { return .japan }
        if lat >= 6 && lat <= 36 && lon >= 68 && lon <= 98 { return .india }
        return .unknown
    }

    // MARK: - Phone GPS Auto-Update

    private var locationUpdateTimer: Timer?
    private var lastSentLatitude: Double?
    private var lastSentLongitude: Double?
    private static let locationSendThresholdMeters: Double = 50

    func startAutoLocationUpdates(interval: Int) {
        locationUpdateTimer?.invalidate()
        setLocationFromPhoneGPS()
        locationUpdateTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(interval), repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.setLocationFromPhoneGPS() }
        }
        DebugLogger.shared.log("PHONE GPS: auto-update every \(interval / 60)min", level: .info)
    }

    func stopAutoLocationUpdates() {
        locationUpdateTimer?.invalidate()
        locationUpdateTimer = nil
        lastSentLatitude = nil
        lastSentLongitude = nil
        DebugLogger.shared.log("PHONE GPS: auto-update stopped", level: .info)
    }

    private func setLocationFromPhoneGPS() {
        #if !os(watchOS)
        guard let location = SharedLocation.manager.location else { return }
        let rawLatitude = location.coordinate.latitude
        let rawLongitude = location.coordinate.longitude

        // Thresholded on the TRUE position, and the raw position is what is
        // remembered. Comparing fudged coordinates measured the same thing
        // -- the fudge is a fixed offset, not a per-call jitter -- but it
        // made the stored pair a fudged one, and passing that on was how the
        // offset came to be applied twice. See below.
        if let previousLatitude = lastSentLatitude, let previousLongitude = lastSentLongitude {
            let northMetres = (rawLatitude - previousLatitude) * 111_000
            let eastMetres = (rawLongitude - previousLongitude) * 111_000
                * cos(previousLatitude * .pi / 180)
            let moved = (northMetres * northMetres + eastMetres * eastMetres).squareRoot()
            guard moved >= Self.locationSendThresholdMeters else { return }
        }
        lastSentLatitude = rawLatitude
        lastSentLongitude = rawLongitude

        // Raw coordinates, deliberately. Every send path below applies the
        // privacy fudge exactly once and expects to be handed the true
        // position.
        //
        // This used to fudge here and then call setAdvertLatLon, which fudges
        // again. locationFudgeAngle and locationFudgeFraction are STORED and
        // stable -- regenerated only when the operator asks -- so the second
        // application moved the point a second time along the very same
        // bearing. The reported position was up to twice the configured
        // privacy radius away, consistently in one direction, which is worse
        // than either honest choice: it is not where you are, and the error
        // has a fixed heading that repeated sightings would average out
        // rather than obscure.
        setAdvertLatLon(latitude: rawLatitude, longitude: rawLongitude)
        shareLocationWithDeck()
        #endif
    }

    // MARK: - Scanning & Connection

    func requestAutoScan() {
        if bleManager.isPoweredOn {
            if connectionState == .disconnected {
                scanRetryCount = maxScanRetries
                startScanning()
            }
        } else {
            pendingAutoScan = true
            scanRetryCount = maxScanRetries
        }
    }

    func startScanning() {
        guard bleManager.isPoweredOn else {
            Self.logger.warning("Cannot scan — BLE not powered on, queuing for later")
            pendingAutoScan = true
            return
        }
        scanRetryTask?.cancel()
        isScanning = true
        bleManager.startScanning()
        // Both centrals scan at once: the operator does not know which protocol
        // the radio in their hand speaks until they see it in the list.
        #if canImport(MeshtasticKit)
        meshtasticManager.startScanning()
        #endif
    }

    func stopScanning() {
        scanRetryTask?.cancel()
        scanRetryTask = nil
        scanRetryCount = 0
        isScanning = false
        bleManager.stopScanning()
        #if canImport(MeshtasticKit)
        meshtasticManager.stopScanning()
        #endif
    }

    /// Whether either central has anything to show. A scan that found a deck but
    /// no MeshCore radio must not count as an empty scan, or the retry loop
    /// restarts a scan whose results are already on screen.
    private var foundNoDevices: Bool {
        #if canImport(MeshtasticKit)
        return discoveredPeripherals.isEmpty && discoveredMeshtasticDevices.isEmpty
        #else
        return discoveredPeripherals.isEmpty
        #endif
    }

    func handleScanTimeout() {
        guard isScanning else { return }
        if foundNoDevices && scanRetryCount > 0 {
            scanRetryCount -= 1
            Self.logger.info("Scan found nothing, retrying (\(self.scanRetryCount) retries left)")
            bleManager.stopScanning()
            #if canImport(MeshtasticKit)
            meshtasticManager.stopScanning()
            #endif
            scanRetryTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !Task.isCancelled else { return }
                self?.bleManager.startScanning()
                #if canImport(MeshtasticKit)
                self?.meshtasticManager.startScanning()
                #endif
            }
        } else if foundNoDevices {
            Self.logger.info("Scan retries exhausted, stopping")
            isScanning = false
            bleManager.stopScanning()
            #if canImport(MeshtasticKit)
            meshtasticManager.stopScanning()
            #endif
        }
    }

    func connect(to peripheral: DiscoveredPeripheral) {
        stopScanning()
        bleManager.connect(to: peripheral.peripheral)
    }

    #if canImport(MeshtasticKit)
    /// Connect to a deck found by the Meshtastic central.
    func connectMeshtastic(to device: DiscoveredMeshtasticDevice) {
        stopScanning()
        meshtasticManager.connect(to: device.peripheral)
    }
    #endif

    func connectWiFi(host: String, port: UInt16 = 5000) {
        stopScanning()
        wifiManager.connect(host: host, port: port)
    }

    func disconnectWiFi() {
        let previousState = connectionState
        wifiManager.disconnect()
        connectionState = .disconnected
        connectedDeviceName = nil
        if previousState != .disconnected {
            onDisconnected?(previousState)
        }
        // Auto-scan after user-initiated disconnect
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, self.connectionState == .disconnected else { return }
            self.requestShowScanner = true
            self.startScanning()
        }
    }

    /// Reconnect WiFi if it was previously connected but dropped (e.g. app suspended).
    func reconnectWiFiIfNeeded() {
        guard let host = wifiManager.lastHost, let port = wifiManager.lastPort,
              !wifiManager.isConnected, !wifiManager.isUserDisconnect else { return }
        DebugLogger.shared.log("WIFI: reconnecting after foreground — \(host):\(port)", level: .info)
        wifiManager.connect(host: host, port: port)
    }


    #if os(macOS) || targetEnvironment(macCatalyst)
    func connectUSB(port: String) {
        stopScanning()
        connectionState = .connecting
        connectedDeviceName = port.replacingOccurrences(of: "/dev/cu.", with: "")
        usbLastConnectedPort = port
        usbManager.connect(to: port)
    }

    func disconnectUSB() {
        usbLastConnectedPort = nil  // User-initiated — don't auto-reconnect
        // Clear any pending queued commands before sending reboot.
        usbManager.clearQueue()
        // Reboot to reset the radio's serial state before closing the port.
        // Without this, the radio holds stale serial state and won't respond to reconnect.
        if usbManager.isConnected {
            sendUSBReboot()
        }
        // Set state immediately so UI reflects disconnect. Fire cleanup first.
        let previousState = connectionState
        connectionState = .disconnected
        connectedDeviceName = nil
        if previousState != .disconnected {
            onDisconnected?(previousState)
        }
        // Delay port close to let the reboot command transmit and process
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard let self else { return }
            self.usbManager.disconnect()
            // Show scanner after close completes (300ms in disconnect + margin)
            DebugLogger.shared.log("USB: disconnected — showing scanner in 2s", level: .info)
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard self.connectionState == .disconnected else { return }
            self.usbManager.scanPorts()
            self.requestShowScanner = true
            self.startScanning()
        }
    }

    func sendUSBCLI(_ command: String) {
        usbManager.sendCLI(command)
    }

    /// Send a reboot command via the correct USB mode (CLI text or binary frame).
    func sendUSBReboot() {
        if usbManager.detectedMode == .cli {
            usbManager.sendCLI("reboot")
        } else if usbManager.detectedMode == .binary {
            sendCommand(MeshCoreProtocol.buildReboot(), label: "REBOOT")
        }
        DebugLogger.shared.log("USB: sent reboot", level: .tx)
    }

    /// Send a USB CLI command directly, bypassing the command queue.
    /// Use only for settings fetch which has its own sequential pacing.
    func sendUSBCLIDirect(_ command: String) {
        usbManager.sendCLIDirect(command)
    }

    /// Send a keepalive byte to the USB serial port without triggering a CLI command.
    func sendUSBKeepalive() {
        usbManager.sendKeepalive()
    }

    /// Poll for a USB port to reappear after device reboot, then auto-reconnect.
    private func pollForUSBReconnect(port: String) {
        DebugLogger.shared.log("USB: polling for \(port) to reappear (device reboot)", level: .info)
        var attempts = 0
        let maxAttempts = 15  // 15 × 2s = 30s max wait

        func poll() {
            Task { @MainActor [weak self] in
                guard let self else { return }
                // Stop if user connected to something else or initiated a new connection
                guard self.connectionState == .disconnected else {
                    DebugLogger.shared.log("USB: reconnect poll cancelled — state changed", level: .info)
                    return
                }
                attempts += 1
                self.usbManager.scanPorts()
                // Small delay for scanPorts to update availablePorts
                try? await Task.sleep(nanoseconds: 500_000_000)

                if self.usbManager.availablePorts.contains(port) {
                    DebugLogger.shared.log("USB: port \(port) reappeared after reboot — reconnecting", level: .info)
                    self.connectUSB(port: port)
                } else if attempts < maxAttempts {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    poll()
                } else {
                    DebugLogger.shared.log("USB: port \(port) did not reappear after \(maxAttempts) attempts — showing scanner", level: .warning)
                    self.usbManager.scanPorts()
                    self.requestShowScanner = true
                    self.startScanning()
                }
            }
        }

        // Start polling after a brief delay — device needs time to begin reboot
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            poll()
        }
    }

    /// Whether the USB device is CLI-connected.
    var isUSBCLIMode: Bool {
        usbManager.isConnected && usbManager.detectedMode == .cli
    }

    /// Whether the USB device is connected via binary protocol (companion radio).
    var isUSBBinaryMode: Bool {
        usbManager.isConnected && usbManager.detectedMode == .binary
    }
    #endif

    func disconnect() {
        // Route to the correct transport disconnect
        #if canImport(MeshtasticKit)
        if isMeshtasticLinkActive {
            // A Meshtastic client is expected to say goodbye, so the radio stops
            // queuing for a phone that has gone; its outbound queue is eight
            // deep and drops live traffic once full.
            meshtasticManager.disconnect(farewell: MeshtasticProto.encodeDisconnect())
            scheduleRescanAfterDisconnect()
            return
        }
        #endif
        if wifiManager.isConnected {
            disconnectWiFi()
            return
        }
        #if os(macOS) || targetEnvironment(macCatalyst)
        if usbManager.isConnected {
            disconnectUSB()
            return
        }
        #endif
        bleManager.disconnect()
        scheduleRescanAfterDisconnect()
    }

    /// Show the scanner again a moment after the operator disconnects, so the
    /// app lands somewhere useful rather than on an empty radio screen.
    private func scheduleRescanAfterDisconnect() {
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, self.connectionState == .disconnected else { return }
            self.requestShowScanner = true
            self.startScanning()
        }
    }

    /// Reset scanning and transport state.
    func reset() {
        stopScanning()
        requestShowScanner = false
        bleStatusMessage = nil
    }

    // MARK: - Subscriptions

    private func setupSubscriptions() {
        #if canImport(MeshtasticKit)
        setupMeshtasticSubscriptions()
        #endif

        // BLE received data → frame handler
        bleManager.receivedDataSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.onFrameReceived?(data)
            }
            .store(in: &cancellables)

        // Background fast-path: parse PUSH_CODE_MSG_WAITING immediately on BLE queue
        bleManager.receivedDataSubject
            .sink { [weak self] data in
                guard let self, data.count >= 1 else { return }
                if data[0] == 0x83 {
                    Self.logger.info("BG FAST-PATH: PUSH_CODE_MSG_WAITING — sending SYNC_NEXT_MESSAGE immediately")
                    DebugLogger.shared.log("NOTIF: 0x83 received, sending SYNC_NEXT immediately", level: .rx)
                    self.bleManager.send(data: Data([0x0A]))
                }
            }
            .store(in: &cancellables)

        // BLE discovered peripherals
        bleManager.$discoveredPeripherals
            .receive(on: DispatchQueue.main)
            .sink { [weak self] peripherals in
                self?.discoveredPeripherals = peripherals
            }
            .store(in: &cancellables)

        // BLE connected device name
        bleManager.$connectedDeviceName
            .receive(on: DispatchQueue.main)
            .sink { [weak self] name in
                guard let self, !self.isMeshtasticLinkActive else { return }
                self.connectedDeviceName = name
            }
            .store(in: &cancellables)

        // BLE connection state changes
        bleManager.$connectionState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                // Don't let BLE state changes override an active WiFi connection
                guard !self.wifiManager.isConnected else { return }
                // The MeshCore central keeps scanning while a deck is connected,
                // and its own .disconnected is its resting state — publishing it
                // would tear down a live Meshtastic session.
                guard !self.isMeshtasticLinkActive else { return }
                let previousState = self.connectionState
                self.connectionState = state

                if state == .disconnected {
                    self.onDisconnected?(previousState)

                    if previousState == .connecting || previousState == .ready {
                        if previousState == .connecting {
                            Task { @MainActor in
                                try? await Task.sleep(nanoseconds: 3_000_000_000)
                                guard self.connectionState == .disconnected else { return }
                                self.requestShowScanner = true
                            }
                        }
                    }
                }
                if state == .ready && previousState != .ready {
                    self.onDeviceReady?()
                }
            }
            .store(in: &cancellables)

        // BLE power state
        bleManager.$isPoweredOn
            .receive(on: DispatchQueue.main)
            .sink { [weak self] poweredOn in
                guard let self, poweredOn, self.pendingAutoScan else { return }
                self.pendingAutoScan = false
                if self.connectionState == .disconnected {
                    self.startScanning()
                }
            }
            .store(in: &cancellables)

        // BLE status message
        bleManager.$bleStatusMessage
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                self?.bleStatusMessage = message
            }
            .store(in: &cancellables)

        // WiFi received data
        wifiManager.receivedDataSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.onFrameReceived?(data)
            }
            .store(in: &cancellables)

        // WiFi connection state — isConnected only changes on user-initiated
        // connect/disconnect and real failures. Silent TCP re-establishes don't
        // touch it, so the app sees a stable connection.
        wifiManager.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] connected in
                guard let self else { return }
                if connected {
                    Self.logger.info("WiFi connected — initializing device")
                    self.connectionState = .ready
                    self.connectedDeviceName = "WiFi: \(self.wifiManager.connectedHost ?? "unknown")"
                    self.onDeviceReady?()
                } else {
                    // Real disconnect (user-initiated or silent reconnect exhausted)
                    if self.connectionState == .ready {
                        let prev = self.connectionState
                        self.connectionState = .disconnected
                        self.connectedDeviceName = nil
                        self.onDisconnected?(prev)
                    }
                }
            }
            .store(in: &cancellables)

        // USB Serial subscriptions (macOS only)
        #if os(macOS) || targetEnvironment(macCatalyst)
        usbManager.receivedDataSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.onFrameReceived?(data)
            }
            .store(in: &cancellables)

        usbManager.receivedLineSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] line in
                self?.onUSBCLILineReceived?(line)
            }
            .store(in: &cancellables)

        usbManager.$availablePorts
            .receive(on: DispatchQueue.main)
            .sink { [weak self] ports in
                self?.usbAvailablePorts = ports
            }
            .store(in: &cancellables)

        usbManager.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] connected in
                guard let self else { return }
                if connected && self.usbManager.detectedMode == .binary {
                    self.connectionState = .ready
                    self.connectedDeviceName = self.usbManager.connectedPort?.replacingOccurrences(of: "/dev/cu.", with: "")
                }
                if !connected {
                    let previousState = self.connectionState
                    let lastPort = self.usbLastConnectedPort
                    self.connectionState = .disconnected
                    self.connectedDeviceName = nil
                    if previousState != .disconnected {
                        self.onDisconnected?(previousState)
                    }
                    // If we had a USB connection, poll for the port to reappear (device reboot)
                    if previousState == .ready || previousState == .connected,
                       let port = lastPort {
                        self.pollForUSBReconnect(port: port)
                    }
                }
            }
            .store(in: &cancellables)

        usbManager.$detectedMode
            .receive(on: DispatchQueue.main)
            .sink { [weak self] mode in
                guard let self else { return }
                if mode == .binary && self.usbManager.isConnected {
                    Self.logger.info("USB binary mode detected — initializing device")
                    self.connectionState = .ready
                    self.connectedDeviceName = self.usbManager.connectedPort?.replacingOccurrences(of: "/dev/cu.", with: "")
                    self.onDeviceReady?()
                } else if mode == .cli && self.usbManager.isConnected {
                    Self.logger.info("USB CLI mode detected — initializing management session")
                    self.connectionState = .connected
                    self.connectedDeviceName = "USB: \(self.usbManager.connectedPort?.replacingOccurrences(of: "/dev/cu.", with: "") ?? "Serial")"
                    self.onUSBCLIReady?()
                }
            }
            .store(in: &cancellables)
        #endif
    }

    #if canImport(MeshtasticKit)

    /// The one place the two connection-state enums are equated.
    ///
    /// They are separate types on purpose — the two managers reach `.ready` on
    /// different evidence, one on a subscribed UART characteristic and one on a
    /// subscribed FromNum — so the mapping has to exist, and has to exist once.
    private static func bridged(_ state: MeshtasticBLEConnectionState) -> BLEConnectionState {
        switch state {
        case .disconnected: return .disconnected
        case .scanning:     return .scanning
        case .connecting:   return .connecting
        case .connected:    return .connected
        case .ready:        return .ready
        }
    }

    private func setupMeshtasticSubscriptions() {
        // FromRadio protobufs arrive on the BLE queue; every store they end up
        // touching is @MainActor, so the hop happens once, here.
        meshtasticManager.fromRadioSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.onFromRadioFrameReceived?(data)
            }
            .store(in: &cancellables)

        meshtasticManager.$discoveredDevices
            .receive(on: DispatchQueue.main)
            .sink { [weak self] devices in
                self?.discoveredMeshtasticDevices = devices
            }
            .store(in: &cancellables)

        meshtasticManager.$connectionState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                let wasActive = self.isMeshtasticLinkActive
                self.meshtasticState = state
                self.isMeshtasticReady = (state == .ready)
                // .scanning is a shared idle state — both centrals scan at the
                // same time — so it is not evidence that a deck owns the link.
                self.isMeshtasticLinkActive = (state == .connecting || state == .connected || state == .ready)

                // A MeshCore radio and a deck are never connected at once, so
                // whichever link is live owns the single connectionState every
                // screen reads. `wasActive` keeps the final .disconnected: it
                // arrives after the flag has already gone false.
                guard wasActive || self.isMeshtasticLinkActive else { return }
                guard !self.wifiManager.isConnected else { return }

                let previousState = self.connectionState
                self.connectionState = Self.bridged(state)
                if self.connectionState == .disconnected {
                    self.connectedDeviceName = nil
                    if previousState != .disconnected { self.onDisconnected?(previousState) }
                }
                if state == .ready && previousState != .ready { self.onDeviceReady?() }
            }
            .store(in: &cancellables)

        meshtasticManager.$connectedDeviceName
            .receive(on: DispatchQueue.main)
            .sink { [weak self] name in
                guard let self, self.isMeshtasticLinkActive else { return }
                self.connectedDeviceName = name
            }
            .store(in: &cancellables)

        meshtasticManager.$statusMessage
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                // Only a real complaint is surfaced. A nil here is the deck's
                // central saying it has nothing to report, not a reason to wipe
                // a message the MeshCore central just put on screen.
                guard let message else { return }
                self?.bleStatusMessage = message
            }
            .store(in: &cancellables)
    }
    #endif
}
