//
//  PommeCoreViewModel.swift
//  PommeCore
//
//  Coordinator: store wiring, lifecycle, cross-store dependencies.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import Combine
import os.log
import UserNotifications
#if os(iOS)
import WidgetKit
#endif
#if os(watchOS)
import WatchKit
#endif
import MeshCoreKit
#if canImport(CoreSpotlight)
import CoreSpotlight
#endif

#if os(macOS) || targetEnvironment(macCatalyst)
/// A line of output in the USB serial terminal.
struct USBTerminalLine: Identifiable {
    let id = UUID()
    let text: String
    let isCommand: Bool
}
#endif

/// Whether iCloud sync is enabled (stored locally per device, defaults to true).
var iCloudSyncEnabled: Bool {
    UserDefaults.standard.object(forKey: "iCloudSyncEnabled") == nil ? true : UserDefaults.standard.bool(forKey: "iCloudSyncEnabled")
}

// RadioConfigVerification, RegionCheck, RadioRegion moved to ConnectionManager

/// Notification preferences synced via iCloud key-value store (when enabled).
@MainActor
final class NotificationPreferences: ObservableObject {
    static let shared = NotificationPreferences()
    private let store = NSUbiquitousKeyValueStore.default

    @Published var notifyDirect: Bool {
        didSet { if iCloudSyncEnabled { store.setAndSync(notifyDirect, forKey: "notify.direct") } }
    }
    @Published var notifyChannel: Bool {
        didSet { if iCloudSyncEnabled { store.setAndSync(notifyChannel, forKey: "notify.channel") } }
    }
    @Published var notifyRoom: Bool {
        didSet { if iCloudSyncEnabled { store.setAndSync(notifyRoom, forKey: "notify.room") } }
    }
    @Published var notifyNewContacts: Bool {
        didSet { if iCloudSyncEnabled { store.setAndSync(notifyNewContacts, forKey: "notify.newContacts") } }
    }
    @Published var notifyConnection: Bool {
        didSet { if iCloudSyncEnabled { store.setAndSync(notifyConnection, forKey: "notify.connection") } }
    }
    @Published var notifyForeground: Bool {
        didSet { if iCloudSyncEnabled { store.setAndSync(notifyForeground, forKey: "notify.foreground") } }
    }

    private init() {
        // Load with defaults (true for messages, false for new contacts)
        notifyDirect = store.object(forKey: "notify.direct") == nil ? true : store.bool(forKey: "notify.direct")
        notifyChannel = store.object(forKey: "notify.channel") == nil ? true : store.bool(forKey: "notify.channel")
        notifyRoom = store.object(forKey: "notify.room") == nil ? true : store.bool(forKey: "notify.room")
        notifyNewContacts = store.bool(forKey: "notify.newContacts")
        notifyConnection = store.object(forKey: "notify.connection") == nil ? true : store.bool(forKey: "notify.connection")
        notifyForeground = store.object(forKey: "notify.foreground") == nil ? true : store.bool(forKey: "notify.foreground")

        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: store, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard iCloudSyncEnabled else { return }
                self?.loadAll()
            }
        }
    }

    private func loadAll() {
        notifyDirect = store.object(forKey: "notify.direct") == nil ? true : store.bool(forKey: "notify.direct")
        notifyChannel = store.object(forKey: "notify.channel") == nil ? true : store.bool(forKey: "notify.channel")
        notifyRoom = store.object(forKey: "notify.room") == nil ? true : store.bool(forKey: "notify.room")
        notifyNewContacts = store.bool(forKey: "notify.newContacts")
        notifyConnection = store.object(forKey: "notify.connection") == nil ? true : store.bool(forKey: "notify.connection")
        notifyForeground = store.object(forKey: "notify.foreground") == nil ? true : store.bool(forKey: "notify.foreground")
    }
}

/// Unified sidebar selection for NavigationSplitView.
// SidebarSelection enum moved to NavigationStore.swift

@MainActor
final class PommeCoreViewModel: ObservableObject {
    static let logger = Logger(subsystem: "com.pommecore", category: "ViewModel")

    // MARK: - Stores (@Observable, injected via .environment() in PommeCoreApp)
    // Stores own all state and logic. ViewModel is the coordinator:
    // wires store dependencies, dispatches incoming frames, manages lifecycle.
    
    let contactStore = ContactStore()
    let channelStore = ChannelStore()
    let messageStoreManager = MessageStoreManager()
    let connectionManager = ConnectionManager()
    let remoteSessionManager = RemoteSessionManager()
    let navigationStore = NavigationStore()
    #if !os(watchOS)
    let lineOfSightStore = LineOfSightStore()
    let rfMonitorStore: RFMonitorStore = {
        let store = RFMonitorStore()
        store.loadTelemetryHistory()
        store.loadCoveragePoints()
        return store
    }()
    let telemetryCloudSync = TelemetryCloudSync()
    let geofenceStore = GeofenceStore()
    #endif
    #if os(iOS)
    let phoneWatchRelay = PhoneWatchRelay()
    #endif

    // All forwarding properties removed — use stores directly.
    // contacts → contactStore.contacts, channels → channelStore.channels, etc.
    
    // MARK: - Internet Map (non-watchOS only)
#if !os(watchOS)
    var pendingMapUpload = false
    var pendingMapDataJSON: String?
#endif
    /// Device configuration — @Observable (fine-grained tracking).
    /// Not @Published: the observeStores bridge tracks changes via @Observable.
    /// Reference is replaced (= DeviceConfig()) on disconnect to reset all state.
    var deviceConfig = DeviceConfig()
    
    private let iCloudStore = NSUbiquitousKeyValueStore.default
    
    private func registerTerminationHandler() {
#if os(iOS)
        NotificationCenter.default.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.connectionManager.bleManager.disconnectForTermination()
            }
        }
#elseif os(macOS)
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.connectionManager.bleManager.disconnectForTermination()
            }
        }
#endif
    }
    
    private func observeiCloudChanges() {
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: iCloudStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                // ContactStore handles its own iCloud observation for nicknames/notes/groups
                self?.mergeMessagesForCurrentRadio()
            }
        }
    }
    
    // MARK: - Spotlight Navigation
    
#if canImport(CoreSpotlight)
    // indexContactsForSpotlight removed — called directly on contactStore
    
    func navigateToContact(pubkeyHex: String) {
        if let contact = contactStore.contacts.first(where: {
            $0.publicKey.hexCompact == pubkeyHex
        }) {
            navigationStore.sidebarSelection = .contact(contact.publicKeyPrefix)
        }
    }
#endif
    
    private var cancellables = Set<AnyCancellable>()
    
    init() {
        wireStoreDependencies()
        wireConnectionCallbacks()
        wireAppIntentBridge()
        observeStores()
        observeiCloudChanges()
        registerTerminationHandler()
    }

    /// Call after onboarding to request notification permissions (avoids prompt during onboarding).
    func requestNotificationPermissionsIfNeeded() {
        requestNotificationPermissions()
    }
    
    /// Wire cross-store dependencies via closures (no circular references).
    private func wireStoreDependencies() {
        // ContactStore dependencies
        contactStore.sendCommand = { [weak self] data, label in self?.connectionManager.sendCommand(data, label: label) }
        contactStore.activityDateProvider = { [weak self] key in self?.messageStoreManager.latestActivityDate(for: key) }
        contactStore.clearMessagesForContact = { [weak self] key in self?.messageStoreManager.clearMessages(for: key) }
        contactStore.postEventNotification = { [weak self] title, body, threadId in self?.postEventNotification(title: title, body: body, threadId: threadId) }
        contactStore.radioPublicKeyHexProvider = { [weak self] in self?.deviceConfig.publicKeyHex ?? "" }
        
        // ChannelStore dependencies
        channelStore.sendCommand = { [weak self] data, label in self?.connectionManager.sendCommand(data, label: label) }
        channelStore.clearChannelMessages = { [weak self] key in
            self?.messageStoreManager.messagesByContact.removeValue(forKey: key)
            self?.messageStoreManager.unreadCounts.removeValue(forKey: key)
        }
        channelStore.persistChannelMessages = { [weak self] key in self?.messageStoreManager.persistMessages(for: key) }
        
        // MessageStoreManager dependencies
        messageStoreManager.sendCommand = { [weak self] data, label in self?.connectionManager.sendCommand(data, label: label) }
        messageStoreManager.displayNameProvider = { [weak self] key in
            guard let self, let contact = self.contactStore.contacts.first(where: { $0.publicKeyPrefix == key }) else { return "Unknown" }
            return self.contactStore.displayName(for: contact)
        }
        messageStoreManager.deviceNameProvider = { [weak self] in self?.deviceConfig.deviceName ?? "" }
        messageStoreManager.radioPublicKeyHexProvider = { [weak self] in self?.deviceConfig.publicKeyHex ?? "" }
        messageStoreManager.contactProvider = { [weak self] key in self?.contactStore.contacts.first(where: { $0.publicKeyPrefix == key }) }
        messageStoreManager.channelProvider = { [weak self] idx in self?.channelStore.channels.first(where: { $0.index == idx }) }
        messageStoreManager.channelNotifyModeProvider = { [weak self] name in self?.channelStore.channelNotifyMode(for: name) ?? .all }
        messageStoreManager.allChannelsProvider = { [weak self] in self?.channelStore.channels ?? [] }
        messageStoreManager.contactNotifyModeProvider = { [weak self] contact in self?.contactStore.effectiveNotifyMode(for: contact) ?? .all }
        messageStoreManager.contactSoundProvider = { [weak self] contact in self?.contactStore.effectiveSound(for: contact) ?? .default }
        messageStoreManager.resetPathForContact = { [weak self] contact in self?.contactStore.resetPath(for: contact) }
        #if os(iOS)
        messageStoreManager.onUnreadChanged = { [weak self] in self?.syncWidget() }
        #endif
        
        // RemoteSessionManager dependencies
        remoteSessionManager.sendCommand = { [weak self] data, label in self?.connectionManager.sendCommand(data, label: label) }
        remoteSessionManager.contactsProvider = { [weak self] in self?.contactStore.contacts ?? [] }
        remoteSessionManager.deviceConfigProvider = { [weak self] in self?.deviceConfig ?? DeviceConfig() }
        remoteSessionManager.syncNextMessage = { [weak self] in self?.syncNextMessage() }
        remoteSessionManager.touchContact = { [weak self] key in self?.contactStore.touchContact(publicKeyPrefix: key) }
        remoteSessionManager.showError = { [weak self] msg in self?.connectionManager.lastErrorMessage = msg }
        remoteSessionManager.onStateChanged = { [weak self] in self?.objectWillChange.send() }
#if os(macOS) || targetEnvironment(macCatalyst)
        remoteSessionManager.sendUSBCLI = { [weak self] cmd in self?.connectionManager.sendUSBCLI(cmd) }
        remoteSessionManager.sendUSBCLIDirect = { [weak self] cmd in self?.connectionManager.sendUSBCLIDirect(cmd) }
        remoteSessionManager.sendUSBKeepalive = { [weak self] in self?.connectionManager.sendUSBKeepalive() }
#endif

#if os(iOS)
        phoneWatchRelay.contactStore = contactStore
        phoneWatchRelay.channelStore = channelStore
        phoneWatchRelay.messageStoreManager = messageStoreManager
        phoneWatchRelay.connectionManager = connectionManager

        // Activate relay immediately if unlocked; re-check when unlock status changes.
        if WatchUnlockManager.shared.isUnlocked {
            phoneWatchRelay.activate()
        }
        WatchUnlockManager.shared.$isUnlocked
            .receive(on: DispatchQueue.main)
            .sink { [weak self] unlocked in
                guard unlocked else { return }
                self?.phoneWatchRelay.activate()
                self?.phoneWatchRelay.sendState()
            }
            .store(in: &cancellables)
#endif

#if !os(watchOS)
        lineOfSightStore.userLocationProvider = { SharedLocation.manager.location }

        // GeofenceStore: distress action sends flood advert + public channel SOS message
        geofenceStore.distressAction = { [weak self] in
            guard let self else { return }
            self.connectionManager.sendAdvertise(type: 1)
            let name = self.deviceConfig.deviceName.isEmpty ? "Unknown" : self.deviceConfig.deviceName
            var text = "\u{1F198} DISTRESS from \(name)"
            if let loc = SharedLocation.manager.location {
                text += String(format: " at %.5f, %.5f", loc.coordinate.latitude, loc.coordinate.longitude)
            }
            if let zoneName = self.geofenceStore.lastExitZoneName {
                text += " (left safe zone: \(zoneName))"
            }
            self.messageStoreManager.sendChannelMessage(text, channelIndex: 0)
            #if os(iOS)
            self.syncWidget()
            #endif
        }

        // TelemetryCloudSync: wire to RFMonitorStore
        rfMonitorStore.cloudSync = telemetryCloudSync
        telemetryCloudSync.onCloudDataReceived = { [weak self] contactKey, snapshots in
            guard let self else { return }
            let existing = self.rfMonitorStore.telemetryHistory[contactKey] ?? []
            let existingIDs = Set(existing.map(\.id))
            let newSnapshots = snapshots.filter { !existingIDs.contains($0.id) }
            guard !newSnapshots.isEmpty else { return }
            var merged = existing + newSnapshots
            merged.sort { $0.timestamp < $1.timestamp }
            if merged.count > 500 { merged = Array(merged.suffix(500)) }
            self.rfMonitorStore.telemetryHistory[contactKey] = merged
            self.rfMonitorStore.saveTelemetryHistory()
        }
#endif
    }
    
    /// Populate AppIntentBridge so Siri/Shortcuts intents can reach live store instances.
    private func wireAppIntentBridge() {
        #if !os(watchOS)
        AppIntentBridge.shared.connectionManager = connectionManager
        AppIntentBridge.shared.contactStore = contactStore
        AppIntentBridge.shared.channelStore = channelStore
        AppIntentBridge.shared.messageStoreManager = messageStoreManager
        #endif
    }

    /// Wire ConnectionManager callbacks for frame dispatch and lifecycle events.
    private func wireConnectionCallbacks() {
        connectionManager.deviceConfig = deviceConfig
        connectionManager.onFrameReceived = { [weak self] data in
            self?.handleReceivedData(data)
        }
        connectionManager.onDeviceReady = { [weak self] in
            self?.onDeviceReady()
        }
        connectionManager.onUSBCLIReady = { [weak self] in
#if os(macOS) || targetEnvironment(macCatalyst)
            self?.onUSBCLIReady()
#endif
        }
        connectionManager.onDisconnected = { [weak self] previousState in
            self?.handleDisconnect(previousState: previousState)
        }
#if os(macOS) || targetEnvironment(macCatalyst)
        connectionManager.onUSBCLILineReceived = { [weak self] line in
            self?.remoteSessionManager.handleUSBCLILine(line)
        }
#endif
    }
    
    /// Handle disconnect cleanup — called by ConnectionManager when state → disconnected.
    private func handleDisconnect(previousState: BLEConnectionState) {
        remoteSessionManager.resetLoginSessions()
        remoteSessionManager.reset()
        connectionManager.stopAutoLocationUpdates()
        self.deviceConfig.reset()
        self.contactStore.reset()
        self.channelStore.reset()
        self.messageStoreManager.markAllSendingAsFailed()
        self.messageStoreManager.reset()
        self.messageStoreManager.deactivate()
        #if os(iOS)
        syncWidget()
        #endif

        // Connection loss notification
        if previousState == .connecting || previousState == .ready {
            if self.connectionManager.isInBackground && NotificationPreferences.shared.notifyConnection {
                let deviceName = self.connectionManager.connectedDeviceName ?? "radio"
                self.postEventNotification(
                    title: "Connection Lost",
                    body: "Lost connection to \(deviceName). Attempting to reconnect...",
                    threadId: "connection"
                )
            }
        }
    }
    
    /// Bridge @Observable stores → ObservableObject ViewModel.
    /// Only needed for WatchChatView (the sole remaining @EnvironmentObject consumer).
    /// All iOS/macOS views use @Environment(Store.self) directly.
    /// True while we are inside objectWillChange.send() to prevent re-entrant cascades.
    private var isSendingChange = false
    
    private func observeStores() {
        func trackChanges() {
            withObservationTracking {
                // Only needed for WatchChatView (@EnvironmentObject viewModel).
                // All iOS/macOS views use @Environment(Store.self) directly.
                _ = self.contactStore.contacts
                _ = self.channelStore.channels
                _ = self.connectionManager.connectionState
                _ = self.connectionManager.requestShowScanner
            } onChange: {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { [weak self] in
                    guard let self, !self.isSendingChange else {
                        // Re-register tracking even if we skip the send
                        trackChanges()
                        return
                    }
                    self.isSendingChange = true
                    self.objectWillChange.send()
                    self.isSendingChange = false
                    trackChanges()
                }
            }
        }
        trackChanges()
    }
    
    private func persistMessages(for contactKeyHash: Data) {
        messageStoreManager.persistMessages(for: contactKeyHash)
    }
    
    func mergeMessagesForCurrentRadio() {
        messageStoreManager.mergeMessagesForCurrentRadio()
    }
    
    /// Request notification permissions on first launch.
    private func requestNotificationPermissions() {
        let log = Self.logger
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                log.warning("Notification permission error: \(error.localizedDescription)")
            } else {
                log.info("Notification permission granted: \(granted)")
            }
        }
        setupNotificationCategories()
    }
    
    private func setupNotificationCategories() {
#if os(iOS)
        let replyAction = UNTextInputNotificationAction(
            identifier: "REPLY_ACTION",
            title: "Reply",
            options: [],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Type a message..."
        )
        let messageCategory = UNNotificationCategory(
            identifier: "MESSAGE_CATEGORY",
            actions: [replyAction],
            intentIdentifiers: ["INSendMessageIntent"],
            hiddenPreviewsBodyPlaceholder: "%u messages",
            categorySummaryFormat: "%u more messages",
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([messageCategory])
#endif
    }
    
    /// Handle a quick reply from a notification action (DM).
    func handleNotificationReply(text: String, contactPubkeyHex: String) {
        guard let contact = contactStore.contacts.first(where: {
            $0.publicKey.hexCompact == contactPubkeyHex
        }) else {
            Self.logger.warning("Quick reply: contact not found for \(contactPubkeyHex)")
            return
        }
        messageStoreManager.sendTextMessage(text, to: contact)
    }

    /// Handle a quick reply from a notification action (channel).
    func handleNotificationChannelReply(text: String, channelIndex: UInt8) {
        messageStoreManager.sendChannelMessage(text, channelIndex: channelIndex)
    }
    
    // postLocalNotification, updateAppBadge, playHapticFeedback, playReceiveHaptic -> MessageStoreManager
    
    func postEventNotification(title: String, body: String, threadId: String = "system") {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = threadId
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
    
    // updateAppBadge removed — views use MessageStoreManager directly
    
    // setupSubscriptions removed — transport subscriptions moved to ConnectionManager.
    // ConnectionManager callbacks are wired in wireConnectionCallbacks().
    
    #if os(iOS)
    func syncWidget() {
        syncWidgetState(
            connectionManager: connectionManager,
            deviceConfig: deviceConfig,
            messageStoreManager: messageStoreManager,
            geofenceStore: geofenceStore,
            contactStore: contactStore,
            channelStore: channelStore
        )
    }
    #endif

    private func onDeviceReady() {
#if os(macOS) || targetEnvironment(macCatalyst)
        // USB CLI mode handles its own settings fetch — don't send binary commands
        if connectionManager.usbManager.isConnected && connectionManager.usbManager.detectedMode == .cli { return }
#endif
        // Reconnection notification
        if connectionManager.isInBackground && NotificationPreferences.shared.notifyConnection {
            postEventNotification(
                title: "Reconnected",
                body: "Connected to \(connectionManager.connectedDeviceName ?? "radio")",
                threadId: "connection"
            )
        }
        channelStore.hasCompletedInitialChannelSync = false
        connectionManager.refreshAllSettings()
        contactStore.requestContacts(fullSync: true)
        syncNextMessage()
        #if os(iOS)
        syncWidget()
        #endif
    }
    
    func refreshAll() {
        connectionManager.refreshAll(contactStore: contactStore)
    }
    
    // Scanning & connection forwards removed — views use ConnectionManager directly
    
#if os(macOS) || targetEnvironment(macCatalyst)
    /// Called when USB CLI mode is detected — delegates to RemoteSessionManager.
    private func onUSBCLIReady() {
        let portName = connectionManager.usbManager.connectedPort?.replacingOccurrences(of: "/dev/cu.", with: "") ?? "USB Device"
        remoteSessionManager.onUSBCLIReady(portName: portName) { [weak self] cmd in
            self?.connectionManager.sendUSBCLI(cmd)
        }
        // Set ready state after clock sync
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard let self else { return }
            self.connectionManager.connectionState = .ready
            DebugLogger.shared.log("USB CLI: connectionState set to .ready", level: .info)
        }
    }
#endif
    
    // disconnect, disconnectUSB, sendUSBCLI removed — views use stores directly
    
    // MARK: - Location Privacy

    /// Session-stable random offset for location privacy. Regenerated on app launch
    /// or when the privacy radius setting changes.
    private static var locationFudgeAngle: Double = Double.random(in: 0..<(2 * .pi))
    private static var locationFudgeFraction: Double = Double.random(in: 0...1)

    static func fudgeLocation(lat: Double, lon: Double) -> (Double, Double) {
        let radius = UserDefaults.standard.double(forKey: "locationPrivacyRadius")
        guard radius > 0 else { return (lat, lon) }
        let distance = Self.locationFudgeFraction * radius
        let latOffset = (distance * cos(Self.locationFudgeAngle)) / 111_320.0
        let lonOffset = (distance * sin(Self.locationFudgeAngle)) / (111_320.0 * cos(lat * .pi / 180))
        return (lat + latOffset, lon + lonOffset)
    }

    static func regenerateLocationFudge() {
        locationFudgeAngle = Double.random(in: 0..<(2 * .pi))
        locationFudgeFraction = Double.random(in: 0...1)
    }

    // MARK: - Commands Used Internally

    func syncNextMessage() {
        #if os(macOS) || targetEnvironment(macCatalyst)
        guard !(connectionManager.isUSBCLIMode && remoteSessionManager.isUSBCLIConnected) else { return }
        #endif
        messageStoreManager.syncNextMessage()
    }

    func removeContact(_ contact: Contact) {
        contactStore.removeContact(contact)
        messageStoreManager.messagesByContact.removeValue(forKey: contact.publicKeyPrefix)
        messageStoreManager.unreadCounts.removeValue(forKey: contact.publicKeyPrefix)
        if case .contact(let key) = navigationStore.sidebarSelection, key == contact.publicKeyPrefix {
            navigationStore.sidebarSelection = nil
        }
    }

    func exportContact(_ contact: Contact) {
        messageStoreManager.lastExportedURL = nil
        connectionManager.exportContact(contact)
    }

    func exportSelfContact() {
        messageStoreManager.lastExportedURL = nil
        connectionManager.exportSelfContact()
    }

    func handleMeshCoreURL(_ urlString: String) {
        if channelStore.handleChannelURL(urlString) { return }
        if urlString.hasPrefix("meshcore://") {
            connectionManager.importContact(url: urlString)
            contactStore.requestContacts(fullSync: true)
        }
    }
}
