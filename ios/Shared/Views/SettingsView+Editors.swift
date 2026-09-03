//
//  SettingsView+Editors.swift
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

// MARK: - Troubleshooting

extension SettingsView {
    var troubleshootingSection: some View {
        Section {
            Button {
                showConnectionHelp = true
            } label: {
                HStack {
                    Label("Can't Connect to Radio?", systemImage: "questionmark.circle")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
        } header: {
            sectionInfoHeader("Troubleshooting", info: "Tools to help diagnose connection problems between your phone and radio.")
        }
        .alert("Connection Troubleshooting", isPresented: $showConnectionHelp) {
            Button("OK") {}
        } message: {
            Text("If your radio won't appear in the scanner:\n\n1. Go to Settings \u{2192} Bluetooth\n2. Find your MeshCore device and tap \u{24D8}\n3. Tap \u{2018}Forget This Device\u{2019}\n4. Power off the radio for 30 seconds\n5. Power it back on and scan again\n\nForce-quitting the app can leave the radio\u{2019}s Bluetooth in a stuck state. A full power cycle clears it.")
        }
    }
}

// MARK: - About

extension SettingsView {
    var aboutSection: some View {
        Section {
            LabelValueRow(
                label: "App Version",
                value: "\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"))"
            )

            Link(destination: URL(string: "https://meshcore.co")!) {
                HStack {
                    Text("MeshCore Project")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            .listRowBackground(MeshTheme.surface)

            Link(destination: URL(string: "https://gist.github.com/mbedworth/7cccc52eec16626a5ad7f5328b456fb3")!) {
                HStack {
                    Text("Privacy Policy")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            .listRowBackground(MeshTheme.surface)

            Button {
                UserDefaults.standard.set(false, forKey: "hasCompletedOnboarding")
            } label: {
                HStack {
                    Text("Show Welcome Guide")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Image(systemName: "book.pages")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)

            #if os(macOS) || targetEnvironment(macCatalyst)
            Button {
                showDebugLog = true
            } label: {
                HStack {
                    Text("Debug Log")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text("\(DebugLogger.shared.entries.count)")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            .sheet(isPresented: $showDebugLog) {
                NavigationStack {
                    DebugLogView()
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { showDebugLog = false }
                            }
                            ToolbarItem(placement: .primaryAction) {
                                Menu {
                                    Button {
                                        let text = DebugLogger.shared.exportText()
                                        copyToClipboard(text)
                                    } label: {
                                        Label("Copy All", systemImage: "doc.on.doc")
                                    }
                                    Button(role: .destructive) {
                                        DebugLogger.shared.clear()
                                    } label: {
                                        Label("Clear Log", systemImage: "trash")
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                        .foregroundStyle(MeshTheme.accent)
                                }
                            }
                        }
                }
                .frame(minWidth: 500, minHeight: 400)
            }
            #else
            NavigationLink {
                DebugLogView()
            } label: {
                HStack {
                    Text("Debug Log")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text("\(DebugLogger.shared.entries.count)")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
            .listRowBackground(MeshTheme.surface)
            #endif
        } header: {
            sectionInfoHeader("About", info: "Debug Log records connection and protocol events for troubleshooting.")
        }
    }
}

// MARK: - Section 10: Danger Zone (Fix #13: Factory Reset requires typing RESET)

extension SettingsView {
    var dangerZoneSection: some View {
        DangerZoneSection()
    }
}

struct DangerZoneSection: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var showRebootConfirm = false
    @State private var showResetConfirm = false
    @State private var resetConfirmText = ""

    var body: some View {
        Section {
            Button {
                showRebootConfirm = true
            } label: {
                HStack {
                    Image(systemName: "arrow.counterclockwise.circle")
                        .foregroundStyle(.orange)
                        .frame(width: 24)
                    Text("Reboot Device")
                        .foregroundStyle(.orange)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            .alert("Reboot Device?", isPresented: $showRebootConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Reboot", role: .destructive) {
                    connectionManager.sendCommand(MeshCoreProtocol.buildReboot(), label: "REBOOT")
                }
            } message: {
                Text("The radio will disconnect and restart. You'll need to reconnect via Bluetooth.")
            }

            Button {
                resetConfirmText = ""
                showResetConfirm = true
            } label: {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .frame(width: 24)
                    Text("Factory Reset")
                        .foregroundStyle(.red)
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            .alert("Factory Reset?", isPresented: $showResetConfirm) {
                TextField("Type RESET to confirm", text: $resetConfirmText)
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    if resetConfirmText == "RESET" {
                        connectionManager.sendCommand(MeshCoreProtocol.buildFactoryReset(), label: "FACTORY_RESET")
                        connectionManager.lastErrorMessage = "Radio has been factory reset. Power cycle the radio, then go to Settings \u{2192} Bluetooth and tap \"Forget This Device\" before pairing again."
                        // Delay disconnect to let the BLE write complete
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 1_000_000_000)
                            connectionManager.disconnect()
                        }
                    }
                }
                .disabled(resetConfirmText != "RESET")
            } message: {
                Text("This will erase all data and cannot be undone.\n\nType RESET to confirm.")
            }
        } header: {
            SectionInfoHeader(title: "Danger Zone", info: "Factory reset erases all contacts, channels, settings, and encryption keys from the device. This cannot be undone.", titleColor: .red)
        }
    }
}

// MARK: - Save Button with Feedback (Fix #14)

/// Trigger saved feedback: show "Saved" for 2 seconds then revert.
func showSaved(_ state: Binding<SaveButtonState>) {
    state.wrappedValue = .saved
    Task { @MainActor in
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        state.wrappedValue = .idle
    }
}

// MARK: - Helpers

extension SettingsView {
    var config: DeviceConfig { deviceConfig }

    func infoRow(icon: String, label: LocalizedStringKey, value: String, valueColor: Color = MeshTheme.textSecondary) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(MeshTheme.accent)
                .frame(width: 24)
            Text(label)
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Text(value)
                .foregroundStyle(valueColor)
                .textSelection(.enabled)
        }
        .listRowBackground(MeshTheme.surface)
    }

    func sectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .foregroundStyle(MeshTheme.textSecondary)
    }

    func sectionInfoHeader(_ title: LocalizedStringKey, info: LocalizedStringKey) -> some View {
        SectionInfoHeader(title: title, info: info)
    }

    func detectRadioPreset(freqKHz: Double, bw: Double, sf: UInt8, cr: UInt8) -> String? {
        radioPresets.first { p in
            abs(p.frequencyKHz - freqKHz) < 2.0 &&
            abs(p.bandwidth - bw) < 0.5 &&
            p.spreadingFactor == sf &&
            p.codingRate == cr
        }?.name
    }
}

// MARK: - Editor Sheets

struct NameEditorSheet: View {

    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""

    var body: some View {
        Form {
            Section {
                HStack {
                    TextField("Device Name", text: $name)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .onChange(of: name) { _, newValue in
                            if newValue.count > 31 { name = String(newValue.prefix(31)) }
                        }
                    Text("\(name.count)/31")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    InfoButton(text: "TIP: Use your initials + first 4 of your public key (e.g., NMA-5abd). Max 31 characters.")
                }
            }
        }
        .navigationTitle("Device Name")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            #if targetEnvironment(macCatalyst)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Apply") {
                    connectionManager.setAdvertName(name)
                    dismiss()
                }
                .disabled(name.isEmpty)
            }
            #elseif os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button("Apply") {
                    connectionManager.setAdvertName(name)
                    dismiss()
                }
                .disabled(name.isEmpty)
            }
            #else
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Apply") {
                    connectionManager.setAdvertName(name)
                    dismiss()
                }
                .disabled(name.isEmpty)
            }
            #endif
        }
        .onAppear {
            name = deviceConfig.deviceName
        }
    }
}

struct FirmwareDetailSheet: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(\.dismiss) private var dismiss
    @State private var version = ""
    @State private var buildDate = ""
    @State private var model = ""
    @State private var maxContacts: UInt16 = 0
    @State private var maxChannels: UInt8 = 0
    @State private var publicKeyHex = ""
    @State private var clockDate: Date?

    var body: some View {
        List {
            Section {
                LabeledContent("Version", value: version.isEmpty ? "\u{2014}" : version)
                LabeledContent("Build Date", value: buildDate.isEmpty ? "\u{2014}" : buildDate)
                LabeledContent("Model", value: model.isEmpty ? "\u{2014}" : model)
            } header: {
                SectionInfoHeader(info: "Hardware and firmware details from your radio.")
            }
            Section {
                LabeledContent("Max Contacts", value: "\(maxContacts)")
                LabeledContent("Max Channels", value: "\(maxChannels)")
            }
            if !publicKeyHex.isEmpty {
                Section {
                    LabeledContent("Public Key", value: String(publicKeyHex.prefix(16)) + "...")
                        .textSelection(.enabled)
                } header: {
                    SectionInfoHeader(info: "Long-press to copy. Share this with others to let them add you as a contact.")
                }
            }
            Section {
                if let date = clockDate {
                    LabeledContent("Device Clock") {
                        Text(date, style: .date) + Text(" ") + Text(date, style: .time)
                    }
                }
                LabeledContent("Clock Status", value: "Auto-synced on connect")
            } header: {
                SectionInfoHeader(title: "Time", info: "Device clock is automatically synced from your phone on every connection.")
            }
        }
        .meshListStyle()
        .navigationTitle("Device Details")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            version = deviceConfig.semanticVersion.isEmpty ? "v\(deviceConfig.firmwareVersion)" : deviceConfig.semanticVersion
            buildDate = deviceConfig.buildDate
            model = deviceConfig.manufacturer
            maxContacts = deviceConfig.maxContacts
            maxChannels = deviceConfig.maxChannels
            publicKeyHex = deviceConfig.publicKeyHex
            clockDate = deviceConfig.deviceTimeDate
        }
    }
}

// MARK: - TX Power Editor

struct TxPowerEditorSheet: View {

    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var txPower: Double = 22
    @State private var maxPower: Double = 22
    @State private var saved = false

    var body: some View {
        Form {
            Section {
                HStack {
                    Text("TX Power")
                    Spacer()
                    if saved {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(MeshTheme.connected)
                    }
                    Text("\(Int(txPower)) dBm").fontWeight(.medium)
                    InfoButton(text: "Higher power = more range but more battery drain. Max \(Int(maxPower)) dBm for this device.")
                }
                Slider(value: $txPower, in: 1...max(maxPower, 2), step: 1)
                    .tint(MeshTheme.accent)
                    .onChange(of: txPower) { _, newValue in
                        connectionManager.setRadioTXPower(UInt8(newValue))
                        saved = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { saved = false }
                    }
            }
        }
        .navigationTitle("TX Power")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            txPower = Double(deviceConfig.radioTXPower)
            maxPower = Double(deviceConfig.maxTXPower)
        }
    }
}

// MARK: - Tuning Editor

struct TuningEditorSheet: View {

    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var rxDelay: Double = 0
    @State private var airtimeFactor: Double = 0

    var body: some View {
        Form {
            Section {
                HStack {
                    Text("RX Delay")
                    Spacer()
                    Text("\(String(format: "%.1f", rxDelay))s").fontWeight(.medium)
                    InfoButton(text: "Base delay for SNR-based packet prioritization. Higher values give better-signal packets more priority. 0 = disabled.")
                }
                Slider(value: $rxDelay, in: 0...20, step: 0.5)
                    .tint(MeshTheme.accent)
            }

            Section {
                HStack {
                    Text("Airtime Factor")
                    Spacer()
                    Text("\(String(format: "%.1f", airtimeFactor))x").fontWeight(.medium)
                    InfoButton(text: "Multiplier for airtime budget. Higher values allow more frequent transmissions. 0 = no limit.")
                }
                Slider(value: $airtimeFactor, in: 0...9, step: 0.5)
                    .tint(MeshTheme.accent)
            }
        }
        .navigationTitle("Tuning")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            #if targetEnvironment(macCatalyst)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Apply") {
                    let rx = UInt32(rxDelay * 1000)
                    let air = UInt32(airtimeFactor * 1000)
                    connectionManager.setTuningParams(rxDelayBase: rx, airtimeFactor: air)
                    dismiss()
                }
            }
            #elseif os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button("Apply") {
                    let rx = UInt32(rxDelay * 1000)
                    let air = UInt32(airtimeFactor * 1000)
                    connectionManager.setTuningParams(rxDelayBase: rx, airtimeFactor: air)
                    dismiss()
                }
            }
            #else
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Apply") {
                    let rx = UInt32(rxDelay * 1000)
                    let air = UInt32(airtimeFactor * 1000)
                    connectionManager.setTuningParams(rxDelayBase: rx, airtimeFactor: air)
                    dismiss()
                }
            }
            #endif
        }
        .onAppear {
            rxDelay = deviceConfig.rxDelaySeconds
            airtimeFactor = deviceConfig.airtimeMultiplier
        }
    }
}

// MARK: - Flood Scope Editor

struct FloodScopeEditorSheet: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var scopeName = ""

    var body: some View {
        Form {
            Section {
                TextField("Region name (e.g. SoCal)", text: $scopeName)
                    .autocorrectionDisabled()
                    #if !os(macOS)
                    .textInputAutocapitalization(.never)
                    #endif
            } footer: {
                Text("Sets the default region scope for flood packets originating from this device. Leave empty to clear.")
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .navigationTitle("Flood Scope")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            #if targetEnvironment(macCatalyst)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Apply") { apply() }
            }
            #elseif os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button("Apply") { apply() }
            }
            #else
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Apply") { apply() }
            }
            #endif
        }
        .onAppear {
            scopeName = deviceConfig.defaultFloodScope
        }
    }

    private func apply() {
        connectionManager.setDefaultFloodScope(scopeName.trimmingCharacters(in: .whitespaces))
        dismiss()
    }
}

// MARK: - GPS Editor

struct GPSEditorSheet: View {

    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var latitude = ""
    @State private var longitude = ""
    @State private var gpsSyncFeedback = false
    @State private var gpsUnavailable = false
    @State private var mapPickFeedback = false
    @State private var showMapPicker = false
    @State private var mapPickedCoordinate: CLLocationCoordinate2D?
    @AppStorage("autoUpdateLocation") private var autoUpdateLocation = false
    @AppStorage("locationUpdateInterval") private var locationUpdateInterval = 900
    @AppStorage("locationPrivacyRadius") private var locationPrivacyRadius: Double = 0.0

    var body: some View {
        Form {
            Section {
                LabeledContent("Latitude", value: latitude.isEmpty ? "\u{2014}" : latitude)
                LabeledContent("Longitude", value: longitude.isEmpty ? "\u{2014}" : longitude)
            } header: {
                SectionInfoHeader(info: "Your radio\u{2019}s stored coordinates. These are shared with other radios when advertising.")
            }

            #if !os(watchOS)
            Section {
                Button {
                    guard let location = SharedLocation.manager.location else {
                        showFeedback($gpsUnavailable)
                        return
                    }
                    let (fLat, fLon) = PommeCoreViewModel.fudgeLocation(lat: location.coordinate.latitude, lon: location.coordinate.longitude)
                    latitude = formatCoordinate(fLat)
                    longitude = formatCoordinate(fLon)
                    connectionManager.setAdvertLatLon(latitude: fLat, longitude: fLon)
                    showFeedback($gpsSyncFeedback)
                } label: {
                    (gpsUnavailable
                        ? Label("GPS Not Available", systemImage: "location.slash")
                        : (gpsSyncFeedback ? Label("Location Set!", systemImage: "iphone.radiowaves.left.and.right") : Label("Set from Phone GPS", systemImage: "iphone.radiowaves.left.and.right")))
                        .foregroundStyle(gpsUnavailable ? .red : gpsSyncFeedback ? .green : MeshTheme.accent)
                }

                Button {
                    // Pre-populate map with current coordinates
                    if let lat = Double(latitude), let lon = Double(longitude), lat != 0 || lon != 0 {
                        mapPickedCoordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
                    }
                    showMapPicker = true
                } label: {
                    (mapPickFeedback ? Label("Location Set!", systemImage: "checkmark.circle.fill") : Label("Pick on Map", systemImage: "map"))
                        .foregroundStyle(mapPickFeedback ? .green : MeshTheme.accent)
                }

                Toggle(isOn: $autoUpdateLocation) {
                    Label("Auto-Update", systemImage: "location.fill.viewfinder")
                        .foregroundStyle(MeshTheme.accent)
                }
                .tint(MeshTheme.accent)
                .onChange(of: autoUpdateLocation) { _, enabled in
                    if enabled { connectionManager.startAutoLocationUpdates(interval: locationUpdateInterval) }
                    else { connectionManager.stopAutoLocationUpdates() }
                }

                if autoUpdateLocation {
                    Picker("Interval", selection: $locationUpdateInterval) {
                        Text("5 min").tag(300)
                        Text("15 min").tag(900)
                        Text("30 min").tag(1800)
                        Text("1 hour").tag(3600)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: locationUpdateInterval) { _, interval in
                        if autoUpdateLocation { connectionManager.startAutoLocationUpdates(interval: interval) }
                    }
                }
            } header: {
                SectionInfoHeader(info: "Set from Phone GPS copies your phone\u{2019}s coordinates to the radio. Auto-Update periodically refreshes while the app is open.")
            }

            Section {
                HStack {
                    Image(systemName: "location.slash.circle")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Picker("Position Accuracy", selection: $locationPrivacyRadius) {
                        Text("Exact").tag(0.0)
                        Text("\u{00B1} 100m (~1 block)").tag(100.0)
                        Text("\u{00B1} 500m (~\u{00BC} mile)").tag(500.0)
                        Text("\u{00B1} 1km (~\u{00BD} mile)").tag(1000.0)
                        Text("\u{00B1} 5km (~3 miles)").tag(5000.0)
                    }
                    .foregroundStyle(MeshTheme.accent)
                    .tint(.primary)
                }
            } header: {
                SectionInfoHeader(info: "Adds a random offset to your location before sharing. Only affects your personal device \u{2014} repeater and room server locations are always exact.")
            }
            #endif
        }
        .navigationTitle("GPS & Location")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            if deviceConfig.latitude != 0 { latitude = formatCoordinate(deviceConfig.latitude) }
            if deviceConfig.longitude != 0 { longitude = formatCoordinate(deviceConfig.longitude) }
            #if !os(watchOS)
            let mgr = SharedLocation.manager
            if mgr.authorizationStatus == .notDetermined {
                mgr.requestWhenInUseAuthorization()
            }
            mgr.startUpdatingLocation()
            #endif
        }
        .onDisappear {
            #if !os(watchOS)
            SharedLocation.manager.stopUpdatingLocation()
            #endif
        }
        .onChange(of: locationPrivacyRadius) {
            PommeCoreViewModel.regenerateLocationFudge()
        }
        .sheet(isPresented: $showMapPicker, onDismiss: {
            guard let coord = mapPickedCoordinate else { return }
            let (fLat, fLon) = PommeCoreViewModel.fudgeLocation(lat: coord.latitude, lon: coord.longitude)
            latitude = formatCoordinate(fLat)
            longitude = formatCoordinate(fLon)
            connectionManager.setAdvertLatLon(latitude: fLat, longitude: fLon)
            showFeedback($mapPickFeedback)
        }) {
            MapPointPickerView(selectedCoordinate: $mapPickedCoordinate)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 500, idealWidth: 700, minHeight: 500, idealHeight: 600)
            #endif
        }
    }
}

// MARK: - Battery Editor

struct BatteryEditorSheet: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(\.dismiss) private var dismiss
    @Binding var batteryChemistryRaw: String
    @State private var voltageText = ""
    @State private var percentText = ""

    var body: some View {
        Form {
            Section {
                LabeledContent("Voltage", value: voltageText)
                LabeledContent("Percentage", value: percentText)
            } header: {
                SectionInfoHeader(info: "Live reading from the radio\u{2019}s battery sensor. Accuracy depends on correct chemistry selection below.")
            }
            Section {
                Picker("Battery Type", selection: $batteryChemistryRaw) {
                    Text("LiPo (3.7V)").tag(BatteryChemistry.lipo.rawValue)
                    Text("LiFePO4 (3.2V)").tag(BatteryChemistry.lifepo4.rawValue)
                    Text("Li-Ion (3.7V)").tag(BatteryChemistry.li18650.rawValue)
                }
                .tint(.primary)
            } header: {
                SectionInfoHeader(info: "Select battery chemistry for accurate percentage calculation.")
            }
        }
        .navigationTitle("Battery")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            let battV = String(format: "%.2f", Double(deviceConfig.batteryMillivolts) / 1000.0)
            let battPct = deviceConfig.batteryPercent()
            voltageText = "\(battV)V"
            percentText = battPct > 0 ? String(format: "%d%%", battPct) : "\u{2014}"
        }
    }
}

// MARK: - Blocked Contacts View

struct BlockedContactsView: View {
    @Environment(ContactStore.self) private var contactStore

    var body: some View {
        List {
            if contactStore.blockedContacts.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "hand.raised.slash")
                        .font(.system(size: 32))
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text("No Blocked Contacts")
                        .font(.headline)
                    Text("Blocked contacts won't appear in your contact list and their messages will be suppressed.")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.vertical, 8)
                .listRowBackground(MeshTheme.surface)
            } else {
                ForEach(contactStore.blockedContacts) { contact in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(contactStore.displayName(for: contact))
                                .foregroundStyle(MeshTheme.textPrimary)
                            Text(contact.type.displayName)
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        Spacer()
                        Button("Unblock") {
                            contactStore.unblockContact(contact)
                        }
                        .font(.caption.weight(.medium))
                        .foregroundStyle(MeshTheme.accent)
                    }
                    .listRowBackground(MeshTheme.surface)
                }
            }
        }
        .meshListStyle()
        .navigationTitle("Blocked Contacts")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
