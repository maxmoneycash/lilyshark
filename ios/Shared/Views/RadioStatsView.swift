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
                // Falls back to Meshtastic telemetry so this screen and the
                // Settings rows never disagree about the same deck's uptime.
                statRow("Uptime", value: formatUptime(deviceConfig.availableUptimeSeconds))
                statRow("Queue Depth", value: deviceConfig.hasCoreStats ? "\(deviceConfig.statsQueueLength)" : "Not reported")
                errorFlagsRow
            } header: { Text("Core") }

            Section {
                if deviceConfig.hasRadioStats {
                statRow("Noise Floor", value: "\(deviceConfig.statsNoiseFloor) dBm",
                        color: noiseFloorColor)
                statRow("Last RSSI", value: "\(deviceConfig.statsLastRSSI) dBm",
                        color: rssiColor)
                statRow("Last SNR", value: formatSNR(deviceConfig.statsLastSNR),
                        color: snrColor)
                statRow("TX Airtime", value: formatUptime(deviceConfig.statsTXAirtime))
                statRow("RX Airtime", value: formatUptime(deviceConfig.statsRXAirtime))
                } else {
                    ContentUnavailableView("Radio statistics not reported", systemImage: "waveform",
                                           description: Text("This deck has not supplied signal or airtime readings."))
                }
            } header: { Text("Radio") }

            Section {
                if deviceConfig.hasPacketStats {
                statRow("Packets Received", value: "\(deviceConfig.statsPacketsReceived)")
                statRow("Packets Sent", value: "\(deviceConfig.statsPacketsSent)")
                statRow("Flood Sent", value: "\(deviceConfig.statsFloodCount)")
                statRow("Direct Sent", value: "\(deviceConfig.statsDirectCount)")
                statRow("Flood Received", value: "\(deviceConfig.statsRecvFlood)")
                statRow("Direct Received", value: "\(deviceConfig.statsRecvDirect)")
                if !deviceConfig.hasReceiveErrorStats {
                    statRow("Receive Errors", value: "Not reported")
                } else if deviceConfig.statsReceiveErrors > 0 {
                    statRow("Receive Errors", value: "\(deviceConfig.statsReceiveErrors)",
                            color: .red)
                } else {
                    statRow("Receive Errors", value: "0", color: MeshTheme.connected)
                }
                } else {
                    ContentUnavailableView("Packet counts not reported", systemImage: "tray",
                                           description: Text("An empty report does not tell us whether the band is quiet."))
                }
            } header: { Text("Packets") }

            #if os(macOS) || targetEnvironment(macCatalyst)
            Section {
                Button { requestStats() } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .foregroundStyle(MeshTheme.accent)
                }
                .buttonStyle(.meshPlain)
                .listRowBackground(MeshTheme.surface)
            }
            #endif
        }
        .meshTheme()
        .navigationTitle("Radio Stats")
        .onAppear { requestStats() }
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
        guard connectionManager.connectionState == .ready,
              !connectionManager.isMeshtasticLinkActive else { return }
        connectionManager.requestStats(subType: 0)
        connectionManager.requestStats(subType: 1)
        connectionManager.requestStats(subType: 2)
    }

    // MARK: - Row helpers

    private func statRow(_ label: LocalizedStringKey, value: String, color: Color = MeshTheme.textSecondary) -> some View {
        MeshValueRow(label: label, value: value, valueColor: color)
        .listRowBackground(MeshTheme.surface)
    }

    private var errorFlagsRow: some View {
        HStack {
            Text("Error Flags").foregroundStyle(MeshTheme.accent)
            Spacer()
            if !deviceConfig.hasCoreStats {
                Text("Not reported").foregroundStyle(MeshTheme.textSecondary)
            } else if deviceConfig.statsErrorFlags == 0 {
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
        guard deviceConfig.hasCoreStats, deviceConfig.statsBatteryMV > 0 else { return "Not reported" }
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
