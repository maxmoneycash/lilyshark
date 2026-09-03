//
//  ContactRowView.swift
//  PommeCore
//
//  Single contact row: name, status indicator, path, last seen, unread badge.
//
//  Created by Michael P. Bedworth on 3/29/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

/// A single contact row in the sidebar — displays name, status, path, last message, unread badge.
struct ContactRowView: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(RemoteSessionManager.self) private var remoteSessionManager

    /// Passed from parent list — ticks every 30s to refresh relative time text.
    var refreshTick: Date = Date()

    var body: some View {
        HStack(spacing: 12) {
            contactIcon
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(contactStore.displayName(for: contact))
                        .font(.body)
                        .foregroundStyle(MeshTheme.textPrimary)
                    loginBadge
                    pathIndicator
                }
                if contactStore.nickname(for: contact) != nil, !contact.name.isEmpty {
                    Text(contact.name)
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                lastSeenLine
            }
            Spacer()
            if messageStoreManager.hasDraft(for: contact.publicKeyPrefix) {
                Text("Draft")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            if contactStore.isContactMuted(contact) {
                Image(systemName: "bell.slash")
                    .foregroundStyle(MeshTheme.textSecondary)
                    .font(.caption)
                    .accessibilityLabel("Muted")
            }
            if contactStore.hasNote(for: contact) {
                Image(systemName: "note.text")
                    .foregroundStyle(MeshTheme.textSecondary)
                    .font(.caption)
                    .accessibilityLabel("Has notes")
            }
            if contact.isFavourite {
                Image(systemName: "star.fill")
                    .foregroundStyle(.yellow)
                    .font(.caption)
                    .accessibilityLabel("Favourite")
            }
            unreadBadge
        }
        .contentShape(Rectangle())
        // Collapse the row into a single VoiceOver element so name, status,
        // path, flags, and unread count are announced together (one swipe).
        .accessibilityElement(children: .combine)
    }

    // MARK: - Sub-views

    @ViewBuilder
    private var contactIcon: some View {
        let isManaged = contact.type == .repeater || contact.type == .room
        let session = isManaged ? remoteSessionManager.remoteSession(for: contact) : nil
        let loggedIn: Bool = {
            guard let s = session else { return false }
            if case .loggedIn = s.loginState { return true }
            return false
        }()

        let liveContact = contactStore.contacts.first(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) ?? contact
        let statusColor = contactStore.contactStatusColor(for: liveContact)
        let statusLabel = contactStore.contactStatusLabel(for: liveContact)
        ZStack {
            Circle()
                .fill(statusColor.opacity(0.15))
                .frame(width: 40, height: 40)
            Image(systemName: iconName(for: contact.type))
                .foregroundStyle(statusColor)

            if isManaged {
                if loggedIn {
                    Image(systemName: "lock.open.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(MeshTheme.connected)
                        .offset(x: 14, y: 14)
                } else if KeychainManager.hasPassword(forDevice: contact.publicKey) {
                    Image(systemName: "key.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(MeshTheme.textSecondary)
                        .offset(x: 14, y: 14)
                } else {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(MeshTheme.textSecondary)
                        .offset(x: 14, y: 14)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(contact.type.displayName), \(statusLabel)\(loggedIn ? ", logged in" : "")")
    }

    @ViewBuilder
    private var loginBadge: some View {
        if contact.type == .repeater || contact.type == .room {
            let session = remoteSessionManager.remoteSession(for: contact)
            switch session.loginState {
            case .loggedIn(let permission):
                Text(permission.displayName)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(permissionBadgeColor(permission).opacity(0.8))
                    .clipShape(Capsule())
            default:
                EmptyView()
            }
        }
    }

    @ViewBuilder
    private var pathIndicator: some View {
        if contact.outPathLen == 0 {
            Text("direct")
                .font(.caption2)
                .foregroundStyle(MeshTheme.connected)
        } else if contact.outPathLen > 0 {
            let pathStr = formatPathHashes(contact.outPath, hopCount: Int(contact.outPathLen))
            if pathStr.isEmpty {
                Text("^[\(contact.outPathLen) hop](inflect: true)")
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.textSecondary)
            } else {
                Text(pathStr)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(MeshTheme.textSecondary)
                    .lineLimit(1)
            }
        }
    }

    @ViewBuilder
    private var lastSeenLine: some View {
        if (contact.type == .repeater || contact.type == .room),
           case .loggedIn(let permission) = remoteSessionManager.remoteSession(for: contact).loginState {
            let session = remoteSessionManager.remoteSession(for: contact)
            if let ver = session.settings["ver"], !ver.isEmpty {
                Text("Connected \u{2014} \(permission.displayName) \u{00B7} \(ver)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.connected)
                    .lineLimit(1)
            } else {
                Text("Connected \u{2014} \(permission.displayName)")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.connected)
            }
        } else if let seenText = lastSeenText {
            Text(seenText)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        } else {
            Text("Never seen")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }

        // Infrastructure status summary (battery, uptime, contacts)
        if (contact.type == .repeater || contact.type == .room || contact.type == .sensor),
           let status = remoteSessionManager.statusByContact[contact.publicKeyPrefix] {
            HStack(spacing: 8) {
                if status.batteryMV > 0 {
                    Label(String(format: "%.2fV", Double(status.batteryMV) / 1000.0), systemImage: "battery.50")
                        .foregroundStyle(MeshTheme.accent)
                }
                Label(formatUptime(status.uptime), systemImage: "clock")
            }
            .font(.caption2)
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

    @ViewBuilder
    private var unreadBadge: some View {
        let count = messageStoreManager.unreadCount(for: contact)
        if count > 0 {
            Text("\(count)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.black)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(MeshTheme.interactiveGreen)
                .clipShape(Capsule())
                .accessibilityLabel("^[\(count) unread message](inflect: true)")
        }
    }

    // MARK: - Helpers

    private var lastSeenText: String? {
        // Reference refreshTick so this recomputes every 30s for relative time updates
        _ = refreshTick
        // Read live contact from store to pick up in-place lastAdvert updates
        let liveContact = contactStore.contacts.first(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) ?? contact
        var latest = TimeInterval(liveContact.lastAdvert)
        // Also consider last received message as a "seen" event
        if let activityDate = messageStoreManager.latestActivityDate(for: contact.publicKeyPrefix) {
            latest = max(latest, activityDate.timeIntervalSince1970)
        }
        guard latest > 1_000_000_000 else { return nil }
        let date = Date(timeIntervalSince1970: latest)
        let now = Date()
        if now.timeIntervalSince(date) > 365 * 24 * 60 * 60 { return nil }
        if date > now.addingTimeInterval(300) { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return "Seen \(formatter.localizedString(for: date, relativeTo: now))"
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

    private func formatPathHashes(_ pathData: Data, hopCount: Int) -> String {
        guard !pathData.isEmpty, hopCount > 0 else { return "" }
        let bytesPerHop = pathData.count / hopCount
        guard bytesPerHop >= 1 && bytesPerHop <= 3 else { return "" }
        var hops: [String] = []
        for i in 0..<hopCount {
            let start = i * bytesPerHop
            let end = min(start + bytesPerHop, pathData.count)
            guard end <= pathData.count else { break }
            let hash = pathData[start..<end]
            let hexStr = Data(hash).hexCompact.uppercased()
            if let name = contactStore.contactNameForHash(hexStr) {
                hops.append(name)
            } else {
                hops.append(hexStr)
            }
        }
        return hops.joined(separator: " \u{2192} ")
    }

    private func permissionBadgeColor(_ permission: RemotePermission) -> Color {
        switch permission {
        case .guest: return MeshTheme.textSecondary
        case .readOnly: return .yellow
        case .readWrite: return .blue
        case .admin: return MeshTheme.interactiveGreen
        }
    }
}
