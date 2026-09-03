//
//  ToolsView.swift
//  PommeCore
//
//  Planning and monitoring tools — accessible from the sidebar.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MeshCoreKit

struct ToolsView: View {
    @State private var showLineOfSight = false
    @State private var showNoiseFloor = false
    @State private var showRadioCalc = false
    @State private var showAirtime = false
    @State private var showSensitivity = false
    @State private var showFreqScanner = false
    var body: some View {
        List {
            Section {
                toolButton(
                    icon: "eye.trianglebadge.exclamationmark",
                    title: "Line of Sight",
                    subtitle: "Terrain analysis with Fresnel zone for RF path planning"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showLineOfSight = true }
                }

                toolButton(
                    icon: "function",
                    title: "Radio Calculator",
                    subtitle: "Link budget, path loss, wavelength, and range estimation",
                    badge: "No Radio"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showRadioCalc = true }
                }

                toolButton(
                    icon: "timer",
                    title: "Airtime Calculator",
                    subtitle: "LoRa time-on-air, duty cycle, and packets per hour",
                    badge: "No Radio"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showAirtime = true }
                }

                toolButton(
                    icon: "chart.bar",
                    title: "SF/BW Reference",
                    subtitle: "Sensitivity, bit rate, and range by spreading factor",
                    badge: "No Radio"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showSensitivity = true }
                }
            } header: {
                Text("Planning")
            } footer: {
                Text("These tools don't require a radio connection.")
            }

            Section {
                toolButton(
                    icon: "waveform.badge.magnifyingglass",
                    title: "RF Monitor",
                    subtitle: "Live SNR and RSSI chart from received LoRa packets"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showNoiseFloor = true }
                }

                toolButton(
                    icon: "antenna.radiowaves.left.and.right.slash",
                    title: "Frequency Scanner",
                    subtitle: "Scan regional presets to detect which frequencies have mesh activity nearby"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showFreqScanner = true }
                }

            } header: {
                Text("Monitoring")
            } footer: {
                Text("These tools require a radio connection.")
            }
        }
        .meshTheme()
        .navigationTitle("Tools")
        .sheet(isPresented: $showLineOfSight) {
            LineOfSightView()
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 500, idealWidth: 700, minHeight: 700, idealHeight: 900)
            #endif
        }
        .sheet(isPresented: $showRadioCalc) {
            NavigationStack {
                RadioCalculatorView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showRadioCalc = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 500, idealWidth: 600, minHeight: 600, idealHeight: 700)
            #endif
        }
        .sheet(isPresented: $showAirtime) {
            NavigationStack {
                LoRaAirtimeView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showAirtime = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 500, idealWidth: 600, minHeight: 600, idealHeight: 700)
            #endif
        }
        .sheet(isPresented: $showSensitivity) {
            NavigationStack {
                SensitivityTableView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showSensitivity = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 500, idealWidth: 600, minHeight: 600, idealHeight: 700)
            #endif
        }
        .sheet(isPresented: $showFreqScanner) {
            NavigationStack {
                FrequencyScannerView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showFreqScanner = false }
                        }
                    }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 400, minHeight: 500)
            #endif
        }
        .sheet(isPresented: $showNoiseFloor) {
            NavigationStack {
                ScrollView {
                    NoiseFloorMonitorView()
                        .padding()
                }
                .background(MeshTheme.background)
                .navigationTitle("RF Monitor")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { showNoiseFloor = false }
                    }
                }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 400, minHeight: 500)
            #endif
        }
    }

    private func toolButton(icon: String, title: LocalizedStringKey, subtitle: LocalizedStringKey, badge: LocalizedStringKey? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(MeshTheme.accent.opacity(0.15))
                        .frame(width: 40, height: 40)
                    Image(systemName: icon)
                        .foregroundStyle(MeshTheme.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(title)
                            .font(.body)
                            .foregroundStyle(MeshTheme.textPrimary)
                        if let badge {
                            Text(badge)
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(MeshTheme.accent)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(MeshTheme.accent.opacity(0.15))
                                .clipShape(Capsule())
                        }
                    }
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .lineLimit(2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(MeshTheme.surface)
    }
}
#endif
