//
//  RadioCalculatorView.swift
//  PommeCore
//
//  RF link budget calculator: wavelength, free-space path loss, link budget.
//  Works offline — no radio connection required.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MeshCoreKit

struct RadioCalculatorView: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var frequencyMHz: Double = 910.525
    @State private var txPowerDBm: Double = 22
    @State private var distanceKm: Double = 5.0
    @State private var txAntennaGainDBi: Double = 2.0
    @State private var rxAntennaGainDBi: Double = 2.0
    @State private var rxSensitivityDBm: Double = -130
    @State private var useDeviceConfig = true

    private var hasRadioSettings: Bool {
        connectionManager.connectionState == .ready && !connectionManager.isMeshtasticLinkActive
            && deviceConfig.loadedSections.contains("selfInfo")
    }

    var body: some View {
        Form {
            Section {
                Toggle("Use Connected Radio Settings", isOn: $useDeviceConfig)
                    .disabled(!hasRadioSettings)
                    .foregroundStyle(MeshTheme.accent)
                    .listRowBackground(MeshTheme.surface)
                    .onChange(of: useDeviceConfig) { _, use in
                        if use { loadFromDevice() }
                    }

                paramRow("Frequency", value: $frequencyMHz, unit: "MHz", range: 400...928)
                paramRow("TX Power", value: $txPowerDBm, unit: "dBm", range: -9...30)
                paramRow("Distance", value: $distanceKm, unit: "km", range: 0.1...200)
                paramRow("TX Antenna Gain", value: $txAntennaGainDBi, unit: "dBi", range: 0...20)
                paramRow("RX Antenna Gain", value: $rxAntennaGainDBi, unit: "dBi", range: 0...20)
                paramRow("RX Sensitivity", value: $rxSensitivityDBm, unit: "dBm", range: -150...(-80))
            } header: {
                Text("Parameters")
            }

            Section {
                resultRow("Wavelength", value: String(format: "%.3f m", wavelength))
                resultRow("Free-Space Path Loss", value: String(format: "%.1f dB", fspl))
                resultRow("EIRP", value: String(format: "%.1f dBm", eirp))
                resultRow("Received Power", value: String(format: "%.1f dBm", receivedPower))
                resultRow("Link Margin", value: String(format: "%.1f dB", linkMargin),
                          color: linkMargin > 10 ? .green : linkMargin > 0 ? .orange : .red)

                HStack {
                    Image(systemName: linkMargin > 10 ? "checkmark.circle.fill" : linkMargin > 0 ? "exclamationmark.triangle.fill" : "xmark.circle.fill")
                        .foregroundStyle(linkMargin > 10 ? .green : linkMargin > 0 ? .orange : .red)
                    Text(linkVerdict)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                .listRowBackground(MeshTheme.surface)
            } header: {
                Text("Results")
            } footer: {
                Text("Free-space path loss assumes an unobstructed path. Terrain, buildings, reflections, and atmospheric conditions can change the result.")
            }

            Section {
                resultRow("Max Range (FSPL only)", value: String(format: "%.1f km", maxRange))
            } header: {
                Text("Estimated Range")
            } footer: {
                Text("Theoretical maximum based on TX power, antenna gains, and RX sensitivity. Actual range depends on terrain, obstructions, and interference.")
            }
        }
        .formStyle(.grouped)
        .meshTheme()
        .navigationTitle("Radio Calculator")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            if useDeviceConfig { loadFromDevice() }
        }
        .onChange(of: hasRadioSettings) { _, available in
            if !available { useDeviceConfig = false }
        }
    }

    // MARK: - Calculations

    private var wavelength: Double {
        guard frequencyMHz > 0 else { return 0 }
        return FresnelZone.speedOfLight / (frequencyMHz * 1_000_000)
    }

    /// Free-Space Path Loss in dB
    /// FSPL = 20*log10(d) + 20*log10(f) + 32.44
    /// where d in km, f in MHz
    private var fspl: Double {
        guard frequencyMHz > 0, distanceKm > 0 else { return 0 }
        return 20 * log10(distanceKm) + 20 * log10(frequencyMHz) + 32.44
    }

    /// Effective Isotropic Radiated Power
    private var eirp: Double {
        txPowerDBm + txAntennaGainDBi
    }

    /// Received power at RX antenna
    private var receivedPower: Double {
        eirp - fspl + rxAntennaGainDBi
    }

    /// Link margin above RX sensitivity
    private var linkMargin: Double {
        receivedPower - rxSensitivityDBm
    }

    private var linkVerdict: String {
        if linkMargin > 20 { return "Excellent link — strong margin" }
        if linkMargin > 10 { return "Good link — adequate margin" }
        if linkMargin > 0 { return "Marginal link — may be unreliable" }
        return "No link — signal below receiver sensitivity"
    }

    /// Max theoretical range in km (FSPL only)
    private var maxRange: Double {
        // Rearrange FSPL: d = 10^((EIRP + rxGain - rxSensitivity - 32.44 - 20*log10(f)) / 20)
        guard frequencyMHz > 0 else { return 0 }
        let budget = eirp + rxAntennaGainDBi - rxSensitivityDBm
        let exponent = (budget - 32.44 - 20 * log10(frequencyMHz)) / 20
        return pow(10, exponent)
    }

    // MARK: - Helpers

    private func loadFromDevice() {
        guard hasRadioSettings else {
            useDeviceConfig = false
            return
        }
        frequencyMHz = deviceConfig.frequencyMHz
        txPowerDBm = Double(deviceConfig.radioTXPower)
    }

    private func paramRow(_ label: LocalizedStringKey, value: Binding<Double>, unit: LocalizedStringKey, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text(label)
                .foregroundStyle(MeshTheme.textSecondary)
            HStack(spacing: Design.Space.tight) {
                TextField(label, value: Binding(
                    get: { value.wrappedValue },
                    set: { input in
                        guard input.isFinite else { return }
                        value.wrappedValue = min(range.upperBound, max(range.lowerBound, input))
                    }
                ), format: .number)
                    .textFieldStyle(.roundedBorder)
                    .monospacedDigit()
                    .frame(minHeight: Design.minimumTouchTarget)
                Text(unit)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .fixedSize()
            }
        }
        .listRowBackground(MeshTheme.surface)
    }

    private func resultRow(_ label: LocalizedStringKey, value: String, color: Color = MeshTheme.textSecondary) -> some View {
        MeshValueRow(label: label, value: value, valueColor: color)
        .listRowBackground(MeshTheme.surface)
    }
}
#endif
