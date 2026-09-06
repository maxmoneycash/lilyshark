//
//  SensitivityTableView.swift
//  PommeCore
//
//  LoRa sensitivity and performance reference table.
//  Shows how SF and BW affect sensitivity, bit rate, and range.
//
//  Created by Michael P. Bedworth on 04/07/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MeshCoreKit

struct SensitivityTableView: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager

    private var hasRadioSettings: Bool {
        connectionManager.connectionState == .ready && !connectionManager.isMeshtasticLinkActive
            && deviceConfig.loadedSections.contains("selfInfo")
    }

    private var referenceFrequencyMHz: Double {
        hasRadioSettings ? deviceConfig.frequencyMHz : 910.525
    }

    @State private var selectedBandwidth: Double = 62.5
    private let bandwidthOptions: [Double] = [7.8, 15.6, 31.25, 62.5, 125, 250, 500]

    var body: some View {
        Form {
            Section {
                Picker("Bandwidth", selection: $selectedBandwidth) {
                    ForEach(bandwidthOptions, id: \.self) { bw in
                        Text(formatBW(bw)).tag(bw)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
                .listRowBackground(MeshTheme.surface)
            } header: {
                Text("Select Bandwidth")
            }

            Section {
                ForEach(5...12, id: \.self) { sf in
                    let entry = tableEntry(sf: sf, bwKHz: selectedBandwidth)
                    let isCurrentSF = hasRadioSettings && Int(deviceConfig.radioSpreadingFactor) == sf &&
                        abs(deviceConfig.bandwidthKHz - selectedBandwidth) < 0.5
                    VStack(alignment: .leading, spacing: Design.Space.tight) {
                        HStack(spacing: Design.Space.tight) {
                            Text("SF\(sf)")
                                .font(.headline)
                            if isCurrentSF {
                                Label("Current", systemImage: "antenna.radiowaves.left.and.right")
                                    .font(.subheadline)
                                    .foregroundStyle(MeshTheme.accent)
                            }
                        }
                        MeshValueRow(label: "Sensitivity", value: String(format: "%.0f dBm", entry.sensitivity))
                        MeshValueRow(label: "Bit Rate", value: formatBitRate(entry.bitRate))
                        MeshValueRow(label: "Theoretical Range", value: formatRange(entry.theoreticalRangeKm))
                    }
                    .padding(.vertical, Design.Space.tight)
                    .listRowBackground(isCurrentSF ? MeshTheme.accent.opacity(0.1) : MeshTheme.surface)
                }
            } header: {
                Text("Performance by Spreading Factor")
            } footer: {
                Text("Calculated at \(String(format: "%.3f", referenceFrequencyMHz)) MHz with CR 4/5, 22 dBm TX power, and 2 dBi antenna gain. Range assumes free space.")
            }

            Section {
                infoRow("Higher SF", detail: "Better sensitivity and range, but slower data rate and longer airtime")
                infoRow("Lower SF", detail: "Faster data rate and shorter airtime, but reduced range")
                infoRow("Wider BW", detail: "Higher bit rate, lower sensitivity. Less affected by frequency drift")
                infoRow("Narrower BW", detail: "Better sensitivity and range, but more susceptible to crystal drift")
            } header: {
                Text("Quick Reference")
            }
        }
        .formStyle(.grouped)
        .meshTheme()
        .navigationTitle("SF/BW Reference")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            guard hasRadioSettings else { return }
            // Select the bandwidth matching the connected radio
            let deviceBW = deviceConfig.bandwidthKHz
            if bandwidthOptions.contains(where: { abs($0 - deviceBW) < 0.5 }) {
                selectedBandwidth = bandwidthOptions.first(where: { abs($0 - deviceBW) < 0.5 }) ?? 62.5
            }
        }
    }

    // MARK: - Sensitivity Model
    // Based on Semtech SX1276 datasheet typical sensitivity values
    // Formula: sensitivity = -174 + 10*log10(BW) + NF + SNR_required
    // NF (noise figure) ~6 dB for SX1276

    private struct TableEntry {
        let sensitivity: Double  // dBm
        let bitRate: Double      // bps
        let theoreticalRangeKm: Double
    }

    /// SNR required for demodulation at each SF (from Semtech datasheet)
    private let snrRequired: [Int: Double] = [
        5: -2.5,
        6: -5.0,
        7: -7.5,
        8: -10.0,
        9: -12.5,
        10: -15.0,
        11: -17.5,
        12: -20.0,
    ]

    private func tableEntry(sf: Int, bwKHz: Double) -> TableEntry {
        let bwHz = bwKHz * 1000
        let noiseFigure = 6.0
        let snr = snrRequired[sf] ?? -7.5

        // Sensitivity = -174 + 10*log10(BW_Hz) + NF + SNR
        let sensitivity = -174.0 + 10.0 * log10(bwHz) + noiseFigure + snr

        // Bit rate = SF * (4/CR) * BW / 2^SF  (CR=5 → 4/5)
        let cr = 5.0
        let bitRate = Double(sf) * (4.0 / cr) * bwHz / pow(2.0, Double(sf))

        // Theoretical FSPL range: TX 22 dBm + 2 dBi TX + 2 dBi RX
        let txPower = 22.0
        let txGain = 2.0
        let rxGain = 2.0
        let budget = txPower + txGain + rxGain - sensitivity
        // FSPL: d = 10^((budget - 32.44 - 20*log10(f_MHz)) / 20)
        let freqMHz = referenceFrequencyMHz
        let exponent = (budget - 32.44 - 20 * log10(freqMHz)) / 20
        let rangeKm = pow(10, exponent)

        return TableEntry(sensitivity: sensitivity, bitRate: bitRate, theoreticalRangeKm: rangeKm)
    }

    // MARK: - Formatting

    private func formatBW(_ bw: Double) -> String {
        if bw == bw.rounded() && bw >= 1 {
            return "\(Int(bw)) kHz"
        }
        return "\(bw) kHz"
    }

    private func formatBitRate(_ bps: Double) -> String {
        if bps >= 1000 {
            return String(format: "%.1f kbps", bps / 1000)
        }
        return String(format: "%.0f bps", bps)
    }

    private func formatRange(_ km: Double) -> String {
        if km >= 1 {
            return String(format: "%.0f km", km)
        }
        return String(format: "%.0f m", km * 1000)
    }

    private func infoRow(_ label: LocalizedStringKey, detail: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(MeshTheme.accent)
            Text(detail)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .listRowBackground(MeshTheme.surface)
    }
}
#endif
