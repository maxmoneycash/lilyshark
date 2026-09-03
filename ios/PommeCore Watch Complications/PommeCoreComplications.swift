//
//  PommeCoreComplications.swift
//  PommeCore Watch Complications
//
//  Created by Michael P. Bedworth on 05/19/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import WidgetKit
import SwiftUI
import PommeCoreWatchKit

// MARK: - Timeline

struct WatchEntry: TimelineEntry {
    let date: Date
    let state: WatchWidgetState
}

struct WatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry {
        WatchEntry(date: .now, state: placeholderState)
    }

    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) {
        let state = context.isPreview ? placeholderState : WatchWidgetState.load()
        completion(WatchEntry(date: .now, state: state))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        let entry = WatchEntry(date: .now, state: WatchWidgetState.load())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: .now) ?? Date(timeIntervalSinceNow: 900)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private var placeholderState: WatchWidgetState {
        WatchWidgetState(isConnected: true, deviceName: "Mesh Pocket", unreadDMCount: 3, unreadChannelCount: 2)
    }
}

// MARK: - Circular view (two-row DM / PC)

private struct CircularView: View {
    let state: WatchWidgetState

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            countRow(label: "DM:", value: state.unreadDMCount)
            countRow(label: "PC:", value: state.unreadChannelCount)
        }
        .padding(4)
    }

    private func countRow(label: LocalizedStringKey, value: Int) -> some View {
        HStack(spacing: 4) {
            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.red)
                .fixedSize()
            Text(value > 99 ? "99+" : "\(value)")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.7)
        }
    }
}

// MARK: - Rectangular view (hearing-aid L/R split)

private struct RectangularView: View {
    let state: WatchWidgetState

    var body: some View {
        HStack(spacing: 0) {
            column(
                icon: "person.fill",
                label: "DM",
                value: state.unreadDMCount
            )
            Divider()
                .padding(.vertical, 4)
            column(
                icon: "antenna.radiowaves.left.and.right",
                label: "PC",
                value: state.unreadChannelCount
            )
            Spacer()
        }
    }

    private func column(icon: String, label: LocalizedStringKey, value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.red)
                Text(label)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.red)
            }
            Text(value > 99 ? "99+" : "\(value)")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.6)
        }
        .frame(minWidth: 56, alignment: .leading)
        .padding(.horizontal, 8)
    }
}

// MARK: - Inline view

private struct InlineView: View {
    let state: WatchWidgetState

    var body: some View {
        if state.unreadDMCount > 0 || state.unreadChannelCount > 0 {
            Label("DM:\(state.unreadDMCount)  PC:\(state.unreadChannelCount)",
                  systemImage: "message.fill")
        } else if state.isConnected {
            Label(state.deviceName.isEmpty ? "Connected" : state.deviceName,
                  systemImage: "dot.radiowaves.left.and.right")
        } else {
            Label("Disconnected", systemImage: "wifi.slash")
        }
    }
}

// MARK: - Entry views

struct CircularEntryView: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular: CircularView(state: entry.state)
        case .accessoryInline:   InlineView(state: entry.state)
        default:                 CircularView(state: entry.state)
        }
    }
}

struct SplitEntryView: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryRectangular: RectangularView(state: entry.state)
        case .accessoryInline:      InlineView(state: entry.state)
        default:                    RectangularView(state: entry.state)
        }
    }
}

// MARK: - Complications

struct PommeCoreCircularComplication: Widget {
    let kind = "PommeCoreCircularComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchProvider()) { entry in
            CircularEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("PommeCore")
        .description("DM and public channel unread counts.")
        .supportedFamilies([.accessoryCircular, .accessoryInline])
    }
}

struct PommeCoreSplitComplication: Widget {
    let kind = "PommeCoreSplitComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchProvider()) { entry in
            SplitEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("PommeCore Messages")
        .description("DM and public channel counts side by side.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Bundle

@main
struct PommeCoreComplicationsBundle: WidgetBundle {
    var body: some Widget {
        PommeCoreCircularComplication()
        PommeCoreSplitComplication()
    }
}
