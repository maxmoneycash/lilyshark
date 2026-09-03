//
//  SettingsView+Sections.swift
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

// MARK: - Notifications

extension SettingsView {
    var notificationsSection: some View {
        NotificationsSection()
    }
}

struct NotificationsSection: View {
    @ObservedObject private var prefs = NotificationPreferences.shared

    var body: some View {
        Section {
            Toggle(isOn: $prefs.notifyDirect) {
                Label("Direct Messages", systemImage: "bubble.left.fill")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Notify when a contact sends you a direct message.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: $prefs.notifyChannel) {
                Label("Channel Messages", systemImage: "number")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Notify when a message is posted to a channel you are on.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: $prefs.notifyRoom) {
                Label("Room Server Messages", systemImage: "server.rack")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Notify when a room server relays a message to you.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: $prefs.notifyNewContacts) {
                Label("New Contacts Discovered", systemImage: "person.badge.plus")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Notify when a new radio is detected on the mesh.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: $prefs.notifyConnection) {
                Label("Connection Status", systemImage: "antenna.radiowaves.left.and.right")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Notify when your radio connects or disconnects.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: $prefs.notifyForeground) {
                Label("In-App Banners", systemImage: "bell.badge")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Show notification banners even while the app is open.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)
        } header: {
            SectionInfoHeader(title: "Notifications", info: "Choose which events trigger notifications. In-App Banners shows alerts even when the app is open.")
        }
    }
}

// MARK: - Message Settings

extension SettingsView {
    var messageSettingsSection: some View {
        Section {
            Toggle(isOn: autoRetryBinding) {
                Label("Auto Retry", systemImage: "arrow.clockwise")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Resend failed direct messages up to 3 times before marking as failed.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: autoResetPathBinding) {
                Label("Auto Reset Path", systemImage: "dot.radiowaves.left.and.right")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("After retries are exhausted, clear the cached route and resend as a mesh flood.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: multiACKBinding) {
                HStack {
                    Image(systemName: "checkmark.message")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Multi-ACK")
                        .foregroundStyle(MeshTheme.accent)
                }
            }
            .help("Send delivery confirmations back through every hop in the message route.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

        } header: {
            SectionInfoHeader(title: "Message Delivery", info: "Auto Retry resends failed direct messages up to 3 times. Auto Reset Path clears the cached route and resends as flood. Multi-ACK sends delivery confirmations to all hops in the route.")
        }
    }

    private var autoRetryBinding: Binding<Bool> {
        Binding(
            get: { UserDefaults.standard.bool(forKey: "autoRetry") },
            set: { UserDefaults.standard.set($0, forKey: "autoRetry") }
        )
    }

    private var autoResetPathBinding: Binding<Bool> {
        Binding(
            get: { UserDefaults.standard.bool(forKey: "autoResetPath") },
            set: { UserDefaults.standard.set($0, forKey: "autoResetPath") }
        )
    }

    private var multiACKBinding: Binding<Bool> {
        Binding(
            get: { deviceConfig.multiACK != 0 },
            set: { newValue in
                connectionManager.setOtherParams(
                    manualAddContacts: deviceConfig.manualAddContacts,
                    telemetryBase: deviceConfig.telemetryBase,
                    telemetryLocation: deviceConfig.telemetryLocation,
                    advertLocPolicy: deviceConfig.advertLocPolicy,
                    multiACK: newValue ? 1 : 0
                )
            }
        )
    }

}

// MARK: - Section 1: Device Info

extension SettingsView {
    var deviceInfoSection: some View {
        #if os(macOS) || targetEnvironment(macCatalyst)
        DeviceInfoSection(batteryChemistryRaw: $batteryChemistryRaw, showSetupWizard: $showSetupWizard, connectedDeviceName: connectionManager.connectedDeviceName, onShowOTA: { firmwareOTAItem = FirmwareOTAItem(version: $0) }, inspectorSheet: $inspectorSheet, showInspector: $showInspector)
        #else
        DeviceInfoSection(batteryChemistryRaw: $batteryChemistryRaw, showSetupWizard: $showSetupWizard, connectedDeviceName: connectionManager.connectedDeviceName, onShowOTA: { firmwareOTAItem = FirmwareOTAItem(version: $0) }, activeSheet: $iosDeviceSheet)
        #endif
    }

}

/// Device Info section.
/// macOS/Catalyst: rows set a binding that opens an inspector panel on the parent List.
/// iOS: .sheet(item:) with isolated @State.
/// DeviceConfig is @Observable via @Environment — SwiftUI tracks only the
/// specific properties read in body. No cascade from ViewModel changes.
struct DeviceInfoSection: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Binding var batteryChemistryRaw: String
    @Binding var showSetupWizard: Bool
    var connectedDeviceName: String?
    @State private var firmwareChecker = FirmwareUpdateChecker()
    /// Called with the resolved version string when the user taps the OTA row.
    var onShowOTA: (String) -> Void
    #if os(macOS) || targetEnvironment(macCatalyst)
    /// Binding to parent SettingsView — drives the inspector panel content.
    @Binding var inspectorSheet: DeviceSheet?
    /// Binding to parent SettingsView — shows/hides the inspector panel.
    @Binding var showInspector: Bool
    #else
    /// Binding to parent SettingsView — state lives there so sheet survives DeviceInfoSection re-renders.
    @Binding var activeSheet: DeviceSheet?
    #endif

    private var config: DeviceConfig { deviceConfig }

    // MARK: - Row views (shared between platforms)

    private var nameRow: some View {
        HStack {
            Label("Name", systemImage: "textformat")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Text(config.deviceName.isEmpty ? (connectedDeviceName ?? "\u{2014}") : config.deviceName)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .contentShape(Rectangle())
    }

    private var wizardRow: some View {
        HStack {
            Image(systemName: "wand.and.stars")
                .foregroundStyle(MeshTheme.accent)
                .frame(width: 24)
            Text("Name Wizard")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .contentShape(Rectangle())
    }

    private var radioRow: some View {
        let freqStr = formatFrequency(Double(config.radioFrequency))
        let bwKHz = String(format: "%.1f", Double(config.radioBandwidth) / 1000.0)
        let presetName = detectPreset()
        return HStack {
            Label("Radio", systemImage: "antenna.radiowaves.left.and.right")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(freqStr) \u{2022} \(bwKHz)kHz \u{2022} SF\(config.radioSpreadingFactor) CR\(config.radioCodingRate)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
                Text(presetName ?? "Custom")
                    .font(.caption2)
                    .foregroundStyle(presetName != nil ? .green : .orange)
            }
        }
        .contentShape(Rectangle())
    }

    private var tuningRow: some View {
        HStack {
            Label("Tuning", systemImage: "tuningfork")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Text("RX \(String(format: "%.1f", config.rxDelaySeconds))s \u{2022} Air \(String(format: "%.1f", config.airtimeMultiplier))x")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .contentShape(Rectangle())
    }

    private var floodScopeRow: some View {
        HStack {
            Label("Flood Scope", systemImage: "globe.americas")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Text(config.defaultFloodScope.isEmpty ? "Not set" : config.defaultFloodScope)
                .foregroundStyle(config.defaultFloodScope.isEmpty ? MeshTheme.textSecondary : MeshTheme.textPrimary)
        }
        .contentShape(Rectangle())
    }

    @AppStorage("autoUpdateLocation") private var autoUpdateLocation = false
    @AppStorage("locationPrivacyRadius") private var locationPrivacyRadius: Double = 0.0

    private var gpsStatusLabel: String {
        if config.latitude == 0 && config.longitude == 0 { return String(localized: "Not set") }
        if autoUpdateLocation {
            return locationPrivacyRadius > 0
                ? String(format: String(localized: "Auto · ±%@"), formatFudgeRadius(locationPrivacyRadius))
                : String(localized: "Auto · Exact")
        }
        return String(localized: "Manual")
    }

    private func formatFudgeRadius(_ radius: Double) -> String {
        if radius >= 1000 { return "\(Int(radius / 1000))km" }
        return "\(Int(radius))m"
    }

    private var gpsRow: some View {
        HStack {
            Label("GPS", systemImage: "location.fill")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                if config.latitude != 0 || config.longitude != 0 {
                    Text("\(formatCoordinate(config.latitude)), \(formatCoordinate(config.longitude))")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                Text(gpsStatusLabel)
                    .font(.caption2)
                    .foregroundStyle(config.latitude == 0 && config.longitude == 0 ? .orange : .green)
            }
        }
        .contentShape(Rectangle())
    }

    private var batteryRow: some View {
        HStack {
            Label("Battery", systemImage: "battery.50percent")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            let battV = String(format: "%.2f", Double(config.batteryMillivolts) / 1000.0)
            let battPct = config.batteryPercent()
            let battColor: Color = battPct > 50 ? .green : battPct > 20 ? .yellow : battPct > 0 ? .red : MeshTheme.textSecondary
            Text(battPct > 0 ? String(format: "%@V (%d%%)", battV, battPct) : "\(battV)V")
                .foregroundStyle(battColor)
        }
        .contentShape(Rectangle())
    }

    private var firmwareRow: some View {
        HStack {
            Label("Firmware", systemImage: "cpu")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            HStack(spacing: 6) {
                Text(config.semanticVersion.isEmpty ? "v\(config.firmwareVersion)" : config.semanticVersion)
                    .foregroundStyle(MeshTheme.textSecondary)
                if !firmwareChecker.isUpdateAvailable && firmwareChecker.latestVersion != nil {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                }
            }
        }
        .contentShape(Rectangle())
    }

    // MARK: - Body

    // DeviceSheet enum shared between platforms
    enum DeviceSheet: Identifiable {
        case radio, txPower, tuning, name, gps, battery, firmware, floodScope, profileTransfer, radioProfiles, radioStats
        var id: String { String(describing: self) }
    }

    #if os(macOS) || targetEnvironment(macCatalyst)
    private func openInspector(_ sheet: DeviceSheet) {
        inspectorSheet = sheet
        showInspector = true
    }
    #endif

    var body: some View {
        Section {
            #if os(macOS) || targetEnvironment(macCatalyst)
            Button { openInspector(.name) } label: { nameRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { showSetupWizard = true } label: { wizardRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            if config.radioFrequency > 0 {
                Button { openInspector(.radio) } label: { radioRow }
                    .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
                Button { openInspector(.tuning) } label: { tuningRow }
                    .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            }
            Button { openInspector(.floodScope) } label: { floodScopeRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { openInspector(.gps) } label: { gpsRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { openInspector(.battery) } label: { batteryRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { openInspector(.firmware) } label: { firmwareRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            firmwareUpdateRow
            verifyConfigRow
            verifyConfigResult
            Button { openInspector(.profileTransfer) } label: { profileTransferRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { openInspector(.radioProfiles) } label: { radioProfilesRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { openInspector(.radioStats) } label: { radioStatsRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            #else
            iOSDeviceRows
            firmwareUpdateRow
            verifyConfigRow
            verifyConfigResult
            profileTransferRow
                .onTapGesture { activeSheet = .profileTransfer }
                .listRowBackground(MeshTheme.surface)
            radioProfilesRow
                .onTapGesture { activeSheet = .radioProfiles }
                .listRowBackground(MeshTheme.surface)
            radioStatsRow
                .onTapGesture { activeSheet = .radioStats }
                .listRowBackground(MeshTheme.surface)
            #endif
        } header: {
            SectionInfoHeader(title: "Device", info: "Tap any row to view or change that setting on your connected radio.")
        }
        .onAppear { firmwareChecker.checkIfNeeded(currentVersion: config.semanticVersion) }
    }

    private var firmwareUpdateRow: some View {
        Group {
            if firmwareChecker.isUpdateAvailable, let latest = firmwareChecker.latestVersion {
                Button {
                    onShowOTA(latest)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.down.circle.fill")
                            .foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Firmware Update Available")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(MeshTheme.textPrimary)
                            let current = FirmwareUpdateChecker.extractVersion(config.semanticVersion.isEmpty ? config.firmwareVersion : config.semanticVersion)
                            Text("v\(latest) available \u{2014} tap to update (you have v\(current))")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
            } else if firmwareChecker.isChecking {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Checking for updates...")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .listRowBackground(MeshTheme.surface)
            }
        }
    }

    private var verifyConfigRow: some View {
        Button {
            connectionManager.verifyRadioConfig()
        } label: {
            HStack {
                Label("Verify Radio Config", systemImage: "checkmark.shield")
                    .foregroundStyle(MeshTheme.accent)
                Spacer()
                if connectionManager.isVerifyingConfig {
                    ProgressView()
                        #if !os(watchOS)
                        .controlSize(.small)
                        #endif
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(connectionManager.connectionState != .ready || connectionManager.isVerifyingConfig)
        .listRowBackground(MeshTheme.surface)
    }

    @ViewBuilder
    private var verifyConfigResult: some View {
        if let result = connectionManager.lastConfigVerification {
            VStack(alignment: .leading, spacing: 6) {
                LabeledContent("Frequency", value: result.frequency)
                LabeledContent("Bandwidth", value: result.bandwidth)
                LabeledContent("SF / CR", value: "SF\(result.spreadingFactor) CR\(result.codingRate)")
                LabeledContent("TX Power", value: result.txPower)
                LabeledContent("Battery", value: result.battery)
                Divider()
                Text(result.regionMessage)
                    .font(.caption)
                    .foregroundStyle(result.regionCheck == .pass ? .green : result.regionCheck == .fail ? .red : .orange)
            }
            .font(.caption)
            .listRowBackground(MeshTheme.surface)
        }
    }

    // MARK: - iOS sheet-based rows

    #if !os(macOS) && !targetEnvironment(macCatalyst)
    private var iOSDeviceRows: some View {
        Group {
            Button { activeSheet = .name } label: { nameRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { showSetupWizard = true } label: { wizardRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            if config.radioFrequency > 0 {
                Button { activeSheet = .radio } label: { radioRow }
                    .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
                Button { activeSheet = .tuning } label: { tuningRow }
                    .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            }
            Button { activeSheet = .floodScope } label: { floodScopeRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { activeSheet = .gps } label: { gpsRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { activeSheet = .battery } label: { batteryRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
            Button { activeSheet = .firmware } label: { firmwareRow }
                .buttonStyle(.plain).listRowBackground(MeshTheme.surface)
        }
        // Sheet now lives in SettingsView (above this view) to survive structural changes here.
    }
    #endif

    private func detectPreset() -> String? {
        let freqKHz = Double(config.radioFrequency)
        let bwKHz = Double(config.radioBandwidth) / 1000.0
        let sf = config.radioSpreadingFactor
        let cr = config.radioCodingRate
        return radioPresets.first { p in
            abs(p.frequencyKHz - freqKHz) < 2.0 &&
            abs(p.bandwidth - bwKHz) < 0.5 &&
            p.spreadingFactor == sf &&
            p.codingRate == cr
        }?.name
    }

    private var profileTransferRow: some View {
        HStack {
            Label("Backup & Transfer", systemImage: "arrow.up.arrow.down.circle")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .contentShape(Rectangle())
    }

    @Environment(RadioProfileStore.self) private var radioProfileStore

    private var radioProfilesRow: some View {
        HStack {
            Label("Radio Profiles", systemImage: "list.bullet.rectangle.portrait")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            let count = radioProfileStore.profiles.count
            if count > 0 {
                Text("\(count)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .contentShape(Rectangle())
    }

    private var radioStatsRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Label("Radio Stats", systemImage: "chart.xyaxis.line")
                    .foregroundStyle(MeshTheme.accent)
                Text("Battery, signal strength, and packet counters")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .contentShape(Rectangle())
    }
}

extension SettingsView {
    var batteryChemistryPicker: some View {
        HStack {
            Image(systemName: "bolt.batteryblock")
                .foregroundStyle(MeshTheme.accent)
                .frame(width: 24)
            Picker("Battery Type", selection: $batteryChemistryRaw) {
                ForEach(BatteryChemistry.allCases) { chem in
                    Text(chem.displayName).tag(chem.rawValue)
                }
            }
            .foregroundStyle(MeshTheme.accent)
            .tint(.primary)
            .onChange(of: batteryChemistryRaw) {
                deviceConfig.resetBatteryCalibration()
            }
        }
        .listRowBackground(MeshTheme.surface)
    }

    var statsBatteryDisplay: String {
        guard config.statsBatteryMV != 0 else { return "\u{2014}" }
        let mv = Int(config.statsBatteryMV)
        if let cal = deviceConfig.batteryCalibration {
            let correctedMV = Int(Double(mv) * cal.correctionFactor)
            let v = Double(correctedMV) / 1000.0
            let pct = batteryChemistry.profile.percentage(forMillivolts: correctedMV)
            return "\(String(format: "%.2fV", v)) (\(pct)%)"
        }
        let v = Double(mv) / 1000.0
        let pct = batteryChemistry.profile.percentage(forMillivolts: mv)
        return "\(String(format: "%.2fV", v)) (\(pct)%)"
    }

    // Fix #11: Public key with Copy button
    var publicKeyRow: some View {
        HStack {
            Image(systemName: "key")
                .foregroundStyle(MeshTheme.accent)
                .frame(width: 24)
            Text("Public Key")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Text(String(config.publicKeyHex.prefix(16)) + "...")
                .foregroundStyle(MeshTheme.textPrimary)
                .font(.caption)
            Button {
                copyToClipboard(config.publicKeyHex)
            } label: {
                Image(systemName: "doc.on.doc")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.accent)
            }
            .buttonStyle(.plain)
            .contentShape(Rectangle())
        }
        .listRowBackground(MeshTheme.surface)
    }

    var correctedBatteryPercent: Int {
        if let cal = deviceConfig.batteryCalibration {
            let correctedMV = cal.correctedMillivolts(config.batteryMillivolts)
            return batteryChemistry.profile.percentage(forMillivolts: correctedMV)
        }
        return config.batteryPercent(chemistry: batteryChemistry)
    }

    var correctedBatteryVoltage: Double {
        if let cal = deviceConfig.batteryCalibration {
            return cal.correctedVoltage(config.batteryVoltage)
        }
        return config.batteryVoltage
    }

    var batteryRow: some View {
        HStack {
            Image(systemName: batteryIconName)
                .foregroundStyle(batteryColor)
                .frame(width: 24)
            Text("Battery")
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            if config.batteryMillivolts > 0 {
                Text(String(format: "%.2fV (%d%%)", correctedBatteryVoltage, correctedBatteryPercent))
                    .foregroundStyle(batteryColor)
            } else {
                Text("\u{2014}")
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .listRowBackground(MeshTheme.surface)
    }

    var batteryCalibrationsRows: some View {
        Group {
            if let cal = deviceConfig.batteryCalibration, config.batteryMillivolts > 0 {
                HStack {
                    Image(systemName: "tuningfork")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Raw Voltage")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text(String(format: "%.2fV", config.batteryVoltage))
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text(String(format: "(\u{00D7}%.3f)", cal.correctionFactor))
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .listRowBackground(MeshTheme.surface)

                Button {
                    deviceConfig.resetBatteryCalibration()
                } label: {
                    HStack {
                        Image(systemName: "arrow.counterclockwise")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        Text("Reset Calibration")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
            }
        }
    }

    var batteryIconName: String {
        let pct = correctedBatteryPercent
        if pct > 75 { return "battery.100" }
        if pct > 50 { return "battery.75" }
        if pct > 25 { return "battery.50" }
        if pct > 0 { return "battery.25" }
        return "battery.0"
    }

    var batteryColor: Color {
        let pct = correctedBatteryPercent
        if pct > 50 { return .green }
        if pct > 20 { return .yellow }
        return .red
    }
}

// MARK: - Section 2: Connection

extension SettingsView {
    var connectionSection: some View {
        Section {
            HStack {
                Image(systemName: "circle.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(statusColor)
                    .shadow(color: statusColor.opacity(0.5), radius: 3)
                Text("Status")
                    .foregroundStyle(MeshTheme.accent)
                Spacer()
                Text(connectionLabel)
                    .foregroundStyle(statusColor)
            }
            .listRowBackground(MeshTheme.surface)

            if connectionManager.connectionState != .disconnected {
                Button(role: .destructive) {
                    #if os(macOS) || targetEnvironment(macCatalyst)
                    if connectionManager.usbManager.isConnected {
                        connectionManager.disconnectUSB()
                    } else if connectionManager.wifiManager.isConnected {
                        connectionManager.disconnectWiFi()
                    } else {
                        connectionManager.disconnect()
                    }
                    #else
                    connectionManager.disconnect()
                    #endif
                } label: {
                    HStack {
                        Image(systemName: "xmark.circle")
                        Text("Disconnect")
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
            }
        } header: {
            sectionInfoHeader("Connection", info: "PommeCore supports Bluetooth, WiFi, and USB Serial connections to your radio.")
        }
    }

    var statusColor: Color {
        switch connectionManager.connectionState {
        case .ready: MeshTheme.connected
        case .connected: MeshTheme.initialConnected
        case .connecting: MeshTheme.connecting
        case .scanning: MeshTheme.scanning
        case .disconnected: MeshTheme.disconnected
        }
    }

    var connectionLabel: String {
        switch connectionManager.connectionState {
        case .ready: String(localized: "Ready")
        case .connected: String(localized: "Connected")
        case .connecting: String(localized: "Connecting")
        case .scanning: String(localized: "Scanning")
        case .disconnected: String(localized: "Disconnected")
        }
    }
}

// MARK: - Watch Companion

#if os(iOS)
extension SettingsView {
    var watchCompanionSection: some View {
        WatchCompanionSection()
    }
}

@MainActor
struct WatchCompanionSection: View {
    @ObservedObject private var unlockManager = WatchUnlockManager.shared
    @State private var watchProduct: Product?
    @State private var isPurchasing = false
    @State private var loadError: String?

    var body: some View {
        Section {
            if unlockManager.isUnlocked {
                HStack {
                    Label("Watch Companion", systemImage: "applewatch")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Active")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                }
                .listRowBackground(MeshTheme.surface)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Send and receive mesh messages from your Apple Watch.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let err = loadError {
                        Text(err)
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                }
                .listRowBackground(MeshTheme.surface)

                if let product = watchProduct {
                    Button {
                        Task { await purchaseCompanion(product) }
                    } label: {
                        HStack {
                            Label("Unlock Watch Companion", systemImage: "applewatch")
                                .foregroundStyle(MeshTheme.accent)
                            Spacer()
                            if isPurchasing {
                                ProgressView()
                                    .tint(MeshTheme.accent)
                            } else {
                                Text(product.displayPrice)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .disabled(isPurchasing)
                    .listRowBackground(MeshTheme.surface)
                } else if loadError == nil {
                    HStack {
                        Label("Unlock Watch Companion", systemImage: "applewatch")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                        ProgressView()
                            .tint(MeshTheme.accent)
                    }
                    .listRowBackground(MeshTheme.surface)
                }

                Text("$9.99 supporters also receive Watch Companion automatically.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .listRowBackground(MeshTheme.surface)
            }
        } header: {
            SectionInfoHeader(title: "Watch Companion", info: "Requires Apple Watch paired with this iPhone. Messages sync via WatchConnectivity when your iPhone is nearby or reachable.")
        }
        .task { await loadProduct() }
    }

    private func loadProduct() async {
        do {
            let products = try await Product.products(for: [WatchUnlockManager.companionProductID])
            watchProduct = products.first
            if watchProduct == nil {
                loadError = "Not available — check App Store Connect"
            }
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func purchaseCompanion(_ product: Product) async {
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                if case .verified(let tx) = verification {
                    await tx.finish()
                    unlockManager.isUnlocked = true
                    DebugLogger.shared.log("WATCH: companion IAP verified", level: .info)
                }
            case .pending:
                DebugLogger.shared.log("WATCH: companion IAP pending", level: .warning)
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            DebugLogger.shared.log("WATCH: companion IAP error — \(error.localizedDescription)", level: .error)
        }
    }
}
#endif


// MARK: - Mesh Responder

extension SettingsView {
    var meshResponderSection: some View {
        MeshResponderSection()
    }
}

/// Opt-in mesh service: other nodes can DM slash commands (/ping, /summary,
/// /battery, /nodecheck) and this device answers from its local data. Off by
/// default — an auto-replying radio costs shared airtime.
struct MeshResponderSection: View {
    @AppStorage("meshResponderEnabled") private var responderEnabled = false

    var body: some View {
        Section {
            Toggle(isOn: $responderEnabled) {
                Label("Answer Mesh Commands", systemImage: "bubble.left.and.text.bubble.right")
                    .foregroundStyle(MeshTheme.accent)
            }
            .help("Reply automatically when another node sends /ping, /summary, /battery or /nodecheck as a direct message.")
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)
        } header: {
            SectionInfoHeader(title: "Mesh Responder", info: "When enabled, other nodes can send /ping, /summary, /battery or /nodecheck <name> as a direct message and this device replies with live status from its own data. Replies are throttled to one per sender every 30 seconds.")
        }
    }
}
