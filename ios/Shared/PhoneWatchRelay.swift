//
//  PhoneWatchRelay.swift
//  PommeCore
//
//  WCSessionDelegate for iPhone — observes stores, pushes to watch, handles commands.
//
//  Created by Michael P. Bedworth on 4/19/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if os(iOS) && canImport(PommeCoreWatchKit)
import Foundation
import WatchConnectivity
import MeshCoreKit
import PommeCoreWatchKit

@MainActor
final class PhoneWatchRelay: NSObject {
    weak var contactStore: ContactStore?
    weak var channelStore: ChannelStore?
    weak var messageStoreManager: MessageStoreManager?
    weak var connectionManager: ConnectionManager?

    private var session: WCSession { .default }

    var isReachable: Bool {
        WCSession.isSupported() && session.activationState == .activated && session.isReachable
    }

    // Debounce tasks — coalesce rapid changes before sending to watch.
    private var stateSendTask: Task<Void, Never>?
    private var contactsSendTask: Task<Void, Never>?
    private var channelsSendTask: Task<Void, Never>?
    private var messagesSendTask: Task<Void, Never>?

    // Last-sent payload cache — skip WCSession transfer when payload is unchanged.
    private var lastSentStateData: Data?
    private var lastSentContactsData: Data?
    private var lastSentChannelsData: Data?
    // Per-contact newest-message timestamp — skip re-sending all 50 messages when nothing new arrived.
    private var lastSentMessageTimestamp: [Data: Date] = [:]

    private var activated = false

    func activate() {
        guard !activated, WCSession.isSupported() else { return }
        activated = true
        session.delegate = self
        session.activate()
        startObserving()
    }

    // MARK: - Observation

    private func startObserving() {
        func trackState() {
            withObservationTracking {
                _ = connectionManager?.connectionState
                _ = connectionManager?.connectedDeviceName
                _ = messageStoreManager?.unreadCounts
            } onChange: {
                Task { @MainActor [weak self] in
                    self?.scheduleSendState()
                    trackState()
                }
            }
        }
        trackState()

        func trackContacts() {
            withObservationTracking {
                _ = contactStore?.contacts
            } onChange: {
                Task { @MainActor [weak self] in
                    self?.scheduleSendContacts()
                    trackContacts()
                }
            }
        }
        trackContacts()

        func trackChannels() {
            withObservationTracking {
                _ = channelStore?.channels
            } onChange: {
                Task { @MainActor [weak self] in
                    self?.scheduleSendChannels()
                    trackChannels()
                }
            }
        }
        trackChannels()

        func trackMessages() {
            withObservationTracking {
                _ = messageStoreManager?.messagesByContact
            } onChange: {
                Task { @MainActor [weak self] in
                    self?.scheduleSendUnreadMessages()
                    trackMessages()
                }
            }
        }
        trackMessages()
    }

    private func scheduleSendState() {
        stateSendTask?.cancel()
        stateSendTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.sendState()
        }
    }

    private func scheduleSendContacts() {
        contactsSendTask?.cancel()
        contactsSendTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.sendContacts()
        }
    }

    private func scheduleSendChannels() {
        channelsSendTask?.cancel()
        channelsSendTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.sendChannels()
        }
    }

    private func scheduleSendUnreadMessages() {
        messagesSendTask?.cancel()
        messagesSendTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            self?.sendAllUnreadMessages()
        }
    }

    func sendAllUnreadMessages() {
        guard let store = messageStoreManager, let contacts = contactStore?.contacts else { return }
        for (key, count) in store.unreadCounts where count > 0 {
            if key.count == 6,
               let contact = contacts.first(where: { $0.publicKeyPrefix == key }) {
                let newest = store.messagesByContact[key]?.last?.timestamp
                guard newest != lastSentMessageTimestamp[key] else { continue }
                lastSentMessageTimestamp[key] = newest
                sendRecentMessages(for: contact.publicKey.hexCompact)
            } else if key.count == 1 {
                let newest = store.messagesByContact[key]?.last?.timestamp
                guard newest != lastSentMessageTimestamp[key] else { continue }
                lastSentMessageTimestamp[key] = newest
                sendChannelMessages(channelIndex: key[0])
            }
        }
    }

    // MARK: - Push State

    func sendState() {
        guard session.activationState == .activated else { return }
        let state = connectionManager?.connectionState
        let isConnected = state == .ready || state == .connected
        let unreadByContact = resolvedUnreadCounts()
        let (dmCount, channelCount) = resolvedSplitCounts()
        let payload = WatchAppStatePayload(
            isConnected: isConnected,
            deviceName: connectionManager?.connectedDeviceName ?? "",
            unreadByContact: unreadByContact,
            isUnlocked: WatchUnlockManager.shared.isUnlocked,
            unreadDMCount: dmCount,
            unreadChannelCount: channelCount
        )
        guard let data = try? JSONEncoder().encode(payload) else { return }
        guard data != lastSentStateData else { return }
        lastSentStateData = data
        try? session.updateApplicationContext([WatchKey.topic: WatchTopic.state.rawValue, WatchKey.data: data])
    }

    func sendContacts() {
        guard session.activationState == .activated else { return }
        guard let store = contactStore else { return }
        let watchContacts = store.contacts.map { contact in
            WatchContact(
                publicKeyHex: contact.publicKey.hexCompact,
                name: contact.name,
                displayName: store.displayName(for: contact),
                typeRaw: contact.type.rawValue,
                lastAdvert: contact.lastAdvert,
                latitude: contact.latitude,
                longitude: contact.longitude,
                isFavourite: contact.isFavourite
            )
        }
        guard let data = try? JSONEncoder().encode(watchContacts) else { return }
        guard data != lastSentContactsData else { return }
        lastSentContactsData = data
        session.transferUserInfo([WatchKey.topic: WatchTopic.contacts.rawValue, WatchKey.data: data])
    }

    func sendChannels() {
        guard session.activationState == .activated else { return }
        guard let store = channelStore else { return }
        let watchChannels = store.channels.filter(\.isActive).map { ch in
            WatchChannel(
                index: ch.index,
                name: ch.name,
                channelTypeRaw: channelTypeString(ch)
            )
        }
        guard let data = try? JSONEncoder().encode(watchChannels) else { return }
        guard data != lastSentChannelsData else { return }
        lastSentChannelsData = data
        session.transferUserInfo([WatchKey.topic: WatchTopic.channels.rawValue, WatchKey.data: data])
    }

    func sendNewMessage(_ message: Message, contactKeyHex: String) {
        guard session.activationState == .activated else { return }
        let watchMsg = makeWatchMessage(message, contactKeyHex: contactKeyHex)
        guard let data = try? JSONEncoder().encode([watchMsg]) else { return }
        let payload: [String: Any] = [
            WatchKey.topic: WatchTopic.messages.rawValue,
            WatchKey.contactKeyHex: contactKeyHex,
            WatchKey.data: data
        ]
        if isReachable {
            session.sendMessage(payload, replyHandler: nil)
        } else {
            session.transferUserInfo(payload)
        }
        sendState()
    }

    func sendRecentMessages(for contactKeyHex: String) {
        guard session.activationState == .activated,
              let store = messageStoreManager,
              let keyData = Data(hexString: contactKeyHex) else { return }
        let contactKey = Data(keyData.prefix(6))
        let msgs = (store.messagesByContact[contactKey] ?? []).suffix(50)
            .map { makeWatchMessage($0, contactKeyHex: contactKeyHex) }
        guard let data = try? JSONEncoder().encode(msgs) else { return }
        let payload: [String: Any] = [
            WatchKey.topic: WatchTopic.messages.rawValue,
            WatchKey.contactKeyHex: contactKeyHex,
            WatchKey.data: data
        ]
        if isReachable {
            session.sendMessage(payload, replyHandler: nil)
        } else {
            session.transferUserInfo(payload)
        }
    }

    func sendChannelMessages(channelIndex: UInt8) {
        guard session.activationState == .activated,
              let store = messageStoreManager else { return }
        let channelKey = Data([channelIndex])
        let contactKeyHex = WatchContact.channelKey(channelIndex)
        let msgs = (store.messagesByContact[channelKey] ?? []).suffix(50)
            .map { makeWatchMessage($0, contactKeyHex: contactKeyHex) }
        guard let data = try? JSONEncoder().encode(msgs) else { return }
        let payload: [String: Any] = [
            WatchKey.topic: WatchTopic.messages.rawValue,
            WatchKey.contactKeyHex: contactKeyHex,
            WatchKey.data: data
        ]
        if isReachable {
            session.sendMessage(payload, replyHandler: nil)
        } else {
            session.transferUserInfo(payload)
        }
    }

    // MARK: - Handle Commands from Watch

    private func handleCommand(_ dict: [String: Any]) {
        guard let cmdRaw = dict[WatchKey.command] as? String,
              let cmdData = dict[WatchKey.commandData] as? Data,
              let payload = try? JSONDecoder().decode(WatchCommandPayload.self, from: cmdData),
              let cmd = WatchCommand(rawValue: cmdRaw) else { return }

        switch cmd {
        case .sendDM:
            guard let keyHex = payload.contactKeyHex,
                  let text = payload.text,
                  let contact = contactStore?.contacts.first(where: { $0.publicKey.hexCompact == keyHex }) else { return }
            messageStoreManager?.sendTextMessage(text, to: contact)

        case .sendChannelMessage:
            guard let text = payload.text, let index = payload.channelIndex else { return }
            messageStoreManager?.sendChannelMessage(text, channelIndex: index)

        case .markRead:
            guard let keyHex = payload.contactKeyHex,
                  let keyData = Data(hexString: keyHex) else { return }
            messageStoreManager?.markAsRead(contactKey: Data(keyData.prefix(6)))

        case .requestMessages:
            if let keyHex = payload.contactKeyHex {
                if let index = WatchContact.channelIndexFrom(key: keyHex) {
                    sendChannelMessages(channelIndex: index)
                } else {
                    sendRecentMessages(for: keyHex)
                }
            }

        case .sendAdvert:
            connectionManager?.sendAdvertise(type: 1)

        case .requestRefresh:
            lastSentStateData = nil
            lastSentContactsData = nil
            lastSentChannelsData = nil
            lastSentMessageTimestamp = [:]
            sendState()
            sendContacts()
            sendChannels()
            sendAllUnreadMessages()

        case .sendReaction:
            guard let emoji = payload.emoji,
                  let msgIDString = payload.messageID,
                  let msgID = UUID(uuidString: msgIDString) else { return }

            if let chIdx = payload.channelIndex {
                let chKey = Data([chIdx])
                guard let msg = messageStoreManager?.messagesByContact[chKey]?.first(where: { $0.id == msgID }) else { return }
                let hash = messageStoreManager?.reactionHash(for: msg) ?? ""
                let sender = msg.senderName ?? ""
                let reactionText = "\(emoji)@[\(sender)]\n\(hash)"
                messageStoreManager?.sendChannelMessage(reactionText, channelIndex: chIdx)
                messageStoreManager?.addReactionLocal(emoji, to: msg)
            } else {
                guard let keyHex = payload.contactKeyHex,
                      let keyData = Data(hexString: keyHex),
                      let msg = messageStoreManager?.messagesByContact[Data(keyData.prefix(6))]?.first(where: { $0.id == msgID }) else { return }
                messageStoreManager?.addReaction(emoji, to: msg)
            }
        }
    }

    // MARK: - Helpers

    private func makeWatchMessage(_ message: Message, contactKeyHex: String) -> WatchMessage {
        WatchMessage(
            id: message.id,
            contactKeyHex: contactKeyHex,
            text: message.text,
            timestamp: message.timestamp,
            isOutgoing: message.isOutgoing,
            statusRaw: message.status.rawValue,
            senderName: message.senderName,
            channelIndex: message.channelIndex,
            hops: message.hops,
            reactions: message.reactions
        )
    }

    private func channelTypeString(_ ch: MeshChannel) -> String {
        switch ch.channelType {
        case .publicChannel: return "public"
        case .hashChannel: return "hash"
        case .privateChannel: return "private"
        }
    }

    private func resolvedUnreadCounts() -> [String: Int] {
        guard let store = messageStoreManager, let contacts = contactStore?.contacts else { return [:] }
        var result: [String: Int] = [:]
        for (key, count) in store.unreadCounts where count > 0 {
            if key.count == 6,
               let contact = contacts.first(where: { $0.publicKeyPrefix == key }) {
                result[contact.publicKey.hexCompact] = count
            } else if key.count == 1 {
                result[WatchContact.channelKey(key[0])] = count
            }
        }
        return result
    }

    private func resolvedSplitCounts() -> (dm: Int, channel: Int) {
        guard let store = messageStoreManager, let contacts = contactStore?.contacts else { return (0, 0) }
        var dmCount = 0
        var channelCount = 0
        for (key, count) in store.unreadCounts where count > 0 {
            if key.count == 6 {
                if let contact = contacts.first(where: { $0.publicKeyPrefix == key }),
                   let contactStore,
                   contactStore.effectiveNotifyMode(for: contact) != .muted {
                    dmCount += count
                }
            } else if key.count == 1 {
                let channelIndex = key[0]
                if let channel = channelStore?.channels.first(where: { $0.index == channelIndex }),
                   let channelStore,
                   channelStore.channelNotifyMode(for: channel.name) != .muted {
                    channelCount += count
                }
            }
        }
        return (dmCount, channelCount)
    }
}

// MARK: - WCSessionDelegate

extension PhoneWatchRelay: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        guard state == .activated else { return }
        Task { @MainActor in
            sendState()
            sendContacts()
            sendChannels()
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in
            // Flush payload caches so watch gets a full refresh on reconnect.
            lastSentStateData = nil
            lastSentContactsData = nil
            lastSentChannelsData = nil
            lastSentMessageTimestamp = [:]
            sendState()
            sendContacts()
            sendChannels()
            sendAllUnreadMessages()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in handleCommand(message) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        Task { @MainActor in handleCommand(userInfo) }
    }
}
#elseif os(iOS)
// PommeCoreWatchKit is a private package; without it the watch relay is a
// no-op so the iPhone app builds and runs standalone.
import Foundation
import MeshCoreKit

@MainActor
final class PhoneWatchRelay: NSObject {
    weak var contactStore: ContactStore?
    weak var channelStore: ChannelStore?
    weak var messageStoreManager: MessageStoreManager?
    weak var connectionManager: ConnectionManager?

    var isReachable: Bool { false }

    func activate() {}
    func sendAllUnreadMessages() {}
    func sendState() {}
    func sendContacts() {}
    func sendChannels() {}
    func sendNewMessage(_ message: Message, contactKeyHex: String) {}
    func sendRecentMessages(for contactKeyHex: String) {}
    func sendChannelMessages(channelIndex: UInt8) {}
}
#endif
