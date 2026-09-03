//
//  Message.swift
//  MeshCoreKit
//
//  Message model: text, status, delivery tracking, and Codable persistence.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// Delivery status for outgoing messages.
public enum DeliveryStatus: String, Codable, Sendable {
    case sending    // queued, not yet confirmed by device
    case sent       // device accepted it (RESP_CODE_SENT received)
    case delivered  // ACK received from recipient (PUSH_CODE_SEND_CONFIRMED)
    case failed     // send timed out or errored
    case retrying   // automatic retry in progress (direct path)
    case flooding   // retrying via flood after path reset
    case repeated   // channel message confirmed repeated by nearby repeater

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = DeliveryStatus(rawValue: raw) ?? .sent // map removed cases (e.g. "noRepeats") to .sent
    }
}

/// A text message sent or received via the MeshCore mesh network.
public struct Message: Identifiable, Codable, Sendable {
    public let id: UUID

    /// Public key hash of the sender (empty Data for outgoing).
    public let senderKeyHash: Data

    /// Public key hash of the contact this message belongs to.
    public let contactKeyHash: Data

    /// Message text content.
    public let text: String

    /// Timestamp when the message was sent or received.
    public let timestamp: Date

    /// Whether this message was sent by the local user.
    public let isOutgoing: Bool

    /// Delivery status for outgoing messages.
    public var status: DeliveryStatus

    /// Expected ACK code from the device (for tracking delivery confirmation).
    public var expectedACK: UInt32?

    /// SNR of the received message (raw value from protocol, divide by 4.0 for dB).
    public let snr: Int8?

    /// Hop count from the received message (0 = direct, 0xFF = routed/unknown, >0 = number of hops).
    public let hops: UInt8?

    /// Channel index (for channel messages, nil for direct).
    public let channelIndex: UInt8?

    /// Sender name (for channel messages).
    public let senderName: String?

    /// Round-trip time in milliseconds (set on delivery confirmation).
    public var roundTripMs: UInt32?

    /// Text type: 0 = plain text, 1 = CLI data. Used to route CLI responses to management.
    public let txtType: UInt8

    /// Send attempt number (0 = first try, increments on retry).
    public var attempt: UInt8

    /// Whether this message was cryptographically signed (txt_type=2).
    public let isSigned: Bool

    /// Suggested timeout from device (ms) for ACK wait. Stored for retry reuse.
    public var suggestedTimeoutMs: UInt32?

    /// Whether path was reset (flood phase active).
    public var didResetPath: Bool

    /// Local-only emoji reactions (not persisted to mesh, PommeCore-to-PommeCore feature).
    public var reactions: [String]

    public init(
        id: UUID = UUID(),
        senderKeyHash: Data = Data(),
        contactKeyHash: Data = Data(),
        text: String,
        timestamp: Date,
        isOutgoing: Bool,
        status: DeliveryStatus = .sending,
        expectedACK: UInt32? = nil,
        snr: Int8? = nil,
        hops: UInt8? = nil,
        channelIndex: UInt8? = nil,
        senderName: String? = nil,
        roundTripMs: UInt32? = nil,
        txtType: UInt8 = 0,
        attempt: UInt8 = 0,
        isSigned: Bool = false,
        suggestedTimeoutMs: UInt32? = nil,
        didResetPath: Bool = false,
        reactions: [String] = []
    ) {
        self.id = id
        self.senderKeyHash = senderKeyHash
        self.contactKeyHash = contactKeyHash
        self.text = text
        self.timestamp = timestamp
        self.isOutgoing = isOutgoing
        self.status = status
        self.expectedACK = expectedACK
        self.snr = snr
        self.hops = hops
        self.channelIndex = channelIndex
        self.senderName = senderName
        self.roundTripMs = roundTripMs
        self.txtType = txtType
        self.attempt = attempt
        self.isSigned = isSigned
        self.suggestedTimeoutMs = suggestedTimeoutMs
        self.didResetPath = didResetPath
        self.reactions = reactions
    }

    // Backward-compatible decoder — reactions may not exist in older persisted data
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        senderKeyHash = try container.decode(Data.self, forKey: .senderKeyHash)
        contactKeyHash = try container.decode(Data.self, forKey: .contactKeyHash)
        text = try container.decode(String.self, forKey: .text)
        timestamp = try container.decode(Date.self, forKey: .timestamp)
        isOutgoing = try container.decode(Bool.self, forKey: .isOutgoing)
        status = try container.decode(DeliveryStatus.self, forKey: .status)
        expectedACK = try container.decodeIfPresent(UInt32.self, forKey: .expectedACK)
        snr = try container.decodeIfPresent(Int8.self, forKey: .snr)
        hops = try container.decodeIfPresent(UInt8.self, forKey: .hops)
        channelIndex = try container.decodeIfPresent(UInt8.self, forKey: .channelIndex)
        senderName = try container.decodeIfPresent(String.self, forKey: .senderName)
        roundTripMs = try container.decodeIfPresent(UInt32.self, forKey: .roundTripMs)
        txtType = try container.decodeIfPresent(UInt8.self, forKey: .txtType) ?? 0
        attempt = try container.decodeIfPresent(UInt8.self, forKey: .attempt) ?? 0
        isSigned = try container.decodeIfPresent(Bool.self, forKey: .isSigned) ?? false
        suggestedTimeoutMs = try container.decodeIfPresent(UInt32.self, forKey: .suggestedTimeoutMs)
        didResetPath = try container.decodeIfPresent(Bool.self, forKey: .didResetPath) ?? false
        reactions = try container.decodeIfPresent([String].self, forKey: .reactions) ?? []
    }
}
