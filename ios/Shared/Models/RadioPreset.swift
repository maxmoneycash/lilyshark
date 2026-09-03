//
//  RadioPreset.swift
//  PommeCore
//
//  Radio preset definitions and reusable picker view.
//  Extracted from SettingsView for shared use by Settings and Remote Management.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

struct RadioPreset: Identifiable {
    let id = UUID()
    let name: String
    let region: String
    let frequencyKHz: Double
    let bandwidth: Double
    let spreadingFactor: UInt8
    let codingRate: UInt8
}

let radioPresets: [RadioPreset] = [
    // USA / Canada
    RadioPreset(name: "USA/Canada (Recommended)", region: "North America",
                frequencyKHz: 910525.244, bandwidth: 62.5, spreadingFactor: 7, codingRate: 5),
    RadioPreset(name: "USA/Canada (Legacy Wide)", region: "North America",
                frequencyKHz: 915800.0, bandwidth: 250, spreadingFactor: 11, codingRate: 5),
    RadioPreset(name: "USA: Texas", region: "North America",
                frequencyKHz: 903500.0, bandwidth: 62.5, spreadingFactor: 7, codingRate: 5),
    RadioPreset(name: "USA: Southern California", region: "North America",
                frequencyKHz: 927875.0, bandwidth: 62.5, spreadingFactor: 7, codingRate: 8),

    // Australia
    RadioPreset(name: "Australia", region: "Australia/NZ",
                frequencyKHz: 915800.0, bandwidth: 250, spreadingFactor: 10, codingRate: 5),
    RadioPreset(name: "Australia: Victoria", region: "Australia/NZ",
                frequencyKHz: 916575.0, bandwidth: 62.5, spreadingFactor: 7, codingRate: 5),
    RadioPreset(name: "Australia: Brisbane", region: "Australia/NZ",
                frequencyKHz: 917800.0, bandwidth: 62.5, spreadingFactor: 8, codingRate: 5),
    RadioPreset(name: "Australia: Western Australia", region: "Australia/NZ",
                frequencyKHz: 921500.0, bandwidth: 62.5, spreadingFactor: 7, codingRate: 5),

    // New Zealand
    RadioPreset(name: "New Zealand", region: "Australia/NZ",
                frequencyKHz: 915800.0, bandwidth: 250, spreadingFactor: 10, codingRate: 5),
    RadioPreset(name: "New Zealand (Narrow)", region: "Australia/NZ",
                frequencyKHz: 916800.0, bandwidth: 62.5, spreadingFactor: 8, codingRate: 5),

    // Europe / UK
    RadioPreset(name: "Europe (Recommended)", region: "Europe",
                frequencyKHz: 869525.0, bandwidth: 62.5, spreadingFactor: 9, codingRate: 5),
    RadioPreset(name: "Europe (Legacy Wide)", region: "Europe",
                frequencyKHz: 869525.0, bandwidth: 250, spreadingFactor: 11, codingRate: 5),
    RadioPreset(name: "UK", region: "Europe",
                frequencyKHz: 869525.0, bandwidth: 62.5, spreadingFactor: 9, codingRate: 5),
    RadioPreset(name: "Netherlands", region: "Europe",
                frequencyKHz: 869525.0, bandwidth: 62.5, spreadingFactor: 9, codingRate: 5),

    // Asia
    RadioPreset(name: "Thailand", region: "Asia",
                frequencyKHz: 920000.0, bandwidth: 62.5, spreadingFactor: 7, codingRate: 5),
    RadioPreset(name: "Japan", region: "Asia",
                frequencyKHz: 923000.0, bandwidth: 62.5, spreadingFactor: 7, codingRate: 5),
    RadioPreset(name: "India", region: "Asia",
                frequencyKHz: 866000.0, bandwidth: 62.5, spreadingFactor: 7, codingRate: 5),
]

/// Map ISO 3166-1 alpha-2 country code to radioPresets region string.
func presetRegionForCountry(_ isoCountry: String) -> String? {
    let code = isoCountry.uppercased()
    switch code {
    case "US", "CA":
        return "North America"
    case "AU":
        return "Australia/NZ"
    case "NZ":
        return "Australia/NZ"
    case "GB", "DE", "FR", "IT", "ES", "NL", "BE", "CH", "AT", "SE", "NO", "DK", "FI",
         "PL", "CZ", "PT", "IE", "GR", "HU", "RO", "BG", "HR", "SK", "SI", "LT", "LV",
         "EE", "LU", "MT", "CY", "IS":
        return "Europe"
    case "TH", "JP", "IN", "CN", "KR", "SG", "MY", "PH", "ID", "VN", "TW", "HK":
        return "Asia"
    default:
        return nil
    }
}

/// Filter presets to those matching a given ISO country code's region.
func presetsForCountry(_ isoCountry: String) -> [RadioPreset] {
    guard let region = presetRegionForCountry(isoCountry) else { return radioPresets }
    return radioPresets.filter { $0.region == region }
}

/// Legal ISM frequency ranges by region (kHz).
private let legalFrequencyRanges: [String: ClosedRange<Double>] = [
    "North America": 902_000...928_000,
    "Europe":        863_000...870_000,
    "Australia/NZ":  915_000...928_000,
    "Asia":          860_000...930_000,   // broad — varies by country
]

/// Check if a frequency (in kHz) is legal for a given ISO country code.
func isFrequencyLegal(frequencyKHz: Double, forCountry isoCountry: String) -> Bool {
    guard let region = presetRegionForCountry(isoCountry),
          let range = legalFrequencyRanges[region] else {
        return true  // Unknown country — don't block
    }
    return range.contains(frequencyKHz)
}

/// Reusable radio preset picker section. Calls `onApply` with the selected preset.
/// Auto-detects current preset from device config via inline computation.
struct RadioPresetPicker: View {
    let onApply: (RadioPreset) -> Void
    var currentFreqKHz: Double = 0
    var currentBW: Double = 0
    var currentSF: UInt8 = 0
    var currentCR: UInt8 = 0
    /// Optional country filter — when set, only shows presets for that region.
    var countryFilter: String?
    @State private var selectedPresetIndex: Int = -1
    @State private var presetToConfirm: RadioPreset?
    @State private var communityPresetToConfirm: RadioPreset?
    @State private var hasAutoDetected = false
    #if !os(watchOS)
    @Environment(RegionalPresetService.self) private var presetService
    #endif

    private var filteredPresets: [RadioPreset] {
        if let country = countryFilter {
            return presetsForCountry(country)
        }
        return radioPresets
    }

    /// Computed: find matching preset index from current radio params.
    private var detectedPresetIndex: Int {
        guard currentFreqKHz > 0 else { return -1 }
        for (index, p) in filteredPresets.enumerated() {
            if abs(p.frequencyKHz - currentFreqKHz) < 2.0 &&
               abs(p.bandwidth - currentBW) < 0.5 &&
               p.spreadingFactor == currentSF &&
               p.codingRate == currentCR {
                return index
            }
        }
        return -1
    }

    var body: some View {
        // Auto-detect preset on every render when values are available and user hasn't manually changed
        let detected = detectedPresetIndex
        let _ = {
            if detected != selectedPresetIndex && !hasAutoDetected && detected >= 0 {
                DispatchQueue.main.async {
                    selectedPresetIndex = detected
                    hasAutoDetected = true
                    DebugLogger.shared.log("PRESET AUTO: matched '\(filteredPresets[detected].name)' from freq=\(currentFreqKHz) bw=\(currentBW) sf=\(currentSF) cr=\(currentCR)", level: .info)
                }
            }
        }()
        Section {
            HStack {
                Image(systemName: "globe")
                    .foregroundStyle(MeshTheme.accent)
                    .frame(width: 24)
                Picker("Radio Preset", selection: $selectedPresetIndex) {
                    Text("Custom").tag(-1)
                    ForEach(Array(filteredPresets.enumerated()), id: \.offset) { index, preset in
                        Text(preset.name).tag(index)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
            }
            .listRowBackground(MeshTheme.surface)

            if selectedPresetIndex >= 0, selectedPresetIndex < filteredPresets.count {
                let preset = filteredPresets[selectedPresetIndex]
                Text("\(formatFrequency(preset.frequencyKHz)) · SF\(preset.spreadingFactor) · BW \(preset.bandwidth == preset.bandwidth.rounded() ? "\(Int(preset.bandwidth))" : "\(preset.bandwidth)") kHz · CR 4/\(preset.codingRate)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .listRowBackground(MeshTheme.surface)

                Button {
                    presetToConfirm = preset
                } label: {
                    HStack {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        Text("Apply Preset")
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
                .alert("Apply Radio Preset?", isPresented: Binding(
                    get: { presetToConfirm != nil },
                    set: { if !$0 { presetToConfirm = nil } }
                )) {
                    Button("Cancel", role: .cancel) { presetToConfirm = nil }
                    Button("Apply") {
                        if let p = presetToConfirm {
                            onApply(p)
                            selectedPresetIndex = -1
                        }
                        presetToConfirm = nil
                    }
                } message: {
                    if let p = presetToConfirm {
                        Text("This will change your radio to \(formatFrequency(p.frequencyKHz)), BW \(p.bandwidth == p.bandwidth.rounded() ? "\(Int(p.bandwidth))" : "\(p.bandwidth)") kHz, SF\(p.spreadingFactor), CR 4/\(p.codingRate).\n\nAll nodes on your mesh must use the same settings.")
                    }
                }
            }
        } header: {
            SectionInfoHeader(title: "Radio Presets", info: "Select a preset for your region. All nodes on your mesh must use the same settings.")
        }

        #if !os(watchOS)
        let visibleCommunity: [RadioPreset] = {
            guard let filter = countryFilter,
                  let region = presetRegionForCountry(filter) else {
                return presetService.presets
            }
            let regionMatches = presetService.presets.filter { $0.region == region }
            return regionMatches.isEmpty ? presetService.presets : regionMatches
        }()
        if !visibleCommunity.isEmpty {
            Section {
                ForEach(visibleCommunity) { preset in
                    Button {
                        communityPresetToConfirm = preset
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(preset.name)
                                    .foregroundStyle(MeshTheme.accent)
                                Text("\(formatFrequency(preset.frequencyKHz)) · SF\(preset.spreadingFactor) · BW \(preset.bandwidth == preset.bandwidth.rounded() ? "\(Int(preset.bandwidth))" : "\(preset.bandwidth)") kHz")
                                    .font(.caption)
                                    .foregroundStyle(MeshTheme.textSecondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(MeshTheme.surface)
                }
            } header: {
                SectionInfoHeader(title: "Community Presets", info: "Presets contributed by regional mesh communities. Submit additions via pull request to the PommeCore repository.")
            }
            .alert("Apply Community Preset?", isPresented: Binding(
                get: { communityPresetToConfirm != nil },
                set: { if !$0 { communityPresetToConfirm = nil } }
            )) {
                Button("Cancel", role: .cancel) { communityPresetToConfirm = nil }
                Button("Apply") {
                    if let p = communityPresetToConfirm { onApply(p) }
                    communityPresetToConfirm = nil
                }
            } message: {
                if let p = communityPresetToConfirm {
                    Text("This will change your radio to \(formatFrequency(p.frequencyKHz)), BW \(p.bandwidth == p.bandwidth.rounded() ? "\(Int(p.bandwidth))" : "\(p.bandwidth)") kHz, SF\(p.spreadingFactor), CR 4/\(p.codingRate).\n\nAll nodes on your mesh must use the same settings.")
                }
            }
        }
        #endif
    }
}
