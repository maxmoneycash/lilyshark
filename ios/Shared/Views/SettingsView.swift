//
//  SettingsView.swift
//  PommeCore
//
//  Device settings, radio config, privacy, iCloud, storage, and diagnostics.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import StoreKit
import LocalAuthentication
import CloudKit
import MeshCoreKit
#if !os(watchOS)
import CoreLocation
#endif

/// Wraps a firmware version string so it can be used as a `.sheet(item:)` identifier.
struct FirmwareOTAItem: Identifiable {
    let version: String
    var id: String { version }
}

struct SettingsView: View {
    @Environment(DeviceConfig.self) var deviceConfig
    @Environment(ConnectionManager.self) var connectionManager
    @Environment(RemoteSessionManager.self) var remoteSessionManager
    @Environment(MessageStoreManager.self) var messageStoreManager
    #if !os(watchOS)
    @Environment(RFMonitorStore.self) var rfMonitorStore
    #endif
    @AppStorage("batteryChemistry") var batteryChemistryRaw: String = BatteryChemistry.lipo.rawValue
    @AppStorage("appTheme") var appTheme: String = AppTheme.system.rawValue
    @AppStorage("maxMessagesPerContact") var maxMessagesPerContact: Int = 500
    @AppStorage("iCloudSyncEnabled") var iCloudSyncEnabled: Bool = true
    @State var statsExpanded = false
    @StateObject var tipJar = TipJarManager()
    @State var radioToDelete: String?
    @State var showDeleteRadioConfirm = false
    @State var radioToMigrate: String?
    @State var showMigrateSheet = false
    @State var showConnectionHelp = false
    @State var showPurgeOptions = false
    @State var showDebugLog = false
    @State var showSupportersSheet = false
    @State var supporterName = ""
    @StateObject var supportersManager = SupportersManager()
    #if os(macOS) || targetEnvironment(macCatalyst)
    @State var inspectorSheet: DeviceInfoSection.DeviceSheet?
    @State var showInspector = false
    @State var showTipJarSheet = false
    #else
    @State var iosDeviceSheet: DeviceInfoSection.DeviceSheet?
    @State var showTipJarSheet = false
    #endif
    @State var showSetupWizard = false
    @State var firmwareOTAItem: FirmwareOTAItem? = nil

    var batteryChemistry: BatteryChemistry {
        BatteryChemistry(rawValue: batteryChemistryRaw) ?? .lipo
    }

    var body: some View {
        Group {
            if !isConnected {
                disconnectedView
            } else {
                settingsForm
            }
        }
        .navigationTitle("Settings")
        .alert("Join the Supporters Wall?", isPresented: $tipJar.showSupporterNamePrompt) {
            TextField("Display name", text: $supporterName)
            Button("Add My Name") {
                let name = supporterName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { return }
                Task {
                    _ = await supportersManager.addSupporter(name: name)
                }
            }
            Button("No Thanks", role: .cancel) {}
        } message: {
            Text("Thank you for your generous tip! Enter a display name to appear on the Supporters Wall, visible to all Lilyshark users.")
        }
        .onAppear {
            if isConnected {
                connectionManager.refreshAllSettings()
            }
        }
    }

    var isConnected: Bool {
        connectionManager.connectionState == .ready || connectionManager.connectionState == .connected
    }

    // MARK: - Disconnected State

    private var disconnectedView: some View {
        List {
            appearanceSection
            iCloudSection
            radioDataSection

            Section {
                VStack(spacing: 16) {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash")
                        .font(.system(size: 48))
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text("No Device Connected")
                        .font(.headline)
                    Text("Connect to a MeshCore radio to view and change device settings.")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            }

            tipJarSection
            aboutSection
        }
        .meshListStyle()
        .sheet(isPresented: $showTipJarSheet) {
            NavigationStack {
                TipJarView(manager: tipJar)
            }
            .meshTheme()
        }
        .sheet(isPresented: $showSupportersSheet) {
            NavigationStack {
                SupportersView()
            }
            .meshTheme()
        }
    }

    // MARK: - Settings Form

    private var settingsForm: some View {
        List {
            // 1. Appearance
            appearanceSection

            // 2. Connection
            connectionSection

            // 4. Device Info (BLE/WiFi/USB Binary only — USB CLI uses RemoteManagementView)
            #if os(macOS) || targetEnvironment(macCatalyst)
            if isConnected && !connectionManager.isUSBCLIMode {
                deviceInfoSection
            }
            #else
            if isConnected {
                deviceInfoSection
            }
            #endif

            // 5. Notifications
            notificationsSection

            // 6. Watch Companion
            #if os(iOS)
            watchCompanionSection
            #endif

            messageSettingsSection

            meshResponderSection

            // 7. Privacy & Security
            privacySection

            // 7. iCloud & Storage
            iCloudSection
            storageSection
            radioDataSection

            // 8. Support & About
            tipJarSection
            aboutSection

            // 9. Advanced
            Section {
                if isConnected {
                    if !deviceConfig.customVars.isEmpty {
                        customVarsSection
                    }
                    statsSection
                }
                troubleshootingSection
            } header: {
                sectionInfoHeader("Advanced", info: "Developer and diagnostic tools. Most users won\u{2019}t need these.")
            }

            // 10. Danger Zone
            if isConnected {
                dangerZoneSection
            }
        }
        .meshListStyle()
        #if !os(macOS) && !targetEnvironment(macCatalyst)
        // iOS: sheet anchored here — above the conditional DeviceInfoSection — so
        // structural changes inside DeviceInfoSection can't auto-dismiss the sheet.
        .sheet(item: $iosDeviceSheet) { sheet in
            NavigationStack {
                Group {
                    switch sheet {
                    case .name: NameEditorSheet()
                    case .radio: RadioSection().navigationTitle("Radio Settings")
                    case .txPower: TxPowerEditorSheet()
                    case .tuning: TuningEditorSheet()
                    case .floodScope: FloodScopeEditorSheet()
                    case .gps: GPSEditorSheet()
                    case .battery: BatteryEditorSheet(batteryChemistryRaw: $batteryChemistryRaw)
                    case .firmware: FirmwareDetailSheet()
                    case .profileTransfer: ProfileExportView()
                    case .radioProfiles: RadioProfilesView()
                    case .radioStats: RadioStatsView()
                    }
                }
                .lilysharkSheet { iosDeviceSheet = nil }
            }
            .meshTheme()
        }
        .sheet(item: $firmwareOTAItem) { item in
            FirmwareUpdateView(latestVersion: item.version)
                #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 480, minHeight: 420)
                #endif
        }
        // iOS: Tip Jar sheet anchored at List level — same reason as iosDeviceSheet above.
        .sheet(isPresented: $showTipJarSheet) {
            NavigationStack {
                TipJarView(manager: tipJar)
            }
            .meshTheme()
        }
        .sheet(isPresented: $showSupportersSheet) {
            NavigationStack {
                SupportersView()
            }
            .meshTheme()
        }
        .sheet(isPresented: $showSetupWizard) {
            NavigationStack {
                NodeSetupWizardView(
                                publicKeyHex: deviceConfig.publicKeyHex,
                                currentAdvertName: deviceConfig.deviceName,
                                onApplyName: { name in connectionManager.setAdvertName(name) }
                            )
                    .lilysharkSheet { showSetupWizard = false }
            }
            .meshTheme()
        }
        #endif
        #if os(macOS) || targetEnvironment(macCatalyst)
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: 40)
        }
        // macOS/Catalyst: inspector panel replaces broken .sheet on Catalyst
        .inspector(isPresented: $showInspector) {
            if let sheet = inspectorSheet {
                NavigationStack {
                    Group {
                        switch sheet {
                        case .name: NameEditorSheet()
                        case .radio: RadioSection().navigationTitle("Radio Settings")
                        case .txPower: TxPowerEditorSheet()
                        case .tuning: TuningEditorSheet()
                        case .floodScope: FloodScopeEditorSheet()
                        case .gps: GPSEditorSheet()
                        case .battery: BatteryEditorSheet(batteryChemistryRaw: $batteryChemistryRaw)
                        case .firmware: FirmwareDetailSheet()
                        case .profileTransfer: ProfileExportView()
                        case .radioProfiles: RadioProfilesView()
                    case .radioStats: RadioStatsView()
                        }
                    }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") {
                                showInspector = false
                                inspectorSheet = nil
                            }
                        }
                    }
                }
                .meshTheme()
            }
        }
        .inspectorColumnWidth(min: 300, ideal: 400, max: 500)
        .sheet(item: $firmwareOTAItem) { item in
            FirmwareUpdateView(latestVersion: item.version)
                .frame(minWidth: 480, minHeight: 420)
        }
        // macOS/Catalyst: Tip Jar sheet anchored at the List level (not on the row Button)
        // so List cell reuse/re-render on sheet dismiss can't corrupt navigation state.
        .sheet(isPresented: $showTipJarSheet) {
            NavigationStack {
                TipJarView(manager: tipJar)
            }
            .meshTheme()
        }
        .sheet(isPresented: $showSupportersSheet) {
            NavigationStack {
                SupportersView()
            }
            .meshTheme()
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
            .frame(minWidth: 360, minHeight: 500)
        }
        #endif
        // macOS/Catalyst: refresh button lives in the NavigationSplitView toolbar.
        // iOS: add a settings-specific refresh button.
        #if !os(macOS) && !targetEnvironment(macCatalyst)
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button {
                    connectionManager.refreshAllSettings()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundStyle(MeshTheme.accent)
                }
                .help("Refresh all settings")
            }
        }
        #endif
    }
}

// MARK: - iCloud Sync

private extension SettingsView {
    var iCloudSection: some View {
        Section {
            Toggle(isOn: $iCloudSyncEnabled) {
                Label("Sync to iCloud", systemImage: "icloud")
                    .foregroundStyle(MeshTheme.accent)
            }
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            if iCloudSyncEnabled {
                let usage = iCloudKVSUsage()
                HStack {
                    Text("iCloud Storage")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text("\(usage.keys) keys, \(ByteCountFormatter.string(fromByteCount: Int64(usage.bytes), countStyle: .memory))")
                        .font(.caption)
                        .foregroundStyle(usage.bytes > 900_000 ? .red : usage.bytes > 700_000 ? .orange : .green)
                }
                .listRowBackground(MeshTheme.surface)
                if usage.bytes > 900_000 {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text("Approaching iCloud limit (1 MB). Consider deleting old radio data below.")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    .listRowBackground(MeshTheme.surface)
                }
            }
        } header: {
            sectionInfoHeader("iCloud", info: "Syncs nicknames, notes, channel secrets, login credentials, recent messages, app settings, and telemetry history between your Apple devices via iCloud. Data is encrypted by Apple in transit and at rest. Messages and telemetry are stored per radio \u{2014} switching radios keeps data separate.")
        }
    }

    private func iCloudKVSUsage() -> (keys: Int, bytes: Int) {
        let store = NSUbiquitousKeyValueStore.default
        let dict = store.dictionaryRepresentation
        var totalBytes = 0
        for (key, value) in dict {
            totalBytes += key.utf8.count
            if let data = value as? Data { totalBytes += data.count }
            else if let string = value as? String { totalBytes += string.utf8.count }
            else if let array = value as? [Any] { totalBytes += MemoryLayout<Int>.size * array.count }
            else { totalBytes += 8 }
        }
        return (dict.count, totalBytes)
    }


    var radioDataSection: some View {
        RadioDataSection(radioToDelete: $radioToDelete, showDeleteRadioConfirm: $showDeleteRadioConfirm, radioToMigrate: $radioToMigrate, showMigrateSheet: $showMigrateSheet)
    }
}

struct RadioDataSection: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Binding var radioToDelete: String?
    @Binding var showDeleteRadioConfirm: Bool
    @Binding var radioToMigrate: String?
    @Binding var showMigrateSheet: Bool

    private var currentRadioPrefix: String? {
        let hex = deviceConfig.publicKeyHex
        return hex.isEmpty ? nil : String(hex.prefix(12))
    }

    private var knownRadios: [String] {
        var prefixes = Set<String>()

        // Discover from iCloud message keys
        let store = NSUbiquitousKeyValueStore.default
        let allKeys = store.dictionaryRepresentation.keys
        for key in allKeys where key.hasPrefix("msg.") {
            let parts = key.dropFirst(4) // remove "msg."
            if let dot = parts.firstIndex(of: ".") {
                prefixes.insert(String(parts[parts.startIndex..<dot]))
            }
        }

        // Discover from local per-radio message subdirectories
        for prefix in MessageStore.knownRadioPrefixes() {
            prefixes.insert(prefix)
        }

        return prefixes.sorted()
    }

    var body: some View {
        if !knownRadios.isEmpty {
            Section {
                ForEach(knownRadios, id: \.self) { radioPrefix in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Radio \(radioPrefix.prefix(8))...")
                                .font(.body)
                                .foregroundStyle(MeshTheme.accent)
                            Text("\(messageCountForRadio(radioPrefix)) messages in iCloud")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        Spacer()
                        if radioPrefix == currentRadioPrefix {
                            Text("Connected")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.connected)
                        }
                    }
                    .contentShape(Rectangle())
                    .listRowBackground(MeshTheme.surface)
                    .contextMenu {
                        if radioPrefix != currentRadioPrefix && currentRadioPrefix != nil {
                            Button {
                                radioToMigrate = radioPrefix
                                showMigrateSheet = true
                            } label: {
                                Label("Migrate to Current Radio", systemImage: "arrow.right.arrow.left")
                            }
                        }
                        Button(role: .destructive) {
                            radioToDelete = radioPrefix
                            showDeleteRadioConfirm = true
                        } label: {
                            Label("Delete All Data", systemImage: "trash")
                        }
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            radioToDelete = radioPrefix
                            showDeleteRadioConfirm = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            } header: {
                SectionInfoHeader(title: "Known Radios", info: "Each radio stores messages separately. If you replace a radio, use \u{2018}Migrate\u{2019} to move history to your new device.")
            }
            .confirmationDialog("Delete Radio Data?", isPresented: $showDeleteRadioConfirm) {
                Button("Delete All Messages", role: .destructive) {
                    if let prefix = radioToDelete {
                        deleteRadioData(radioPrefix: prefix)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete all synced messages for this radio from iCloud and all your devices. This cannot be undone.")
            }
            .sheet(isPresented: $showMigrateSheet) {
                NavigationStack {
                    VStack(spacing: 16) {
                        Image(systemName: "arrow.right.arrow.left")
                            .font(.system(size: 48))
                            .foregroundStyle(MeshTheme.accent)
                        Text("Migrate Messages")
                            .font(.headline)
                        Text("Copy all message history from the old radio to your currently connected radio.")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        Button("Migrate") {
                            if let old = radioToMigrate, let current = currentRadioPrefix {
                                migrateRadioData(from: old, to: current)
                            }
                            showMigrateSheet = false
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(MeshTheme.interactiveGreen)
                    }
                    .padding()
                    .navigationTitle("Migrate Radio Data")
                    // "Cancel", not "Done": leaving here abandons a migration
                    // the sheet was about to run, and "Done" would say the
                    // opposite of what happened.
                    .lilysharkSheet("Cancel") { showMigrateSheet = false }
                }
            }
        }
    }

    private func messageCountForRadio(_ radioPrefix: String) -> Int {
        let store = NSUbiquitousKeyValueStore.default
        let allKeys = store.dictionaryRepresentation.keys
        return allKeys.filter { $0.hasPrefix("msg.\(radioPrefix).") }.count * 50 // approximate
    }

    private func deleteRadioData(radioPrefix: String) {
        let store = NSUbiquitousKeyValueStore.default
        let allKeys = store.dictionaryRepresentation.keys

        // Delete iCloud message keys, scoped drafts, lastRead, and channel notify keys
        let prefixes = ["msg.\(radioPrefix).", "draft.\(radioPrefix).", "lastRead.\(radioPrefix).", "channel.notify.\(radioPrefix)."]
        for key in allKeys {
            if prefixes.contains(where: { key.hasPrefix($0) }) {
                store.removeObject(forKey: key)
            }
        }
        store.synchronize()

        // Delete local per-radio message directory
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let radioDir = docs.appendingPathComponent("MeshCoreMessages/\(radioPrefix)", isDirectory: true)
        try? FileManager.default.removeItem(at: radioDir)
    }

    private func migrateRadioData(from oldPrefix: String, to newPrefix: String) {
        let store = NSUbiquitousKeyValueStore.default
        let allKeys = store.dictionaryRepresentation.keys

        // Migrate iCloud KVS keys: messages, drafts, lastRead, channel notify
        let kvsPrefixes = ["msg.", "draft.", "lastRead.", "channel.notify."]
        for kvsPrefix in kvsPrefixes {
            let oldFullPrefix = "\(kvsPrefix)\(oldPrefix)."
            for oldKey in allKeys where oldKey.hasPrefix(oldFullPrefix) {
                let suffix = String(oldKey.dropFirst(oldFullPrefix.count))
                let newKey = "\(kvsPrefix)\(newPrefix).\(suffix)"
                if kvsPrefix == "msg." {
                    if let data = store.data(forKey: oldKey) {
                        store.set(data, forKey: newKey)
                    }
                } else if let str = store.string(forKey: oldKey) {
                    store.set(str, forKey: newKey)
                } else {
                    let val = store.double(forKey: oldKey)
                    if val > 0 { store.set(val, forKey: newKey) }
                }
            }
        }
        store.synchronize()

        // Migrate local message files
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let oldDir = docs.appendingPathComponent("MeshCoreMessages/\(oldPrefix)", isDirectory: true)
        let newDir = docs.appendingPathComponent("MeshCoreMessages/\(newPrefix)", isDirectory: true)
        if FileManager.default.fileExists(atPath: oldDir.path) {
            try? FileManager.default.createDirectory(at: newDir, withIntermediateDirectories: true)
            if let files = try? FileManager.default.contentsOfDirectory(at: oldDir, includingPropertiesForKeys: nil) {
                for file in files where file.pathExtension == "json" {
                    let dest = newDir.appendingPathComponent(file.lastPathComponent)
                    try? FileManager.default.copyItem(at: file, to: dest)
                }
            }
        }
    }
}

// MARK: - Section 0: Appearance

private extension SettingsView {
    var appearanceSection: some View {
        Section {
            Picker("Theme", selection: $appTheme) {
                ForEach(AppTheme.allCases, id: \.rawValue) { theme in
                    Text(theme.displayName).tag(theme.rawValue)
                }
            }
            .pickerStyle(.segmented)

            Toggle(isOn: AppStorage(wrappedValue: false, "channelsFirst").projectedValue) {
                Label("Channels First", systemImage: "arrow.up.arrow.down")
                    .foregroundStyle(MeshTheme.accent)
            }
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)
        } header: {
            sectionInfoHeader("Appearance", info: "Choose how Lilyshark looks. System follows your device\u{2019}s Dark Mode setting.")
        }
    }
}

