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
    #if os(macOS)
    @State private var usbCaptureSession = USBCaptureSession()
    #endif

    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showLineOfSight = false
    @State private var showSpectrumAnalyzer = false
    @State private var showTrafficAnalyzer = false
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

            if supportsMonitoring {
                Section("Your radio") {
                    toolRow(
                        icon: "waveform.badge.magnifyingglass",
                        title: "RF Monitor",
                        detail: "Watch live signal and noise reports"
                    ) { showNoiseFloor = true }
                    toolRow(
                        icon: "dot.radiowaves.left.and.right",
                        title: "Frequency Scanner",
                        detail: "Scan regional frequency presets"
                    ) { showFreqScanner = true }
                }
            }

            Section("Plan a link") {
                toolRow(
                    icon: "eye.trianglebadge.exclamationmark",
                    title: "Line of Sight",
                    detail: "Check terrain between two locations"
                ) { showLineOfSight = true }
                toolRow(
                    icon: "function",
                    title: "Radio Calculator",
                    detail: "Estimate range and link budget"
                ) { showRadioCalc = true }
                toolRow(
                    icon: "timer",
                    title: "Airtime",
                    detail: "Calculate how long a packet takes to send"
                ) { showAirtime = true }
                toolRow(
                    icon: "chart.bar",
                    title: "Sensitivity",
                    detail: "Compare spreading factor and bandwidth"
                ) { showSensitivity = true }
            }

            Section("Explore") {
                toolRow(
                    icon: "list.dash.header.rectangle",
                    title: "Traffic Analyzer",
                    detail: "Open a capture and inspect packets"
                ) { showTrafficAnalyzer = true }
                toolRow(
                    icon: "waveform.path",
                    title: "Spectrum Analyzer",
                    detail: spectrumDetail
                ) { showSpectrumAnalyzer = true }
                toolRow(
                    icon: "rotate.3d",
                    title: "The Deck",
                    detail: "Turn the handset. Walk the firmware."
                ) { showDeck = true }
            }
            if !supportsMonitoring {
                Section {
                    DisclosureGroup("Live radio tools") {
                        Text("RF Monitor and Frequency Scanner use MeshCore radio reports and controls.")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                        #if os(macOS)
                        Text("Connect a MeshCore radio to use them here. For a T-Deck over USB, open Traffic Analyzer or Spectrum Analyzer.")
                        #else
                        Text("Connect a MeshCore radio to use them here. Live T-Deck analysis uses USB in the Mac or web app. You can open saved captures in Traffic Analyzer on this phone.")
                        #endif
                    }
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
        .sheet(isPresented: $showTrafficAnalyzer, onDismiss: {
            #if os(macOS)
            usbCaptureSession.disconnect()
            #endif
        }) {
            NavigationStack {
                #if os(macOS)
                TrafficAnalyzerView(usbSession: usbCaptureSession)
                    .lilysharkSheet {
                        usbCaptureSession.disconnect()
                        showTrafficAnalyzer = false
                    }
                #else
                TrafficAnalyzerView()
                    .lilysharkSheet { showTrafficAnalyzer = false }
                #endif
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 800, minHeight: 600)
            #endif
        }
        .sheet(isPresented: $showSpectrumAnalyzer) {
            NavigationStack {
                SpectrumAnalyzerView()
                    .lilysharkSheet { showSpectrumAnalyzer = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 800, minHeight: 600)
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

    private var spectrumDetail: LocalizedStringKey {
        #if os(macOS)
        "USB band scans and simulated preview"
        #else
        "Simulated band scan preview"
        #endif
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
            NavigationLink {
                RadioVisibilityView()
            } label: {
                rowLabel(
                    icon: "checkmark.circle.fill",
                    title: LocalizedStringKey(connectionManager.connectedDeviceName ?? "My radio"),
                    detail: "View radio details",
                    iconStyle: MeshTheme.connected,
                    titleFont: .headline,
                    showsChevron: false
                )
            }
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
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            rowLabel(
                icon: icon,
                title: title,
                detail: detail,
                iconStyle: MeshTheme.textPrimary,
                titleFont: .body,
                showsChevron: true
            )
        }
        .buttonStyle(.meshPlain)
        .listRowBackground(MeshTheme.surface)
        .accessibilityHint("Opens this tool")
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
            if !dynamicTypeSize.isAccessibilitySize {
                Image(systemName: icon)
                    .font(.title3)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(iconStyle)
                    .frame(width: 28)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(title)
                    .font(titleFont)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(Design.Text.detail)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if showsChevron && !dynamicTypeSize.isAccessibilitySize {
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
