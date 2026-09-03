//
//  NetworkToolsView.swift
//  PommeCore
//
//  Contact detail sheet for trace route, status, telemetry, path info, and ping.
//
//  Created by Michael P. Bedworth on 3/14/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

// MARK: - Contact Detail Sheet

/// Overlay sheet showing trace route, status, telemetry, or path info for a contact.
struct ContactDetailSheet: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(\.dismiss) private var dismiss
    @State private var showPathEditor = false
    @State private var errorMessage: String?
    #if !os(watchOS)
    @Environment(LineOfSightStore.self) private var lineOfSightStore
    @State private var showLineOfSight = false
    #endif

    private var isTracePending: Bool { remoteSessionManager.pendingTraceTag != nil }
    private var isStatusPending: Bool { remoteSessionManager.pendingStatusKey == contact.publicKeyPrefix }
    private var isTelemetryPending: Bool { remoteSessionManager.pendingTelemetryKey == contact.publicKeyPrefix }
    private var isPathPending: Bool { remoteSessionManager.pendingAdvertPathKey == contact.publicKeyPrefix }
    private var isDiscoveryPending: Bool { remoteSessionManager.pendingPathDiscoveryKey == contact.publicKeyPrefix }
    private var hasPath: Bool { contact.outPathLen > 0 && !contact.outPath.isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Ping Results
                    if remoteSessionManager.isPinging || !remoteSessionManager.pingResults.isEmpty {
                        PingResultsView(
                            results: remoteSessionManager.pingResults,
                            stats: remoteSessionManager.pingStats,
                            isPinging: remoteSessionManager.isPinging,
                            current: remoteSessionManager.pingCount,
                            total: remoteSessionManager.pingTotal
                        )
                    }

                    // Trace Route
                    if isTracePending {
                        ActivityOverlay(message: "Tracing route to \(contactStore.displayName(for: contact))...", timeout: 15)
                            .padding()
                            .background(MeshTheme.surfaceLight)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if let trace = remoteSessionManager.lastTraceResult {
                        TraceRouteResultView(result: trace, contactName: contactStore.displayName(for: contact))
                    }

                    // Status
                    if isStatusPending {
                        ActivityOverlay(message: statusActivityMessage, timeout: 15)
                            .padding()
                            .background(MeshTheme.surfaceLight)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if let status = remoteSessionManager.statusByContact[contact.publicKeyPrefix] {
                        StatusInfoView(status: status, contactName: contactStore.displayName(for: contact))
                    }

                    // Telemetry
                    if isTelemetryPending {
                        ActivityOverlay(message: telemetryActivityMessage, timeout: 15)
                            .padding()
                            .background(MeshTheme.surfaceLight)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if let readings = remoteSessionManager.telemetryByContact[contact.publicKeyPrefix], !readings.isEmpty {
                        TelemetryView(readings: readings, contactName: contactStore.displayName(for: contact))
                    }

                    // Telemetry history chart
                    #if !os(watchOS)
                    TelemetryChartView(contactKey: contact.publicKeyPrefix, contactName: contactStore.displayName(for: contact))
                    #endif

                    // Routing Path (from contact's outPath)
                    PathViewer(contact: contact)

                    // Advert Path
                    if isPathPending {
                        ActivityOverlay(message: "Loading path info for \(contactStore.displayName(for: contact))...", timeout: 10)
                            .padding()
                            .background(MeshTheme.surfaceLight)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if let path = remoteSessionManager.advertPathByContact[contact.publicKeyPrefix] {
                        AdvertPathView(pathInfo: path, contactName: contactStore.displayName(for: contact))
                    }

                    // Path Discovery
                    if isDiscoveryPending {
                        ActivityOverlay(message: "Discovering path to \(contactStore.displayName(for: contact))...", timeout: 30)
                            .padding()
                            .background(MeshTheme.surfaceLight)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if let disc = remoteSessionManager.pathDiscoveryByContact[contact.publicKeyPrefix] {
                        PathDiscoveryResultView(result: disc, contactName: contactStore.displayName(for: contact))
                    }

                    // Actions
                    VStack(spacing: 8) {
                        actionButton("Ping", icon: "bolt.horizontal", pending: false, disabled: !hasPath) {
                            remoteSessionManager.ping(contact: contact)
                        }
                        actionButton("Multi-Ping (5x)", icon: "bolt.horizontal.fill", pending: remoteSessionManager.isPinging, disabled: !hasPath && !remoteSessionManager.isPinging) {
                            if remoteSessionManager.isPinging {
                                remoteSessionManager.cancelPing()
                            } else {
                                remoteSessionManager.multiPing(contact: contact, count: 5)
                            }
                        }
                        actionButton("Trace Route", icon: "point.topleft.down.to.point.bottomright.curvepath", pending: isTracePending, disabled: !hasPath) {
                            remoteSessionManager.traceRoute(to: contact)
                        }
                        if !hasPath {
                            Text("Ping and Trace Route require a routed path. Use \u{201C}Discover Path\u{201D} or send a message first.")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                                .padding(.horizontal, 4)
                        }
                        actionButton("Request Status", icon: "info.circle", pending: isStatusPending) {
                            remoteSessionManager.requestStatus(for: contact)
                        }
                        actionButton("Request Telemetry", icon: "chart.line.uptrend.xyaxis", pending: isTelemetryPending) {
                            remoteSessionManager.requestTelemetry(for: contact)
                        }
                        actionButton("Show Path Info", icon: "map", pending: isPathPending) {
                            remoteSessionManager.requestAdvertPath(for: contact)
                        }
                        actionButton("Discover Path", icon: "arrow.triangle.branch", pending: isDiscoveryPending) {
                            remoteSessionManager.discoverPath(for: contact)
                        }
                        actionButton("Reset Path", icon: "arrow.counterclockwise", pending: false) {
                            contactStore.resetPath(for: contact)
                        }
                        actionButton("Edit Path", icon: "pencil.line", pending: false) {
                            showPathEditor = true
                        }
                        #if !os(watchOS)
                        actionButton("Line of Sight", icon: "eye.trianglebadge.exclamationmark", pending: false) {
                            lineOfSightStore.configureForContact(contact)
                            showLineOfSight = true
                        }
                        #endif
                    }
                    .foregroundStyle(MeshTheme.accent)
                }
                .padding()
            }
            .background(MeshTheme.background)
            .navigationTitle(contactStore.displayName(for: contact))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showPathEditor) {
                ManualPathEditor(contact: contact)
            }
            #if !os(watchOS)
            .sheet(isPresented: $showLineOfSight) {
                LineOfSightView()
                #if os(macOS) || targetEnvironment(macCatalyst)
                    .frame(minWidth: 500, idealWidth: 700, minHeight: 700, idealHeight: 900)
                #endif
            }
            #endif
        }
        .meshTheme()
        .onAppear {
            remoteSessionManager.showError = { msg in
                Task { @MainActor in self.errorMessage = msg }
            }
            // Auto-request status for infrastructure nodes when sheet opens
            if (contact.type == .repeater || contact.type == .room || contact.type == .sensor),
               remoteSessionManager.statusByContact[contact.publicKeyPrefix] == nil {
                remoteSessionManager.requestStatus(for: contact)
            }
        }
        .alert("Network Tools", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    /// Contextual status request message based on contact type.
    private var statusActivityMessage: String {
        switch contact.type {
        case .chat: return String(localized: "Chat nodes don't typically support status requests. Waiting...")
        case .repeater: return String(localized: "Requesting status from repeater...")
        case .room: return String(localized: "Requesting status from room server...")
        default: return String(localized: "Requesting status...")
        }
    }

    /// Contextual telemetry request message based on contact type.
    private var telemetryActivityMessage: String {
        switch contact.type {
        case .chat: return String(localized: "Telemetry is typically only available from sensor nodes. Waiting...")
        case .repeater: return String(localized: "Some repeaters support basic telemetry. Waiting...")
        case .room: return String(localized: "Room servers don't typically support telemetry. Waiting...")
        default: return String(localized: "Requesting telemetry from sensor...")
        }
    }

    private func actionButton(_ title: LocalizedStringKey, icon: String, pending: Bool, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        let isDisabled = pending || disabled
        return Button(action: action) {
            HStack {
                if pending {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: icon)
                }
                Text(title)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.4 : 1.0)
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(MeshTheme.surfaceLight)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
