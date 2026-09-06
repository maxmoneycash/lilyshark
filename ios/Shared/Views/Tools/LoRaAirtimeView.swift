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
    @Environment(ConnectionManager.self) private var connectionManager

    @State private var spreadingFactor: Int = 7
    @State private var bandwidthKHz: Double = 62.5
    @State private var codingRate: Int = 5
    @State private var payloadBytes: Int = 32
    @State private var preambleSymbols: Int = 8
    @State private var explicitHeader = true
    @State private var crcEnabled = true
    @State private var lowDataRateOptimize = false
    @State private var useDeviceConfig = true

    private var hasRadioSettings: Bool {
        connectionManager.connectionState == .ready && !connectionManager.isMeshtasticLinkActive
            && deviceConfig.loadedSections.contains("selfInfo")
    }

    private let sfRange = 5...12
    private let bandwidthOptions: [Double] = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500]

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
                if let estimate {
                    resultRow("Symbol Duration", value: String(format: "%.3f ms", estimate.symbolDurationMs))
                    resultRow("Preamble Time", value: formatDuration(estimate.preambleTimeMs))
                    resultRow("Payload Symbols", value: "\(estimate.payloadSymbolCount)")
                    resultRow("Payload Time", value: formatDuration(estimate.payloadTimeMs))
                    resultRow("Total Airtime", value: formatDuration(estimate.totalAirtimeMs),
                              color: MeshTheme.accent)
                    resultRow("Bit Rate", value: String(format: "%.0f bps", estimate.bitRate))
                } else {
                    ContentUnavailableView("Check the parameters", systemImage: "slider.horizontal.3",
                                           description: Text("Choose supported radio settings and valid payload and preamble lengths to calculate airtime."))
                }
            } header: {
                Text("Airtime")
            }

            if let estimate {
            Section {
                resultRow("1% Duty Cycle", value: packetsPerHourText(estimate, dutyCycle: 0.01))
                resultRow("10% Duty Cycle", value: packetsPerHourText(estimate, dutyCycle: 0.10))
                resultRow("100% (no limit)", value: packetsPerHourText(estimate, dutyCycle: 1.0))
            } header: {
                Text("Duty Cycle")
            } footer: {
                Text("These are calculated airtime budgets. Applicable duty cycle and dwell-time rules depend on your location, band, and operating mode.")
            }
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
        .onChange(of: hasRadioSettings) { _, available in
            if !available { useDeviceConfig = false }
        }
        .onChange(of: spreadingFactor) { _, _ in autoLDRO() }
        .onChange(of: bandwidthKHz) { _, _ in autoLDRO() }
    }

    // MARK: - LoRa Airtime Math
    private var estimate: LoRaAirtimeEstimate? {
        LoRaAirtimeEstimate(
            spreadingFactor: spreadingFactor, bandwidthKHz: bandwidthKHz,
            codingRateDenominator: codingRate, payloadBytes: payloadBytes,
            preambleSymbols: preambleSymbols, explicitHeader: explicitHeader,
            crcEnabled: crcEnabled, lowDataRateOptimize: lowDataRateOptimize
        )
    }

    private func packetsPerHourText(_ estimate: LoRaAirtimeEstimate, dutyCycle: Double) -> String {
        guard let count = estimate.packetsPerHour(dutyCycle: dutyCycle) else { return String(localized: "Unavailable") }
        return "\(count) packets/hr"
    }

    // MARK: - Helpers

    private func loadFromDevice() {
        guard hasRadioSettings else {
            useDeviceConfig = false
            return
        }
        spreadingFactor = Int(deviceConfig.radioSpreadingFactor)
        bandwidthKHz = deviceConfig.bandwidthKHz
        codingRate = Int(deviceConfig.radioCodingRate)
        autoLDRO()
    }

    /// Auto-enable LDRO when symbol duration exceeds 16ms (Semtech recommendation)
    private func autoLDRO() {
        guard bandwidthKHz.isFinite, bandwidthKHz > 0, (5...12).contains(spreadingFactor) else { return }
        lowDataRateOptimize = pow(2, Double(spreadingFactor)) / bandwidthKHz >= 16
    }

    private func formatBW(_ bw: Double) -> String {
        if bw == bw.rounded() && bw >= 1 {
            return "\(Int(bw)) kHz"
        }
        return "\(bw) kHz"
    }

    private func paramRow(_ label: LocalizedStringKey, value: Binding<Int>, unit: LocalizedStringKey, range: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text(label)
                .foregroundStyle(MeshTheme.textSecondary)
            HStack(spacing: Design.Space.tight) {
                TextField(label, value: Binding(
                    get: { value.wrappedValue },
                    set: { value.wrappedValue = min(range.upperBound, max(range.lowerBound, $0)) }
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
