//
//  NetworkToolsView+Discovery.swift
//  PommeCore
//
//  Discover neighbors, trace route, status request, telemetry, and advert path views.
//
//  Created by Michael P. Bedworth on 3/14/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

// MARK: - Discover View

struct DiscoverView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @State private var discoveryDuration: TimeInterval = 300
    @State private var timeRemaining: TimeInterval = 0
    @State private var discoveryTimer: Timer?
    @State private var advertTimer: Timer?
    @State private var isTimedDiscovery = false

    var body: some View {
        List {
            Section {
                Button {
                    remoteSessionManager.startDiscover()
                } label: {
                    HStack {
                        Image(systemName: "magnifyingglass.circle")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        (remoteSessionManager.isDiscovering ? Text("Restart Scan") : Text("Start Discover"))
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                        if remoteSessionManager.isDiscovering {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)

                if remoteSessionManager.isDiscovering || isTimedDiscovery {
                    Button {
                        remoteSessionManager.stopDiscover()
                        stopTimedDiscovery()
                    } label: {
                        HStack {
                            Image(systemName: "stop.circle")
                                .foregroundStyle(.orange)
                                .frame(width: 24)
                            Text("Stop Scan")
                                .foregroundStyle(.orange)
                            Spacer()
                            if isTimedDiscovery && timeRemaining > 0 {
                                Text(formatTimeRemaining(timeRemaining))
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                                    .monospacedDigit()
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(MeshTheme.surface)
                }

                if remoteSessionManager.isDiscovering {
                    ActivityOverlay(message: "Scanning for nearby nodes...", timeout: 30)
                        .listRowBackground(MeshTheme.surface)
                }

                if let fallbackMsg = remoteSessionManager.discoverFallbackMessage {
                    HStack(spacing: 6) {
                        Image(systemName: "info.circle")
                            .foregroundStyle(.orange)
                        Text(fallbackMsg)
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .listRowBackground(MeshTheme.surface)
                }
            }

            Section {
                HStack {
                    Image(systemName: "timer")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    Picker("Duration", selection: $discoveryDuration) {
                        Text("5 minutes").tag(TimeInterval(300))
                        Text("10 minutes").tag(TimeInterval(600))
                        Text("15 minutes").tag(TimeInterval(900))
                        Text("30 minutes").tag(TimeInterval(1800))
                    }
                    .foregroundStyle(MeshTheme.accent)
                    .tint(.primary)
                }
                .listRowBackground(MeshTheme.surface)

                Button {
                    if isTimedDiscovery { stopTimedDiscovery() }
                    startTimedDiscovery()
                } label: {
                    HStack {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .foregroundStyle(MeshTheme.accent)
                            .frame(width: 24)
                        (isTimedDiscovery ? Text("Restart Timed Discovery") : Text("Start Timed Discovery"))
                            .foregroundStyle(MeshTheme.accent)
                        Spacer()
                        if isTimedDiscovery {
                            Text(formatTimeRemaining(timeRemaining))
                                .font(.caption)
                                .foregroundStyle(MeshTheme.accent)
                                .monospacedDigit()
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(MeshTheme.surface)
            } header: {
                Text("Timed Discovery")
                    .foregroundStyle(MeshTheme.textSecondary)
            } footer: {
                Text("Sends periodic flood advertisements for the selected duration. Uses more battery and airtime than a single scan.")
                    .font(.caption2)
            }

            if remoteSessionManager.discoveredNodes.isEmpty {
                Section {
                    HStack {
                        Spacer()
                        VStack(spacing: 8) {
                            Image(systemName: "sensor.tag.radiowaves.forward")
                                .font(.system(size: 36))
                                .foregroundStyle(MeshTheme.textSecondary)
                            Text("No nodes discovered")
                                .font(.subheadline)
                                .foregroundStyle(MeshTheme.textSecondary)
                            Text("Tap Start Discover to scan the mesh")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        Spacer()
                    }
                    .listRowBackground(MeshTheme.surface)
                }
            } else {
                Section {
                    ForEach(remoteSessionManager.discoveredNodes) { node in
                        discoveredNodeRow(node)
                    }
                } header: {
                    Text("^[\(remoteSessionManager.discoveredNodes.count) node](inflect: true) Found")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
        }
        .meshListStyle()
        .navigationTitle("Discover")
    }

    private func discoveredNodeRow(_ node: DiscoveredNode) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(MeshTheme.accent.opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: iconName(for: node.type))
                    .foregroundStyle(MeshTheme.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(node.name.isEmpty ? "Unknown" : node.name)
                    .font(.body)
                    .foregroundStyle(MeshTheme.textPrimary)
                HStack(spacing: 8) {
                    Text(typeName(for: node.type))
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)
                    if node.pathLen == 0 {
                        Text("direct")
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.connected)
                    } else {
                        Text("^[\(node.pathLen) hop](inflect: true)")
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("SNR \(node.snr)")
                    .font(.caption2)
                    .foregroundStyle(snrColor(node.snr))
                Text("RSSI \(node.rssi)")
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .listRowBackground(MeshTheme.surface)
    }

    private func iconName(for type: ContactType) -> String {
        switch type {
        case .chat: return "person.fill"
        case .repeater: return "antenna.radiowaves.left.and.right"
        case .room: return "server.rack"
        case .sensor: return "sensor.fill"
        case .unknown: return "person.fill"
        }
    }

    private func typeName(for type: ContactType) -> String {
        switch type {
        case .chat: return "Chat"
        case .repeater: return "Repeater"
        case .room: return "Room"
        case .sensor: return "Sensor"
        case .unknown: return "Unknown"
        }
    }

    private func snrColor(_ snr: Int8) -> Color {
        if snr >= 5 { return MeshTheme.connected }
        if snr >= 0 { return .yellow }
        return .orange
    }

    private func startTimedDiscovery() {
        isTimedDiscovery = true
        timeRemaining = discoveryDuration
        remoteSessionManager.discoveredNodes = []
        DebugLogger.shared.log("DISCOVER: started \(Int(discoveryDuration / 60))min timed discovery", level: .info)
        connectionManager.sendAdvertise(type: 1) // Initial flood advert

        // Re-advertise every 30 seconds
        let cm = connectionManager
        advertTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
            Task { @MainActor in
                cm.sendAdvertise(type: 1)
            }
        }

        // Countdown timer
        discoveryTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            timeRemaining -= 1
            if timeRemaining <= 0 {
                stopTimedDiscovery()
            }
        }
    }

    private func stopTimedDiscovery() {
        advertTimer?.invalidate()
        discoveryTimer?.invalidate()
        advertTimer = nil
        discoveryTimer = nil
        isTimedDiscovery = false
        timeRemaining = 0
        DebugLogger.shared.log("DISCOVER: timed discovery stopped", level: .info)
    }

    private func formatTimeRemaining(_ seconds: TimeInterval) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - Trace Route Result View

struct TraceRouteResultView: View {
    let result: TraceResult
    let contactName: String
    @Environment(ContactStore.self) private var contactStore
    @Environment(ConnectionManager.self) private var connectionManager

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                    .foregroundStyle(MeshTheme.accent)
                Text("Trace Route to \(contactName)")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
            }

            if result.hops.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.right")
                        .foregroundStyle(MeshTheme.connected)
                    Text("Direct connection (no hops)")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            } else {
                VStack(spacing: 0) {
                    // Local device
                    traceNode(name: connectionManager.connectedDeviceName ?? String(localized: "Local"), isFirst: true, isLast: false, snr: nil)

                    ForEach(Array(result.hops.enumerated()), id: \.element.id) { index, hop in
                        traceLine(snr: hop.snr)
                        traceNode(
                            name: nodeName(for: hop.nodeHash),
                            isFirst: false,
                            isLast: index == result.hops.count - 1,
                            snr: nil
                        )
                    }
                }
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func traceNode(name: String, isFirst: Bool, isLast: Bool, snr: Int8?) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(isFirst ? MeshTheme.accent : (isLast ? MeshTheme.connected : MeshTheme.textSecondary))
                .frame(width: 10, height: 10)
            Text(name)
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textPrimary)
            Spacer()
        }
        .padding(.horizontal, 8)
    }

    private func traceLine(snr: Int8) -> some View {
        HStack(spacing: 8) {
            Rectangle()
                .fill(MeshTheme.textSecondary.opacity(0.6))
                .frame(width: 2, height: 20)
                .padding(.leading, 4)
            Text("SNR \(snr)")
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
            Spacer()
        }
        .padding(.horizontal, 8)
    }

    private func nodeName(for hash: Data) -> String {
        if let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == hash }) {
            return contactStore.displayName(for: contact)
        }
        return Data(hash.prefix(4)).hexFormatted(separator: ":")
    }
}

// MARK: - Status Info View

struct StatusInfoView: View {
    let status: RemoteStatusInfo
    let contactName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "info.circle")
                    .foregroundStyle(MeshTheme.accent)
                Text("Status: \(contactName)")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
            }

            VStack(spacing: 8) {
                statusRow(icon: "battery.50", label: "Battery", value: batteryString, color: MeshTheme.accent)
                statusRow(icon: "clock.arrow.circlepath", label: "Uptime", value: formatUptime(status.uptime))
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var batteryString: String {
        let mv = Int(status.batteryMV)
        if mv == 0 { return "\u{2014}" }
        return String(format: "%.2fV", Double(mv) / 1000.0)
    }

    private func statusRow(icon: String, label: LocalizedStringKey, value: String, color: Color = MeshTheme.accent) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 20)
            Text(label)
                .foregroundStyle(MeshTheme.textPrimary)
            Spacer()
            Text(value)
                .foregroundStyle(MeshTheme.textSecondary)
        }
    }

    private func batteryIconName(for pct: Int) -> String {
        if pct > 75 { return "battery.100" }
        if pct > 50 { return "battery.75" }
        if pct > 25 { return "battery.50" }
        if pct > 0 { return "battery.25" }
        return "battery.0"
    }

    private func batteryColor(for pct: Int) -> Color {
        if pct > 50 { return .green }
        if pct > 20 { return .yellow }
        return .red
    }
}

// MARK: - Telemetry View

struct TelemetryView: View {
    let readings: [TelemetryReading]
    let contactName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .foregroundStyle(MeshTheme.accent)
                Text("Telemetry: \(contactName)")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
            }

            if readings.isEmpty {
                Text("No telemetry data")
                    .foregroundStyle(MeshTheme.textSecondary)
            } else {
                VStack(spacing: 8) {
                    ForEach(readings) { reading in
                        HStack {
                            Image(systemName: telemetryIcon(for: reading.name))
                                .foregroundStyle(MeshTheme.accent)
                                .frame(width: 20)
                            Text(reading.name)
                                .foregroundStyle(MeshTheme.textPrimary)
                            Spacer()
                            if reading.name == "Altitude" {
                                Text(String(format: "%.0f m (%.0f ft)", reading.value, reading.value * 3.28084))
                                    .foregroundStyle(MeshTheme.textSecondary)
                                    .font(.system(.body, design: .monospaced))
                            } else {
                                Text(String(format: "%.1f %@", reading.value, reading.unit))
                                    .foregroundStyle(MeshTheme.textSecondary)
                                    .font(.system(.body, design: .monospaced))
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func telemetryIcon(for name: String) -> String {
        switch name.lowercased() {
        case "temperature": return "thermometer"
        case "humidity": return "humidity"
        case "pressure": return "barometer"
        case "battery": return "battery.75"
        case "illuminance": return "sun.max"
        case "altitude": return "arrow.up.to.line"
        case "gps lat", "gps lon": return "location"
        default: return "gauge"
        }
    }
}

// MARK: - Advert Path View

struct AdvertPathView: View {
    let pathInfo: AdvertPathInfo
    let contactName: String
    @Environment(ContactStore.self) private var contactStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "map")
                    .foregroundStyle(MeshTheme.accent)
                Text("Path: \(contactName)")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
            }

            VStack(spacing: 8) {
                HStack {
                    Text("Hops")
                        .foregroundStyle(MeshTheme.textPrimary)
                    Spacer()
                    Text("\(pathInfo.pathLen)")
                        .foregroundStyle(MeshTheme.textPrimary)
                }

                if pathInfo.recvTimestamp > 0 {
                    HStack {
                        Text("Received")
                            .foregroundStyle(MeshTheme.textPrimary)
                        Spacer()
                        Text(pathInfo.recvTimestamp.asDate, style: .relative)
                            .foregroundStyle(MeshTheme.textPrimary)
                        Text("ago")
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                }

                if !pathInfo.pathHashes.isEmpty {
                    Divider()
                    ForEach(Array(pathInfo.pathHashes.enumerated()), id: \.offset) { index, hash in
                        HStack(spacing: 8) {
                            Text("\(index + 1).")
                                .font(.caption)
                                .foregroundStyle(MeshTheme.textSecondary)
                                .frame(width: 20)
                            Text(nodeName(for: hash))
                                .font(.subheadline)
                                .foregroundStyle(MeshTheme.textPrimary)
                            Spacer()
                        }
                    }
                }
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func nodeName(for hash: Data) -> String {
        if let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix == hash }) {
            return contactStore.displayName(for: contact)
        }
        if hash.count < 6 {
            if let contact = contactStore.contacts.first(where: { $0.publicKeyPrefix.prefix(hash.count) == hash }) {
                return contactStore.displayName(for: contact)
            }
        }
        return Data(hash).hexFormatted(separator: ":")
    }
}
