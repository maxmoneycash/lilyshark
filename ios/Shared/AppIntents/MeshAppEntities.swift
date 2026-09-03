//
//  MeshAppEntities.swift
//  PommeCore
//
//  AppEntity types for Siri / Shortcuts entity resolution.
//
//  Created by Michael P. Bedworth on 04/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import AppIntents
import MeshCoreKit

// MARK: - Contact Entity

struct ContactEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Mesh Contact")
    static let defaultQuery = ContactEntityQuery()

    let id: String   // publicKeyPrefix
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: LocalizedStringResource(stringLiteral: name))
    }

    struct ContactEntityQuery: EntityQuery {
        func entities(for identifiers: [String]) async throws -> [ContactEntity] {
            let contacts = await MainActor.run { AppIntentBridge.shared.contactStore?.contacts ?? [] }
            return contacts
                .filter { identifiers.contains($0.publicKeyPrefix.hexCompact) }
                .map { ContactEntity(id: $0.publicKeyPrefix.hexCompact, name: $0.name) }
        }

        func suggestedEntities() async throws -> [ContactEntity] {
            let contacts = await MainActor.run { AppIntentBridge.shared.contactStore?.contacts ?? [] }
            return contacts.map { ContactEntity(id: $0.publicKeyPrefix.hexCompact, name: $0.name) }
        }
    }
}

// MARK: - Channel Entity

struct ChannelEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Mesh Channel")
    static let defaultQuery = ChannelEntityQuery()

    let id: String   // String(channel.index)
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: LocalizedStringResource(stringLiteral: name))
    }

    struct ChannelEntityQuery: EntityQuery {
        func entities(for identifiers: [String]) async throws -> [ChannelEntity] {
            let channels = await MainActor.run { AppIntentBridge.shared.channelStore?.channels ?? [] }
            return channels
                .filter { identifiers.contains(String($0.index)) }
                .map { ChannelEntity(id: String($0.index), name: $0.name) }

        }

        func suggestedEntities() async throws -> [ChannelEntity] {
            let channels = await MainActor.run { AppIntentBridge.shared.channelStore?.channels ?? [] }
            return channels.map { ChannelEntity(id: String($0.index), name: $0.name) }
        }
    }
}
#endif
