//
//  ContactStore.swift
//  PommeCore
//
//  Contacts, nicknames, notes, groups, activity status, and Spotlight indexing.
//
//  Created by Michael P. Bedworth on 3/20/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import os.log
#if canImport(CoreSpotlight)
import CoreSpotlight
import UniformTypeIdentifiers
#endif
import MeshCoreKit

/// Observable store for contacts, nicknames, notes, groups, and activity status.
/// Extracted from PommeCoreViewModel to enable fine-grained view observation.
@MainActor @Observable
final class ContactStore {
    private static let logger = Logger(subsystem: "com.pommecore", category: "ContactStore")

    // MARK: - Public State

    var contacts: [Contact] = []
    var pendingNewContacts: [Contact] = []
    var contactGroups: [ContactGroup] = []
    var mutedContacts: Set<String> = []

    // MARK: - Position History

    struct PositionPoint: Codable {
        let latitude: Double
        let longitude: Double
        let timestamp: Date
    }

    /// Position history per contact (keyed by pubkey hex). Max 50 points per contact.
    var positionHistory: [String: [PositionPoint]] = [:]
    private let maxPositionPoints = 50

    // MARK: - Dependencies (set by coordinator)

    /// Closure to send a command frame to the device.
    var sendCommand: ((Data, String) -> Void)?

    /// Closure to get latest activity date for a contact (checks messages).
    var activityDateProvider: ((Data) -> Date?)?

    /// Closure to clear messages when a contact is deleted.
    var clearMessagesForContact: ((Data) -> Void)?

    /// Closure to post an event notification.
    var postEventNotification: ((String, String, String) -> Void)?

    /// Closure to get the connected radio's public key hex (for per-radio data isolation).
    var radioPublicKeyHexProvider: (() -> String)?

    // MARK: - Private State

    private let iCloudStore = NSUbiquitousKeyValueStore.default
    private var nicknames: [String: String] = [:]
    private var contactNotes: [String: String] = [:]

    // Contact sync state
    var incomingContacts: [Contact] = []
    var isSyncingContacts = false
    var isIncrementalContactSync = false
    var lastContactsSync: UInt32 = 0
    var expectedContactCount: UInt32 = 0
    private var contactSyncDebounceTask: Task<Void, Never>?

    // MARK: - Blocked Contacts

    private var blockedPubkeys: Set<String> = []

    func isBlocked(_ contact: Contact) -> Bool {
        blockedPubkeys.contains(contact.publicKey.hexCompact)
    }

    func isBlocked(publicKeyPrefix: Data) -> Bool {
        contacts.first(where: { $0.publicKeyPrefix == publicKeyPrefix })
            .map { isBlocked($0) } ?? false
    }

    func blockContact(_ contact: Contact) {
        blockedPubkeys.insert(contact.publicKey.hexCompact)
        saveBlockedToiCloud()
    }

    func unblockContact(_ contact: Contact) {
        blockedPubkeys.remove(contact.publicKey.hexCompact)
        saveBlockedToiCloud()
    }

    var blockedContacts: [Contact] {
        contacts.filter { isBlocked($0) }
    }

    func loadBlockedFromiCloud() {
        if let list = iCloudStore.loadCodable([String].self, forKey: "blockedContacts") {
            blockedPubkeys = Set(list)
        }
    }

    private func saveBlockedToiCloud() {
        guard iCloudSyncEnabled else { return }
        iCloudStore.saveCodable(Array(blockedPubkeys), forKey: "blockedContacts")
    }

    // MARK: - Init

    init() {
        // Don't load nicknames/notes at init — radio pubkey isn't known yet.
        // They are loaded in handleSelfInfo when the radio connects.
        loadContactGroupsFromiCloud()
        loadMutedContactsFromiCloud()
        loadBlockedFromiCloud()
        loadPositionHistory()
        observeiCloudChanges()
    }

    // MARK: - Sorted Contacts

    var sortedContacts: [Contact] {
        sortedContacts(byLastSeen: false)
    }

    /// Composite last-activity timestamp: max(lastAdvert, last message activity).
    func lastActivityTimestamp(for contact: Contact) -> TimeInterval {
        var latest = TimeInterval(contact.lastAdvert)
        if let activityDate = activityDateProvider?(contact.publicKeyPrefix) {
            latest = max(latest, activityDate.timeIntervalSince1970)
        }
        return latest
    }

    func sortedContacts(byLastSeen: Bool) -> [Contact] {
        contacts.filter { !isBlocked($0) }.sorted { a, b in
            if a.isFavourite != b.isFavourite {
                return a.isFavourite
            }
            if byLastSeen {
                return lastActivityTimestamp(for: a) > lastActivityTimestamp(for: b)
            }
            let nameA = displayName(for: a).strippingEmoji
            let nameB = displayName(for: b).strippingEmoji
            return nameA.localizedCaseInsensitiveCompare(nameB) == .orderedAscending
        }
    }

    // MARK: - Nicknames

    func setNickname(_ nickname: String, for contact: Contact) {
        let key = contact.publicKey.hexCompact
        let trimmed = String(nickname.prefix(32))
        if trimmed.isEmpty {
            nicknames.removeValue(forKey: key)
        } else {
            nicknames[key] = trimmed
        }
        saveNicknamesToiCloud()
    }

    func nickname(for contact: Contact) -> String? {
        let key = contact.publicKey.hexCompact
        guard let value = nicknames[key], !value.isEmpty else { return nil }
        return value
    }

    func displayName(for contact: Contact) -> String {
        if let nick = nickname(for: contact), !nick.isEmpty { return nick }
        if !contact.name.isEmpty { return contact.name }
        // Fallback for contacts with no name (e.g. factory-reset or new radios)
        return Data(contact.publicKey.prefix(4)).hexCompact
    }

    /// Resolve a channel message sender name to a nickname if one exists.
    func channelSenderDisplayName(_ rawSenderName: String) -> String {
        if let contact = contacts.first(where: { $0.name == rawSenderName }) {
            return displayName(for: contact)
        }
        return rawSenderName
    }

    /// iCloud key for nicknames, scoped to the connected radio.
    private var nicknamesKey: String {
        let radioKey = radioPublicKeyHexProvider?() ?? ""
        return radioKey.isEmpty ? "contactNicknames" : "nicknames.\(String(radioKey.prefix(12)))"
    }

    func loadNicknamesFromiCloud() {
        if let decoded: [String: String] = iCloudStore.loadCodable([String: String].self, forKey: nicknamesKey) {
            nicknames = decoded
                .filter { !$0.value.isEmpty }
                .mapValues { $0.count > 32 ? String($0.prefix(32)) : $0 }
            return
        }

        nicknames = [:]
    }

    private func saveNicknamesToiCloud() {
        guard iCloudSyncEnabled else { return }
        let cleaned = nicknames.filter { !$0.value.isEmpty }
        iCloudStore.saveCodable(cleaned, forKey: nicknamesKey)
    }

    // MARK: - Contact Activity Touch

    /// Update a contact's lastAdvert to now. Call this on any activity that proves
    /// the contact is alive: message received, ACK, login success, CLI response.
    func touchContact(publicKeyPrefix: Data) {
        guard let idx = contacts.firstIndex(where: { $0.publicKeyPrefix == publicKeyPrefix }) else { return }
        let now = Date().epochUInt32
        guard contacts[idx].lastAdvert < now else { return } // already current
        // Replace the full struct to ensure @Observable detects the change.
        // In-place struct field mutation may not always trigger SwiftUI view invalidation.
        var updated = contacts[idx]
        updated.lastAdvert = now
        contacts[idx] = updated
    }

    // MARK: - Contact Activity Status

    enum ContactStatus {
        case active, recent, stale, offline
    }

    func contactStatus(for contact: Contact) -> ContactStatus {
        let now = Date().timeIntervalSince1970
        let latest = lastActivityTimestamp(for: contact)

        guard latest > 1_000_000_000 else { return .offline }
        let elapsed = now - latest

        if contact.type == .repeater || contact.type == .room {
            if elapsed < 6 * 3600 { return .active }
            if elapsed < 12 * 3600 { return .recent }
            if elapsed < 48 * 3600 { return .stale }
            return .offline
        } else {
            if elapsed < 1 * 3600 { return .active }
            if elapsed < 6 * 3600 { return .recent }
            if elapsed < 24 * 3600 { return .stale }
            return .offline
        }
    }

    func contactStatusColor(for contact: Contact) -> Color {
        switch contactStatus(for: contact) {
        case .active: return .green
        case .recent: return .yellow
        case .stale: return .gray
        case .offline: return .red
        }
    }

    func contactStatusLabel(for contact: Contact) -> String {
        switch contactStatus(for: contact) {
        case .active: return "active"
        case .recent: return "recently seen"
        case .stale: return "stale"
        case .offline: return "offline"
        }
    }

    // MARK: - Contact Notes

    func note(for contact: Contact) -> String {
        let key = contact.publicKey.hexCompact
        return contactNotes[key] ?? ""
    }

    func setNote(_ note: String, for contact: Contact) {
        let key = contact.publicKey.hexCompact
        if note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            contactNotes.removeValue(forKey: key)
        } else {
            contactNotes[key] = note
        }
        saveContactNotesToiCloud()
    }

    func hasNote(for contact: Contact) -> Bool {
        let key = contact.publicKey.hexCompact
        return contactNotes[key] != nil && !contactNotes[key]!.isEmpty
    }

    private var notesKey: String {
        let radioKey = radioPublicKeyHexProvider?() ?? ""
        return radioKey.isEmpty ? "contactNotes" : "notes.\(String(radioKey.prefix(12)))"
    }

    func loadContactNotesFromiCloud() {
        if let decoded: [String: String] = iCloudStore.loadCodable([String: String].self, forKey: notesKey) {
            contactNotes = decoded
            return
        }

        contactNotes = [:]
    }

    private func saveContactNotesToiCloud() {
        guard iCloudSyncEnabled else { return }
        iCloudStore.saveCodable(contactNotes, forKey: notesKey)
    }

    // MARK: - Contact Groups

    enum GroupNotifyMode: String, Codable, CaseIterable {
        case all = "All Messages"
        case priority = "Priority"
        case muted = "Muted"

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = GroupNotifyMode(rawValue: raw) ?? .all
        }
    }

    enum GroupSound: String, Codable, CaseIterable {
        case `default` = "Default"
        case chime = "Chime"
        case pulse = "Pulse"
        case alert = "Alert"
        case none = "None"

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = GroupSound(rawValue: raw) ?? .default
        }
    }

    struct ContactGroup: Codable, Identifiable {
        let id: UUID
        var name: String
        var emoji: String
        var memberPubkeys: [String]
        var notifyMode: GroupNotifyMode
        var sound: GroupSound

        init(id: UUID = UUID(), name: String, emoji: String = "", memberPubkeys: [String] = [],
             notifyMode: GroupNotifyMode = .all, sound: GroupSound = .default) {
            self.id = id
            self.name = name
            self.emoji = emoji
            self.memberPubkeys = memberPubkeys
            self.notifyMode = notifyMode
            self.sound = sound
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id           = try c.decode(UUID.self, forKey: .id)
            name         = try c.decode(String.self, forKey: .name)
            emoji        = try c.decodeIfPresent(String.self, forKey: .emoji) ?? ""
            memberPubkeys = try c.decodeIfPresent([String].self, forKey: .memberPubkeys) ?? []
            notifyMode   = try c.decodeIfPresent(GroupNotifyMode.self, forKey: .notifyMode) ?? .all
            sound        = try c.decodeIfPresent(GroupSound.self, forKey: .sound) ?? .default
        }
    }

    func loadContactGroupsFromiCloud() {
        guard let decoded = iCloudStore.loadCodable([ContactGroup].self, forKey: "contactGroups") else { return }
        contactGroups = decoded
    }

    private func saveContactGroupsToiCloud() {
        guard iCloudSyncEnabled else { return }
        iCloudStore.saveCodable(contactGroups, forKey: "contactGroups")
    }

    func addContactGroup(name: String, emoji: String) {
        contactGroups.append(ContactGroup(name: name, emoji: emoji))
        saveContactGroupsToiCloud()
    }

    func deleteContactGroup(_ group: ContactGroup) {
        contactGroups.removeAll { $0.id == group.id }
        saveContactGroupsToiCloud()
    }

    func renameContactGroup(_ group: ContactGroup, name: String, emoji: String) {
        if let idx = contactGroups.firstIndex(where: { $0.id == group.id }) {
            contactGroups[idx].name = name
            contactGroups[idx].emoji = emoji
            saveContactGroupsToiCloud()
        }
    }

    func addContactToGroup(_ contact: Contact, group: ContactGroup) {
        let pubkeyHex = contact.publicKey.hexCompact
        if let idx = contactGroups.firstIndex(where: { $0.id == group.id }) {
            if !contactGroups[idx].memberPubkeys.contains(pubkeyHex) {
                contactGroups[idx].memberPubkeys.append(pubkeyHex)
                saveContactGroupsToiCloud()
            }
        }
    }

    func removeContactFromGroup(_ contact: Contact, group: ContactGroup) {
        let pubkeyHex = contact.publicKey.hexCompact
        if let idx = contactGroups.firstIndex(where: { $0.id == group.id }) {
            contactGroups[idx].memberPubkeys.removeAll { $0 == pubkeyHex }
            saveContactGroupsToiCloud()
        }
    }

    func contactsInGroup(_ group: ContactGroup) -> [Contact] {
        contacts.filter { contact in
            let hex = contact.publicKey.hexCompact
            return group.memberPubkeys.contains(hex)
        }
    }

    func setGroupNotifyMode(_ group: ContactGroup, mode: GroupNotifyMode) {
        if let idx = contactGroups.firstIndex(where: { $0.id == group.id }) {
            contactGroups[idx].notifyMode = mode
            saveContactGroupsToiCloud()
        }
    }

    func setGroupSound(_ group: ContactGroup, sound: GroupSound) {
        if let idx = contactGroups.firstIndex(where: { $0.id == group.id }) {
            contactGroups[idx].sound = sound
            saveContactGroupsToiCloud()
        }
    }

    /// Mute/unmute all members of a group.
    func setGroupMembersMuted(_ group: ContactGroup, muted: Bool) {
        for pubkey in group.memberPubkeys {
            if muted {
                mutedContacts.insert(pubkey)
            } else {
                mutedContacts.remove(pubkey)
            }
        }
        saveMutedContactsToiCloud()
    }

    // MARK: - Per-Contact Mute

    func isContactMuted(_ contact: Contact) -> Bool {
        mutedContacts.contains(contact.publicKey.hexCompact)
    }

    func toggleContactMuted(_ contact: Contact) {
        let key = contact.publicKey.hexCompact
        if mutedContacts.contains(key) {
            mutedContacts.remove(key)
        } else {
            mutedContacts.insert(key)
        }
        saveMutedContactsToiCloud()
    }

    /// Returns the most specific notification mode for a contact based on group membership.
    /// Priority > All > Muted. If contact is in multiple groups, highest priority wins.
    func effectiveNotifyMode(for contact: Contact) -> GroupNotifyMode {
        let hex = contact.publicKey.hexCompact
        if mutedContacts.contains(hex) { return .muted }
        var best: GroupNotifyMode = .all
        for group in contactGroups where group.memberPubkeys.contains(hex) {
            if group.notifyMode == .priority { return .priority }
            if group.notifyMode == .muted { best = .muted }
        }
        return best
    }

    /// Returns the notification sound for a contact based on group membership.
    func effectiveSound(for contact: Contact) -> GroupSound {
        let hex = contact.publicKey.hexCompact
        for group in contactGroups where group.memberPubkeys.contains(hex) {
            if group.sound != .default { return group.sound }
        }
        return .default
    }

    func loadMutedContactsFromiCloud() {
        if let array = iCloudStore.array(forKey: "mutedContacts") as? [String] {
            mutedContacts = Set(array)
        }
    }

    private func saveMutedContactsToiCloud() {
        guard iCloudSyncEnabled else { return }
        iCloudStore.set(Array(mutedContacts), forKey: "mutedContacts")
        iCloudStore.synchronize()
    }

    // MARK: - Position History

    /// Record a position update for a contact. Deduplicates if position hasn't changed.
    func recordPosition(for contact: Contact) {
        let lat = contact.latitude
        let lon = contact.longitude
        guard lat != 0 || lon != 0 else { return }

        let key = contact.publicKey.hexCompact
        var history = positionHistory[key] ?? []

        // Skip if same position as last recorded
        if let last = history.last,
           abs(last.latitude - lat) < 0.00001 && abs(last.longitude - lon) < 0.00001 {
            return
        }

        history.append(PositionPoint(latitude: lat, longitude: lon, timestamp: Date()))
        if history.count > maxPositionPoints {
            history.removeFirst(history.count - maxPositionPoints)
        }
        positionHistory[key] = history
        savePositionHistoryDebounced()
    }

    func positionTrail(for contact: Contact) -> [PositionPoint] {
        positionHistory[contact.publicKey.hexCompact] ?? []
    }

    private var positionSavePending = false

    private func savePositionHistoryDebounced() {
        guard !positionSavePending else { return }
        positionSavePending = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 10_000_000_000) // batch every 10s
            self.positionSavePending = false
            self.savePositionHistory()
        }
    }

    func loadPositionHistory() {
        let url = Self.positionHistoryFileURL
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            let data = try Data(contentsOf: url)
            positionHistory = try JSONDecoder().decode([String: [PositionPoint]].self, from: data)
        } catch {
            DebugLogger.shared.log("POSITION: failed to load history: \(error.localizedDescription)", level: .warning)
        }
    }

    private func savePositionHistory() {
        do {
            let data = try JSONEncoder().encode(positionHistory)
            try data.write(to: Self.positionHistoryFileURL, options: .atomic)
        } catch {
            DebugLogger.shared.log("POSITION: failed to save history: \(error.localizedDescription)", level: .warning)
        }
    }

    private static var positionHistoryFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let appDir = dir.appendingPathComponent("MeshCore", isDirectory: true)
        try? FileManager.default.createDirectory(at: appDir, withIntermediateDirectories: true)
        return appDir.appendingPathComponent("position_history.json")
    }

    // MARK: - Favourites

    func toggleFavourite(for contact: Contact) {
        var newFlags = contact.flags
        if contact.isFavourite {
            newFlags &= ~0x01
        } else {
            newFlags |= 0x01
        }

        let frame = MeshCoreProtocol.buildAddUpdateContact(
            publicKey: contact.publicKey,
            type: contact.type.rawValue,
            flags: newFlags,
            outPathLen: contact.outPathLen,
            outPath: contact.outPath,
            advName: contact.name,
            lastAdvert: contact.lastAdvert,
            latitude: Int32(contact.latitude * 1_000_000),
            longitude: Int32(contact.longitude * 1_000_000)
        )
        sendCommand?(frame, "UPDATE_CONTACT_FLAGS")

        if let index = contacts.firstIndex(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) {
            contacts[index] = contact.withFlags(newFlags)
        }
    }

    func updateContactFlags(_ contact: Contact, newFlags: UInt8) {
        let frame = MeshCoreProtocol.buildAddUpdateContact(
            publicKey: contact.publicKey,
            type: contact.type.rawValue,
            flags: newFlags,
            outPathLen: contact.outPathLen,
            outPath: contact.outPath,
            advName: contact.name,
            lastAdvert: contact.lastAdvert,
            latitude: Int32(contact.latitude * 1_000_000),
            longitude: Int32(contact.longitude * 1_000_000)
        )
        sendCommand?(frame, "UPDATE_CONTACT_FLAGS")

        if let index = contacts.firstIndex(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) {
            contacts[index] = contact.withFlags(newFlags)
        }
    }

    // MARK: - Contact Management

    func removeContact(_ contact: Contact) {
        let frame = MeshCoreProtocol.buildRemoveContact(publicKey: contact.publicKey)
        sendCommand?(frame, "REMOVE_CONTACT")
        contacts.removeAll { $0.publicKeyPrefix == contact.publicKeyPrefix }
        // Clean up all local data for this contact
        setNickname("", for: contact)
        setNote("", for: contact)
        clearMessagesForContact?(contact.publicKeyPrefix)
    }

    func resetPath(for contact: Contact) {
        DebugLogger.shared.log("PATH RESET: \(contact.name) — will flood until path discovered", level: .tx)
        let frame = MeshCoreProtocol.buildResetPath(publicKey: contact.publicKey)
        sendCommand?(frame, "RESET_PATH")

        if let index = contacts.firstIndex(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) {
            contacts[index] = Contact(
                publicKey: contact.publicKey,
                name: contact.name,
                type: contact.type,
                flags: contact.flags,
                outPathLen: -1,
                outPath: Data(),
                lastAdvert: contact.lastAdvert,
                latitude: contact.latitude,
                longitude: contact.longitude,
                lastmod: contact.lastmod
            )
        }

        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            self?.requestDebouncedIncrementalSync()
        }
    }

    func setContactPath(_ contact: Contact, pathLen: Int8, pathData: Data) {
        let pathHex = pathData.isEmpty ? "(empty)" : pathData.hexCompact
        let mode = pathLen < 0 ? "flood" : pathLen == 0 ? "direct" : "\(pathLen) hops"
        DebugLogger.shared.log("PATH SET: \(mode) pathLen=\(pathLen) pathHex=\(pathHex) for \(contact.name)", level: .tx)

        let frame = MeshCoreProtocol.buildAddUpdateContact(
            publicKey: contact.publicKey,
            type: contact.type.rawValue,
            flags: contact.flags,
            outPathLen: pathLen,
            outPath: pathData,
            advName: contact.name,
            lastAdvert: contact.lastAdvert,
            latitude: Int32(contact.latitude * 1_000_000),
            longitude: Int32(contact.longitude * 1_000_000)
        )
        sendCommand?(frame, "SET_CONTACT_PATH(len=\(pathLen))")

        if let index = contacts.firstIndex(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) {
            contacts[index] = Contact(
                publicKey: contact.publicKey,
                name: contact.name,
                type: contact.type,
                flags: contact.flags,
                outPathLen: pathLen,
                outPath: pathData,
                lastAdvert: contact.lastAdvert,
                latitude: contact.latitude,
                longitude: contact.longitude,
                lastmod: contact.lastmod
            )
        }

        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            self?.requestDebouncedIncrementalSync()
        }
    }

    func shareContact(_ contact: Contact) {
        let frame = MeshCoreProtocol.buildShareContact(publicKey: contact.publicKey)
        sendCommand?(frame, "SHARE_CONTACT")
    }

    // MARK: - Pending Contacts

    func acceptPendingContact(_ contact: Contact) {
        pendingNewContacts.removeAll { $0.publicKeyPrefix == contact.publicKeyPrefix }
        if !contacts.contains(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) {
            contacts.append(contact)
        }
    }

    func rejectPendingContact(_ contact: Contact) {
        pendingNewContacts.removeAll { $0.publicKeyPrefix == contact.publicKeyPrefix }
        let frame = MeshCoreProtocol.buildRemoveContact(publicKey: contact.publicKey)
        sendCommand?(frame, "REJECT_PENDING_CONTACT")
    }

    // MARK: - Contact Sync (from response handling)

    func handleContactsStart(count: UInt32) {
        Self.logger.info("Contacts sync starting: \(count) contacts expected")
        DebugLogger.shared.log("Contacts sync: \(count) expected", level: .info)
        expectedContactCount = count
        incomingContacts = []
    }

    func handleContact(_ contact: Contact) {
        let c = contactWithTimestamp(contact)
        Self.logger.debug("Received contact: \(c.name) type=\(c.type.rawValue)")
        incomingContacts.append(c)
    }

    /// Finalize contact sync. Returns true if channel sync should be triggered.
    func handleEndOfContacts(lastmod: UInt32) -> Bool {
        Self.logger.info("Contacts sync complete: \(self.incomingContacts.count) contacts, lastmod=\(lastmod), incremental=\(self.isIncrementalContactSync)")
        DebugLogger.shared.log("Contacts done: \(self.incomingContacts.count) synced", level: .info)
        if isIncrementalContactSync {
            if !incomingContacts.isEmpty {
                // Dictionary-based merge: O(n+m) instead of O(n*m)
                var indexByPrefix: [Data: Int] = [:]
                for (i, c) in contacts.enumerated() {
                    indexByPrefix[c.publicKeyPrefix] = i
                }
                var merged = contacts
                for incoming in incomingContacts {
                    if let idx = indexByPrefix[incoming.publicKeyPrefix] {
                        merged[idx] = incoming
                    } else {
                        indexByPrefix[incoming.publicKeyPrefix] = merged.count
                        merged.append(incoming)
                    }
                }
                contacts = merged
            }
        } else {
            contacts = incomingContacts
        }
        incomingContacts = []
        lastContactsSync = lastmod
        let wasFullSync = !isIncrementalContactSync
        isIncrementalContactSync = false
        isSyncingContacts = false

        // Record position history for contacts with coordinates
        for contact in contacts {
            recordPosition(for: contact)
        }

        #if canImport(CoreSpotlight)
        indexContactsForSpotlight()
        #endif

        return wasFullSync
    }

    /// Ensure lastAdvert is set — if firmware sends 0, stamp with current time.
    private func contactWithTimestamp(_ contact: Contact) -> Contact {
        guard contact.lastAdvert < 1_000_000_000 else { return contact }
        let now = Date().epochUInt32
        return Contact(
            publicKey: contact.publicKey, name: contact.name, type: contact.type,
            flags: contact.flags, outPathLen: contact.outPathLen, outPath: contact.outPath,
            lastAdvert: now, latitude: contact.latitude, longitude: contact.longitude,
            lastmod: contact.lastmod
        )
    }

    func handleAdvert(_ contact: Contact) {
        let now = Date().epochUInt32
        if let idx = contacts.firstIndex(where: { $0.publicKeyPrefix == contact.publicKeyPrefix }) {
            if contact.name.isEmpty && contact.type == .unknown {
                // Pubkey-only advert (0x80 short form) — update timestamp on existing contact,
                // don't replace with skeleton data.
                contacts[idx].lastAdvert = now
                DebugLogger.shared.log("ADVERT: timestamp updated for \(contacts[idx].name)", level: .rx)
            } else {
                // Full contact advert — replace with new data
                let c = contactWithTimestamp(contact)
                contacts[idx] = c
                DebugLogger.shared.log("ADVERT: updated \(c.name) lastAdvert=\(c.lastAdvert)", level: .rx)
            }
        } else if !contact.name.isEmpty {
            // Only add new contacts if we have real data (not pubkey-only)
            let c = contactWithTimestamp(contact)
            contacts.append(c)
            DebugLogger.shared.log("ADVERT: new contact \(c.name) lastAdvert=\(c.lastAdvert)", level: .rx)
        } else {
            DebugLogger.shared.log("ADVERT: ignoring pubkey-only for unknown contact", level: .rx)
        }
    }

    func handleNewAdvert(_ contact: Contact, isInBackground: Bool) {
        let c = contactWithTimestamp(contact)
        Self.logger.info("PUSH NewAdvert (manual_add): \(c.name)")
        DebugLogger.shared.log("PUSH NewAdvert: \(c.name)", level: .rx)
        if !pendingNewContacts.contains(where: { $0.publicKeyPrefix == c.publicKeyPrefix }) {
            pendingNewContacts.append(c)
            if isInBackground && NotificationPreferences.shared.notifyNewContacts {
                postEventNotification?("New Contact Discovered", c.name, "contacts")
            }
        }
    }

    func handleContactDeleted(publicKey: Data) {
        let keyPrefix = publicKey.prefix(6)
        let name = contacts.first(where: { $0.publicKeyPrefix == keyPrefix })?.name ?? "Unknown"
        Self.logger.info("Contact deleted by device: \(name)")
        contacts.removeAll { $0.publicKeyPrefix == keyPrefix }
    }

    // MARK: - Path Hash Resolution

    func contactNameForHash(_ hashHex: String) -> String? {
        let hashBytes = Data(stride(from: 0, to: hashHex.count, by: 2).compactMap { i in
            let start = hashHex.index(hashHex.startIndex, offsetBy: i)
            let end = hashHex.index(start, offsetBy: min(2, hashHex.distance(from: start, to: hashHex.endIndex)))
            return UInt8(hashHex[start..<end], radix: 16)
        })
        guard !hashBytes.isEmpty else { return nil }
        for contact in contacts where contact.type == .repeater {
            if contact.publicKeyPrefix.prefix(hashBytes.count) == hashBytes {
                return displayName(for: contact)
            }
        }
        return nil
    }

    // MARK: - Contact Requests

    func requestContacts(fullSync: Bool = false) {
        let since: UInt32 = fullSync ? 0 : lastContactsSync
        isIncrementalContactSync = !fullSync && since > 0
        isSyncingContacts = true
        sendCommand?(MeshCoreProtocol.buildGetContacts(since: since), "GET_CONTACTS(since:\(since))")
    }

    func requestDebouncedIncrementalSync() {
        contactSyncDebounceTask?.cancel()
        contactSyncDebounceTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled, let self else { return }
            self.requestContacts()
        }
    }

    // MARK: - Spotlight

    #if canImport(CoreSpotlight)
    func indexContactsForSpotlight() {
        var items: [CSSearchableItem] = []
        for contact in contacts {
            let attrs = CSSearchableItemAttributeSet(contentType: .contact)
            attrs.displayName = displayName(for: contact)
            attrs.contentDescription = "PommeCore \(contact.type == .repeater ? "repeater" : contact.type == .room ? "room server" : "contact")"
            let pubkeyHex = contact.publicKey.hexCompact
            let item = CSSearchableItem(
                uniqueIdentifier: "meshcore.contact.\(pubkeyHex)",
                domainIdentifier: "com.mbedworth.meshcore.contacts",
                attributeSet: attrs
            )
            item.expirationDate = .distantFuture
            items.append(item)
        }
        CSSearchableIndex.default().indexSearchableItems(items)
    }
    #endif

    // MARK: - iCloud Changes

    private func observeiCloudChanges() {
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: iCloudStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                // Only reload nicknames/notes if a radio is connected (key is scoped)
                if let radioKey = self?.radioPublicKeyHexProvider?(), !radioKey.isEmpty {
                    self?.loadNicknamesFromiCloud()
                    self?.loadContactNotesFromiCloud()
                }
                self?.loadContactGroupsFromiCloud()
                self?.loadMutedContactsFromiCloud()
                self?.loadBlockedFromiCloud()
            }
        }
    }

    // MARK: - Reset

    func reset() {
        contactSyncDebounceTask?.cancel()
        isSyncingContacts = false
        isIncrementalContactSync = false
        lastContactsSync = 0
        incomingContacts = []
        pendingNewContacts = []
        contacts = []
        nicknames = [:]
        contactNotes = [:]
    }
}
