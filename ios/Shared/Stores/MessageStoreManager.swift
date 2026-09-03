//
//  MessageStoreManager.swift
//  PommeCore
//
//  Messages, ACK tracking, echo detection, drafts, unread counts, and iCloud sync.
//
//  Created by Michael P. Bedworth on 3/20/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import os.log
import UserNotifications
import CryptoKit
#if os(watchOS)
import WatchKit
#endif
#if os(iOS)
import Intents
#endif
import MeshCoreKit

/// Observable store for messages, ACK tracking, echo detection, drafts, and unread counts.
/// Extracted from PommeCoreViewModel to enable fine-grained view observation.
@MainActor @Observable
final class MessageStoreManager {
    private static let logger = Logger(subsystem: "com.pommecore", category: "MessageStore")

    // MARK: - Public State

    /// All messages keyed by contact public key prefix (6 bytes) or channel key (1 byte).
    var messagesByContact: [Data: [Message]] = [:]

    /// Unread message counts per contact/channel key.
    var unreadCounts: [Data: Int] = [:]

    /// Last exported contact URL (set when exportedContact response arrives).
    var lastExportedURL: String?

    // MARK: - Dependencies (set by coordinator)

    /// Closure to send a command frame to the device.
    var sendCommand: ((Data, String) -> Void)?

    /// Closure to get the display name for a contact key prefix.
    var displayNameProvider: ((Data) -> String)?

    /// Closure to get the current device name (for @mention matching).
    var deviceNameProvider: (() -> String)?

    /// Closure to get the public key hex of the current radio.
    var radioPublicKeyHexProvider: (() -> String)?

    /// Closure to find a contact by key prefix.
    var contactProvider: ((Data) -> Contact?)?

    /// Closure to get channel info by index.
    var channelProvider: ((UInt8) -> MeshChannel?)?

    /// Closure to get channel notification mode.
    var channelNotifyModeProvider: ((String) -> ChannelStore.ChannelNotifyMode)?

    /// Closure to get all channels (for notification context).
    var allChannelsProvider: (() -> [MeshChannel])?

    /// Closure to check contact notification mode (from group membership / mute).
    var contactNotifyModeProvider: ((Contact) -> ContactStore.GroupNotifyMode)?

    /// Closure to get contact notification sound (from group membership).
    var contactSoundProvider: ((Contact) -> ContactStore.GroupSound)?

    /// Closure to reset a contact's path (for flood retry / path refresh).
    var resetPathForContact: ((Contact) -> Void)?

    /// Called when unread counts change (used to trigger widget sync).
    var onUnreadChanged: (() -> Void)?

    /// Pending pre-send path check: holds message frame until advert path response arrives.
    private var pendingPathCheck: (contact: Contact, frame: Data)?
    private var pathCheckTimeoutTask: Task<Void, Never>?

    /// Whether the app is currently in the background.
    var isInBackground = false

    /// True if message encryption is unavailable (Keychain failure).
    /// Views can check this to show a warning banner.
    var isEncryptionUnavailable = false

    /// Currently selected contact key (to suppress unread count for visible chat).
    var selectedContactKey: Data?

    // MARK: - Private State

    private var persistenceStore = MessageStore()
    private let iCloudStore = NSUbiquitousKeyValueStore.default

    /// The 12-char hex prefix of the connected radio's public key.
    /// Nil when no radio is connected. Used to scope drafts, lastRead, and file storage.
    private(set) var radioPrefix12: String?

    /// Maps expected ACK code -> message tracking info.
    private var pendingACKs: [UInt32: (contactKeyHash: Data, messageID: UUID)] = [:]

    /// Tracks the most recent outgoing channel message for echo detection.
    var pendingChannelEcho: (id: UUID, channelKey: Data, sent: Date)?

    /// Whether we're currently syncing queued messages.
    var isSyncingMessages = false

    // MARK: - Init

    init() {
        // Messages are NOT loaded at init — wait for activateForRadio() after SELF_INFO.
    }

    // MARK: - Per-Radio Activation

    /// Activate message storage for a specific radio. Called after SELF_INFO provides the radio's public key.
    /// Migrates flat files if needed, loads persisted messages, and merges iCloud data.
    func activateForRadio(_ prefix: String) {
        radioPrefix12 = prefix
        persistenceStore = MessageStore(radioPrefix: prefix)
        MessageStore.migrateToPerRadioStorage(radioPrefix: prefix)
        isEncryptionUnavailable = persistenceStore.isEncryptionUnavailable
        if isEncryptionUnavailable {
            Self.logger.warning("Message encryption unavailable — Keychain key could not be created")
        }
        loadPersistedMessages()
        mergeMessagesForCurrentRadio()
    }

    /// Deactivate message storage on disconnect. Clears in-memory messages so the UI shows empty state.
    func deactivate() {
        flushDirtyMessages()
        messagesByContact.removeAll()
        unreadCounts.removeAll()
        radioPrefix12 = nil
        updateAppBadge()
    }

    // MARK: - Message Access

    func messages(for contact: Contact) -> [Message] {
        messagesByContact[contact.publicKeyPrefix] ?? []
    }

    func unreadCount(for contact: Contact) -> Int {
        unreadCounts[contact.publicKeyPrefix] ?? 0
    }

    func markAsRead(_ contact: Contact) {
        markAsRead(contactKey: contact.publicKeyPrefix)
    }

    func markAsRead(contactKey: Data) {
        unreadCounts[contactKey] = 0
        updateAppBadge()
        onUnreadChanged?()
        guard let prefix = radioPrefix12 else { return }
        let contactHex = contactKey.hexCompact
        let key = "lastRead.\(prefix).\(contactHex)"
        iCloudStore.setAndSync(Date().timeIntervalSince1970, forKey: key)
    }

    func firstUnreadIndex(in messages: [Message], for contactKey: Data) -> Int? {
        let lastRead = lastReadValue(for: contactKey)
        guard lastRead > 0 else { return nil }
        let lastReadDate = Date(timeIntervalSince1970: lastRead)
        return messages.firstIndex { $0.timestamp > lastReadDate && !$0.isOutgoing }
    }

    func lastReadTimestamp(for contactKey: Data) -> Date? {
        let ts = lastReadValue(for: contactKey)
        guard ts > 0 else { return nil }
        return Date(timeIntervalSince1970: ts)
    }

    /// Read lastRead timestamp, trying scoped key first then falling back to legacy.
    private func lastReadValue(for contactKey: Data) -> Double {
        iCloudStore.scopedDouble(base: "lastRead", contactHex: contactKey.hexCompact, radioPrefix: radioPrefix12)
    }

    /// Latest activity date for a contact (for ContactStore activity status).
    func latestActivityDate(for contactKey: Data) -> Date? {
        guard let msgs = messagesByContact[contactKey] else { return nil }
        var latest: Date?
        for msg in msgs {
            let eligible = (msg.isOutgoing && msg.status == .delivered) || !msg.isOutgoing
            if eligible {
                latest = max(latest ?? msg.timestamp, msg.timestamp)
            }
        }
        return latest
    }

    // MARK: - Persistence

    /// Maximum messages stored per contact on disk. Oldest pruned on save.
    /// User-configurable via Settings > Storage.
    var maxMessagesPerContact: Int {
        let stored = UserDefaults.standard.integer(forKey: "maxMessagesPerContact")
        return stored > 0 ? stored : 500
    }

    /// Contact keys with unsaved changes, flushed by debounce timer.
    private var dirtyContactKeys: Set<Data> = []
    private var persistDebounceTask: Task<Void, Never>?

    private func loadPersistedMessages() {
        messagesByContact = persistenceStore.loadAllMessages()
        // Prune any contacts over the limit on load
        for (key, msgs) in messagesByContact where msgs.count > self.maxMessagesPerContact {
            messagesByContact[key] = Array(msgs.suffix(self.maxMessagesPerContact))
        }
    }

    /// Mark a contact's messages as needing persistence. Writes are coalesced
    /// and flushed after a short delay to avoid excessive disk I/O.
    func persistMessages(for contactKeyHash: Data) {
        dirtyContactKeys.insert(contactKeyHash)
        persistDebounceTask?.cancel()
        persistDebounceTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
            guard !Task.isCancelled, let self else { return }
            self.flushDirtyMessages()
        }
    }

    /// Immediately write all dirty messages to disk.
    func flushDirtyMessages() {
        let keys = dirtyContactKeys
        dirtyContactKeys.removeAll()
        persistDebounceTask?.cancel()
        persistDebounceTask = nil
        for key in keys {
            if var messages = messagesByContact[key] {
                // Prune to limit before saving
                if messages.count > self.maxMessagesPerContact {
                    messages = Array(messages.suffix(self.maxMessagesPerContact))
                    messagesByContact[key] = messages
                }
                persistenceStore.saveMessages(messages, for: key)
                syncMessagesToiCloud(for: key)
            }
        }
    }

    // MARK: - Drafts

    func saveDraft(_ text: String, for contactKey: Data) {
        guard let prefix = radioPrefix12 else { return }
        let contactHex = contactKey.hexCompact
        let key = "draft.\(prefix).\(contactHex)"
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            iCloudStore.removeObject(forKey: key)
        } else {
            iCloudStore.set(text, forKey: key)
        }
        iCloudStore.synchronize()
    }

    func loadDraft(for contactKey: Data) -> String {
        iCloudStore.scopedString(base: "draft", contactHex: contactKey.hexCompact, radioPrefix: radioPrefix12) ?? ""
    }

    func hasDraft(for contactKey: Data) -> Bool {
        iCloudStore.scopedString(base: "draft", contactHex: contactKey.hexCompact, radioPrefix: radioPrefix12) != nil
    }

    func clearAllDrafts() {
        let keys = iCloudStore.dictionaryRepresentation.keys.filter { $0.hasPrefix("draft.") }
        for key in keys {
            iCloudStore.removeObject(forKey: key)
        }
        iCloudStore.synchronize()
    }

    // MARK: - Send Messages

    func sendTextMessage(_ text: String, to contact: Contact, signed: Bool = false) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let outgoing = Message(
            contactKeyHash: contact.publicKeyPrefix,
            text: trimmed,
            timestamp: Date(),
            isOutgoing: true,
            status: .sending,
            isSigned: signed
        )
        messagesByContact[contact.publicKeyPrefix, default: []].append(outgoing)
        persistMessages(for: contact.publicKeyPrefix)

        let frame = MeshCoreProtocol.buildSendTextMessage(
            text: trimmed,
            recipientKeyHash: contact.publicKeyPrefix,
            txtType: signed ? 2 : 0
        )
        Self.logger.info("DM SEND: to=\(contact.name) key=\(contact.publicKeyPrefix.hexCompact)")
        DebugLogger.shared.log("DM SEND: to='\(contact.name)' '\(text.prefix(40))'", level: .tx)

        // For routed contacts, query the firmware's last advert path before sending.
        // If the contact's advert arrived directly (path_len=0), reset the outbound
        // route so the firmware discovers the direct path instead of routing through
        // a repeater. This is a local firmware query — no airtime cost.
        if contact.outPathLen > 0 {
            pendingPathCheck = (contact: contact, frame: frame)
            let query = MeshCoreProtocol.buildGetAdvertPath(publicKey: contact.publicKey)
            sendCommand?(query, "PRE_SEND_PATH_CHECK")
            pathCheckTimeoutTask?.cancel()
            pathCheckTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
                guard !Task.isCancelled, let self else { return }
                self.flushPendingPathCheck(reason: "timeout")
            }
        } else {
            sendCommand?(frame, "SEND_TXT")
        }
    }

    /// Handle advert path response for a pending pre-send path check.
    func handleAdvertPathForPendingSend(_ info: AdvertPathInfo) {
        guard let pending = pendingPathCheck else { return }
        pathCheckTimeoutTask?.cancel()
        pendingPathCheck = nil

        if info.pathLen == 0 {
            // Last advert from this contact arrived directly — they're in range.
            // Reset the stale routed path so the firmware discovers direct.
            Self.logger.info("PRE-SEND PATH CHECK: \(pending.contact.name) advert path is direct — resetting routed path")
            DebugLogger.shared.log("PATH REFRESH: \(pending.contact.name) direct advert detected, resetting route", level: .info)
            resetPathForContact?(pending.contact)
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 500_000_000)
                self?.sendCommand?(pending.frame, "SEND_TXT(path_refreshed)")
            }
        } else {
            // Contact still reached via repeater(s) — send on the cached routed path.
            Self.logger.info("PRE-SEND PATH CHECK: \(pending.contact.name) still routed (\(info.pathLen) hops)")
            sendCommand?(pending.frame, "SEND_TXT")
        }
    }

    private func flushPendingPathCheck(reason: String) {
        guard let pending = pendingPathCheck else { return }
        pendingPathCheck = nil
        pathCheckTimeoutTask?.cancel()
        Self.logger.info("PRE-SEND PATH CHECK: flushing (\(reason)) — sending on cached path for \(pending.contact.name)")
        sendCommand?(pending.frame, "SEND_TXT")
    }

    func sendChannelMessage(_ text: String, channelIndex: UInt8 = 0, signed: Bool = false) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let frame = MeshCoreProtocol.buildSendChannelMessage(
            text: trimmed,
            channelIndex: channelIndex,
            txtType: signed ? 2 : 0
        )
        Self.logger.info("CHANNEL TX: [\(frame.count) bytes] \(frame.hexFormatted())")
        DebugLogger.shared.log("CH TX: ch=\(frame.count > 2 ? "\(frame[2])" : "?") [\(frame.count)B] \(frame.hexFormatted())", level: .tx)
        DebugLogger.shared.log("CH TX: text='\(trimmed)'", level: .tx)

        // Store before sending — echo response can arrive before message is persisted.
        let channelKey = Data([channelIndex])
        let outgoing = Message(
            contactKeyHash: channelKey,
            text: trimmed,
            timestamp: Date(),
            isOutgoing: true,
            status: .sent,
            channelIndex: channelIndex,
            isSigned: signed
        )
        messagesByContact[channelKey, default: []].append(outgoing)
        persistMessages(for: channelKey)

        sendCommand?(frame, "SEND_CHANNEL_TXT")
        pendingChannelEcho = (id: outgoing.id, channelKey: channelKey, sent: Date())
        DebugLogger.shared.log("ECHO: armed pending echo for ch=\(channelIndex)", level: .info)
    }

    func sendRoomMessage(_ text: String, to contact: Contact) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let outgoing = Message(
            contactKeyHash: contact.publicKeyPrefix,
            text: trimmed,
            timestamp: Date(),
            isOutgoing: true,
            status: .sending
        )
        messagesByContact[contact.publicKeyPrefix, default: []].append(outgoing)
        persistMessages(for: contact.publicKeyPrefix)

        let frame = MeshCoreProtocol.buildSendTextMessage(
            text: trimmed,
            recipientKeyHash: contact.publicKeyPrefix,
            txtType: 0
        )
        sendCommand?(frame, "SEND_ROOM_TXT")
    }

    func syncNextMessage() {
        isSyncingMessages = true
        sendCommand?(MeshCoreProtocol.buildSyncNextMessage(), "SYNC_NEXT_MSG")
    }

    private let maxDirectRetries: UInt8 = 2  // 1 initial send + 1 retry before flooding
    private let maxFloodRetries: UInt8 = 2

    // MARK: - ACK Handling

    func handleSentResponse(expectedACK: UInt32, suggestedTimeoutMs: UInt32) {
        var matched = false
        for (contactKey, messages) in messagesByContact {
            if let idx = messages.firstIndex(where: { $0.isOutgoing && ($0.status == .sending || $0.status == .retrying || $0.status == .flooding) }) {
                // Don't downgrade a flooding message back to sent — keep .flooding visible until ACK or timeout
                let keepFlooding = messages[idx].status == .flooding
                Self.logger.info("DM RESP_SENT: matched message \(messages[idx].id) → \(keepFlooding ? ".flooding (kept)" : ".sent"), ack=\(expectedACK)")
                if !keepFlooding {
                    messagesByContact[contactKey]?[idx].status = .sent
                }
                messagesByContact[contactKey]?[idx].expectedACK = expectedACK
                messagesByContact[contactKey]?[idx].suggestedTimeoutMs = suggestedTimeoutMs
                pendingACKs[expectedACK] = (contactKeyHash: contactKey, messageID: messages[idx].id)
                persistMessages(for: contactKey)
                matched = true

                // Direct/retry phase: cap at 15s (covers SF12/BW125/CR4-8 worst-case ~12s round trip).
                // Flood phase uses firmware's full suggested timeout — mesh propagation needs more time.
                let rawSec = UInt64(suggestedTimeoutMs / 1000)
                let timeoutSec = keepFlooding ? max(rawSec, 6) : min(max(rawSec, 6), 15)
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: timeoutSec * 1_000_000_000)
                    guard let self else { return }
                    if self.pendingACKs[expectedACK] != nil {
                        self.handleACKTimeout(ackCode: expectedACK)
                    }
                }
                break
            }
        }
        if !matched {
            // Expected for CLI commands, login, status requests — not just DMs.
            Self.logger.debug("DM RESP_SENT: no pending message for ack=\(expectedACK) (likely non-DM command)")
        }
    }

    /// Returns the contact key hash if the ACK was matched, so callers can update activity.
    @discardableResult
    func handleSendConfirmed(ackCode: UInt32, roundTripMs: UInt32) -> Data? {
        guard let pending = pendingACKs.removeValue(forKey: ackCode) else {
            Self.logger.warning("DM CONFIRMED: no pending ACK for code \(ackCode)")
            return nil
        }

        if var messages = messagesByContact[pending.contactKeyHash],
           let idx = messages.firstIndex(where: { $0.id == pending.messageID }) {
            Self.logger.info("DM CONFIRMED: message \(pending.messageID) → .delivered, roundTrip=\(roundTripMs)ms")
            messages[idx].status = .delivered
            messages[idx].roundTripMs = roundTripMs
            messagesByContact[pending.contactKeyHash] = messages
            persistMessages(for: pending.contactKeyHash)
        }
        return pending.contactKeyHash
    }

    private func handleACKTimeout(ackCode: UInt32) {
        guard let pending = pendingACKs.removeValue(forKey: ackCode) else { return }

        guard var messages = messagesByContact[pending.contactKeyHash],
              let idx = messages.firstIndex(where: { $0.id == pending.messageID }),
              messages[idx].status == .sent || messages[idx].status == .flooding else { return }

        let message = messages[idx]
        let autoRetry = UserDefaults.standard.bool(forKey: "autoRetry")
        let autoResetPath = UserDefaults.standard.bool(forKey: "autoResetPath")

        // Phase 1: Direct path retries
        if !message.didResetPath && message.attempt < maxDirectRetries - 1 {
            if autoRetry {
                Self.logger.info("ACK timeout for message \(pending.messageID), auto-retrying (attempt \(message.attempt + 1))")
                messages[idx].status = .retrying
                messages[idx].attempt += 1
                let attempt = messages[idx].attempt
                let contactKey = pending.contactKeyHash
                messagesByContact[contactKey] = messages
                persistMessages(for: contactKey)

                if let channelIdx = message.channelIndex {
                    let frame = MeshCoreProtocol.buildSendChannelMessage(text: message.text, channelIndex: channelIdx)
                    sendCommand?(frame, "AUTO_RETRY_CHANNEL(\(attempt))")
                } else {
                    let frame = MeshCoreProtocol.buildSendTextMessage(text: message.text, recipientKeyHash: contactKey, attempt: attempt)
                    sendCommand?(frame, "AUTO_RETRY_TXT(\(attempt))")
                }
                return
            }
        }

        // Phase 2: Reset path and flood
        if autoRetry && autoResetPath && !message.didResetPath && message.channelIndex == nil {
            Self.logger.info("Direct retries exhausted for \(pending.messageID), resetting path and flooding")
            messages[idx].status = .flooding
            messages[idx].didResetPath = true
            messages[idx].attempt = 0
            let contactKey = pending.contactKeyHash
            messagesByContact[contactKey] = messages
            persistMessages(for: contactKey)

            if let contact = contactProvider?(contactKey) {
                resetPathForContact?(contact)
            }

            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard let self else { return }
                let frame = MeshCoreProtocol.buildSendTextMessage(text: message.text, recipientKeyHash: contactKey, attempt: 0)
                self.sendCommand?(frame, "FLOOD_RETRY_TXT")
            }
            return
        }

        // Phase 3: Flood retries
        if message.didResetPath && message.attempt < maxFloodRetries - 1 {
            if autoRetry {
                Self.logger.info("Flood retry for \(pending.messageID) (attempt \(message.attempt + 1))")
                messages[idx].status = .flooding
                messages[idx].attempt += 1
                let attempt = messages[idx].attempt
                let contactKey = pending.contactKeyHash
                messagesByContact[contactKey] = messages
                persistMessages(for: contactKey)

                let frame = MeshCoreProtocol.buildSendTextMessage(text: message.text, recipientKeyHash: contactKey, attempt: attempt)
                sendCommand?(frame, "FLOOD_RETRY_TXT(\(attempt))")
                return
            }
        }

        // All retries exhausted
        Self.logger.info("All retries exhausted for message \(pending.messageID), marking as failed")
        messages[idx].status = .failed
        messagesByContact[pending.contactKeyHash] = messages
        persistMessages(for: pending.contactKeyHash)
    }

    /// Mark any message stuck in `.sending` as failed immediately.
    /// Called when firmware returns RESP_ERR — no RESP_SENT will arrive, so no expectedACK
    /// is registered and no timeout task is scheduled. Without this, the message hangs forever.
    func failPendingSendingMessage() {
        for (contactKey, messages) in messagesByContact {
            if let idx = messages.firstIndex(where: { $0.isOutgoing && $0.status == .sending }) {
                Self.logger.warning("RESP_ERR received with message \(messages[idx].id) stuck in .sending — marking failed")
                messagesByContact[contactKey]?[idx].status = .failed
                persistMessages(for: contactKey)
                break
            }
        }
    }

    // MARK: - Incoming Messages

    /// Handle an incoming message. Returns the message if stored (for notification).
    func handleIncomingMessage(_ message: Message) -> Message? {
        let contactKey = message.contactKeyHash

        // Check if this is a reaction message (MeshCore One compatible)
        if let reaction = parseReaction(text: message.text) {
            if handleIncomingReaction(emoji: reaction.emoji, hash: reaction.hash, contactKey: contactKey) {
                Self.logger.debug("Matched incoming reaction \(reaction.emoji) to message hash \(reaction.hash)")
                return nil // Don't store as a regular message
            }
            // If no match found, store as regular message (might be for a message we don't have)
        }

        let existing = messagesByContact[contactKey] ?? []
        let isDuplicate = existing.contains { msg in
            msg.text == message.text &&
            abs(msg.timestamp.timeIntervalSince(message.timestamp)) < 15 &&
            msg.isOutgoing == message.isOutgoing
        }
        guard !isDuplicate else {
            Self.logger.debug("Skipping duplicate message")
            return nil
        }

        messagesByContact[contactKey, default: []].append(message)
        persistMessages(for: contactKey)

        if !isInBackground {
            playReceiveHaptic()
        }

        if selectedContactKey != contactKey {
            unreadCounts[contactKey, default: 0] += 1
            updateAppBadge()
        }

        return message
    }

    // MARK: - Echo Detection (0x88)

    func handleLogRxData(snr: Int8) {
        if let pending = pendingChannelEcho {
            let elapsed = Date().timeIntervalSince(pending.sent)
            if elapsed < 30 {
                if var msgs = messagesByContact[pending.channelKey],
                   let msgIdx = msgs.firstIndex(where: { $0.id == pending.id }) {
                    Self.logger.info("ECHO: 0x88 received \(String(format: "%.1f", elapsed))s after channel send — marking as repeated")
                    DebugLogger.shared.log("ECHO: repeated after \(String(format: "%.1f", elapsed))s (snr=\(String(format: "%.1f", Float(snr)/4.0)))", level: .info)
                    msgs[msgIdx].status = .repeated
                    messagesByContact[pending.channelKey] = msgs
                    persistMessages(for: pending.channelKey)
                }
                pendingChannelEcho = nil
            } else {
                pendingChannelEcho = nil
            }
        }
    }

    // MARK: - Delete / Clear

    func addReaction(_ emoji: String, to message: Message) {
        let contactKey = message.contactKeyHash
        guard var messages = messagesByContact[contactKey],
              let idx = messages.firstIndex(where: { $0.id == message.id }) else { return }
        if messages[idx].reactions.contains(emoji) {
            messages[idx].reactions.removeAll { $0 == emoji }
        } else {
            messages[idx].reactions.append(emoji)
            // Send reaction over the mesh (MeshCore One compatible format)
            let hash = reactionHash(for: message)
            let reactionText = "\(emoji)\n\(hash)"
            if let contact = contactProvider?(contactKey) {
                sendTextMessage(reactionText, to: contact)
            }
        }
        messagesByContact[contactKey] = messages
        persistMessages(for: contactKey)
    }

    /// Add a reaction locally without sending over mesh (for channel reactions sent separately).
    func addReactionLocal(_ emoji: String, to message: Message) {
        let contactKey = message.contactKeyHash
        guard var messages = messagesByContact[contactKey],
              let idx = messages.firstIndex(where: { $0.id == message.id }) else { return }
        if !messages[idx].reactions.contains(emoji) {
            messages[idx].reactions.append(emoji)
            messagesByContact[contactKey] = messages
            persistMessages(for: contactKey)
        }
    }

    // MARK: - Reaction Hash (MeshCore One compatible)

    /// Compute the Crockford Base32 hash for a message (for reaction matching).
    /// Hash = SHA256(message_text_utf8 + sender_timestamp_le_u32), first 5 bytes → 8-char Crockford Base32.
    func reactionHash(for message: Message) -> String {
        let textData = Data(message.text.utf8)
        let epoch = UInt32(message.timestamp.timeIntervalSince1970)
        var combined = textData
        combined.append(contentsOf: withUnsafeBytes(of: epoch.littleEndian) { Array($0) })
        let digest = SHA256.hash(data: combined)
        let first5 = Data(digest.prefix(5))
        return crockfordBase32Encode(first5)
    }

    /// Check if an incoming message text is a reaction.
    /// DM format: emoji\nhash
    /// Channel format: emoji@[senderName]\nhash
    func parseReaction(text: String) -> (emoji: String, hash: String)? {
        let parts = text.components(separatedBy: "\n")
        guard parts.count == 2 else { return nil }
        var emojiPart = parts[0]
        let hashPart = parts[1]

        // Strip @[senderName] suffix for channel reactions
        if let atIdx = emojiPart.firstIndex(of: "@"),
           emojiPart[atIdx...].hasPrefix("@[") {
            emojiPart = String(emojiPart[..<atIdx])
        }

        // Emoji part should be 1-4 Unicode scalars, hash should be 8 alphanumeric chars
        guard emojiPart.unicodeScalars.count <= 4,
              emojiPart.unicodeScalars.first?.properties.isEmoji == true,
              hashPart.count == 8,
              hashPart.allSatisfy({ $0.isLetter || $0.isNumber }) else { return nil }
        return (emojiPart, hashPart)
    }

    /// Try to attach an incoming reaction to an existing message.
    /// Returns true if the reaction was matched and attached.
    func handleIncomingReaction(emoji: String, hash: String, contactKey: Data) -> Bool {
        guard var messages = messagesByContact[contactKey] else { return false }
        for i in messages.indices.reversed() { // search recent first
            let msgHash = reactionHash(for: messages[i])
            if msgHash == hash {
                if !messages[i].reactions.contains(emoji) {
                    messages[i].reactions.append(emoji)
                    messagesByContact[contactKey] = messages
                    persistMessages(for: contactKey)
                }
                return true
            }
        }
        return false
    }

    /// Crockford Base32 encoding for 5 bytes → 8 characters.
    private func crockfordBase32Encode(_ data: Data) -> String {
        let alphabet = Array("0123456789abcdefghjkmnpqrstvwxyz")
        var bits: UInt64 = 0
        for byte in data { bits = (bits << 8) | UInt64(byte) }
        var result = ""
        for i in stride(from: 35, through: 0, by: -5) {
            let index = Int((bits >> i) & 0x1F)
            result.append(alphabet[index])
        }
        return result
    }

    func deleteMessage(_ message: Message, in contactKey: Data) {
        if var messages = messagesByContact[contactKey],
           let idx = messages.firstIndex(where: { $0.id == message.id }) {
            messages.remove(at: idx)
            messagesByContact[contactKey] = messages
            persistMessages(for: contactKey)
        }
    }

    func clearMessages(for contactKey: Data) {
        messagesByContact.removeValue(forKey: contactKey)
        unreadCounts.removeValue(forKey: contactKey)
        persistenceStore.deleteMessages(for: contactKey)
        updateAppBadge()
    }

    func clearAllMessages() {
        messagesByContact.removeAll()
        persistenceStore.deleteAllMessages()
        unreadCounts.removeAll()
        updateAppBadge()
    }

    func retryMessage(_ message: Message) {
        guard message.isOutgoing, message.status == .failed else { return }
        let contactKey = message.contactKeyHash

        if var messages = messagesByContact[contactKey],
           let idx = messages.firstIndex(where: { $0.id == message.id }) {

            if message.channelIndex == nil {
                if let contact = contactProvider?(contactKey) {
                    Self.logger.info("RETRY: resetting path for \(contact.name) before flood retry")
                    resetPathForContact?(contact)
                }
                messages[idx].status = .sending
                messages[idx].attempt = 2
                messages[idx].didResetPath = true
                messagesByContact[contactKey] = messages

                let msgID = message.id
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    guard let self else { return }
                    Self.logger.info("RETRY: sending flood for \(msgID) with attempt=2")
                    let frame = MeshCoreProtocol.buildSendTextMessage(text: message.text, recipientKeyHash: contactKey, attempt: 2)
                    self.sendCommand?(frame, "MANUAL_RETRY_FLOOD")
                }
            } else {
                guard let channelIndex = message.channelIndex else { return }
                messages[idx].status = .sending
                messages[idx].attempt = 0
                messagesByContact[contactKey] = messages
                let frame = MeshCoreProtocol.buildSendChannelMessage(text: message.text, channelIndex: channelIndex)
                sendCommand?(frame, "MANUAL_RETRY_CHANNEL")
            }
            persistMessages(for: contactKey)
        }
    }

    // MARK: - Mark All Sending as Failed (disconnect)

    func markAllSendingAsFailed() {
        for (contactKey, messages) in messagesByContact {
            var updated = messages
            var changed = false
            for i in updated.indices where updated[i].isOutgoing && updated[i].status == .sending {
                updated[i].status = .failed
                changed = true
            }
            if changed {
                messagesByContact[contactKey] = updated
                persistMessages(for: contactKey)
            }
        }
        pendingACKs.removeAll()
    }

    // MARK: - iCloud Message Sync

    func syncMessagesToiCloud(for contactKeyHash: Data) {
        guard iCloudSyncEnabled else { return }
        let radioKey = radioPublicKeyHexProvider?() ?? ""
        guard !radioKey.isEmpty else { return }

        let contactHex = contactKeyHash.hexCompact
        let key = "msg.\(radioKey.prefix(12)).\(contactHex)"

        guard let messages = messagesByContact[contactKeyHash] else { return }
        let recent = Array(messages.suffix(50))

        if let data = try? JSONEncoder().encode(recent), data.count < 60_000 {
            iCloudStore.set(data, forKey: key)
        }
    }

    func mergeMessagesForCurrentRadio() {
        let radioKey = radioPublicKeyHexProvider?() ?? ""
        guard !radioKey.isEmpty else { return }
        let prefix = "msg.\(radioKey.prefix(12))."

        let allKeys = iCloudStore.dictionaryRepresentation.keys
        var mergedCount = 0

        for key in allKeys where key.hasPrefix(prefix) {
            let contactHex = String(key.dropFirst(prefix.count))
            guard let contactKeyHash = Data(hexString: contactHex),
                  let data = iCloudStore.data(forKey: key),
                  let cloudMessages = try? JSONDecoder().decode([Message].self, from: data)
            else { continue }

            let localMessages = messagesByContact[contactKeyHash] ?? []
            let localIDs = Set(localMessages.map(\.id))
            var merged = localMessages

            for msg in cloudMessages where !localIDs.contains(msg.id) {
                merged.append(msg)
                mergedCount += 1
            }

            if merged.count > localMessages.count {
                merged.sort { $0.timestamp < $1.timestamp }
                messagesByContact[contactKeyHash] = merged
                persistenceStore.saveMessages(merged, for: contactKeyHash)
            }
        }

        if mergedCount > 0 {
            Self.logger.info("iCloud sync: merged \(mergedCount) messages from other devices")
        }
    }

    // MARK: - Notifications

    func postLocalNotification(for message: Message) {

        let prefs = NotificationPreferences.shared
        let isChannel = message.channelIndex != nil
        let contact = contactProvider?(message.contactKeyHash)
        let isRoom = contact?.type == .room

        if isChannel {
            guard prefs.notifyChannel else { return }
            if let chIdx = message.channelIndex,
               let channel = channelProvider?(chIdx) {
                let mode = channelNotifyModeProvider?(channel.name) ?? .all
                if mode == .muted { return }
                if mode == .mentionsOnly {
                    let myName = (deviceNameProvider?() ?? "").lowercased()
                    guard !myName.isEmpty, message.text.lowercased().contains("@\(myName)") else { return }
                }
            }
        } else if isRoom {
            guard prefs.notifyRoom else { return }
        } else {
            // Suppress notifications from infrastructure nodes (repeaters, sensors)
            if let contact, contact.type == .repeater || contact.type == .sensor {
                return
            }
            guard prefs.notifyDirect else { return }

            // Check per-contact / group mute
            if let contact, let mode = contactNotifyModeProvider?(contact) {
                if mode == .muted { return }
            }
        }

        let content = UNMutableNotificationContent()

        // Apply group-specific sound
        var notifSound: UNNotificationSound = .default
        if let contact, let groupSound = contactSoundProvider?(contact) {
            switch groupSound {
            case .default: break
            case .chime: notifSound = UNNotificationSound(named: UNNotificationSoundName("chime.caf"))
            case .pulse: notifSound = UNNotificationSound(named: UNNotificationSoundName("pulse.caf"))
            case .alert: notifSound = UNNotificationSound(named: UNNotificationSoundName("alert.caf"))
            case .none: notifSound = UNNotificationSound(named: UNNotificationSoundName(""))
            }
        }
        content.sound = notifSound

        let senderName = message.senderName
            ?? contact.map { displayNameProvider?($0.publicKeyPrefix) ?? $0.name }

        if let channelIdx = message.channelIndex {
            let channels = allChannelsProvider?() ?? []
            let channelName = channels.first(where: { $0.index == channelIdx })?.name ?? "Channel"
            content.title = channelName
            if let name = message.senderName, !name.isEmpty {
                content.subtitle = name
            }
            content.threadIdentifier = "channel.\(channelIdx)"
        } else if let name = senderName {
            content.title = name
            content.threadIdentifier = "dm.\(message.contactKeyHash.hexCompact)"
        } else {
            content.title = "New Message"
        }
        content.body = message.text

        if let contact {
            content.userInfo["contactPubkey"] = contact.publicKey.hexCompact
            content.userInfo["isChannel"] = isChannel
            if let chIdx = message.channelIndex {
                content.userInfo["channelIndex"] = chIdx
            }
            #if os(iOS)
            content.categoryIdentifier = "MESSAGE_CATEGORY"
            #endif
        }

        let totalUnread = unreadCounts.values.reduce(0, +)
        content.badge = NSNumber(value: totalUnread)

        DebugLogger.shared.log("NOTIF: posting notification for '\(message.text.prefix(30))'", level: .info)

        #if os(iOS)
        let finalContent = communicationContent(from: content, message: message, senderName: senderName)
        #else
        let finalContent: UNNotificationContent = content
        #endif

        let request = UNNotificationRequest(
            identifier: message.id.uuidString,
            content: finalContent,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    #if os(iOS)
    private func communicationContent(
        from content: UNMutableNotificationContent,
        message: Message,
        senderName: String?
    ) -> UNNotificationContent {
        let name = senderName ?? "Unknown"
        let keyString: String
        let speakableGroup: INSpeakableString?

        if let chIdx = message.channelIndex {
            keyString = "\(name)@ch\(chIdx)"
            speakableGroup = INSpeakableString(spokenPhrase: content.title)
        } else {
            keyString = message.contactKeyHash.hexCompact
            speakableGroup = nil
        }

        let handle = INPersonHandle(value: keyString, type: .unknown)
        let sender = INPerson(
            personHandle: handle,
            nameComponents: nil,
            displayName: name,
            image: nil,
            contactIdentifier: nil,
            customIdentifier: keyString
        )
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: message.text,
            speakableGroupName: speakableGroup,
            conversationIdentifier: content.threadIdentifier,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate(completion: nil)

        return (try? content.updating(from: intent)) ?? content
    }
    #endif

    // MARK: - Badge

    func updateAppBadge() {
        let totalUnread = unreadCounts.values.reduce(0, +)
        #if os(macOS)
        NSApplication.shared.dockTile.badgeLabel = totalUnread > 0 ? "\(totalUnread)" : nil
        #endif
        #if !os(watchOS)
        Task { @MainActor in
            try? await UNUserNotificationCenter.current().setBadgeCount(totalUnread)
        }
        #endif
    }

    // MARK: - Haptics

    func playHapticFeedback() {
        #if os(iOS)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        #elseif os(watchOS)
        WKInterfaceDevice.current().play(.click)
        #endif
    }

    func playReceiveHaptic() {
        #if os(iOS)
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
        #elseif os(watchOS)
        WKInterfaceDevice.current().play(.notification)
        #endif
    }

    // MARK: - Reset

    func reset() {
        isSyncingMessages = false
        pendingACKs.removeAll()
        pendingChannelEcho = nil
    }
}
