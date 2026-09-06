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
    @Environment(ConnectionManager.self) private var connectionManager
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
                    subtitle: "Link budget, path loss, wavelength, and range estimation"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showRadioCalc = true }
                }

                toolButton(
                    icon: "timer",
                    title: "Airtime Calculator",
                    subtitle: "LoRa time-on-air, duty cycle, and packets per hour"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showAirtime = true }
                }

                toolButton(
                    icon: "chart.bar",
                    title: "SF/BW Reference",
                    subtitle: "Sensitivity, bit rate, and range by spreading factor"
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
                    subtitle: "Request regional presets and watch for contact updates"
                ) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { showFreqScanner = true }
                }

            } header: {
                Text("Monitoring")
            } footer: {
                Text("Monitoring requires a connected MeshCore radio. Lilyshark deck monitoring is available in the web app over USB.")
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
                    .lilysharkSheet { showRadioCalc = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 500, idealWidth: 600, minHeight: 600, idealHeight: 700)
            #endif
        }
        .sheet(isPresented: $showAirtime) {
            NavigationStack {
                LoRaAirtimeView()
                    .lilysharkSheet { showAirtime = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 500, idealWidth: 600, minHeight: 600, idealHeight: 700)
            #endif
        }
        .sheet(isPresented: $showSensitivity) {
            NavigationStack {
                SensitivityTableView()
                    .lilysharkSheet { showSensitivity = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 500, idealWidth: 600, minHeight: 600, idealHeight: 700)
            #endif
        }
        .sheet(isPresented: $showFreqScanner) {
            NavigationStack {
                Group {
                    if supportsMonitoring {
                        FrequencyScannerView()
                    } else {
                        monitoringUnavailable
                    }
                }
                    .lilysharkSheet { showFreqScanner = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 400, minHeight: 500)
            #endif
        }
        .sheet(isPresented: $showNoiseFloor) {
            NavigationStack {
                ScrollView {
                    if supportsMonitoring {
                        NoiseFloorMonitorView()
                            .padding()
                    } else {
                        monitoringUnavailable
                    }
                }
                .background(MeshTheme.background)
                .navigationTitle("RF Monitor")
                .lilysharkSheet { showNoiseFloor = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 400, minHeight: 500)
            #endif
        }
    }

    private var supportsMonitoring: Bool {
        connectionManager.connectionState == .ready && !connectionManager.isMeshtasticLinkActive
    }

    private var monitoringUnavailable: some View {
        ContentUnavailableView(
            "Connect a MeshCore radio",
            systemImage: "antenna.radiowaves.left.and.right.slash",
            description: Text("These tools use MeshCore radio reports and controls. For a Lilyshark deck, open the web app and connect over USB to monitor radio traffic.")
        )
    }

    private func toolButton(icon: String, title: LocalizedStringKey, subtitle: LocalizedStringKey, action: @escaping () -> Void) -> some View {
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
                    Text(title)
                        .font(.body)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .touchable()
        }
        .buttonStyle(.meshPlain)
        .listRowBackground(MeshTheme.surface)
    }
}
#endif
