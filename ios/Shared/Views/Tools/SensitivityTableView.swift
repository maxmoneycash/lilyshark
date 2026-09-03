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
                // Header row
                HStack(spacing: 0) {
                    Text("SF")
                        .frame(width: 36, alignment: .leading)
                    Text("Sensitivity")
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    Text("Bit Rate")
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    Text("Range")
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(MeshTheme.textSecondary)
                .listRowBackground(MeshTheme.surface)

                ForEach(5...12, id: \.self) { sf in
                    let entry = tableEntry(sf: sf, bwKHz: selectedBandwidth)
                    let isCurrentSF = Int(deviceConfig.radioSpreadingFactor) == sf &&
                        abs(deviceConfig.bandwidthKHz - selectedBandwidth) < 0.5
                    HStack(spacing: 0) {
                        HStack(spacing: 4) {
                            Text("SF\(sf)")
                                .font(.body.weight(isCurrentSF ? .bold : .regular))
                            if isCurrentSF {
                                Image(systemName: "antenna.radiowaves.left.and.right")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.accent)
                            }
                        }
                        .frame(width: 56, alignment: .leading)

                        Text(String(format: "%.0f dBm", entry.sensitivity))
                            .frame(maxWidth: .infinity, alignment: .trailing)

                        Text(formatBitRate(entry.bitRate))
                            .frame(maxWidth: .infinity, alignment: .trailing)

                        Text(formatRange(entry.theoreticalRangeKm))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(.body.monospaced())
                    .foregroundStyle(isCurrentSF ? MeshTheme.accent : MeshTheme.textSecondary)
                    .listRowBackground(isCurrentSF ? MeshTheme.accent.opacity(0.1) : MeshTheme.surface)
                }
            } header: {
                Text("Performance by Spreading Factor")
            } footer: {
                Text("Sensitivity assumes CR 4/5. Range is theoretical FSPL max with 22 dBm TX + 2 dBi antenna. Real-world range is typically 30-50\u{0025} of theoretical.")
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
        let freqMHz = deviceConfig.frequencyMHz > 0 ? deviceConfig.frequencyMHz : 910.525
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
