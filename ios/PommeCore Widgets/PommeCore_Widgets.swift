//
//  PommeCore_Widgets.swift
//  PommeCore Widgets
//
//  Small: connection + battery + safe zones + unread count
//  Medium: small content + last message preview
//  Lock screen: circular (connection dot), rectangular (status summary), inline (unread)
//

import WidgetKit
import SwiftUI

// MARK: - Timeline Provider

struct PommeCoreEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
}

struct PommeCoreProvider: TimelineProvider {
    func placeholder(in context: Context) -> PommeCoreEntry {
        PommeCoreEntry(date: .now, state: placeholderState)
    }

    func getSnapshot(in context: Context, completion: @escaping (PommeCoreEntry) -> Void) {
        let state = context.isPreview ? placeholderState : WidgetState.load()
        completion(PommeCoreEntry(date: .now, state: state))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PommeCoreEntry>) -> Void) {
        let entry = PommeCoreEntry(date: .now, state: WidgetState.load())
        // Fallback refresh every 15 min; main app calls reloadAllTimelines on real changes
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: .now) ?? Date(timeIntervalSinceNow: 900)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private var placeholderState: WidgetState {
        var s = WidgetState()
        s.isConnected = true
        s.deviceName = "Mesh Pocket"
        s.batteryPct = 72
        s.unreadCount = 5
        s.unreadDMCount = 3
        s.unreadChannelCount = 2
        s.activeZoneCount = 2
        s.lastMessageSender = "MacBook"
        s.lastMessagePreview = "Hey, did you copy that frequency?"
        s.lastMessageDate = Date(timeIntervalSinceNow: -180)
        return s
    }
}

// MARK: - Status Row

private struct StatusRow: View {
    let icon: String
    let label: String
    var color: Color = .primary

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 14)
            Text(label)
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
        .font(.caption2)
    }
}

// MARK: - Connection Header

private struct ConnectionHeader: View {
    let state: WidgetState

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(state.isConnected ? Color.green : Color.red)
                .frame(width: 8, height: 8)
            Text(state.isConnected ? (state.deviceName.isEmpty ? "Connected" : state.deviceName) : "Disconnected")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
    }
}

// MARK: - Status Rows Content

private struct StatusContent: View {
    let state: WidgetState

    var body: some View {
        // Battery
        if state.batteryPct >= 0 {
            StatusRow(icon: batteryIcon, label: "\(state.batteryPct)%", color: batteryColor)
        }

        // Safe zones
        if let zoneName = state.alertZoneName {
            StatusRow(icon: "exclamationmark.shield.fill",
                      label: "Exited \(zoneName)",
                      color: .orange)
        } else if state.activeZoneCount > 0 {
            let zones = state.activeZoneCount == 1 ? "1 zone" : "\(state.activeZoneCount) zones"
            StatusRow(icon: "shield.fill", label: zones, color: .green)
        } else {
            StatusRow(icon: "shield", label: "No zones", color: .secondary)
        }

        // Unread DMs
        if state.unreadDMCount > 0 {
            StatusRow(icon: "person.fill",
                      label: "\(state.unreadDMCount) DM\(state.unreadDMCount == 1 ? "" : "s")",
                      color: .green)
        } else {
            StatusRow(icon: "person", label: "No DMs", color: .secondary)
        }

        // Unread channels
        if state.unreadChannelCount > 0 {
            StatusRow(icon: "antenna.radiowaves.left.and.right",
                      label: "\(state.unreadChannelCount) Ch",
                      color: .green)
        } else {
            StatusRow(icon: "antenna.radiowaves.left.and.right",
                      label: "No channels",
                      color: .secondary)
        }
    }

    private var batteryIcon: String {
        switch state.batteryPct {
        case 75...: return "battery.100"
        case 50...: return "battery.75"
        case 25...: return "battery.25"
        default:    return "battery.0"
        }
    }

    private var batteryColor: Color {
        switch state.batteryPct {
        case 50...: return .green
        case 20...: return .yellow
        default:    return .red
        }
    }
}

// MARK: - Small Widget View

private struct SmallWidgetView: View {
    let state: WidgetState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ConnectionHeader(state: state)
            Divider()
            StatusContent(state: state)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Medium Widget View

private struct MediumWidgetView: View {
    let state: WidgetState

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // Left: status (same as small)
            VStack(alignment: .leading, spacing: 6) {
                ConnectionHeader(state: state)
                Divider()
                StatusContent(state: state)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            Divider()
                .padding(.horizontal, 8)

            // Right: last message
            VStack(alignment: .leading, spacing: 4) {
                if let sender = state.lastMessageSender {
                    Text(sender)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if let preview = state.lastMessagePreview {
                        Text(preview)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(4)
                    }
                    Spacer(minLength: 0)
                    if let date = state.lastMessageDate {
                        Text(date, style: .relative)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                } else {
                    Text("No messages")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Lock Screen Views

private struct CircularLockView: View {
    let state: WidgetState

    var body: some View {
        ZStack {
            Circle()
                .fill(state.isConnected ? Color.green.opacity(0.2) : Color.red.opacity(0.2))
            VStack(spacing: 1) {
                Circle()
                    .fill(state.isConnected ? Color.green : Color.red)
                    .frame(width: 10, height: 10)
                if state.unreadCount > 0 {
                    Text("\(state.unreadCount)")
                        .font(.system(size: 11, weight: .bold))
                        .widgetAccentable()
                }
            }
        }
    }
}

private struct RectangularLockView: View {
    let state: WidgetState

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(state.isConnected ? Color.green : Color.red)
                .frame(width: 7, height: 7)
            Text(state.isConnected ? (state.deviceName.isEmpty ? "Connected" : state.deviceName) : "Disconnected")
                .font(.caption2)
                .fontWeight(.medium)
                .widgetAccentable()
            Spacer()
            if state.unreadCount > 0 {
                Label("\(state.unreadCount)", systemImage: "message.fill")
                    .font(.caption2)
                    .widgetAccentable()
            }
        }
        .lineLimit(1)
    }
}

private struct InlineLockView: View {
    let state: WidgetState

    var body: some View {
        if state.unreadCount > 0 {
            Label("\(state.unreadCount) unread", systemImage: "message.fill")
        } else if state.isConnected {
            Label(state.deviceName.isEmpty ? "Connected" : state.deviceName, systemImage: "dot.radiowaves.left.and.right")
        } else {
            Label("Disconnected", systemImage: "wifi.slash")
        }
    }
}

// MARK: - Split Lock Screen Views (DM vs Channel counts)

private struct CircularDMLockView: View {
    let state: WidgetState

    var body: some View {
        ZStack {
            Circle().fill(Color.green.opacity(0.15))
            VStack(spacing: 1) {
                Text(state.unreadDMCount > 99 ? "99+" : "\(state.unreadDMCount)")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .widgetAccentable()
                    .minimumScaleFactor(0.7)
                Text("DMs")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct CircularChannelLockView: View {
    let state: WidgetState

    var body: some View {
        ZStack {
            Circle().fill(Color.green.opacity(0.15))
            VStack(spacing: 1) {
                Text(state.unreadChannelCount > 99 ? "99+" : "\(state.unreadChannelCount)")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .widgetAccentable()
                    .minimumScaleFactor(0.7)
                Text("Chs")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct RectangularSplitLockView: View {
    let state: WidgetState

    var body: some View {
        HStack(spacing: 0) {
            Circle()
                .fill(state.isConnected ? Color.green : Color.red)
                .frame(width: 6, height: 6)
                .padding(.trailing, 4)
            Label("\(state.unreadDMCount)", systemImage: "person.fill")
                .font(.caption2.weight(.semibold))
                .widgetAccentable()
            Text("  ·  ")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Label("\(state.unreadChannelCount)", systemImage: "antenna.radiowaves.left.and.right")
                .font(.caption2.weight(.semibold))
                .widgetAccentable()
            Spacer()
        }
        .lineLimit(1)
    }
}

private struct InlineSplitLockView: View {
    let state: WidgetState

    var body: some View {
        if state.unreadDMCount > 0 || state.unreadChannelCount > 0 {
            Label("\(state.unreadDMCount) DM · \(state.unreadChannelCount) Ch",
                  systemImage: "message.fill")
        } else if state.isConnected {
            Label(state.deviceName.isEmpty ? "Connected" : state.deviceName,
                  systemImage: "dot.radiowaves.left.and.right")
        } else {
            Label("Disconnected", systemImage: "wifi.slash")
        }
    }
}

// MARK: - Split Widget Entry View

struct PommeCoreSplitEntryView: View {
    let entry: PommeCoreEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            CircularDMLockView(state: entry.state)
        case .accessoryRectangular:
            RectangularSplitLockView(state: entry.state)
        case .accessoryInline:
            InlineSplitLockView(state: entry.state)
        default:
            CircularDMLockView(state: entry.state)
        }
    }
}

// MARK: - Widget Entry View

struct PommeCoreWidgetEntryView: View {
    let entry: PommeCoreEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(state: entry.state)
        case .systemMedium:
            MediumWidgetView(state: entry.state)
        case .accessoryCircular:
            CircularLockView(state: entry.state)
        case .accessoryRectangular:
            RectangularLockView(state: entry.state)
        case .accessoryInline:
            InlineLockView(state: entry.state)
        default:
            SmallWidgetView(state: entry.state)
        }
    }
}

// MARK: - Widgets

struct PommeCoreStatusWidget: Widget {
    let kind = "PommeCoreStatus"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PommeCoreProvider()) { entry in
            PommeCoreWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("PommeCore Status")
        .description("Radio connection, battery, safe zones, and unread messages.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct PommeCoreLockWidget: Widget {
    let kind = "PommeCoreLock"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PommeCoreProvider()) { entry in
            PommeCoreWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("PommeCore")
        .description("Radio connection status and unread count on your lock screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct PommeCoreSplitWidget: Widget {
    let kind = "PommeCoreSplit"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PommeCoreProvider()) { entry in
            PommeCoreSplitEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("PommeCore Messages")
        .description("Separate DM and channel unread counts.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
