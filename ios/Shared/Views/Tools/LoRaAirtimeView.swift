//
//  LoRaAirtimeView.swift
//  PommeCore
//
//  LoRa airtime calculator: time-on-air, duty cycle, and packets-per-hour.
//  Pure math — works offline, no radio connection required.
//
//  Created by Michael P. Bedworth on 04/07/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MeshCoreKit

struct LoRaAirtimeView: View {
    @Environment(DeviceConfig.self) private var deviceConfig

    @State private var spreadingFactor: Int = 7
    @State private var bandwidthKHz: Double = 62.5
    @State private var codingRate: Int = 5
    @State private var payloadBytes: Int = 32
    @State private var preambleSymbols: Int = 8
    @State private var explicitHeader = true
    @State private var crcEnabled = true
    @State private var lowDataRateOptimize = false
    @State private var useDeviceConfig = true

    private let sfRange = 5...12
    private let bandwidthOptions: [Double] = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500]

    var body: some View {
        Form {
            Section {
                Toggle("Use Connected Radio Settings", isOn: $useDeviceConfig)
                    .foregroundStyle(MeshTheme.accent)
                    .listRowBackground(MeshTheme.surface)
                    .onChange(of: useDeviceConfig) { _, use in
                        if use { loadFromDevice() }
                    }

                Picker("Spreading Factor", selection: $spreadingFactor) {
                    ForEach(sfRange, id: \.self) { sf in
                        Text("SF\(sf)").tag(sf)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
                .listRowBackground(MeshTheme.surface)

                Picker("Bandwidth", selection: $bandwidthKHz) {
                    ForEach(bandwidthOptions, id: \.self) { bw in
                        Text(formatBW(bw)).tag(bw)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
                .listRowBackground(MeshTheme.surface)

                Picker("Coding Rate", selection: $codingRate) {
                    ForEach(5...8, id: \.self) { cr in
                        Text("4/\(cr)").tag(cr)
                    }
                }
                .foregroundStyle(MeshTheme.accent)
                .tint(.primary)
                .listRowBackground(MeshTheme.surface)

                paramRow("Payload Size", value: $payloadBytes, unit: "bytes", range: 1...255)
                paramRow("Preamble", value: $preambleSymbols, unit: "symbols", range: 6...65535)

                Toggle("Explicit Header", isOn: $explicitHeader)
                    .foregroundStyle(MeshTheme.accent)
                    .listRowBackground(MeshTheme.surface)
                Toggle("CRC", isOn: $crcEnabled)
                    .foregroundStyle(MeshTheme.accent)
                    .listRowBackground(MeshTheme.surface)
                Toggle("Low Data Rate Optimize", isOn: $lowDataRateOptimize)
                    .foregroundStyle(MeshTheme.accent)
                    .listRowBackground(MeshTheme.surface)
            } header: {
                Text("Parameters")
            }

            Section {
                resultRow("Symbol Duration", value: String(format: "%.3f ms", symbolDurationMs))
                resultRow("Preamble Time", value: formatDuration(preambleTimeMs))
                resultRow("Payload Symbols", value: "\(payloadSymbolCount)")
                resultRow("Payload Time", value: formatDuration(payloadTimeMs))
                resultRow("Total Airtime", value: formatDuration(totalAirtimeMs),
                          color: MeshTheme.accent)
                resultRow("Bit Rate", value: String(format: "%.0f bps", bitRate))
            } header: {
                Text("Airtime")
            }

            Section {
                resultRow("1% Duty Cycle", value: "\(packetsPerHour(dutyCycle: 0.01)) packets/hr")
                resultRow("10% Duty Cycle", value: "\(packetsPerHour(dutyCycle: 0.10)) packets/hr")
                resultRow("100% (no limit)", value: "\(packetsPerHour(dutyCycle: 1.0)) packets/hr")
            } header: {
                Text("Duty Cycle")
            } footer: {
                Text("EU 868 MHz band: 1\u{0025} duty cycle. US 915 MHz: no duty cycle limit (FCC dwell time applies instead).")
            }
        }
        .formStyle(.grouped)
        .meshTheme()
        .navigationTitle("Airtime Calculator")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            if useDeviceConfig { loadFromDevice() }
        }
        .onChange(of: spreadingFactor) { _, _ in autoLDRO() }
        .onChange(of: bandwidthKHz) { _, _ in autoLDRO() }
    }

    // MARK: - LoRa Airtime Math
    // Reference: Semtech AN1200.13 "LoRa Modem Designer's Guide"

    private var symbolDurationMs: Double {
        let bw = bandwidthKHz * 1000 // Hz
        guard bw > 0 else { return 0 }
        return (pow(2.0, Double(spreadingFactor)) / bw) * 1000
    }

    private var preambleTimeMs: Double {
        (Double(preambleSymbols) + 4.25) * symbolDurationMs
    }

    private var payloadSymbolCount: Int {
        let sf = Double(spreadingFactor)
        let de: Double = lowDataRateOptimize ? 1 : 0
        let ih: Double = explicitHeader ? 0 : 1
        let crc: Double = crcEnabled ? 1 : 0
        let cr = Double(codingRate)

        let numerator = 8.0 * Double(payloadBytes) - 4.0 * sf + 28.0 + 16.0 * crc - 20.0 * ih
        let denominator = 4.0 * (sf - 2.0 * de)
        guard denominator > 0 else { return 8 }

        let symbolCount = 8 + max(Int(ceil(numerator / denominator)) * Int(cr - 4 + 1), 0)
        return symbolCount
    }

    private var payloadTimeMs: Double {
        Double(payloadSymbolCount) * symbolDurationMs
    }

    private var totalAirtimeMs: Double {
        preambleTimeMs + payloadTimeMs
    }

    private var bitRate: Double {
        let sf = Double(spreadingFactor)
        let cr = Double(codingRate)
        let bw = bandwidthKHz * 1000
        guard bw > 0 else { return 0 }
        return sf * (4.0 / cr) * bw / pow(2.0, sf)
    }

    private func packetsPerHour(dutyCycle: Double) -> Int {
        guard totalAirtimeMs > 0 else { return 0 }
        let airtimeSeconds = totalAirtimeMs / 1000
        let availableSeconds = 3600.0 * dutyCycle
        return Int(availableSeconds / airtimeSeconds)
    }

    // MARK: - Helpers

    private func loadFromDevice() {
        spreadingFactor = Int(deviceConfig.radioSpreadingFactor)
        bandwidthKHz = deviceConfig.bandwidthKHz
        codingRate = Int(deviceConfig.radioCodingRate)
        autoLDRO()
    }

    /// Auto-enable LDRO when symbol duration exceeds 16ms (Semtech recommendation)
    private func autoLDRO() {
        lowDataRateOptimize = symbolDurationMs > 16
    }

    private func formatBW(_ bw: Double) -> String {
        if bw == bw.rounded() && bw >= 1 {
            return "\(Int(bw)) kHz"
        }
        return "\(bw) kHz"
    }

    private func paramRow(_ label: LocalizedStringKey, value: Binding<Int>, unit: LocalizedStringKey, range: ClosedRange<Int>) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            TextField(unit, value: value, format: .number)
                .frame(width: 70)
                .multilineTextAlignment(.trailing)
                .foregroundStyle(.primary)
                #if !os(watchOS)
                .textFieldStyle(.roundedBorder)
                #endif
            Text(unit)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .frame(width: 55, alignment: .leading)
        }
        .listRowBackground(MeshTheme.surface)
    }

    private func resultRow(_ label: LocalizedStringKey, value: String, color: Color = MeshTheme.textSecondary) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Text(value)
                .font(.body.monospaced())
                .foregroundStyle(color)
        }
        .listRowBackground(MeshTheme.surface)
    }
}
#endif
