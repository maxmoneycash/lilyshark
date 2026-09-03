//
//  SettingsView+RadioPrivacy.swift
//  PommeCore
//
//  Radio configuration, privacy & security, custom variables, and statistics.
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

// MARK: - Section 4: Radio Configuration (Fixes #3, #4, #5, #6)


/// Standard LoRa bandwidths in kHz
private let loraBandwidths: [Double] = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500]

// RadioPreset, RadioPresetPicker, and radioPresets are in Shared/Models/RadioPreset.swift

struct RadioSection: View {

    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(\.dismiss) private var dismiss
    @State private var freqMHz: String = ""
    @State private var selectedBW: Double = 250
    @State private var selectedSF: UInt8 = 12
    @State private var selectedCR: UInt8 = 5
    @State private var txPower: Double = 22
    @State private var maxTxPower: Double = 22
    @State private var deviceSelfType: UInt8 = 1
    @State private var showRepeatConfirm = false
    @State private var repeatMode = false
    @State private var initFreqKHz: Double = 0
    @State private var initBW: Double = 0
    @State private var initSF: UInt8 = 0
    @State private var initCR: UInt8 = 0
    @State private var regionFilter: String? = LocationSuggestion.cachedCountryCode

    /// Region options for the macOS manual picker: (label, representative ISO code)
    #if os(macOS) || targetEnvironment(macCatalyst)
    private let regionOptions: [(String, String?)] = [
        ("All Regions", nil),
        ("North America", "US"),
        ("Europe", "GB"),
        ("Australia / NZ", "AU"),
        ("Asia", "JP"),
    ]
    #endif

    var body: some View {
        Form {
        #if os(macOS) || targetEnvironment(macCatalyst)
        Section {
            HStack {
                Image(systemName: "globe")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Region", selection: $regionFilter) {
                    ForEach(regionOptions, id: \.0) { label, code in
                        Text(label).tag(code)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)
        } header: {
            SectionInfoHeader(title: "Region Filter", info: "Filter presets to your local frequency band. GPS detection is not available on Mac — select your region manually.")
        }
        #else
        if let filter = regionFilter, let regionName = presetRegionForCountry(filter) {
            Section {
                HStack {
                    Image(systemName: "scope")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Showing \(regionName) presets")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .font(.subheadline)
                    Spacer()
                    Button("Show All") { regionFilter = nil }
                        .foregroundStyle(MeshTheme.accent)
                        .font(.subheadline)
                        .buttonStyle(.plain)
                }
                .listRowBackground(MeshTheme.surface)
            }
        }
        #endif

        RadioPresetPicker(
            onApply: { preset in
                applyPreset(preset)
                let freq = UInt32(preset.frequencyKHz)
                let bw = UInt32(preset.bandwidth * 1000)
                connectionManager.setRadioParams(
                    frequency: freq, bandwidth: bw,
                    spreadingFactor: preset.spreadingFactor, codingRate: preset.codingRate,
                    repeatMode: repeatMode
                )
                // Radio params require reboot to take effect
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    connectionManager.sendCommand(MeshCoreProtocol.buildReboot(), label: "REBOOT")
                }
                dismiss()
            },
            currentFreqKHz: initFreqKHz,
            currentBW: initBW,
            currentSF: initSF,
            currentCR: initCR,
            countryFilter: regionFilter
        )
        .task { regionFilter = await LocationSuggestion.detectIfNeeded() }

        Section {
            HStack {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Text("Frequency (MHz)")
                    .foregroundStyle(MeshTheme.accent)
                Spacer()
                #if os(watchOS)
                TextField("MHz", text: $freqMHz)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .frame(width: 80)
                #else
                TextField("MHz", text: $freqMHz)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .textFieldStyle(MeshTextFieldStyle())
                    .frame(width: 110)
                #endif
            }
            .listRowBackground(MeshTheme.surface)

            if !connectionManager.allowedFreqRanges.isEmpty {
                allowedFreqRow
            }

            // Fix #5: Bandwidth picker with standard LoRa values
            HStack {
                Image(systemName: "waveform")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Bandwidth", selection: $selectedBW) {
                    ForEach(loraBandwidths, id: \.self) { bw in
                        Text(formatBW(bw)).tag(bw)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)

            // Fix #4: Spreading Factor picker
            HStack {
                Image(systemName: "chart.bar")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Spreading Factor", selection: $selectedSF) {
                    ForEach(Array(UInt8(7)...UInt8(12)), id: \.self) { val in
                        Text("SF\(val)").tag(val)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)

            // Fix #3: Coding Rate picker
            HStack {
                Image(systemName: "shield")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Coding Rate", selection: $selectedCR) {
                    Text("4/5").tag(UInt8(5))
                    Text("4/6").tag(UInt8(6))
                    Text("4/7").tag(UInt8(7))
                    Text("4/8").tag(UInt8(8))
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)

            VStack(alignment: .leading) {
                HStack {
                    Image(systemName: "bolt")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("TX Power: \(Int(txPower)) dBm")
                        .foregroundStyle(MeshTheme.accent)
                }
                Slider(value: $txPower, in: 2...max(maxTxPower, 2), step: 1)
                    .tint(MeshTheme.accent)
            }
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: Binding(
                get: { repeatMode },
                set: { newValue in
                    if newValue && deviceSelfType == 1 {
                        showRepeatConfirm = true
                    } else {
                        repeatMode = newValue
                    }
                }
            )) {
                HStack {
                    Image(systemName: "repeat")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Repeat Mode")
                        .foregroundStyle(MeshTheme.accent)
                }
            }
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)
            .alert("Enable Repeat Mode?", isPresented: $showRepeatConfirm) {
                Button("Enable") { repeatMode = true }
                Button("Cancel", role: .cancel) {}
            } message: {
                if remoteSessionManager.allowedRepeatFreqRanges.isEmpty {
                    Text("Your companion radio will act as a portable repeater.\n\nThis is useful for camping, hiking, and search & rescue where repeater infrastructure doesn't exist.\n\nRepeat mode is restricted to allowed frequency ranges configured on the device.")
                } else {
                    let freqText = remoteSessionManager.allowedRepeatFreqRanges.map { range in
                        String(format: "%.1f\u{2013}%.1f MHz", Double(range.lowerKHz) / 1_000, Double(range.upperKHz) / 1_000)
                    }.joined(separator: "\n")
                    Text("Your companion radio will act as a portable repeater.\n\nAllowed frequency ranges:\n\(freqText)\n\nThis is useful for camping, hiking, and search & rescue where repeater infrastructure doesn't exist.")
                }
            }

            if !remoteSessionManager.allowedRepeatFreqRanges.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: "waveform.badge.magnifyingglass")
                                .foregroundStyle(MeshTheme.accent)
                                .frame(width: 24)
                            Text("Allowed Repeat Frequencies")
                                .foregroundStyle(MeshTheme.accent)
                        }
                        ForEach(Array(remoteSessionManager.allowedRepeatFreqRanges.enumerated()), id: \.offset) { _, range in
                            Text("\(String(format: "%.0f", Double(range.lowerKHz) / 1_000)) \u{2013} \(String(format: "%.0f", Double(range.upperKHz) / 1_000)) MHz")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                                .padding(.leading, 32)
                        }
                    }
                    .listRowBackground(MeshTheme.surface)
                }

                Button {
                    remoteSessionManager.requestAllowedRepeatFreq()
                } label: {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        Text("Query Repeat Frequencies")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
        } header: {
            SectionInfoHeader(title: "Radio Configuration", info: "All radios on your mesh must use the same settings. SF (Spreading Factor): higher = longer range, slower. CR (Coding Rate): higher = more error correction. BW (Bandwidth): lower = longer range. Changes require reboot.")
        }
        } // end Form
        .onAppear { loadFromConfig() }
        .toolbar {
            #if targetEnvironment(macCatalyst)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Apply & Reboot") { applyRadioAndReboot() }
            }
            #elseif os(macOS)
            ToolbarItem(placement: .primaryAction) {
                Button("Apply & Reboot") { applyRadioAndReboot() }
            }
            #else
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Apply & Reboot") { applyRadioAndReboot() }
            }
            #endif
        }
    }

    private func loadFromConfig() {
        let c = deviceConfig
        freqMHz = c.radioFrequency == 0 ? "" : String(format: "%.3f", c.frequencyMHz)
        selectedBW = nearestBW(c.bandwidthKHz)
        selectedSF = c.radioSpreadingFactor
        selectedCR = c.radioCodingRate
        txPower = Double(c.radioTXPower)
        maxTxPower = Double(c.maxTXPower)
        deviceSelfType = c.selfType
        repeatMode = c.repeatMode
        initFreqKHz = Double(c.radioFrequency)
        initBW = c.bandwidthKHz
        initSF = c.radioSpreadingFactor
        initCR = c.radioCodingRate
    }

    private func applyRadioAndReboot() {
        let freq = UInt32((Double(freqMHz) ?? 0) * 1000)
        let bw = UInt32(selectedBW * 1000)
        connectionManager.setRadioParams(frequency: freq, bandwidth: bw,
            spreadingFactor: selectedSF, codingRate: selectedCR,
            repeatMode: repeatMode)
        connectionManager.setRadioTXPower(UInt8(txPower))
        // Radio params require reboot to take effect
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            connectionManager.sendCommand(MeshCoreProtocol.buildReboot(), label: "REBOOT")
        }
        dismiss()
    }

    private func nearestBW(_ kHz: Double) -> Double {
        loraBandwidths.min(by: { abs($0 - kHz) < abs($1 - kHz) }) ?? 250
    }

    private var allowedFreqRow: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.seal")
                .foregroundStyle(MeshTheme.connected)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text("Legal Ranges for Your Region")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(MeshTheme.accent)
                let rangeText = connectionManager.allowedFreqRanges.map { r in
                    let lo = String(format: "%.0f", Double(r.lowerKHz) / 1_000)
                    let hi = String(format: "%.0f", Double(r.upperKHz) / 1_000)
                    return "\(lo)–\(hi) MHz"
                }.joined(separator: ", ")
                Text(rangeText)
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .listRowBackground(MeshTheme.surface)
    }

    private func formatBW(_ bw: Double) -> String {
        if bw == bw.rounded() { return "\(Int(bw)) kHz" }
        return "\(bw) kHz"
    }

    private func applyPreset(_ preset: RadioPreset) {
        freqMHz = String(format: "%.3f", preset.frequencyKHz / 1000)
        selectedBW = nearestBW(preset.bandwidth)
        selectedSF = preset.spreadingFactor
        selectedCR = preset.codingRate
    }
}

// MARK: - Section 6: Privacy & Security (Fix #8: telemetry pickers)

extension SettingsView {
    var privacySection: some View {
        PrivacySection()
    }
}

struct PrivacySection: View {

    @Environment(DeviceConfig.self) private var config
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(ContactStore.self) private var contactStore
    @State private var pinText: String = ""
    @State private var showBlockedContacts = false

    @AppStorage("shareOnMeshMap") private var shareOnMeshMap: Bool = false

    // Computed bindings that read from deviceConfig and auto-save on change
    private var manualAddBinding: Binding<Bool> {
        Binding(
            get: { config.manualAddContacts != 0 },
            set: { newValue in
                connectionManager.setOtherParams(
                    manualAddContacts: newValue ? 1 : 0,
                    telemetryBase: config.telemetryBase,
                    telemetryLocation: config.telemetryLocation,
                    advertLocPolicy: config.advertLocPolicy,
                    multiACK: config.multiACK
                )
            }
        )
    }

    private var telBaseBinding: Binding<UInt8> {
        Binding(
            get: { config.telemetryBase },
            set: { newValue in
                connectionManager.setOtherParams(
                    manualAddContacts: config.manualAddContacts,
                    telemetryBase: newValue,
                    telemetryLocation: config.telemetryLocation,
                    advertLocPolicy: config.advertLocPolicy,
                    multiACK: config.multiACK
                )
            }
        )
    }

    private var telLocBinding: Binding<UInt8> {
        Binding(
            get: { config.telemetryLocation },
            set: { newValue in
                connectionManager.setOtherParams(
                    manualAddContacts: config.manualAddContacts,
                    telemetryBase: config.telemetryBase,
                    telemetryLocation: newValue,
                    advertLocPolicy: config.advertLocPolicy,
                    multiACK: config.multiACK
                )
            }
        )
    }

    private var advertLocBinding: Binding<Bool> {
        Binding(
            get: { config.advertLocPolicy != 0 },
            set: { newValue in
                connectionManager.setOtherParams(
                    manualAddContacts: config.manualAddContacts,
                    telemetryBase: config.telemetryBase,
                    telemetryLocation: config.telemetryLocation,
                    advertLocPolicy: newValue ? 1 : 0,
                    multiACK: config.multiACK
                )
            }
        )
    }

    private func autoAddBinding(bit: UInt8) -> Binding<Bool> {
        Binding(
            get: { config.autoAddBitmask & bit != 0 },
            set: { enabled in
                var bm = config.autoAddBitmask
                if enabled { bm |= bit } else { bm &= ~bit }
                connectionManager.setAutoAddConfig(bitmask: bm)
            }
        )
    }

    var body: some View {
        Section {
            Toggle(isOn: manualAddBinding) {
                HStack {
                    Image(systemName: "person.badge.plus")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Manual Add Contacts")
                        .foregroundStyle(MeshTheme.accent)
                }
            }
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            if config.manualAddContacts == 0 {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 4) {
                        Text("Auto-Add Contact Types")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                        InfoButton(text: "Chat = people, Repeaters extend range, Room Servers host group chats, Sensors report data.")
                    }
                    Toggle("Chat Users", isOn: autoAddBinding(bit: 0x01))
                        .tint(MeshTheme.accent)
                    Toggle("Repeaters", isOn: autoAddBinding(bit: 0x02))
                        .tint(MeshTheme.accent)
                    Toggle("Room Servers", isOn: autoAddBinding(bit: 0x04))
                        .tint(MeshTheme.accent)
                    Toggle("Sensors", isOn: autoAddBinding(bit: 0x08))
                        .tint(MeshTheme.accent)
                }
                .listRowBackground(MeshTheme.surface)
            }

            HStack {
                Image(systemName: "battery.100")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Telemetry Requests", selection: telBaseBinding) {
                    Text("Deny").tag(UInt8(0))
                    Text("Per-Contact").tag(UInt8(1))
                    Text("Allow All").tag(UInt8(2))
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)

            HStack {
                Image(systemName: "location")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Include Location", selection: telLocBinding) {
                    Text("Deny").tag(UInt8(0))
                    Text("Per-Contact").tag(UInt8(1))
                    Text("Allow All").tag(UInt8(2))
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)

            Toggle(isOn: advertLocBinding) {
                HStack {
                    Image(systemName: "location.slash")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("Share Location in Advert")
                        .foregroundStyle(MeshTheme.accent)
                }
            }
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            #if !os(watchOS)
            Toggle(isOn: $shareOnMeshMap) {
                HStack {
                    Image(systemName: "globe")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    HStack(spacing: 4) {
                        Text("Share Location on MeshCore Map")
                            .foregroundStyle(MeshTheme.accent)
                        InfoButton(text: "Uploads your node's signed advert packet to map.meshcore.dev so others can see your node on the internet map. Only uploads when you have a location set. Your Position Accuracy setting (in GPS & Location) is applied before uploading \u{2014} the map receives the fuzzed position, not your exact location.")
                    }
                }
            }
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)
            #endif

            Toggle(isOn: appLockBinding) {
                Label("App Lock", systemImage: biometricIcon)
                    .foregroundStyle(MeshTheme.accent)
            }
            .tint(MeshTheme.accent)
            .listRowBackground(MeshTheme.surface)

            #if os(macOS) || targetEnvironment(macCatalyst)
            Button {
                showBlockedContacts = true
            } label: {
                HStack {
                    Label("Blocked Contacts", systemImage: "hand.raised")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    if !contactStore.blockedContacts.isEmpty {
                        Text("\(contactStore.blockedContacts.count)")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowBackground(MeshTheme.surface)
            #else
            NavigationLink {
                BlockedContactsView()
            } label: {
                HStack {
                    Label("Blocked Contacts", systemImage: "hand.raised")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    if !contactStore.blockedContacts.isEmpty {
                        Text("\(contactStore.blockedContacts.count)")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }
            }
            .listRowBackground(MeshTheme.surface)
            #endif

        } header: {
            SectionInfoHeader(title: "Privacy & Security", info: "Controls what telemetry data is shared when requested. Per-Contact mode only shares with contacts that have telemetry permission set. App Lock requires Face ID, Touch ID, or your device passcode to open MeshCore.")
        }

        #if !os(watchOS)
        safeZonesRow
        #endif

        // Per-contact telemetry permission picker
        if config.telemetryBase == 1 {
            Section {
                let chatContacts = contactStore.contacts.filter { $0.type == .chat }
                if chatContacts.isEmpty {
                    Text("No chat contacts available")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .listRowBackground(MeshTheme.surface)
                } else {
                    ForEach(chatContacts) { contact in
                        Toggle(isOn: Binding(
                            get: { contact.allowTelemetry },
                            set: { enabled in
                                var newFlags = contact.flags
                                if enabled { newFlags |= 0x02 } else { newFlags &= ~0x02 }
                                contactStore.updateContactFlags(contact, newFlags: newFlags)
                            }
                        )) {
                            Text(contactStore.displayName(for: contact))
                                .foregroundStyle(MeshTheme.accent)
                        }
                        .tint(MeshTheme.accent)
                        .listRowBackground(MeshTheme.surface)
                    }
                }
            } header: {
                SectionInfoHeader(title: "Contacts with Telemetry Permission", info: "Contacts listed here can request battery, temperature, and sensor data from your device. Toggle off to stop sharing telemetry with a specific contact.")
            } footer: {
                let count = contactStore.contacts.filter { $0.type == .chat && $0.allowTelemetry }.count
                Text("^[\(count) contact](inflect: true) can request your telemetry data.")
                    .font(.caption2)
            }
        }

        // Per-contact location permission picker
        if config.telemetryLocation == 1 {
            Section {
                let chatContacts = contactStore.contacts.filter { $0.type == .chat }
                if chatContacts.isEmpty {
                    Text("No chat contacts available")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .listRowBackground(MeshTheme.surface)
                } else {
                    ForEach(chatContacts) { contact in
                        Toggle(isOn: Binding(
                            get: { contact.shareTelemetryLocation },
                            set: { enabled in
                                var newFlags = contact.flags
                                if enabled { newFlags |= 0x04 } else { newFlags &= ~0x04 }
                                contactStore.updateContactFlags(contact, newFlags: newFlags)
                            }
                        )) {
                            Text(contactStore.displayName(for: contact))
                                .foregroundStyle(MeshTheme.accent)
                        }
                        .tint(MeshTheme.accent)
                        .listRowBackground(MeshTheme.surface)
                    }
                }
            } header: {
                SectionInfoHeader(title: "Contacts with Location Permission", info: "Contacts listed here will receive your GPS coordinates when they request telemetry. Toggle off to stop sharing your location with a specific contact.")
            } footer: {
                let count = contactStore.contacts.filter { $0.type == .chat && $0.shareTelemetryLocation }.count
                Text("^[\(count) contact](inflect: true) will receive your location in telemetry.")
                    .font(.caption2)
            }
        }

        // BLE PIN — adaptive based on whether device has a screen
        Section {
            if config.blePIN == 0 {
                HStack {
                    Image(systemName: "lock.shield")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("BLE PIN")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text("Shown on device screen")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .listRowBackground(MeshTheme.surface)
            } else {
                HStack {
                    Image(systemName: "lock.shield")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Text("BLE PIN")
                        .foregroundStyle(MeshTheme.accent)
                    Spacer()
                    #if os(watchOS)
                    TextField("PIN", text: $pinText)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .frame(width: 80)
                    #else
                    TextField("PIN", text: $pinText)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .textFieldStyle(MeshTextFieldStyle())
                        .frame(width: 100)
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                    #endif
                }
                .listRowBackground(MeshTheme.surface)

                HStack {
                    Button {
                        connectionManager.setDevicePIN(1)
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 1_000_000_000)
                            connectionManager.refreshAllSettings()
                        }
                    } label: {
                        Label("Randomize", systemImage: "dice")
                            .foregroundStyle(MeshTheme.accent)
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    Button {
                        if let pin = UInt32(pinText), pin <= 999999 {
                            connectionManager.setDevicePIN(pin)
                        }
                    } label: {
                        Text("Apply")
                            .foregroundStyle(MeshTheme.accent)
                    }
                    .buttonStyle(.plain)
                    .disabled(pinText.count > 6 || UInt32(pinText) == nil)
                }
                .listRowBackground(MeshTheme.surface)
            }
        } header: {
            SectionInfoHeader(
                title: "Bluetooth Security",
                info: config.blePIN == 0
                    ? "This device generates a random PIN each time it starts. Check the device screen for the current PIN when pairing."
                    : "Change the BLE PIN from the default (123456) for security. After changing, forget this device in Bluetooth settings and re-pair with the new PIN."
            )
        }
        .onAppear { pinText = String(config.blePIN) }
        .onChange(of: config.blePIN) { pinText = String(config.blePIN) }
        #if os(macOS) || targetEnvironment(macCatalyst)
        .sheet(isPresented: $showBlockedContacts) {
            NavigationStack {
                BlockedContactsView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showBlockedContacts = false }
                        }
                    }
            }
            .meshTheme()
            .frame(minWidth: 360, minHeight: 400)
        }
        #endif
    }

    private var appLockBinding: Binding<Bool> {
        Binding(
            get: { UserDefaults.standard.bool(forKey: "appLockEnabled") },
            set: { newValue in
                if newValue {
                    let context = LAContext()
                    var error: NSError?
                    if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) {
                        UserDefaults.standard.set(true, forKey: "appLockEnabled")
                    } else {
                        DebugLogger.shared.log("APP LOCK: cannot enable — no auth available: \(error?.localizedDescription ?? "unknown")", level: .error)
                    }
                } else {
                    UserDefaults.standard.set(false, forKey: "appLockEnabled")
                }
            }
        )
    }

    private var biometricIcon: String {
        #if os(iOS)
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock"
        }
        #else
        return "lock"
        #endif
    }

    #if !os(watchOS)
    @Environment(GeofenceStore.self) private var geofenceStore
    @State private var showSafeZones = false

    var safeZonesRow: some View {
        Section {
            Button {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    showSafeZones = true
                }
            } label: {
                HStack {
                    Image(systemName: "shield.fill")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Safe Zones")
                            .foregroundStyle(MeshTheme.accent)
                        let enabled = geofenceStore.zones.filter(\.isEnabled).count
                        Text(enabled == 0
                             ? "No active zones"
                             : "^[\(enabled) zone](inflect: true) active")
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
        } header: {
            SectionInfoHeader(title: "Emergency Safety", info: "Safe zones send an automatic SOS beacon if you leave the defined area. Requires \u{201C}Always\u{201D} location permission.")
        }
        .sheet(isPresented: $showSafeZones) {
            NavigationStack {
                GeofencesView()
            }
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 400, minHeight: 500)
            #endif
        }
    }
    #endif
}

// MARK: - Section 8: Custom Variables

extension SettingsView {
    var customVarsSection: some View {
        CustomVarsSection()
    }
}

struct CustomVarsSection: View {

    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var newName: String = ""
    @State private var newValue: String = ""
    @State private var deleteTarget: String? = nil

    var body: some View {
        Section {
            ForEach(Array(deviceConfig.customVars.enumerated()), id: \.offset) { _, pair in
                HStack {
                    Text(pair.name)
                        .foregroundStyle(MeshTheme.accent)
                        .font(.system(.body, design: .monospaced))
                    Spacer()
                    Text(pair.value)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .font(.system(.body, design: .monospaced))
                }
                .listRowBackground(MeshTheme.surface)
                .contentShape(Rectangle())
                .contextMenu {
                    Button {
                        newName = pair.name
                        newValue = pair.value
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }
                    Divider()
                    Button(role: .destructive) {
                        deleteTarget = pair.name
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }

            HStack {
                #if os(watchOS)
                TextField("Name", text: $newName)
                    .foregroundStyle(MeshTheme.textPrimary)
                TextField("Value", text: $newValue)
                    .foregroundStyle(MeshTheme.textPrimary)
                #else
                TextField("Name", text: $newName)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .textFieldStyle(MeshTextFieldStyle())
                TextField("Value", text: $newValue)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .textFieldStyle(MeshTextFieldStyle())
                #endif
                Button {
                    guard !newName.isEmpty else { return }
                    connectionManager.setCustomVar(name: newName, value: newValue)
                    newName = ""
                    newValue = ""
                    refreshVars()
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(MeshTheme.accent)
                }
                .buttonStyle(.plain)
                .contentShape(Rectangle())
            }
            .listRowBackground(MeshTheme.surface)
        } header: {
            SectionInfoHeader(title: "Custom Variables", info: "Key-value pairs stored on the radio. Used for advanced configuration and firmware development. Long-press a row to edit or delete.")
        }
        .alert("Delete Variable", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })) {
            Button("Delete", role: .destructive) {
                if let name = deleteTarget {
                    connectionManager.setCustomVar(name: name, value: "")
                    refreshVars()
                }
                deleteTarget = nil
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("Delete \"\(deleteTarget ?? "")\" from the radio?")
        }
    }

    private func refreshVars() {
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            connectionManager.requestCustomVars()
        }
    }
}

// MARK: - Section 9: Statistics (Fix #10: uptime with days)

extension SettingsView {
    var statsSection: some View {
        Section {
            DisclosureGroup(isExpanded: $statsExpanded) {
                // Core
                infoRow(icon: "battery.75", label: "Battery (stats)", value: statsBatteryDisplay, valueColor: statsBatteryColor)
                infoRow(icon: "clock.arrow.circlepath", label: "Uptime", value: config.statsUptime > 0 ? formatUptime(config.statsUptime) : "\u{2014}")
                infoRow(icon: "exclamationmark.triangle", label: "Error Flags", value: config.statsErrorFlags > 0 ? "0x\(String(format: "%04x", config.statsErrorFlags))" : "None", valueColor: config.statsErrorFlags > 0 ? .red : .green)
                infoRow(icon: "tray", label: "Queue Length", value: "\(config.statsQueueLength)")

                // Radio
                infoRow(icon: "waveform.badge.minus", label: "Noise Floor", value: "\(config.statsNoiseFloor) dBm", valueColor: noiseFloorColor)
                infoRow(icon: "cellularbars", label: "Last RSSI", value: "\(config.statsLastRSSI) dBm", valueColor: rssiColor)
                infoRow(icon: "antenna.radiowaves.left.and.right", label: "Last SNR", value: formatSNR(config.statsLastSNR), valueColor: snrColor)
                infoRow(icon: "arrow.up.circle", label: "TX Airtime", value: "\(config.statsTXAirtime) s")
                infoRow(icon: "arrow.down.circle", label: "RX Airtime", value: "\(config.statsRXAirtime) s")

                // Packets
                infoRow(icon: "arrow.down.doc", label: "Packets RX", value: "\(config.statsPacketsReceived)")
                infoRow(icon: "arrow.up.doc", label: "Packets TX", value: "\(config.statsPacketsSent)")
                infoRow(icon: "arrow.triangle.branch", label: "Sent Flood", value: "\(config.statsFloodCount)")
                infoRow(icon: "arrow.right", label: "Sent Direct", value: "\(config.statsDirectCount)")
                infoRow(icon: "arrow.down.left", label: "Recv Flood", value: "\(config.statsRecvFlood)")
                infoRow(icon: "arrow.down.right", label: "Recv Direct", value: "\(config.statsRecvDirect)")

                Button {
                    connectionManager.requestStats(subType: 0)
                    connectionManager.requestStats(subType: 1)
                    connectionManager.requestStats(subType: 2)
                } label: {
                    HStack {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        Text("Refresh Stats")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } label: {
                Label("Statistics", systemImage: "chart.bar")
                    .foregroundStyle(MeshTheme.accent)
            }
            .listRowBackground(MeshTheme.surface)
        } header: {
            SectionInfoHeader(info: "Live radio diagnostics. Noise Floor is background signal level (lower is better). RSSI is received signal strength. SNR is signal-to-noise ratio (higher is better).")
        }
    }

    // MARK: - Stats Status Colors (LoRa-standard thresholds)

    /// Battery status: reuses existing battery percentage logic
    var statsBatteryColor: Color {
        guard config.statsBatteryMV != 0 else { return MeshTheme.textSecondary }
        let mv = Int(config.statsBatteryMV)
        let pct = batteryChemistry.profile.percentage(forMillivolts: mv)
        if pct > 50 { return .green }
        if pct > 20 { return .yellow }
        return .red
    }

    /// Noise floor: lower is better (thermal floor ~-120 dBm at 125 kHz BW)
    var noiseFloorColor: Color {
        let nf = Int(config.statsNoiseFloor)
        if nf == 0 { return MeshTheme.textSecondary }
        if nf < -105 { return .green }
        if nf < -95 { return .orange }
        return .red
    }

    /// RSSI: LoRa demodulates down to ~-130 dBm
    var rssiColor: Color {
        let rssi = Int(config.statsLastRSSI)
        if rssi == 0 { return MeshTheme.textSecondary }
        if rssi > -100 { return .green }
        if rssi > -120 { return .orange }
        return .red
    }

    /// SNR: LoRa demod thresholds SF7=-7.5dB to SF12=-20dB (raw value is SNR * 4)
    var snrColor: Color {
        let snrDB = Double(Int(config.statsLastSNR)) / 4.0
        if config.statsLastSNR == 0 && config.statsLastRSSI == 0 { return MeshTheme.textSecondary }
        if snrDB > 0 { return .green }
        if snrDB > -10 { return .orange }
        return .red
    }

}
