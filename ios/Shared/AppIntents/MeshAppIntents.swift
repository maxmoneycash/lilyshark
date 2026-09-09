//
//  MeshAppIntents.swift
//  PommeCore
//
//  Siri and Shortcuts actions: send DM, send channel message, get unread count.
//
//  Created by Michael P. Bedworth on 04/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import AppIntents
import MeshCoreKit

// MARK: - Send Direct Message

struct SendDirectMessageIntent: AppIntent {
    static let title: LocalizedStringResource = "Send Mesh Message"
    static let description = IntentDescription("Send a direct message to a mesh contact.")
    static let openAppWhenRun = false

    @Parameter(title: "Contact") var recipient: ContactEntity
    @Parameter(title: "Message") var message: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let bridge = AppIntentBridge.shared
        let isConnected = await MainActor.run { bridge.connectionManager?.isActivelyConnected ?? false }
        guard isConnected else {
            throw IntentError.notConnected
        }
        try await MainActor.run {
            guard let contact = bridge.contactStore?.contacts.first(where: { $0.publicKeyPrefix.hexCompact == recipient.id }) else {
                throw IntentError.contactNotFound
            }
            guard let store = bridge.messageStoreManager, store.sendTextMessage(message, to: contact), store.lastSendError == nil else {
                throw IntentError.sendRejected(bridge.messageStoreManager?.lastSendError ?? "Open Lilyshark and connect a deck to send.")
            }
        }
        return .result(dialog: "Message queued for \(recipient.name). Delivery is not confirmed.")
    }
}

// MARK: - Send Channel Message

struct SendChannelMessageIntent: AppIntent {
    static let title: LocalizedStringResource = "Send Channel Message"
    static let description = IntentDescription("Send a message to a mesh channel.")
    static let openAppWhenRun = false

    @Parameter(title: "Channel") var channel: ChannelEntity
    @Parameter(title: "Message") var message: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let bridge = AppIntentBridge.shared
        let isConnected = await MainActor.run { bridge.connectionManager?.isActivelyConnected ?? false }
        guard isConnected else {
            throw IntentError.notConnected
        }
        try await MainActor.run {
            guard let ch = bridge.channelStore?.channels.first(where: { String($0.index) == channel.id }) else {
                throw IntentError.channelNotFound
            }
            guard let store = bridge.messageStoreManager, store.sendChannelMessage(message, channelIndex: ch.index), store.lastSendError == nil else {
                throw IntentError.sendRejected(bridge.messageStoreManager?.lastSendError ?? "Open Lilyshark and connect a deck to send.")
            }
        }
        return .result(dialog: "Message queued for \(channel.name). Delivery is not confirmed.")
    }
}

// MARK: - Get Unread Count

struct GetUnreadCountIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Unread Message Count"
    static let description = IntentDescription("Returns the number of unread mesh messages.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let count = await MainActor.run {
            AppIntentBridge.shared.messageStoreManager?.unreadCounts.values.reduce(0, +) ?? 0
        }
        if count == 0 {
            return .result(dialog: "No unread mesh messages.")
        }
        return .result(dialog: "\(count) unread mesh message\(count == 1 ? "" : "s").")
    }
}

// MARK: - Errors

private enum IntentError: Error, LocalizedError {
    case notConnected
    case contactNotFound
    case channelNotFound
    case sendRejected(String)

    var errorDescription: String? {
        switch self {
        case .notConnected: return "Radio is not connected."
        case .contactNotFound: return "Contact not found."
        case .channelNotFound: return "Channel not found."
        case .sendRejected(let reason): return reason
        }
    }
}
#endif
