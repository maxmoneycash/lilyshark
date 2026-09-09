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
    @State private var showDeck = false
    @State private var connectAfterDismiss = false

    var body: some View {
        List {
            Section {
                connectionRow
            }

            Section {
                toolRow(
                    icon: "rotate.3d",
                    title: "The Deck",
                    detail: "Turn the handset. Walk the firmware.",
                    featured: true
                ) { showDeck = true }
            }

            Section("Planning") {
                toolRow(
                    icon: "eye.trianglebadge.exclamationmark",
                    title: "Line of Sight",
                    detail: "Terrain and Fresnel zone"
                ) { showLineOfSight = true }
                toolRow(
                    icon: "function",
                    title: "Radio Calculator",
                    detail: "Link budget and range"
                ) { showRadioCalc = true }
                toolRow(
                    icon: "timer",
                    title: "Airtime",
                    detail: "Time-on-air and duty cycle"
                ) { showAirtime = true }
                toolRow(
                    icon: "chart.bar",
                    title: "SF/BW",
                    detail: "Sensitivity by spreading factor"
                ) { showSensitivity = true }
            }

            Section {
                toolRow(
                    icon: "waveform.badge.magnifyingglass",
                    title: "RF Monitor",
                    detail: "Live SNR and RSSI",
                    available: supportsMonitoring
                ) { showNoiseFloor = true }
                toolRow(
                    icon: "dot.radiowaves.left.and.right",
                    title: "Frequency Scanner",
                    detail: "Regional presets",
                    available: supportsMonitoring
                ) { showFreqScanner = true }
            } header: {
                Text("Monitoring")
            } footer: {
                if !supportsMonitoring {
                    Text("Needs a MeshCore radio. Deck traffic is in the web app over USB.")
                }
            }
        }
        .meshListStyle()
        .meshTheme()
        .navigationTitle("Radio")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        .contentMargins(.bottom, Design.Space.section, for: .scrollContent)
        #endif
        .sheet(isPresented: $showDeck) {
            NavigationStack {
                TDeckExperienceView()
                    .lilysharkSheet { showDeck = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 520, minHeight: 720)
            #endif
        }
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
        .sheet(isPresented: $showFreqScanner, onDismiss: openScannerIfRequested) {
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
        .sheet(isPresented: $showNoiseFloor, onDismiss: openScannerIfRequested) {
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
        ContentUnavailableView {
            Label("MeshCore radio required", systemImage: "antenna.radiowaves.left.and.right.slash")
        } description: {
            Text("These tools use MeshCore radio reports and controls. For a Lilyshark deck, open the web app and connect over USB to monitor radio traffic.")
        } actions: {
            if !connectionManager.isActivelyConnected {
                Button("Connect a Deck") {
                    connectAfterDismiss = true
                    showFreqScanner = false
                    showNoiseFloor = false
                }
                .buttonStyle(.meshPrimary)
            }
        }
    }

    private func openScannerIfRequested() {
        guard connectAfterDismiss else { return }
        connectAfterDismiss = false
        connectionManager.requestShowScanner = true
    }

    @ViewBuilder
    private var connectionRow: some View {
        switch connectionManager.connectionState {
        case .ready:
            HStack(spacing: Design.Space.snug) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(MeshTheme.connected)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Design.Space.hairline) {
                    Text("Ready")
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                    if let name = connectionManager.connectedDeviceName, !name.isEmpty {
                        Text(name)
                            .font(Design.Text.detail)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            .listRowBackground(MeshTheme.surface)
        case .connecting, .connected:
            HStack(spacing: Design.Space.snug) {
                ProgressView()
                    .frame(width: 28)
                    .accessibilityHidden(true)
                Text("Connecting")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
            }
            .listRowBackground(MeshTheme.surface)
        default:
            Button {
                connectionManager.requestShowScanner = true
            } label: {
                rowLabel(
                    icon: "antenna.radiowaves.left.and.right",
                    title: "Connect a Deck",
                    detail: "Scan for a nearby T-Deck or radio",
                    iconStyle: MeshTheme.accent,
                    titleFont: .headline,
                    showsChevron: true
                )
            }
            .buttonStyle(.meshPlain)
            .listRowBackground(MeshTheme.surface)
            .accessibilityHint("Scans for nearby decks and radios")
        }
    }

    private func toolRow(
        icon: String,
        title: LocalizedStringKey,
        detail: LocalizedStringKey,
        featured: Bool = false,
        available: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            rowLabel(
                icon: icon,
                title: title,
                detail: detail,
                iconStyle: available ? MeshTheme.textPrimary : MeshTheme.textSecondary,
                titleFont: featured ? .headline : .body,
                showsChevron: true
            )
            .padding(.vertical, featured ? Design.Space.tight : 0)
            .opacity(available ? 1 : 0.55)
        }
        .buttonStyle(.meshPlain)
        .listRowBackground(MeshTheme.surface)
        .accessibilityHint(available ? "Opens this tool" : "Needs a MeshCore radio")
    }

    private func rowLabel(
        icon: String,
        title: LocalizedStringKey,
        detail: LocalizedStringKey,
        iconStyle: Color,
        titleFont: Font,
        showsChevron: Bool
    ) -> some View {
        HStack(spacing: Design.Space.snug) {
            Image(systemName: icon)
                .font(.title3)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(iconStyle)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(title)
                    .font(titleFont)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .lineLimit(1)
                Text(detail)
                    .font(Design.Text.detail)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .touchable()
    }
}
#endif
