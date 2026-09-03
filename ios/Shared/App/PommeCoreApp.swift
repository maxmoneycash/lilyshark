//
//  PommeCoreApp.swift
//  PommeCore
//
//  App entry point, NavigationSplitView layout, platform-specific UI, sheet management.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import UserNotifications
import LocalAuthentication
#if os(watchOS)
import WidgetKit
#endif
#if canImport(CoreSpotlight)
import CoreSpotlight
#endif
import MeshCoreKit
#if (os(watchOS) || os(iOS)) && canImport(PommeCoreWatchKit)
import PommeCoreWatchKit
#endif

@main
struct PommeCoreApp: App {
    #if os(watchOS)
    @State private var watchReceiver = WatchReceiver()
    @State private var watchContactStore = WatchContactStore()
    @State private var watchMessageStore = WatchMessageStore()
    @State private var watchAppState = WatchAppState()
    #else
    @StateObject private var viewModel = PommeCoreViewModel()
    @StateObject private var appLock = AppLockManager()
    @State private var presetService = RegionalPresetService()
    @State private var radioProfileStore = RadioProfileStore()
    private let syncedSettings = SyncedSettings.shared
    @Environment(\.scenePhase) private var scenePhase
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    #elseif os(macOS)
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) var macAppDelegate
    #endif
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @AppStorage("openSettingsAfterOnboarding") private var openSettingsAfterOnboarding = false
    #endif

    init() {
        #if !os(watchOS)
        UserDefaults.standard.register(defaults: [
            "autoRetry": true,
            "autoResetPath": true
        ])
        #endif
    }

    var body: some Scene {
        WindowGroup {
            #if os(watchOS)
            WatchRootView()
                .environment(watchContactStore)
                .environment(watchMessageStore)
                .environment(watchAppState)
                .onAppear {
                    watchReceiver.contactStore = watchContactStore
                    watchReceiver.messageStore = watchMessageStore
                    watchReceiver.appState = watchAppState
                    watchReceiver.activate()
                    syncWatchWidgetState()
                }
                .onChange(of: watchContactStore.unreadCounts) { _, _ in syncWatchWidgetState() }
                .onChange(of: watchAppState.isConnected) { _, _ in syncWatchWidgetState() }
            #else
            if !hasCompletedOnboarding {
                OnboardingView(
                    hasCompletedOnboarding: $hasCompletedOnboarding,
                    navigateToSettings: { openSettingsAfterOnboarding = true }
                )
                .meshTheme()
                .onChange(of: hasCompletedOnboarding) { _, completed in
                    if completed {
                        viewModel.connectionManager.bleManager.activate()
                        viewModel.requestNotificationPermissionsIfNeeded()
                    }
                }
            } else if appLock.appLockEnabled && !appLock.isUnlocked {
                AppLockView(appLock: appLock)
                    .meshTheme()
            } else {
                ContentView()
                    .task { presetService.fetchIfNeeded() }
                    .environmentObject(viewModel)
                    .environment(viewModel.deviceConfig)
                    .environment(presetService)
                    .environment(radioProfileStore)
                    .environment(viewModel.contactStore)
                    .environment(viewModel.channelStore)
                    .environment(viewModel.messageStoreManager)
                    .environment(viewModel.connectionManager)
                    .environment(viewModel.remoteSessionManager)
                    .environment(viewModel.navigationStore)
                    #if !os(watchOS)
                    .environment(viewModel.lineOfSightStore)
                    .environment(viewModel.rfMonitorStore)
                    .environment(viewModel.geofenceStore)
                    #endif
                    .meshTheme()
                    .onAppear {
                        viewModel.connectionManager.bleManager.activate()
                        viewModel.requestNotificationPermissionsIfNeeded()
                    }
                    #if os(iOS)
                    .onAppear { appDelegate.viewModel = viewModel }
                    #endif
                    #if canImport(CoreSpotlight)
                    .onContinueUserActivity(CSSearchableItemActionType) { activity in
                        if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
                            let hex = id.replacingOccurrences(of: "meshcore.contact.", with: "")
                            viewModel.navigateToContact(pubkeyHex: hex)
                        }
                    }
                    #endif
            }
            #endif
        }
        #if !os(watchOS)
        .onChange(of: scenePhase) { _, newPhase in
            viewModel.connectionManager.isInBackground = (newPhase != .active)
            if newPhase == .active {
                viewModel.messageStoreManager.updateAppBadge()
                viewModel.connectionManager.reconnectWiFiIfNeeded()
            }
            if newPhase == .background && appLock.appLockEnabled {
                appLock.isUnlocked = false
            }
        }
        #endif
    }

    #if os(watchOS)
    private func syncWatchWidgetState() {
        let counts = watchContactStore.unreadCounts
        let dmCount = counts.filter { !$0.key.hasPrefix("ch") }.values.reduce(0, +)
        let channelCount = counts.filter { $0.key.hasPrefix("ch") }.values.reduce(0, +)
        WatchWidgetState(
            isConnected: watchAppState.isConnected,
            deviceName: watchAppState.deviceName,
            unreadDMCount: dmCount,
            unreadChannelCount: channelCount
        ).save()
        WidgetCenter.shared.reloadAllTimelines()
    }
    #endif
}

#if os(iOS)
class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var viewModel: PommeCoreViewModel?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if NotificationPreferences.shared.notifyForeground {
            completionHandler([.banner, .sound, .badge])
        } else {
            completionHandler([])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo

        // Handle quick reply action
        if response.actionIdentifier == "REPLY_ACTION",
           let textResponse = response as? UNTextInputNotificationResponse {
            let text = textResponse.userText
            Task { @MainActor in
                if let isChannel = userInfo["isChannel"] as? Bool, isChannel,
                   let chIdx = userInfo["channelIndex"] as? UInt8 {
                    viewModel?.handleNotificationChannelReply(text: text, channelIndex: chIdx)
                } else if let pubkeyHex = userInfo["contactPubkey"] as? String {
                    viewModel?.handleNotificationReply(text: text, contactPubkeyHex: pubkeyHex)
                }
            }
        }

        // Navigate to the correct chat on tap
        Task { @MainActor in
            if let isChannel = userInfo["isChannel"] as? Bool, isChannel,
               let chIdx = userInfo["channelIndex"] as? UInt8 {
                viewModel?.navigationStore.sidebarSelection = chIdx == 0 ? .publicChannel : .channel(chIdx)
            } else if let pubkeyHex = userInfo["contactPubkey"] as? String {
                if let contact = viewModel?.contactStore.contacts.first(where: {
                    $0.publicKey.hexCompact == pubkeyHex
                }) {
                    viewModel?.navigationStore.sidebarSelection = .contact(contact.publicKeyPrefix)
                }
            }
        }
        completionHandler()
    }
}
#endif

#if os(macOS)
class MacAppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Show banners, badges, and sound even when the app is frontmost
        completionHandler([.banner, .sound, .badge])
    }
}
#endif

#if !os(watchOS)
struct ContentView: View {
    @Environment(ContactStore.self) private var contactStore
    @Environment(ChannelStore.self) private var channelStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(NavigationStore.self) private var navigationStore
    @State private var showScanner = false
    @State private var showSettings = false
    @State private var showDiscover = false
    @State private var showConnectionFailed = false
    @State private var showAdvertSent = false
    @State private var showRemoteManagement = false
    @State private var showSetupWizard = false
    @State private var previousConnectionState: BLEConnectionState = .disconnected
    @State private var hasRequestedAutoScan = false
    /// Bridged from OnboardingView's "Open Settings Now" button.
    @AppStorage("openSettingsAfterOnboarding") private var openSettingsAfterOnboarding = false

    var body: some View {
        #if os(watchOS)
        NavigationStack {
            ContactListView(showScanner: $showScanner)
                .sheet(isPresented: $showScanner) {
                    NavigationStack {
                        DeviceScannerView()
                    }
                }
                .onAppear { requestAutoScanOnce() }
                .onChange(of: connectionManager.connectionState) { _, newState in
                    handleConnectionStateChange(newState)
                }
                .alert("Connection Failed", isPresented: $showConnectionFailed) {
                    Button("Retry") { showScanner = true }
                    Button("OK", role: .cancel) { }
                } message: {
                    Text("Could not connect to the device. Would you like to scan again?")
                }
                .alert("Device Error", isPresented: showErrorBinding) {
                    Button("OK", role: .cancel) { connectionManager.lastErrorMessage = nil }
                } message: {
                    Text(connectionManager.lastErrorMessage ?? "Unknown error")
                }
        }
        #else
        NavigationSplitView {
            ContactListView(
                showScanner: $showScanner,
                showDiscover: $showDiscover,
                showSettings: $showSettings,
                showRemoteManagement: $showRemoteManagement,
                showAdvertSent: $showAdvertSent
            )
            // Column width MUST be on the view inside the sidebar builder, not on
            // NavigationSplitView itself — the outer position is silently ignored.
            // ideal = first-launch default; macOS window restoration remembers any
            // user resize automatically via WindowGroup state persistence.
            #if os(macOS) || targetEnvironment(macCatalyst)
            .navigationSplitViewColumnWidth(min: 220, ideal: 240, max: 400)
            #endif
        } detail: {
            switch navigationStore.sidebarSelection {
            case .publicChannel:
                ChannelChatView(channelIndex: 0, channelName: "Public Channel")
            case .channel(let chIdx):
                if let channel = channelStore.channels.first(where: { $0.index == chIdx }) {
                    ChannelChatView(channelIndex: channel.index, channelName: channel.name)
                } else {
                    ChannelChatView(channelIndex: chIdx, channelName: "Channel \(chIdx)")
                }
            case .contact(let key):
                if let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == key }) {
                    switch contact.type {
                    case .room:
                        RoomChatView(
                            contact: contact,
                            session: remoteSessionManager.remoteSession(for: contact)
                        )
                    case .repeater:
                        RepeaterLoginView(
                            contact: contact,
                            session: remoteSessionManager.remoteSession(for: contact)
                        )
                    default:
                        ChatView(contact: contact)
                    }
                } else {
                    Text("Contact not found")
                }
            case .settings:
                SettingsView()
            #if !os(watchOS)
            case .map:
                if #available(iOS 17.0, macOS 14.0, *) {
                    MeshMapView()
                } else {
                    Text("Map requires iOS 17+ or macOS 14+")
                }
            case .tools:
                ToolsView()
            #endif
            #if os(macOS) || targetEnvironment(macCatalyst)
            case .usbTerminal:
                USBTerminalView()
            case .usbDevice:
                if let contact = remoteSessionManager.usbDeviceContact, let session = remoteSessionManager.usbDeviceSession {
                    RemoteManagementView(contact: contact, session: session)
                } else {
                    Text("USB device not connected")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            #endif
            case nil:
                if connectionManager.connectionState == .disconnected {
                    VStack(spacing: 16) {
                        Image(systemName: "antenna.radiowaves.left.and.right.slash")
                            .font(.system(size: 48))
                            .foregroundStyle(MeshTheme.textSecondary)
                        Text("No Radio Connected")
                            .font(.title2)
                            .fontWeight(.semibold)
                        Text("Turn on your MeshCore radio and tap the button below to scan for nearby devices.")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                        Button {
                            showScanner = true
                        } label: {
                            Label("Scan for Devices", systemImage: "magnifyingglass")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(MeshTheme.interactiveGreen)
                        .foregroundStyle(.black)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.system(size: 48))
                            .foregroundStyle(MeshTheme.textSecondary)
                        Text("Select a Contact")
                            .font(.title2)
                            .fontWeight(.semibold)
                        Text("Choose a contact or channel from the sidebar to start messaging.")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        #if os(iOS)
        .navigationSplitViewStyle(.balanced)
        #endif
        #if os(macOS) || targetEnvironment(macCatalyst)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    connectionManager.sendAdvertise(type: 1)
                    showAdvertSent = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        showAdvertSent = false
                    }
                } label: {
                    Image(systemName: showAdvertSent
                        ? "checkmark.circle.fill"
                        : "antenna.radiowaves.left.and.right")
                        .foregroundStyle(MeshTheme.accent)
                }
                .disabled(connectionManager.connectionState != .ready)
                .help("Advertise")
                .accessibilityLabel("Advertise")
                .accessibilityHint("Send an advertisement to announce your presence on the mesh")
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        showDiscover = true
                    } label: {
                        Label("Discover Nodes", systemImage: "binoculars.fill")
                    }
                    Button {
                        navigationStore.sidebarSelection = .map
                    } label: {
                        Label("Mesh Map", systemImage: "map.fill")
                    }
                    Button {
                        navigationStore.sidebarSelection = .tools
                    } label: {
                        Label("Tools", systemImage: "wrench.and.screwdriver")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(MeshTheme.accent)
                }
                .help("More")
                .accessibilityLabel("More")
            }
        }
        #endif
        .sheet(isPresented: $showScanner) {
            NavigationStack {
                DeviceScannerView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showScanner = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showSettings = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showDiscover) {
            NavigationStack {
                DiscoverView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showDiscover = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showRemoteManagement) {
            if let (contact, session) = activeManagementTarget {
                NavigationStack {
                    RemoteManagementView(contact: contact, session: session)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { showRemoteManagement = false }
                            }
                        }
                }
                .meshTheme()
                #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
                #endif
            }
        }
        .sheet(isPresented: $showSetupWizard) {
            NavigationStack {
                NodeSetupWizardView(
                    publicKeyHex: deviceConfig.publicKeyHex,
                    currentAdvertName: deviceConfig.deviceName,
                    onApplyName: { name in connectionManager.setAdvertName(name) }
                )
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showSetupWizard = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 360, minHeight: 500)
            #endif
        }
        .onAppear {
            requestAutoScanOnce()
            if openSettingsAfterOnboarding {
                openSettingsAfterOnboarding = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    dismissAllSheets()
                    showSettings = true
                }
            }
        }
        .onChange(of: connectionManager.connectionState) { _, newState in
            handleConnectionStateChange(newState)
        }
        .onChange(of: connectionManager.requestShowScanner) { _, shouldShow in
            if shouldShow {
                dismissAllSheets()
                showScanner = true
                connectionManager.requestShowScanner = false
            }
        }
        .alert("Connection Failed", isPresented: $showConnectionFailed) {
            Button("Retry") { showScanner = true }
            Button("OK", role: .cancel) { }
        } message: {
            Text("Could not connect to the device. Would you like to scan again?")
        }
        .alert("Device Error", isPresented: showErrorBinding) {
            Button("OK", role: .cancel) { connectionManager.lastErrorMessage = nil }
        } message: {
            Text(connectionManager.lastErrorMessage ?? "Unknown error")
        }
        .alert("Advertisement Sent", isPresented: $showAdvertSent) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Your device advertisement has been broadcast to the mesh network.")
        }
        .onOpenURL { url in
            let urlString = url.absoluteString
            if !channelStore.handleChannelURL(urlString),
               urlString.hasPrefix("meshcore://") {
                connectionManager.importContact(url: urlString)
                contactStore.requestContacts(fullSync: true)
            }
        }
        #endif
    }

    /// Request auto-scan on first launch. The ViewModel waits for BLE poweredOn
    /// before actually starting the scan. Shows scanner sheet immediately.
    private func requestAutoScanOnce() {
        guard !hasRequestedAutoScan else { return }
        hasRequestedAutoScan = true

        // If already connected (e.g. state restoration), don't show scanner
        if connectionManager.connectionState == .ready || connectionManager.connectionState == .connected {
            return
        }
        // If reconnecting via state restoration, don't interrupt
        if connectionManager.connectionState == .connecting {
            return
        }

        showScanner = true
        connectionManager.requestAutoScan()
    }

    /// Find the first logged-in remote management target for the toolbar wrench button.
    private var activeManagementTarget: (Contact, RemoteDeviceSession)? {
        for contact in contactStore.contacts where contact.type == .repeater || contact.type == .room {
            let session = remoteSessionManager.remoteSession(for: contact)
            if case .loggedIn = session.loginState {
                return (contact, session)
            }
        }
        return nil
    }

    private var showErrorBinding: Binding<Bool> {
        Binding(
            get: { connectionManager.lastErrorMessage != nil },
            set: { if !$0 { connectionManager.lastErrorMessage = nil } }
        )
    }

    private func handleConnectionStateChange(_ newState: BLEConnectionState) {
        // Auto-dismiss scanner when connection succeeds
        if newState == .ready || newState == .connected {
            showScanner = false
            // Auto-show setup wizard on first connection with a default/unconfigured name
            offerSetupWizardIfNeeded()
        }
        // No alert on connecting → disconnected — the auto-reconnect and
        // auto-scan flow handles this silently via status bar updates.
        previousConnectionState = newState
    }

    /// Check if device has a default name and offer the setup wizard.
    /// Only prompts once per radio (keyed by public key prefix).
    /// Dismiss any active sheet before presenting a new one.
    /// SwiftUI only supports one presented sheet at a time — setting multiple
    /// sheet booleans simultaneously causes "only presenting a single sheet" warnings.
    private func dismissAllSheets() {
        showScanner = false
        showSettings = false
        showDiscover = false
        showRemoteManagement = false
        showSetupWizard = false
    }

    private func offerSetupWizardIfNeeded() {
        // Wait for device info to populate
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            let name = deviceConfig.deviceName
            let pubkeyPrefix = String(deviceConfig.publicKeyHex.prefix(12))
            guard !pubkeyPrefix.isEmpty else { return }
            let key = "hasOfferedSetupWizard_\(pubkeyPrefix)"
            guard !UserDefaults.standard.bool(forKey: key) else { return }
            // Check if name looks unconfigured (default firmware names)
            let isDefault = name.isEmpty
                || name.hasPrefix("Companion-")
                || name.hasPrefix("MeshCore")
                || name.count <= 4
            if isDefault {
                dismissAllSheets()
                showSetupWizard = true
            }
            UserDefaults.standard.set(true, forKey: key)
        }
    }
}

// MARK: - App Lock

@MainActor
class AppLockManager: ObservableObject {
    @Published var isUnlocked = false
    @Published var authFailCount = 0
    @Published var showResetOption = false
    @AppStorage("appLockEnabled") var appLockEnabled = false

    func authenticate() {
        guard appLockEnabled else {
            isUnlocked = true
            return
        }

        DebugLogger.shared.log("APP LOCK: starting authentication", level: .info)

        // Use .deviceOwnerAuthentication which falls back to device passcode
        // if biometrics fail — never leaves the user locked out.
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"

        // Small delay to ensure the window is fully presented before showing prompt
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            var error: NSError?
            guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
                // No authentication available (no passcode set on device) — unlock directly
                DebugLogger.shared.log("APP LOCK: no auth available, unlocking: \(error?.localizedDescription ?? "none")", level: .warning)
                self.isUnlocked = true
                return
            }

            context.evaluatePolicy(.deviceOwnerAuthentication,
                                   localizedReason: "Unlock Lilyshark to access your messages") { success, authError in
                Task { @MainActor in
                    if success {
                        DebugLogger.shared.log("APP LOCK: authenticated successfully", level: .info)
                        self.isUnlocked = true
                        self.authFailCount = 0
                        self.showResetOption = false
                    } else {
                        self.authFailCount += 1
                        DebugLogger.shared.log("APP LOCK: auth failed (\(self.authFailCount)/3): \(authError?.localizedDescription ?? "cancelled")", level: .warning)
                        if self.authFailCount >= 3 {
                            self.showResetOption = true
                        }
                    }
                }
            }
        }
    }

    /// Emergency reset — disables app lock when user is locked out.
    func resetLock() {
        DebugLogger.shared.log("APP LOCK: emergency reset — disabling app lock", level: .warning)
        appLockEnabled = false
        isUnlocked = true
        authFailCount = 0
        showResetOption = false
    }
}

struct AppLockView: View {
    @ObservedObject var appLock: AppLockManager
    @State private var hasTriedAutoAuth = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 72))
                .foregroundStyle(MeshTheme.accent)
            Text("Lilyshark is Locked")
                .font(.title2.bold())
                .foregroundStyle(MeshTheme.textPrimary)
            Text("Authenticate to access your messages")
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)

            if appLock.showResetOption {
                Text("Authentication failed \(appLock.authFailCount) times")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Spacer()

            Button {
                appLock.authenticate()
            } label: {
                Label("Unlock", systemImage: biometricIcon)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(MeshTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 40)

            if appLock.showResetOption {
                Button {
                    appLock.resetLock()
                } label: {
                    Text("Disable App Lock")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .padding(.top, 8)
            }
        }
        .padding(.bottom, 40)
        .background(MeshTheme.background)
        .onAppear {
            // Only auto-authenticate once per view appearance
            guard !hasTriedAutoAuth else { return }
            hasTriedAutoAuth = true
            appLock.authenticate()
        }
    }

    private var biometricIcon: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.open"
        }
    }
}
#endif
