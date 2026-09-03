//
//  RemoteDeviceSession.swift
//  MeshCoreKit
//
//  Remote admin session state: login, permissions, CLI settings cache.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// Permission levels for remote device management.
public enum RemotePermission: Int, Comparable, Sendable {
    case guest = 0
    case readOnly = 1
    case readWrite = 2
    case admin = 3

    public var displayName: String {
        switch self {
        case .guest: return String(localized: "Guest")
        case .readOnly: return String(localized: "Read Only")
        case .readWrite: return String(localized: "Editor")
        case .admin: return String(localized: "Admin")
        }
    }

    public var isAdmin: Bool { self == .admin }
    public var canEdit: Bool { self >= .readWrite }
    public var canRead: Bool { self >= .readOnly }
    public var canPost: Bool { self >= .readWrite }

    public static func < (lhs: RemotePermission, rhs: RemotePermission) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// Login state for a remote device management session.
public enum RemoteLoginState: Sendable {
    case notLoggedIn
    case loggingIn
    case loggedIn(permission: RemotePermission)
    case loginFailed(message: String)
}

/// A single CLI command/response interaction.
public struct CLIInteraction: Identifiable, Sendable {
    public let id = UUID()
    public let command: String
    public let timestamp: Date
    public var response: String?
    public var isComplete: Bool { response != nil }

    public init(command: String, timestamp: Date = Date(), response: String? = nil) {
        self.command = command
        self.timestamp = timestamp
        self.response = response
    }
}

/// Tracks a remote management session with a repeater or room server.
@MainActor
public final class RemoteDeviceSession: ObservableObject {
    /// The contact being managed.
    public let contact: Contact

    /// Current login state.
    @Published public var loginState: RemoteLoginState = .notLoggedIn

    /// CLI interaction history (command + response pairs).
    @Published public var cliHistory: [CLIInteraction] = []

    /// Parsed setting values from CLI "get" responses.
    @Published public var settings: [String: String] = [:]

    /// Whether we're waiting for a CLI response.
    @Published public var isWaitingForResponse = false

    /// Whether initial settings are being fetched after login.
    @Published public var isFetchingSettings = false

    /// Whether full settings have been fetched at least once this session.
    public var hasLoadedFullSettings = false

    /// Tracks which setting sections have been fetched (on-demand loading).
    @Published public var fetchedSections: Set<String> = []

    /// Section currently being fetched.
    @Published public var fetchingSection: String?

    /// Total number of settings commands sent during auto-fetch.
    @Published public var fetchTotalCount = 0

    /// Number of settings responses received during auto-fetch.
    @Published public var fetchReceivedCount = 0

    /// Whether there are pending CLI commands awaiting responses.
    public var hasPendingCLICommands: Bool {
        cliHistory.contains(where: { !$0.isComplete })
    }

    /// Number of pending (unanswered) CLI commands.
    public var pendingCommandCount: Int {
        cliHistory.filter({ !$0.isComplete }).count
    }

    /// The oldest pending (unanswered) command, used for response attribution logging.
    public var oldestPendingCommand: String? {
        cliHistory.first(where: { !$0.isComplete })?.command
    }

    /// Keys that change automatically and should always be fetched fresh (never served from cache alone).
    public static let volatileKeys: Set<String> = [
        "clock", "neighbors"
    ]

    public init(contact: Contact) {
        self.contact = contact
        loadCachedSettings()
    }

    // MARK: - Settings Cache

    private static var cacheDirectory: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let appDir = dir.appendingPathComponent("MeshCore/remote_settings", isDirectory: true)
        try? FileManager.default.createDirectory(at: appDir, withIntermediateDirectories: true)
        return appDir
    }

    private var cacheFileURL: URL {
        let keyHex = contact.publicKey.map { String(format: "%02x", $0) }.joined()
        return Self.cacheDirectory.appendingPathComponent("settings_\(keyHex).json")
    }

    /// Section command mapping — must match RemoteSessionManager.sectionCommands keys.
    /// Maps section name to the setting keys that section would populate.
    private static let sectionSettingKeys: [String: [String]] = [
        "info": ["ver", "clock", "name", "role", "public.key"],
        "radio": ["radio", "tx", "repeat"],
        "timing": ["af", "rxdelay", "txdelay", "direct.txdelay", "flood.max", "int.thresh", "agc.reset.interval"],
        "routing": ["loop.detect", "path.hash.mode", "region default"],
        "advertising": ["name", "lat", "lon", "owner.info", "advert.interval", "flood.advert.interval", "multi.acks"],
        "gps": ["gps", "gps advert"],
        "security": ["allow.read.only", "guest.password", "adc.multiplier"],
        "maintenance": ["powersaving"],
    ]

    /// Whether cached settings exist for any keys in the given section.
    public func hasCachedSettings(for section: String) -> Bool {
        guard let keys = Self.sectionSettingKeys[section] else { return false }
        return keys.contains { settings[$0] != nil }
    }

    /// Debounce timer for cache saves — avoids writing on every single setting update.
    private var cacheSaveTask: Task<Void, Never>?

    /// Schedule a debounced save of non-volatile settings to disk.
    public func saveSettingsCache() {
        cacheSaveTask?.cancel()
        cacheSaveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2s debounce
            guard !Task.isCancelled, let self else { return }
            self.writeCacheToDisk()
        }
    }

    /// Immediately flush cached settings to disk (called when a section completes).
    public func flushCacheNow() {
        cacheSaveTask?.cancel()
        writeCacheToDisk()
    }

    /// Immediately write non-volatile settings to disk.
    private func writeCacheToDisk() {
        let cacheable = settings.filter { !Self.volatileKeys.contains($0.key) }
        guard !cacheable.isEmpty else { return }
        do {
            let data = try JSONEncoder().encode(cacheable)
            try data.write(to: cacheFileURL, options: [.atomic, .completeFileProtection])
        } catch {
            // Cache save is best-effort
        }
    }

    /// Load cached settings from disk into the settings dictionary.
    /// Also marks sections as fetched so Phase 1 skips them on subsequent launches.
    private func loadCachedSettings() {
        let url = cacheFileURL
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            let data = try Data(contentsOf: url)
            let cached = try JSONDecoder().decode([String: String].self, from: data)
            guard !cached.isEmpty else { return }
            for (key, value) in cached {
                settings[key] = value
            }
            // Mark sections as fetched if their keys exist in cache
            for (section, _) in Self.sectionSettingKeys {
                if hasCachedSettings(for: section) {
                    fetchedSections.insert(section)
                }
            }
        } catch {
            // Cache load is best-effort — stale cache is deleted
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// Wait for a specific command's response to arrive. Polls every 50ms up to timeout.
    /// Returns true if the response arrived, false on timeout.
    public func waitForResponse(at index: Int, timeout: TimeInterval = 3.0) async -> Bool {
        let start = Date()
        while Date().timeIntervalSince(start) < timeout {
            if index < cliHistory.count && cliHistory[index].isComplete {
                return true
            }
            try? await Task.sleep(nanoseconds: 200_000_000) // 200ms poll
        }
        return false
    }

    /// Record that a CLI command was sent. Returns the index for timeout tracking.
    @discardableResult
    public func commandSent(_ command: String) -> Int {
        let idx = cliHistory.count
        cliHistory.append(CLIInteraction(command: command))
        isWaitingForResponse = true
        return idx
    }

    /// Mark a pending command as timed out if it hasn't received a response.
    public func timeoutCommand(at index: Int) {
        guard index < cliHistory.count, !cliHistory[index].isComplete else { return }
        cliHistory[index].response = "(no response)"
        isWaitingForResponse = cliHistory.contains(where: { !$0.isComplete })
    }

    /// Flush all currently-pending commands as "(flushed)" before starting a structured fetch.
    /// Prevents FIFO response attribution from routing fetch responses to stale fire-and-forget slots.
    public func flushPendingCommands() {
        for i in cliHistory.indices where !cliHistory[i].isComplete {
            cliHistory[i].response = "(flushed)"
        }
        isWaitingForResponse = false
    }

    /// Strip all known CLI prefixes from a response value.
    public static func cleanCLIValue(_ text: String) -> String {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Strip "-> > ", "-> ", "> " prefixes (may be nested)
        while s.hasPrefix("->") || s.hasPrefix("> ") || s.hasPrefix(">") {
            if s.hasPrefix("->") {
                s = String(s.dropFirst(2)).trimmingCharacters(in: .whitespaces)
            } else if s.hasPrefix("> ") {
                s = String(s.dropFirst(2)).trimmingCharacters(in: .whitespaces)
            } else if s.hasPrefix(">") {
                s = String(s.dropFirst(1)).trimmingCharacters(in: .whitespaces)
            }
        }
        return s
    }

    /// Record a CLI response received from the device.
    public func responseReceived(_ text: String) {
        var trimmedResponse = Self.cleanCLIValue(text)

        // Skip empty lines
        guard !trimmedResponse.isEmpty else { return }

        // FIFO match: find the first unanswered command (oldest pending)
        if let idx = cliHistory.firstIndex(where: { !$0.isComplete }) {
            let command = cliHistory[idx].command

            // Skip echoed command lines (USB serial echoes "get name" before sending the value)
            if trimmedResponse.lowercased() == command.lowercased() { return }

            // Handle "key = value" format — extract just the value
            if let eqRange = trimmedResponse.range(of: " = ") {
                let responseKey = String(trimmedResponse[trimmedResponse.startIndex..<eqRange.lowerBound])
                    .trimmingCharacters(in: .whitespaces).lowercased()
                // For "get X" commands, check if key matches
                if command.lowercased().hasPrefix("get ") {
                    let settingKey = String(command.dropFirst(4)).trimmingCharacters(in: .whitespaces).lowercased()
                    if responseKey == settingKey {
                        trimmedResponse = String(trimmedResponse[eqRange.upperBound...])
                            .trimmingCharacters(in: .whitespaces)
                    }
                }
                // Also handle bare "key = value" where key matches the command itself
                else if responseKey == command.lowercased() {
                    trimmedResponse = String(trimmedResponse[eqRange.upperBound...])
                        .trimmingCharacters(in: .whitespaces)
                }
            }

            cliHistory[idx].response = trimmedResponse
            parseSettingFromCommand(command, response: trimmedResponse)
        } else {
            // Unsolicited response — add as standalone, try "key = value" fallback
            var entry = CLIInteraction(command: "(unsolicited)")
            entry.response = trimmedResponse
            cliHistory.append(entry)
            parseKeyValueFallback(trimmedResponse)
        }
        isWaitingForResponse = cliHistory.contains(where: { !$0.isComplete })
    }

    /// Derive the setting key from the CLI command and store the response as its value.
    private func parseSettingFromCommand(_ command: String, response: String) {
        // Reject overly long responses before caching — guards against rogue device cache poisoning.
        guard response.count <= 512 else { return }

        let cmd = command.trimmingCharacters(in: .whitespaces).lowercased()

        // "get X" → key is X
        if cmd.hasPrefix("get ") {
            let key = String(cmd.dropFirst(4)).trimmingCharacters(in: .whitespaces)
            if !key.isEmpty {
                settings[key] = response
                saveSettingsCache()
                return
            }
        }

        // "set X value" → optimistically update settings[X] = value from the command itself.
        // Firmware may respond with "OK" which carries no key/value, so we use the sent value.
        if cmd.hasPrefix("set ") {
            let rest = String(cmd.dropFirst(4)).trimmingCharacters(in: .whitespaces)
            // key = everything up to last space; value = last word
            if let lastSpace = rest.lastIndex(of: " ") {
                let key = String(rest[rest.startIndex..<lastSpace]).trimmingCharacters(in: .whitespaces)
                let setValue = String(rest[rest.index(after: lastSpace)...]).trimmingCharacters(in: .whitespaces)
                if !key.isEmpty && !setValue.isEmpty {
                    settings[key] = setValue
                    saveSettingsCache()
                }
            }
            return
        }

        // Bare toggle commands like "powersaving on/off" — update settings[key] = value.
        let bareToggleValues: Set<String> = ["on", "off", "1", "0", "enable", "disable"]
        if let lastSpace = cmd.lastIndex(of: " ") {
            let bareKey = String(cmd[cmd.startIndex..<lastSpace]).trimmingCharacters(in: .whitespaces)
            let bareVal = String(cmd[cmd.index(after: lastSpace)...]).trimmingCharacters(in: .whitespaces)
            if !bareKey.isEmpty && bareToggleValues.contains(bareVal) {
                settings[bareKey] = bareVal
                saveSettingsCache()
                return
            }
        }

        // Bare commands like "ver", "clock", "powersaving", "gps", "neighbors"
        // use the command itself as the key
        let bareCommands = ["ver", "clock", "powersaving", "gps", "gps advert", "neighbors", "discover.neighbors", "region", "region default", "log", "io"]
        if bareCommands.contains(cmd) {
            settings[cmd] = response
            saveSettingsCache()
            return
        }

        // Fallback: try "key = value" format in the response
        parseKeyValueFallback(response)
    }

    /// Fallback parser for responses in "key = value" format.
    private func parseKeyValueFallback(_ text: String) {
        if let eqRange = text.range(of: " = ") {
            let key = String(text[text.startIndex..<eqRange.lowerBound])
                .trimmingCharacters(in: .whitespaces)
                .lowercased()
            let value = String(text[eqRange.upperBound...])
                .trimmingCharacters(in: .whitespaces)
            if !key.isEmpty {
                settings[key] = value
            }
        }
    }
}
