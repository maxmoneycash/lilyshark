//
//  NoiseFloorMonitorView.swift
//  PommeCore
//
//  Live RF noise floor chart showing SNR and RSSI from LOG_RX_DATA (0x88).
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import Charts

struct NoiseFloorMonitorView: View {
    @Environment(RFMonitorStore.self) private var rfStore
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectedTab: RFTab = .chart

    enum RFTab: String, CaseIterable {
        case chart = "Chart"
        case log = "Packet Log"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header + toggle + tab picker
            VStack(alignment: .leading, spacing: Design.Space.regular) {
                Label("RF Monitor", systemImage: "waveform.badge.magnifyingglass")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
                Button {
                    guard rfStore.isMonitoring || canMonitor else { return }
                    rfStore.toggleMonitoring()
                } label: {
                    Label(rfStore.isMonitoring ? "Stop Monitoring" : "Start Monitoring",
                          systemImage: rfStore.isMonitoring ? "stop.circle" : "play.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.meshSecondary)
                .disabled(!rfStore.isMonitoring && !canMonitor)
            }

            Picker("View", selection: $selectedTab) {
                ForEach(RFTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.menu)

            if selectedTab == .log {
                PacketLogView(samples: rfStore.rfSamples)
            } else if !canMonitor && rfStore.rfSamples.isEmpty {
                ContentUnavailableView(
                    "Radio reports unavailable",
                    systemImage: "antenna.radiowaves.left.and.right.slash",
                    description: Text("Connect a MeshCore radio to collect packet signal reports here.")
                )
            } else if rfStore.isMonitoring && rfStore.rfSamples.isEmpty {
                VStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Waiting for packet reports from the radio…")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                    Text("Only packets reported by the radio appear here. No reports does not mean there is no RF activity.")
                        .font(.footnote)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding()
            } else if !rfStore.rfSamples.isEmpty {
                // SNR chart
                VStack(alignment: .leading, spacing: 4) {
                    Text("SNR (dB)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(MeshTheme.textSecondary)
                    Chart(rfStore.rfSamples) { sample in
                        LineMark(
                            x: .value("Time", sample.timestamp),
                            y: .value("SNR", sample.snr)
                        )
                        .foregroundStyle(.green)
                        .interpolationMethod(.catmullRom)
                    }
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                            AxisValueLabel(format: .dateTime.hour().minute().second())
                            AxisGridLine()
                        }
                    }
                    .chartYAxis {
                        AxisMarks(position: .leading)
                    }
                    .frame(height: 120)
                }

                // RSSI chart
                VStack(alignment: .leading, spacing: 4) {
                    Text("RSSI (dBm)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(MeshTheme.textSecondary)
                    Chart(rfStore.rfSamples) { sample in
                        LineMark(
                            x: .value("Time", sample.timestamp),
                            y: .value("RSSI", Int(sample.rssi))
                        )
                        .foregroundStyle(.orange)
                        .interpolationMethod(.catmullRom)
                    }
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                            AxisValueLabel(format: .dateTime.hour().minute().second())
                            AxisGridLine()
                        }
                    }
                    .chartYAxis {
                        AxisMarks(position: .leading)
                    }
                    .frame(height: 120)
                }

                // Stats
                LazyVGrid(columns: dynamicTypeSize.isAccessibilitySize
                          ? [GridItem(.flexible())]
                          : [GridItem(.adaptive(minimum: 180))], spacing: Design.Space.regular) {
                    statCard("Avg SNR", value: rfStore.averageSNR.map { String(format: "%.1f dB", $0) } ?? "Not reported")
                    statCard("Peak SNR", value: rfStore.peakSNR.map { String(format: "%.1f dB", $0) } ?? "Not reported")
                    statCard("Avg RSSI", value: rfStore.averageRSSI.map { String(format: "%.0f dBm", $0) } ?? "Not reported")
                    statCard("Packets", value: "\(rfStore.rfSamples.count)")
                }
            } else {
                ContentUnavailableView(
                    "RF monitor is stopped",
                    systemImage: "waveform.badge.magnifyingglass",
                    description: Text("Start monitoring to collect signal readings from packet reports. This chart does not measure the noise between packets.")
                )
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var canMonitor: Bool {
        connectionManager.connectionState == .ready && !connectionManager.isMeshtasticLinkActive
    }

    private func statCard(_ label: LocalizedStringKey, value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
            Text(value)
                .font(.caption.weight(.medium))
                .foregroundStyle(MeshTheme.textSecondary)
        }
    }
}

struct PacketLogView: View {
    let samples: [RFSample]

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    var body: some View {
        if samples.isEmpty {
            ContentUnavailableView(
                "No saved packet reports",
                systemImage: "list.bullet.rectangle",
                description: Text("Keep monitoring with a compatible radio connected. Reports appear when the radio forwards received packets to the app.")
            )
        } else {
                ScrollView {
                    LazyVStack(spacing: Design.Space.regular) {
                        ForEach(samples.reversed()) { sample in
                            VStack(alignment: .leading, spacing: Design.Space.tight) {
                                Text(Self.timeFormatter.string(from: sample.timestamp))
                                    .font(.subheadline.monospacedDigit())
                                    .foregroundStyle(MeshTheme.textSecondary)
                                MeshValueRow(label: "SNR", value: String(format: "%.1f dB", sample.snr),
                                             valueColor: sample.snr > 0 ? MeshTheme.connected : sample.snr > -10 ? .orange : MeshTheme.disconnected)
                                MeshValueRow(label: "RSSI", value: "\(sample.rssi) dBm",
                                             valueColor: sample.rssi > -100 ? MeshTheme.connected : sample.rssi > -120 ? .orange : MeshTheme.disconnected)
                            }
                            .padding(Design.Space.regular)
                            .background(MeshTheme.surfaceLight, in: RoundedRectangle(cornerRadius: Design.Radius.card))
                        }
                    }
                }
                .frame(maxHeight: 300)
        }
    }
}
#endif
