//
//  ChannelStore.swift
//  PommeCore
//
//  Channel sync, import/export, notification modes, iCloud channel preferences.
//
//  Created by Michael P. Bedworth on 3/20/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import os.log
import MeshCoreKit

/// Observable store for channels, sync, import/export, and notification modes.
/// Extracted from PommeCoreViewModel to enable fine-grained view observation.
@MainActor @Observable
final class ChannelStore {
    private static let logger = Logger(subsystem: "com.pommecore", category: "ChannelStore")

    // MARK: - Public State

    var channels: [MeshChannel] = []
    var isSyncingChannels = false

    /// Parsed channel data pending user confirmation (add vs replace).
    struct PendingChannelImport {
        let name: String
        let secret: Data?
    }

    var pendingChannelImport: PendingChannelImport?
    var showChannelImportOptions = false

    /// Multi-channel import state.
    struct PendingMultiChannelImport {
        let channels: [PendingChannelImport]
        var names: String {
            channels.map(\.name).joined(separator: ", ")
        }
    }

    var pendingMultiChannelImport: PendingMultiChannelImport?
    var showMultiChannelImportOptions = false

    // MARK: - Dependencies (set by coordinator)

    /// Closure to send a command frame to the device.
    var sendCommand: ((Data, String) -> Void)?

    /// Closure to clear messages/unread when a channel is removed or replaced.
    var clearChannelMessages: ((Data) -> Void)?

    /// Closure to persist messages after clearing.
    var persistChannelMessages: ((Data) -> Void)?

    // MARK: - Private State

    private let iCloudStore = NSUbiquitousKeyValueStore.default
    private var incomingChannels: [MeshChannel] = []
    var hasCompletedInitialChannelSync = false
    private var channelSyncTimeoutTask: Task<Void, Never>?
    private var consecutiveEmptyChannels = 0
    private static let earlyStopThreshold = 3

    /// The 12-char hex prefix of the connected radio's public key.
    /// Used to scope channel secrets and notification modes per radio.
    private(set) var radioPrefix12: String?

    /// Activate channel store for a specific radio.
    func activateForRadio(_ prefix: String) {
        radioPrefix12 = prefix
    }

    // MARK: - Channel Notification Modes

    enum ChannelNotifyMode: String {
        case all = "all"
        case mentionsOnly = "mentions"
        case muted = "muted"
    }

    func channelNotifyMode(for channelName: String) -> ChannelNotifyMode {
        let raw = iCloudStore.scopedString(base: "channel.notify", contactHex: channelName, radioPrefix: radioPrefix12) ?? "all"
        return ChannelNotifyMode(rawValue: raw) ?? .all
    }

    func setChannelNotifyMode(_ mode: ChannelNotifyMode, for channelName: String) {
        guard let prefix = radioPrefix12 else { return }
        let key = iCloudStore.scopedKey("channel.notify", contactHex: channelName, radioPrefix: prefix)
        iCloudStore.setAndSync(mode.rawValue, forKey: key)
    }

    // MARK: - Channel Sync

    /// Index of the next channel to request during sequential sync.
    private var nextChannelIndex = 0
    /// Total channels to sync.
    private var channelSyncMax = 0

    func syncChannels(maxChannels: UInt8) {
        let maxCh = Int(maxChannels)
        guard maxCh > 0 else {
            Self.logger.warning("syncChannels called with maxChannels=0 — skipping (DEVICE_INFO not yet received?)")
            return
        }
        Self.logger.info("Channel sync: requesting indices 0..<\(maxCh) (maxChannels=\(maxChannels) from DEVICE_INFO)")
        isSyncingChannels = true
        incomingChannels = []
        consecutiveEmptyChannels = 0
        nextChannelIndex = 0
        channelSyncMax = maxCh

        // Request first channel — subsequent channels requested after each response
        requestNextChannel()

        channelSyncTimeoutTask?.cancel()
        channelSyncTimeoutTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            guard !Task.isCancelled, self.isSyncingChannels else { return }
            DebugLogger.shared.log("Channel sync timeout — completing with \(self.incomingChannels.count) channels", level: .warning)
            self.finalizeChannelSync()
        }
    }

    /// Request the next channel in sequence. Stops when all requested or early-stop triggered.
    private func requestNextChannel() {
        guard isSyncingChannels, nextChannelIndex < channelSyncMax else { return }
        let idx = nextChannelIndex
        nextChannelIndex += 1
        let frame = MeshCoreProtocol.buildGetChannel(index: UInt8(idx))
        sendCommand?(frame, "GET_CHANNEL(\(idx))")
    }

    func handleChannelInfo(_ channel: MeshChannel) {
        guard isSyncingChannels else { return }

        var ch = channel
        if ch.secret == nil {
            if let existing = channels.first(where: { $0.index == channel.index }) {
                ch.secret = existing.secret
            }
        }
        if ch.secret == nil, !ch.name.isEmpty {
            if let prefix = radioPrefix12 {
                ch.secret = KeychainManager.getChannelSecret(forChannelName: ch.name, radioPrefix: prefix)
            } else {
                ch.secret = KeychainManager.getChannelSecret(forChannelName: ch.name)
            }
        }
        if let secret = ch.secret, !ch.name.isEmpty {
            if let prefix = radioPrefix12 {
                KeychainManager.saveChannelSecret(secret, forChannelName: ch.name, radioPrefix: prefix)
            } else {
                KeychainManager.saveChannelSecret(secret, forChannelName: ch.name)
            }
        }
        if let existingIdx = incomingChannels.firstIndex(where: { $0.index == ch.index }) {
            incomingChannels[existingIdx] = ch
        } else {
            incomingChannels.append(ch)
        }

        // Early stop: finalize once we see consecutive empty channels
        if ch.isActive {
            consecutiveEmptyChannels = 0
        } else {
            consecutiveEmptyChannels += 1
            if consecutiveEmptyChannels >= Self.earlyStopThreshold {
                finalizeChannelSync()
                return
            }
        }

        // Request next channel (sequential: 1 request per response)
        if nextChannelIndex < channelSyncMax {
            requestNextChannel()
        } else {
            finalizeChannelSync()
        }
    }

    /// Check if channel sync is complete based on maxChannels from DeviceInfo.
    func checkChannelSyncComplete(maxChannels: UInt8) {
        if maxChannels > 0 && incomingChannels.count >= Int(maxChannels) {
            finalizeChannelSync()
        }
    }

    private func finalizeChannelSync() {
        channelSyncTimeoutTask?.cancel()
        let active = incomingChannels.filter { $0.isActive }
        Self.logger.info("Channel sync complete: \(active.count) active channels out of \(self.incomingChannels.count) total")
        channels = active
        incomingChannels = []
        isSyncingChannels = false
    }

    // MARK: - Set Channel

    func setChannel(index: UInt8, name: String, secret: Data? = nil) {
        let frame = MeshCoreProtocol.buildSetChannel(index: index, name: name, secret: secret)
        sendCommand?(frame, "SET_CHANNEL(idx:\(index))")

        let channelKey = Data([index])
        if name.isEmpty {
            if let existing = channels.first(where: { $0.index == index }) {
                if let prefix = radioPrefix12 {
                    KeychainManager.deleteChannelSecret(forChannelName: existing.name, radioPrefix: prefix)
                } else {
                    KeychainManager.deleteChannelSecret(forChannelName: existing.name)
                }
            }
            channels.removeAll { $0.index == index }
            clearChannelMessages?(channelKey)
        } else {
            if let secret, !secret.isEmpty {
                if let prefix = radioPrefix12 {
                    KeychainManager.saveChannelSecret(secret, forChannelName: name, radioPrefix: prefix)
                } else {
                    KeychainManager.saveChannelSecret(secret, forChannelName: name)
                }
            }
            if let existing = channels.first(where: { $0.index == index }),
               existing.name != name || existing.secret != secret {
                clearChannelMessages?(channelKey)
                persistChannelMessages?(channelKey)
            }
            let newChannel = MeshChannel(index: index, name: name, flags: secret != nil ? 0x01 : 0x00, secret: secret)
            if let idx = channels.firstIndex(where: { $0.index == index }) {
                channels[idx] = newChannel
            } else {
                channels.append(newChannel)
            }
        }
    }

    // MARK: - Channel Import

    /// Handle a meshcore:// URL — returns true if handled as channel import.
    func handleChannelURL(_ urlString: String) -> Bool {
        if urlString.hasPrefix("meshcore://channels?") {
            if let parsed = parseMultiChannelURL(urlString) {
                pendingMultiChannelImport = parsed
                showMultiChannelImportOptions = true
            }
            return true
        } else if urlString.hasPrefix("meshcore://channel?") {
            if let parsed = parseChannelURL(urlString) {
                pendingChannelImport = parsed
                showChannelImportOptions = true
            }
            return true
        }
        return false
    }

    private func parseChannelURL(_ urlString: String) -> PendingChannelImport? {
        guard let components = URLComponents(string: urlString),
              let nameItem = components.queryItems?.first(where: { $0.name == "name" }),
              let name = nameItem.value, !name.isEmpty else { return nil }

        var secret: Data?
        if let secretHex = components.queryItems?.first(where: { $0.name == "secret" })?.value,
           !secretHex.isEmpty {
            secret = Data(hexString: secretHex)
        }
        return PendingChannelImport(name: name, secret: secret)
    }

    private func parseMultiChannelURL(_ urlString: String) -> PendingMultiChannelImport? {
        guard let components = URLComponents(string: urlString),
              let dataItem = components.queryItems?.first(where: { $0.name == "data" }),
              let base64 = dataItem.value,
              let jsonData = Data(base64Encoded: base64),
              let array = try? JSONSerialization.jsonObject(with: jsonData) as? [[String: String]] else {
            return nil
        }

        var parsed: [PendingChannelImport] = []
        for item in array {
            guard let name = item["name"], !name.isEmpty else { continue }
            let secretHex = item["secret"] ?? ""
            let secret: Data? = secretHex.isEmpty ? nil : Data(hexString: secretHex)
            parsed.append(PendingChannelImport(name: name, secret: secret))
        }
        guard !parsed.isEmpty else { return nil }
        return PendingMultiChannelImport(channels: parsed)
    }

    func importChannelAdd(_ data: PendingChannelImport, maxChannels: UInt8) {
        let usedIndices = Set(channels.map(\.index))
        var nextSlot: UInt8 = 1
        while usedIndices.contains(nextSlot) && nextSlot < maxChannels {
            nextSlot += 1
        }
        setChannel(index: nextSlot, name: data.name, secret: data.secret)
    }

    func importChannelReplaceAll(_ data: PendingChannelImport) {
        for channel in channels where channel.index != 0 {
            setChannel(index: channel.index, name: "", secret: nil)
        }
        setChannel(index: 1, name: data.name, secret: data.secret)
    }

    func importMultiChannelsAdd(_ data: PendingMultiChannelImport, maxChannels: UInt8) {
        var usedIndices = Set(channels.map(\.index))
        for channel in data.channels {
            var nextSlot: UInt8 = 1
            while usedIndices.contains(nextSlot) && nextSlot < maxChannels {
                nextSlot += 1
            }
            guard nextSlot < maxChannels else { break }
            setChannel(index: nextSlot, name: channel.name, secret: channel.secret)
            usedIndices.insert(nextSlot)
        }
    }

    func importMultiChannelsReplace(_ data: PendingMultiChannelImport, maxChannels: UInt8) {
        for channel in channels where channel.index != 0 {
            setChannel(index: channel.index, name: "", secret: nil)
        }
        for (i, channel) in data.channels.enumerated() {
            let slot = UInt8(i + 1)
            guard slot < maxChannels else { break }
            setChannel(index: slot, name: channel.name, secret: channel.secret)
        }
    }

    // MARK: - Reset

    func reset() {
        channelSyncTimeoutTask?.cancel()
        channels = []
        incomingChannels = []
        isSyncingChannels = false
        hasCompletedInitialChannelSync = false
        consecutiveEmptyChannels = 0
        pendingChannelImport = nil
        showChannelImportOptions = false
        pendingMultiChannelImport = nil
        showMultiChannelImportOptions = false
        radioPrefix12 = nil
    }
}
