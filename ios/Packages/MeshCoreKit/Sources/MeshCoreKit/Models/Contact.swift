//
//  Contact.swift
//  MeshCoreKit
//
//  Contact model: public key, type, path routing, location, and status.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// Contact type from the MeshCore protocol.
public enum ContactType: UInt8, Codable, Sendable {
    case chat = 1       // Regular chat contact
    case repeater = 2   // Repeater/relay node
    case room = 3       // Room server
    case sensor = 4     // Sensor node
    case unknown = 0

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(UInt8.self)
        self = ContactType(rawValue: raw) ?? .unknown
    }

    public var displayName: String {
        switch self {
        case .chat: return "Contact"
        case .repeater: return "Repeater"
        case .room: return "Room"
        case .sensor: return "Sensor"
        case .unknown: return "Unknown"
        }
    }
}

/// A MeshCore contact discovered on the mesh network.
public struct Contact: Identifiable, Codable, Sendable, Hashable {
    public static func == (lhs: Contact, rhs: Contact) -> Bool {
        lhs.publicKey == rhs.publicKey &&
        lhs.flags == rhs.flags &&
        lhs.name == rhs.name &&
        lhs.lastAdvert == rhs.lastAdvert &&
        lhs.outPathLen == rhs.outPathLen &&
        lhs.latitude == rhs.latitude &&
        lhs.longitude == rhs.longitude
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(publicKey)
        hasher.combine(flags)
        hasher.combine(name)
        hasher.combine(lastAdvert)
        hasher.combine(outPathLen)
        hasher.combine(latitude)
        hasher.combine(longitude)
    }
    /// Use first 6 bytes of publicKey as stable ID.
    public var id: Data { publicKeyPrefix }

    /// First 6 bytes of the public key (used for message routing).
    public var publicKeyPrefix: Data {
        Data(publicKey.prefix(6))
    }

    /// Full 32-byte public key.
    public let publicKey: Data

    /// Display name of the contact.
    public let name: String

    /// Contact type (chat, repeater, room server).
    public let type: ContactType

    /// Protocol flags byte.
    public let flags: UInt8

    /// Outbound path length. -1 = no path known, 0 = direct/neighbor.
    public let outPathLen: Int8

    /// Last time this contact advertised (epoch seconds).
    public var lastAdvert: UInt32

    /// Advertised latitude (degrees × 1,000,000).
    public let latitude: Double

    /// Advertised longitude (degrees × 1,000,000).
    public let longitude: Double

    /// Raw outbound path hashes (up to 64 bytes of routing data for trace route).
    public let outPath: Data

    /// Last modification timestamp (for incremental sync).
    public let lastmod: UInt32

    /// Whether this contact is marked as a favourite (bit 0 of flags).
    public var isFavourite: Bool {
        (flags & 0x01) != 0
    }

    /// Whether this contact is allowed to request telemetry (bit 1 of flags).
    public var allowTelemetry: Bool {
        (flags & 0x02) != 0
    }

    /// Whether to share location in telemetry with this contact (bit 2 of flags).
    public var shareTelemetryLocation: Bool {
        (flags & 0x04) != 0
    }

    /// Last time this contact was seen on the mesh (derived from lastAdvert).
    public var lastSeen: Date {
        lastAdvert > 0 ? lastAdvert.asDate : Date.distantPast
    }

    /// Return a copy with updated flags.
    public func withFlags(_ newFlags: UInt8) -> Contact {
        Contact(
            publicKey: publicKey,
            name: name,
            type: type,
            flags: newFlags,
            outPathLen: outPathLen,
            outPath: outPath,
            lastAdvert: lastAdvert,
            latitude: latitude,
            longitude: longitude,
            lastmod: lastmod
        )
    }

    public init(
        publicKey: Data,
        name: String,
        type: ContactType = .chat,
        flags: UInt8 = 0,
        outPathLen: Int8 = -1,
        outPath: Data = Data(),
        lastAdvert: UInt32 = 0,
        latitude: Double = 0,
        longitude: Double = 0,
        lastmod: UInt32 = 0
    ) {
        self.publicKey = publicKey
        self.name = name
        self.type = type
        self.flags = flags
        self.outPathLen = outPathLen
        self.outPath = outPath
        self.lastAdvert = lastAdvert
        self.latitude = latitude
        self.longitude = longitude
        self.lastmod = lastmod
    }
}
