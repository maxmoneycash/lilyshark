//
//  DebugLogger.swift
//  MeshCoreKit
//
//  Debug log viewer with filtering, export, and auto-scroll.
//
//  Created by Michael P. Bedworth on 3/18/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import Combine

/// In-app debug logger for TestFlight debugging without Xcode.
/// Captures protocol operations and makes them viewable in a log viewer.
public final class DebugLogger: ObservableObject {
    public static let shared = DebugLogger()

    @Published public var entries: [LogEntry] = []
    private let maxEntries = 500
    private let queue = DispatchQueue(label: "com.meshcore.debuglogger")

    public struct LogEntry: Identifiable, Sendable {
        public let id = UUID()
        public let timestamp: Date
        public let message: String
        public let level: Level

        public enum Level: String, Sendable {
            case info = "INFO"
            case warning = "WARN"
            case error = "ERR"
            case tx = "TX"
            case rx = "RX"
        }
    }

    private init() {}

    public func log(_ message: String, level: LogEntry.Level = .info) {
        let entry = LogEntry(timestamp: Date(), message: message, level: level)
        Task { @MainActor in
            self.entries.append(entry)
            if self.entries.count > self.maxEntries {
                self.entries.removeFirst(self.entries.count - self.maxEntries)
            }
        }
    }

    @MainActor
    public func clear() {
        entries.removeAll()
    }

    /// All log entries formatted as text for copying/sharing.
    @MainActor
    public func exportText() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return entries.map { entry in
            "[\(formatter.string(from: entry.timestamp))] [\(entry.level.rawValue)] \(entry.message)"
        }.joined(separator: "\n")
    }
}
