//
//  DebugLogView.swift
//  PommeCore
//
//  Debug log viewer with filtering, export, and auto-scroll.
//
//  Created by Michael P. Bedworth on 3/18/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit

struct DebugLogView: View {
    @ObservedObject var logger = DebugLogger.shared
    @State private var filterLevel: DebugLogger.LogEntry.Level?
    @State private var searchText = ""
    @State private var showCopied = false

    private var filteredEntries: [DebugLogger.LogEntry] {
        var result = logger.entries
        if let level = filterLevel {
            result = result.filter { $0.level == level }
        }
        if !searchText.isEmpty {
            result = result.filter { $0.message.localizedCaseInsensitiveContains(searchText) }
        }
        return result
    }

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            logList
        }
        .navigationTitle("Debug Log")
        #if !os(watchOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        copyAll()
                    } label: {
                        Label("Copy All", systemImage: "doc.on.doc")
                    }
                    Button(role: .destructive) {
                        logger.clear()
                    } label: {
                        Label("Clear Log", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        #endif
        .overlay {
            if showCopied {
                copiedToast
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(label: "All", isSelected: filterLevel == nil) {
                    filterLevel = nil
                }
                FilterChip(label: "TX", isSelected: filterLevel == .tx) {
                    filterLevel = .tx
                }
                FilterChip(label: "RX", isSelected: filterLevel == .rx) {
                    filterLevel = .rx
                }
                FilterChip(label: "Error", isSelected: filterLevel == .error) {
                    filterLevel = .error
                }
                FilterChip(label: "Warn", isSelected: filterLevel == .warning) {
                    filterLevel = .warning
                }
                FilterChip(label: "Info", isSelected: filterLevel == .info) {
                    filterLevel = .info
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    private var logList: some View {
        Group {
            if filteredEntries.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "text.alignleft")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No log entries")
                        .foregroundStyle(.secondary)
                    Text("Protocol operations will appear here")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    List(filteredEntries) { entry in
                        logRow(entry)
                            .id(entry.id)
                    }
                    .listStyle(.plain)
                    .onChange(of: logger.entries.count) {
                        if let last = filteredEntries.last {
                            withAnimation {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    }
                }
            }
        }
    }

    private func logRow(_ entry: DebugLogger.LogEntry) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(levelIcon(entry.level))
                .font(.caption)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(entry.message)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(levelColor(entry.level))
                    #if !os(watchOS)
                    .textSelection(.enabled)
                    #endif
            }
        }
        .padding(.vertical, 2)
    }

    private func levelIcon(_ level: DebugLogger.LogEntry.Level) -> String {
        switch level {
        case .tx: return "^"
        case .rx: return "v"
        case .error: return "X"
        case .warning: return "!"
        case .info: return "-"
        }
    }

    private func levelColor(_ level: DebugLogger.LogEntry.Level) -> Color {
        switch level {
        case .tx: return .blue
        case .rx: return .green
        case .error: return .red
        case .warning: return .orange
        case .info: return .primary
        }
    }

    private func copyAll() {
        let text = logger.exportText()
        copyToClipboard(text)
        withAnimation {
            showCopied = true
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            withAnimation {
                showCopied = false
            }
        }
    }

    private var copiedToast: some View {
        Text("Copied to clipboard")
            .font(.caption)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
            .transition(.opacity.combined(with: .move(edge: .bottom)))
            .frame(maxHeight: .infinity, alignment: .bottom)
            .padding(.bottom, 20)
    }
}

private struct FilterChip: View {
    let label: LocalizedStringKey
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption)
                .fontWeight(isSelected ? .semibold : .regular)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.1))
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
