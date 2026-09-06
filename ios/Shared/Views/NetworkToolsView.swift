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
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif

// MARK: - Contact Detail Sheet

/// Live node details and the management tools supported by its protocol.
struct ContactDetailSheet: View {
    let contact: Contact
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(ContactStore.self) private var contactStore
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(\.dismiss) private var dismiss
    @State private var showPathEditor = false
    @State private var errorMessage: String?
    #if !os(watchOS)
    @Environment(LineOfSightStore.self) private var lineOfSightStore
    @State private var showLineOfSight = false
    #endif

    private var currentContact: Contact {
        contactStore.contacts.first { $0.publicKeyPrefix == contact.publicKeyPrefix } ?? contact
    }

    private var isMeshtasticNode: Bool {
        #if canImport(MeshtasticKit)
        MeshtasticIdentity.nodeNum(forSyntheticKey: currentContact.publicKey) != nil
        #else
        false
        #endif
    }

    private var observation: ContactStore.NodeObservation? {
        contactStore.nodeObservations[currentContact.publicKeyPrefix]
    }

    private var reportedPosition: ContactStore.NodePosition? {
        if isMeshtasticNode { return contactStore.nodePositions[currentContact.publicKeyPrefix] }
        guard currentContact.latitude != 0 || currentContact.longitude != 0 else { return nil }
        return .init(latitude: currentContact.latitude, longitude: currentContact.longitude)
    }

    private var isTracePending: Bool {
        remoteSessionManager.pendingTraceTag != nil && remoteSessionManager.pendingTraceContactKey == currentContact.publicKeyPrefix
    }
    private var isPingingThisContact: Bool {
        remoteSessionManager.isPinging && remoteSessionManager.pingContactKey == currentContact.publicKeyPrefix
    }
    private var isStatusPending: Bool { remoteSessionManager.pendingStatusKey == currentContact.publicKeyPrefix }
    private var isTelemetryPending: Bool { remoteSessionManager.pendingTelemetryKey == currentContact.publicKeyPrefix }
    private var isPathPending: Bool { remoteSessionManager.pendingAdvertPathKey == currentContact.publicKeyPrefix }
    private var isDiscoveryPending: Bool { remoteSessionManager.pendingPathDiscoveryKey == currentContact.publicKeyPrefix }
    private var hasPath: Bool { currentContact.outPathLen > 0 && !currentContact.outPath.isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    nodeSummary
                    if !isMeshtasticNode && !connectionManager.isMeshtasticLinkActive {
                        meshCoreTools
                    } else {
                        Text("These details come from the deck's Meshtastic reports. Route editing and remote management require a MeshCore radio.")
                            .font(.footnote)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
            .background(MeshTheme.background)
            .navigationTitle(contactStore.displayName(for: currentContact))
            // The title here is a peer's display name, so this was the worst
            // of the overlaps: a long Bay Area node name is exactly what slid
            // out from behind "Done". Only ever presented as a sheet
            // (ChatView 257, ChatView+Channels 442, ContactListView 249).
            .lilysharkSheet { dismiss() }
            .sheet(isPresented: $showPathEditor) {
                ManualPathEditor(contact: currentContact)
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
            if !isMeshtasticNode && !connectionManager.isMeshtasticLinkActive,
               (currentContact.type == .repeater || currentContact.type == .room || currentContact.type == .sensor),
               remoteSessionManager.statusByContact[currentContact.publicKeyPrefix] == nil {
                remoteSessionManager.requestStatus(for: currentContact)
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

    private var meshCoreTools: some View {
        VStack(spacing: Design.Space.regular) {
            // Ping Results
            if remoteSessionManager.pingContactKey == currentContact.publicKeyPrefix,
               remoteSessionManager.isPinging || !remoteSessionManager.pingResults.isEmpty {
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
                ActivityOverlay(message: "Tracing route to \(contactStore.displayName(for: currentContact))...", timeout: 15)
                    .padding()
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let trace = remoteSessionManager.lastTraceResult,
                      remoteSessionManager.detailContactForTrace?.publicKeyPrefix == currentContact.publicKeyPrefix {
                TraceRouteResultView(result: trace, contactName: contactStore.displayName(for: currentContact))
            }

            // Status
            if isStatusPending {
                ActivityOverlay(message: statusActivityMessage, timeout: 15)
                    .padding()
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let status = remoteSessionManager.statusByContact[currentContact.publicKeyPrefix] {
                StatusInfoView(status: status, contactName: contactStore.displayName(for: currentContact))
            }

            // Telemetry
            if isTelemetryPending {
                ActivityOverlay(message: telemetryActivityMessage, timeout: 15)
                    .padding()
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let readings = remoteSessionManager.telemetryByContact[currentContact.publicKeyPrefix], !readings.isEmpty {
                TelemetryView(readings: readings, contactName: contactStore.displayName(for: currentContact))
            }

            // Telemetry history chart
            #if !os(watchOS)
            TelemetryChartView(contactKey: currentContact.publicKeyPrefix, contactName: contactStore.displayName(for: currentContact))
            #endif

            // Routing Path (from contact's outPath)
            PathViewer(contact: currentContact)

            // Advert Path
            if isPathPending {
                ActivityOverlay(message: "Loading path info for \(contactStore.displayName(for: currentContact))...", timeout: 10)
                    .padding()
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let path = remoteSessionManager.advertPathByContact[currentContact.publicKeyPrefix] {
                AdvertPathView(pathInfo: path, contactName: contactStore.displayName(for: currentContact))
            }

            // Path Discovery
            if isDiscoveryPending {
                ActivityOverlay(message: "Discovering path to \(contactStore.displayName(for: currentContact))...", timeout: 30)
                    .padding()
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let disc = remoteSessionManager.pathDiscoveryByContact[currentContact.publicKeyPrefix] {
                PathDiscoveryResultView(result: disc, contactName: contactStore.displayName(for: currentContact))
            }

            // Actions
            VStack(spacing: 8) {
                actionButton("Ping", icon: "bolt.horizontal", pending: false, disabled: !hasPath) {
                    remoteSessionManager.ping(contact: currentContact)
                }
                actionButton(isPingingThisContact ? "Stop Ping" : "Multi-Ping (5x)", icon: isPingingThisContact ? "stop.fill" : "bolt.horizontal.fill", pending: false, disabled: !isPingingThisContact && (!hasPath || isTracePending)) {
                    if isPingingThisContact {
                        remoteSessionManager.cancelPing()
                    } else {
                        remoteSessionManager.multiPing(contact: contact, count: 5)
                    }
                }
                actionButton("Trace Route", icon: "point.topleft.down.to.point.bottomright.curvepath", pending: isTracePending, disabled: !hasPath) {
                    remoteSessionManager.traceRoute(to: currentContact)
                }
                if !hasPath {
                    Text("Ping and Trace Route require a routed path. Use \u{201C}Discover Path\u{201D} or send a message first.")
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .padding(.horizontal, 4)
                }
                actionButton("Request Status", icon: "info.circle", pending: isStatusPending) {
                    remoteSessionManager.requestStatus(for: currentContact)
                }
                actionButton("Request Telemetry", icon: "chart.line.uptrend.xyaxis", pending: isTelemetryPending) {
                    remoteSessionManager.requestTelemetry(for: currentContact)
                }
                actionButton("Show Path Info", icon: "map", pending: isPathPending) {
                    remoteSessionManager.requestAdvertPath(for: currentContact)
                }
                actionButton("Discover Path", icon: "arrow.triangle.branch", pending: isDiscoveryPending) {
                    remoteSessionManager.discoverPath(for: currentContact)
                }
                actionButton("Reset Path", icon: "arrow.counterclockwise", pending: false) {
                    contactStore.resetPath(for: currentContact)
                }
                actionButton("Edit Path", icon: "pencil.line", pending: false) {
                    showPathEditor = true
                }
                #if !os(watchOS)
                actionButton("Line of Sight", icon: "eye.trianglebadge.exclamationmark", pending: false) {
                    lineOfSightStore.configureForContact(currentContact)
                    showLineOfSight = true
                }
                #endif
            }
            .foregroundStyle(MeshTheme.accent)
        }
    }

    private var nodeSummary: some View {
        VStack(alignment: .leading, spacing: Design.Space.regular) {
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(contactStore.displayName(for: currentContact))
                    .font(.title2.weight(.semibold))
                Text(isMeshtasticNode ? "Meshtastic node" : currentContact.type.displayName)
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                Text(nodeIdentifier)
                    .font(.footnote.monospaced())
                    .foregroundStyle(MeshTheme.textSecondary)
                    #if !os(watchOS)
                    .textSelection(.enabled)
                    #endif
            }
            .accessibilityElement(children: .combine)

            VStack(alignment: .leading, spacing: Design.Space.tight) {
                Text("Latest report")
                    .font(.headline)
                if isMeshtasticNode, observation == nil {
                    Text("The deck has not supplied reception details for this node.")
                        .font(.subheadline)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: Design.Space.snug) {
                        receptionRows
                    }
                } else {
                    Grid(alignment: .leading, horizontalSpacing: Design.Space.regular, verticalSpacing: Design.Space.snug) {
                        receptionRows
                    }
                }
                Text("Signal readings describe the receiving link, which may include a relay. Missing readings do not establish a direct connection.")
                    .font(.footnote)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            .padding(Design.Space.regular)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MeshTheme.surface)
            .clipShape(.rect(cornerRadius: Design.Radius.card))

            VStack(alignment: .leading, spacing: Design.Space.tight) {
                Text("Last reported position")
                    .font(.headline)
                if let position = reportedPosition {
                    LabeledContent("Latitude", value: formatCoordinate(position.latitude))
                    LabeledContent("Longitude", value: formatCoordinate(position.longitude))
                    if position.viaMQTT == true {
                        Label("Position supplied over MQTT", systemImage: "network")
                            .font(.footnote)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    Text("Position fix time and accuracy have not been reported.")
                        .font(.footnote)
                        .foregroundStyle(MeshTheme.textSecondary)
                } else {
                    ContentUnavailableView {
                        Label("Position Not Reported", systemImage: "location.slash")
                    } description: {
                        Text("A position will appear when the radio shares coordinates for this node. A name or signal reading alone cannot place it on the map.")
                    }
                }
            }
            .padding(Design.Space.regular)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MeshTheme.surface)
            .clipShape(.rect(cornerRadius: Design.Radius.card))
        }
    }

    @ViewBuilder
    private var receptionRows: some View {
        detailRow("SNR", value: observation?.snr.map { String(format: "%.1f dB", $0) } ?? "Not reported")
        detailRow("RSSI", value: observation?.rssi.map { "\($0) dBm" } ?? "Not reported")
        detailRow("Hops traveled", value: observation?.hops.map { "\($0)" } ?? "Not reported")
        detailRow("Last heard", value: lastHeardText)
        detailRow("Source", value: sourceText)
        detailRow("Reception path", value: provenanceText)
    }

    @ViewBuilder
    private func detailRow(_ label: LocalizedStringKey, value: String) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(label).foregroundStyle(MeshTheme.textSecondary)
                Text(value)
            }
            .accessibilityElement(children: .combine)
        } else {
            GridRow(alignment: .firstTextBaseline) {
                Text(label).foregroundStyle(MeshTheme.textSecondary)
                Text(value)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var nodeIdentifier: String {
        #if canImport(MeshtasticKit)
        if let num = MeshtasticIdentity.nodeNum(forSyntheticKey: currentContact.publicKey) {
            return MeshtasticIdentity.defaultLabel(forNodeNum: num)
        }
        #endif
        return currentContact.publicKey.hexCompact
    }

    private var lastHeardText: String {
        let timestamp = isMeshtasticNode ? observation?.lastHeard : (currentContact.lastAdvert > 0 ? currentContact.lastAdvert : nil)
        guard let timestamp else { return String(localized: "Not reported") }
        return Date(timeIntervalSince1970: TimeInterval(timestamp)).formatted(date: .abbreviated, time: .shortened)
    }

    private var sourceText: String {
        guard isMeshtasticNode else { return String(localized: "MeshCore contact record") }
        switch observation?.source {
        case .deckRecord: return String(localized: "Deck node record")
        case .packet: return String(localized: "Packet delivered by deck")
        case nil: return String(localized: "Not reported")
        }
    }

    private var provenanceText: String {
        if observation?.viaMQTT == true { return String(localized: "Internet via MQTT") }
        if observation?.viaMQTT == false { return String(localized: "Deck reports no MQTT relay") }
        return String(localized: "Not reported")
    }

    /// Contextual status request message based on contact type.
    private var statusActivityMessage: String {
        switch currentContact.type {
        case .chat: return String(localized: "Chat nodes don't typically support status requests. Waiting...")
        case .repeater: return String(localized: "Requesting status from repeater...")
        case .room: return String(localized: "Requesting status from room server...")
        default: return String(localized: "Requesting status...")
        }
    }

    /// Contextual telemetry request message based on contact type.
    private var telemetryActivityMessage: String {
        switch currentContact.type {
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
            .padding(.vertical, Design.Space.tight)
            .padding(.horizontal, Design.Space.snug)
            .background(MeshTheme.surfaceLight)
            .clipShape(.rect(cornerRadius: Design.Radius.control))
            .touchable()
        }
        .buttonStyle(.meshPlain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.4 : 1.0)

    }
}
