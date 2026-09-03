//
//  NetworkToolsView+Device.swift
//  PommeCore
//
//  Device info, activity overlay, path viewer, manual path editor, and ping results.
//
//  Created by Michael P. Bedworth on 3/14/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

// MARK: - Device Info Popover

/// Shows basic info about the currently connected device.
struct DeviceInfoPopover: View {
    @Environment(DeviceConfig.self) private var config
    @Environment(ContactStore.self) private var contactStore
    @Environment(ChannelStore.self) private var channelStore
    @Environment(ConnectionManager.self) private var connectionManager

    var body: some View {
        List {
            Section {
                infoRow("Device", value: connectionManager.connectedDeviceName ?? "Unknown")
                if !config.deviceName.isEmpty {
                    infoRow("Advert Name", value: config.deviceName)
                }
                if !config.semanticVersion.isEmpty {
                    infoRow("Firmware", value: config.semanticVersion)
                } else if !config.firmwareVersion.isEmpty {
                    infoRow("Firmware", value: config.firmwareVersion)
                }
                if !config.manufacturer.isEmpty {
                    infoRow("Model", value: config.manufacturer)
                }
            } header: {
                Text("Device").foregroundStyle(MeshTheme.textSecondary)
            }

            Section {
                if config.batteryMillivolts > 0 {
                    infoRow("Battery", value: String(format: "%.2fV (%d%%)", config.batteryVoltage, config.batteryPercent()))
                }
                if config.statsUptime > 0 {
                    infoRow("Uptime", value: formatUptime(config.statsUptime))
                }
                if config.statsLastRSSI != 0 {
                    infoRow("Last RSSI", value: "\(config.statsLastRSSI) dBm")
                }
                if config.statsLastSNR != 0 {
                    infoRow("Last SNR", value: formatSNR(config.statsLastSNR))
                }
            } header: {
                Text("Status").foregroundStyle(MeshTheme.textSecondary)
            }

            Section {
                infoRow("Frequency", value: String(format: "%.3f MHz", config.frequencyMHz))
                infoRow("TX Power", value: "\(config.radioTXPower) dBm")
                infoRow("SF/BW", value: "SF\(config.radioSpreadingFactor) / \(Int(config.bandwidthKHz)) kHz")
                infoRow("Contacts", value: "\(contactStore.contacts.count) / \(config.maxContacts)")
                infoRow("Channels", value: "\(channelStore.channels.count) / \(config.maxChannels)")
            } header: {
                Text("Radio").foregroundStyle(MeshTheme.textSecondary)
            }

            Section {
                Button(role: .destructive) {
                    connectionManager.bleManager.disconnect()
                } label: {
                    HStack {
                        Image(systemName: "wifi.slash")
                        Text("Disconnect")
                        Spacer()
                    }
                    .foregroundStyle(.red)
                }
                .listRowBackground(MeshTheme.surface)
            }
        }
        .meshListStyle()
        .navigationTitle("Device Info")
    }

    private func infoRow(_ label: LocalizedStringKey, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(MeshTheme.accent)
            Spacer()
            Text(value)
                .foregroundStyle(MeshTheme.textPrimary)
        }
        .listRowBackground(MeshTheme.surface)
    }

}

// MARK: - Activity Overlay

/// Reusable activity indicator with message and elapsed time counter.
struct ActivityOverlay: View {
    let message: String
    let timeout: TimeInterval
    @State private var elapsed: TimeInterval = 0
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
                .controlSize(.small)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)
            Spacer()
            Text("\(Int(elapsed))s / \(Int(timeout))s")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .onAppear { elapsed = 0 }
        .onReceive(timer) { _ in
            if elapsed < timeout { elapsed += 1 }
        }
    }
}

// MARK: - Path Viewer

struct PathViewer: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                    .foregroundStyle(MeshTheme.accent)
                Text("Routing Path")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
            }

            if contact.outPathLen == 0 {
                Label("Direct neighbor (0 hops)", systemImage: "arrow.right")
                    .foregroundStyle(MeshTheme.connected)
            } else if contact.outPathLen < 0 {
                Label("No known path \u{2014} messages will flood", systemImage: "antenna.radiowaves.left.and.right")
                    .foregroundStyle(.orange)
            } else {
                let hops = parsePathHops(from: contact.outPath, pathLen: Int(contact.outPathLen))

                // Visual path
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        pathNode(String(localized: "You"), color: MeshTheme.interactiveGreen)
                        ForEach(Array(hops.enumerated()), id: \.offset) { _, hop in
                            Image(systemName: "arrow.right")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                            pathNode(hop, color: MeshTheme.surfaceLight)
                        }
                        Image(systemName: "arrow.right")
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.textSecondary)
                        pathNode(contactStore.displayName(for: contact), color: MeshTheme.incomingBubble)
                    }
                }

                Text("^[\(hops.count) hop](inflect: true)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func pathNode(_ label: String, color: Color) -> some View {
        Text(verbatim: label)
            .font(.system(.caption, design: .monospaced))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(MeshTheme.textPrimary)
    }

    private func parsePathHops(from pathData: Data, pathLen: Int) -> [String] {
        guard !pathData.isEmpty, pathLen > 0 else { return [] }
        let bytesPerHop = max(1, min(3, pathData.count / pathLen))
        var hops: [String] = []
        for i in 0..<pathLen {
            let start = i * bytesPerHop
            let end = min(start + bytesPerHop, pathData.count)
            guard end <= pathData.count else { break }
            let hashBytes = Data(pathData[start..<end])
            if let name = resolvePathHash(hashBytes) {
                hops.append(name)
            } else {
                hops.append(Data(hashBytes).hexCompact.uppercased())
            }
        }
        return hops
    }

    private func resolvePathHash(_ hashBytes: Data) -> String? {
        for c in contactStore.contacts where c.type == .repeater {
            if c.publicKeyPrefix.prefix(hashBytes.count) == hashBytes {
                return contactStore.displayName(for: c)
            }
        }
        return nil
    }
}

// MARK: - Manual Path Editor

struct ManualPathEditor: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(\.dismiss) private var dismiss
    @State private var pathMode = 0 // 0=auto, 1=flood, 2=manual
    @State private var selectedRepeaters: [Contact] = []
    @State private var manualPathHex = ""
    @State private var pathApplied = false

    private var repeaters: [Contact] {
        contactStore.contacts.filter { $0.type == .repeater }
    }

    var body: some View {
        NavigationStack {
            Form {
                modePickerSection
                if pathMode == 2 {
                    repeaterSelectionSection
                    pathOrderSection
                    manualHexSection
                }
            }
            .navigationTitle("Edit Path")
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(pathApplied ? "Done" : "Apply") {
                        if pathApplied {
                            dismiss()
                        } else {
                            applyPath()
                            pathApplied = true
                            // Auto-dismiss after a brief delay so user sees confirmation
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { dismiss() }
                        }
                    }
                    .foregroundStyle(pathApplied ? MeshTheme.connected : MeshTheme.accent)
                }
            }
            .onAppear {
                // Initialize mode from current contact state
                if contact.outPathLen < 0 {
                    pathMode = 1 // Flood
                } else if contact.outPathLen > 0 {
                    pathMode = 2 // Manual
                } else {
                    pathMode = 0 // Auto/Direct
                }
            }
        }
    }

    private var modePickerSection: some View {
        Section {
            Picker("Routing Mode", selection: $pathMode) {
                Text("Auto (device discovers path)").tag(0)
                Text("Flood (broadcast to all)").tag(1)
                Text("Manual (select repeaters)").tag(2)
            }
            .pickerStyle(.inline)
            .tint(.primary)
        }
    }

    private var repeaterSelectionSection: some View {
        Section("Select Repeaters") {
            if repeaters.isEmpty {
                Text("No repeaters discovered")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            ForEach(repeaters) { repeater in
                let isSelected = selectedRepeaters.contains(where: { $0.publicKey == repeater.publicKey })
                Button { toggleRepeater(repeater) } label: {
                    HStack {
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(isSelected ? MeshTheme.accent : MeshTheme.textSecondary)
                        Text(contactStore.displayName(for: repeater))
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var pathOrderSection: some View {
        if !selectedRepeaters.isEmpty {
            Section("Path Order") {
                ForEach(Array(selectedRepeaters.enumerated()), id: \.element.publicKey) { idx, rep in
                    HStack {
                        Text("\(idx + 1).")
                            .foregroundStyle(MeshTheme.textSecondary)
                        Text(contactStore.displayName(for: rep))
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                }
                .onMove { from, to in
                    selectedRepeaters.move(fromOffsets: from, toOffset: to)
                }
            }
        }
    }

    private var manualHexSection: some View {
        Section {
            TextField("Hex hops (e.g., A3,B7,4F)", text: $manualPathHex)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(MeshTheme.textPrimary)
        } header: {
            Text("Or Enter Path Manually")
        } footer: {
            Text("Enter repeater hashes separated by commas.")
                .font(.caption2)
        }
    }

    private func toggleRepeater(_ repeater: Contact) {
        if let idx = selectedRepeaters.firstIndex(where: { $0.publicKey == repeater.publicKey }) {
            selectedRepeaters.remove(at: idx)
        } else {
            selectedRepeaters.append(repeater)
        }
    }

    private func applyPath() {
        switch pathMode {
        case 1: // Flood
            contactStore.setContactPath(contact, pathLen: -1, pathData: Data())
        case 2: // Manual
            if !selectedRepeaters.isEmpty {
                var pathData = Data()
                for rep in selectedRepeaters {
                    pathData.append(rep.publicKeyPrefix.prefix(1)) // 1-byte hash
                }
                contactStore.setContactPath(contact, pathLen: Int8(selectedRepeaters.count), pathData: pathData)
            } else if !manualPathHex.isEmpty {
                let hexParts = manualPathHex.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                var pathData = Data()
                for hex in hexParts {
                    var bytes = Data()
                    var chars = hex[hex.startIndex...]
                    while chars.count >= 2 {
                        if let byte = UInt8(String(chars.prefix(2)), radix: 16) {
                            bytes.append(byte)
                        }
                        chars = chars.dropFirst(2)
                    }
                    pathData.append(bytes)
                }
                contactStore.setContactPath(contact, pathLen: Int8(hexParts.count), pathData: pathData)
            }
        default: // Auto — reset path so device rediscovers
            contactStore.resetPath(for: contact)
        }
    }
}

// MARK: - Ping Results View

struct PingResultsView: View {
    let results: [RemoteSessionManager.PingResult]
    let stats: (sent: Int, received: Int, avgMs: Double, minMs: Double, maxMs: Double)?
    let isPinging: Bool
    let current: Int
    let total: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "bolt.horizontal")
                    .foregroundStyle(MeshTheme.accent)
                (isPinging ? Text("Ping \(current)/\(total)") : Text("Ping Results"))
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
                if isPinging {
                    ProgressView()
                        .scaleEffect(0.7)
                }
            }

            ForEach(results) { result in
                HStack {
                    Text("seq=\(result.seq)")
                        .font(.caption.monospaced())
                        .foregroundStyle(MeshTheme.textSecondary)
                        .frame(width: 50, alignment: .leading)
                    if let ms = result.latencyMs {
                        Text(String(format: "%.0f ms", ms))
                            .font(.caption.monospaced().weight(.medium))
                            .foregroundStyle(ms < 5000 ? .green : ms < 15000 ? .orange : .red)
                        if result.hops > 0 {
                            Text("^[\(result.hops) hop](inflect: true)")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    } else {
                        Text("timeout")
                            .font(.caption.monospaced())
                            .foregroundStyle(.red)
                    }
                }
            }

            if let stats, !isPinging {
                Divider()
                HStack(spacing: 16) {
                    statLabel("Sent", value: "\(stats.sent)")
                    statLabel("Recv", value: "\(stats.received)")
                    statLabel("Loss", value: String(format: "%.0f%%", stats.sent > 0 ? Double(stats.sent - stats.received) / Double(stats.sent) * 100 : 0))
                    statLabel("Avg", value: String(format: "%.0f ms", stats.avgMs))
                    statLabel("Min", value: String(format: "%.0f ms", stats.minMs))
                    statLabel("Max", value: String(format: "%.0f ms", stats.maxMs))
                }
            }
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func statLabel(_ label: LocalizedStringKey, value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
            Text(value)
                .font(.caption.monospaced().weight(.medium))
                .foregroundStyle(MeshTheme.textPrimary)
        }
    }
}

// MARK: - Path Discovery Result View

struct PathDiscoveryResultView: View {
    let result: PathDiscoveryResult
    let contactName: String
    @Environment(ContactStore.self) private var contactStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "arrow.triangle.branch")
                    .foregroundStyle(MeshTheme.accent)
                Text("Path Discovery")
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
                Spacer()
                Text(result.timestamp, style: .time)
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }

            directionRow(
                label: "To \(contactName)",
                pathLen: result.outPathLen,
                pathBytes: result.outPathBytes,
                fromLabel: String(localized: "You"),
                toLabel: contactName
            )

            directionRow(
                label: "From \(contactName)",
                pathLen: result.inPathLen,
                pathBytes: result.inPathBytes,
                fromLabel: contactName,
                toLabel: String(localized: "You")
            )
        }
        .padding()
        .background(MeshTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func directionRow(label: String, pathLen: UInt8, pathBytes: Data, fromLabel: String, toLabel: String) -> some View {
        let hopCount = Int(pathLen & 0x3F)
        let hashSize = Int((pathLen >> 6) + 1)
        let hops = resolveHops(pathBytes: pathBytes, hopCount: hopCount, hashSize: hashSize)

        return VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: label)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)

            if pathLen == 0xFF || (pathLen == 0 && pathBytes.isEmpty && hopCount == 0) {
                Label("Flood route", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            } else if hopCount == 0 {
                Label("Direct (\(fromLabel) \u{2192} \(toLabel))", systemImage: "arrow.right")
                    .font(.subheadline)
                    .foregroundStyle(.green)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        pathNode(fromLabel, color: MeshTheme.interactiveGreen)
                        ForEach(Array(hops.enumerated()), id: \.offset) { _, hop in
                            Image(systemName: "arrow.right").font(.caption2).foregroundStyle(MeshTheme.textSecondary)
                            pathNode(hop, color: MeshTheme.surfaceLight)
                        }
                        Image(systemName: "arrow.right").font(.caption2).foregroundStyle(MeshTheme.textSecondary)
                        pathNode(toLabel, color: MeshTheme.incomingBubble)
                    }
                }
                Text("^[\(hopCount) hop](inflect: true)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
            }
        }
    }

    private func pathNode(_ label: String, color: Color) -> some View {
        Text(verbatim: label)
            .font(.system(.caption, design: .monospaced))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(MeshTheme.textPrimary)
    }

    private func resolveHops(pathBytes: Data, hopCount: Int, hashSize: Int) -> [String] {
        guard !pathBytes.isEmpty, hopCount > 0 else { return [] }
        return (0..<hopCount).compactMap { i in
            let start = i * hashSize
            let end = min(start + hashSize, pathBytes.count)
            guard end <= pathBytes.count else { return nil }
            let hash = Data(pathBytes[start..<end])
            for c in contactStore.contacts where c.type == .repeater {
                if c.publicKeyPrefix.prefix(hashSize) == hash { return contactStore.displayName(for: c) }
            }
            return hash.hexCompact.uppercased()
        }
    }
}
