//
//  Channel.swift
//  MeshCoreKit
//
//  Channel model: index, name, PSK, and Codable persistence.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// Channel type derived from flags byte.
public enum ChannelType: Sendable, Codable {
    case publicChannel   // flag bit 0 clear — open broadcast
    case hashChannel     // flag bit 0 set, no secret — hashtag group
    case privateChannel  // flag bit 0 set, has secret — encrypted private group

    public var iconName: String {
        switch self {
        case .publicChannel: return "megaphone.fill"
        case .hashChannel: return "number"
        case .privateChannel: return "lock.fill"
        }
    }

    public var displayPrefix: String {
        // Channel names already include "#" for hash channels — no extra prefix needed
        return ""
    }
}

/// A MeshCore channel for group communication.
public struct MeshChannel: Identifiable, Codable, Sendable {
    public var id: UInt8 { index }

    /// Channel index on the device (0..<maxChannels).
    public let index: UInt8

    /// Channel display name (up to 32 chars).
    public let name: String

    /// Raw flags byte from the device.
    public let flags: UInt8

    /// Locally stored channel secret (32 bytes). Never sent by the device.
    public var secret: Data?

    /// Derived channel type based on index and name.
    /// Index 0 is always the public channel. Names starting with "#" are hashtag channels.
    /// Everything else is a private channel.
    public var channelType: ChannelType {
        if index == 0 {
            return .publicChannel
        } else if name.hasPrefix("#") {
            return .hashChannel
        } else {
            return .privateChannel
        }
    }

    /// Whether this channel has content (non-empty name).
    public var isActive: Bool {
        !name.isEmpty
    }

    public init(index: UInt8, name: String, flags: UInt8, secret: Data? = nil) {
        self.index = index
        self.name = name
        self.flags = flags
        self.secret = secret
    }
}
