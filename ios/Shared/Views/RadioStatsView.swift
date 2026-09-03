//
//  RadioStatsView.swift
//  PommeCore
//
//  Radio, packet, and core statistics from CMD_GET_STATS (0x38).
//
//  Created by Michael P. Bedworth on 04/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MeshCoreKit

struct RadioStatsView: View {
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ConnectionManager.self) private var connectionManager

    var body: some View {
        List {
            Section {
                statRow("Battery Voltage", value: batteryVoltage)
                statRow("Uptime", value: formatUptime(deviceConfig.statsUptime))
                statRow("Queue Depth", value: "\(deviceConfig.statsQueueLength)")
                errorFlagsRow
            } header: { Text("Core") }

            Section {
                statRow("Noise Floor", value: "\(deviceConfig.statsNoiseFloor) dBm",
                        color: noiseFloorColor)
                statRow("Last RSSI", value: "\(deviceConfig.statsLastRSSI) dBm",
                        color: rssiColor)
                statRow("Last SNR", value: formatSNR(deviceConfig.statsLastSNR),
                        color: snrColor)
                statRow("TX Airtime", value: formatUptime(deviceConfig.statsTXAirtime))
                statRow("RX Airtime", value: formatUptime(deviceConfig.statsRXAirtime))
            } header: { Text("Radio") }

            Section {
                statRow("Packets Received", value: "\(deviceConfig.statsPacketsReceived)")
                statRow("Packets Sent", value: "\(deviceConfig.statsPacketsSent)")
                HStack {
                    Text("Flood Sent").foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text("\(deviceConfig.statsFloodCount)")
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text("/ Direct \(deviceConfig.statsDirectCount)")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .font(.caption)
                }
                HStack {
                    Text("Flood Received").foregroundStyle(MeshTheme.accent)
                    Spacer()
                    Text("\(deviceConfig.statsRecvFlood)")
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text("/ Direct \(deviceConfig.statsRecvDirect)")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .font(.caption)
                }
                if deviceConfig.statsReceiveErrors > 0 {
                    statRow("Receive Errors", value: "\(deviceConfig.statsReceiveErrors)",
                            color: .red)
                } else {
                    statRow("Receive Errors", value: "0", color: MeshTheme.connected)
                }
            } header: { Text("Packets") }

            #if os(macOS) || targetEnvironment(macCatalyst)
            Section {
                Button { requestStats() } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .foregroundStyle(MeshTheme.accent)
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
            }
            #endif
        }
        .meshTheme()
        .navigationTitle("Radio Stats")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    requestStats()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh stats")
            }
        }
        #endif
    }

    // MARK: - Actions

    private func requestStats() {
        connectionManager.requestStats(subType: 0)
        connectionManager.requestStats(subType: 1)
        connectionManager.requestStats(subType: 2)
    }

    // MARK: - Row helpers

    private func statRow(_ label: LocalizedStringKey, value: String, color: Color = MeshTheme.textSecondary) -> some View {
        HStack {
            Text(label).foregroundStyle(MeshTheme.accent)
            Spacer()
            Text(value).foregroundStyle(color)
        }
        .listRowBackground(MeshTheme.surface)
    }

    private var errorFlagsRow: some View {
        HStack {
            Text("Error Flags").foregroundStyle(MeshTheme.accent)
            Spacer()
            if deviceConfig.statsErrorFlags == 0 {
                Text("None").foregroundStyle(MeshTheme.connected)
            } else {
                Text(String(format: "0x%04X", deviceConfig.statsErrorFlags))
                    .foregroundStyle(MeshTheme.disconnected)
            }
        }
        .listRowBackground(MeshTheme.surface)
    }

    // MARK: - Computed values

    private var batteryVoltage: String {
        guard deviceConfig.statsBatteryMV > 0 else { return "—" }
        return String(format: "%.2f V", Double(deviceConfig.statsBatteryMV) / 1000.0)
    }

    private var noiseFloorColor: Color {
        let v = Int(deviceConfig.statsNoiseFloor)
        return v < -105 ? MeshTheme.connected : v < -95 ? .orange : MeshTheme.disconnected
    }

    private var rssiColor: Color {
        let v = Int(deviceConfig.statsLastRSSI)
        return v > -100 ? MeshTheme.connected : v > -120 ? .orange : MeshTheme.disconnected
    }

    private var snrColor: Color {
        let v = Double(deviceConfig.statsLastSNR) / 4.0
        return v > 0 ? MeshTheme.connected : v > -10 ? .orange : MeshTheme.disconnected
    }
}
#endif
