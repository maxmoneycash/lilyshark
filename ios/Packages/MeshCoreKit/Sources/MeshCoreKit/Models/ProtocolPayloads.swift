//
//  ProtocolPayloads.swift
//  MeshCoreKit
//
//  Parsed protocol response structs: status, telemetry, trace, and stats.
//
//  Created by Michael P. Bedworth on 3/14/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// A node discovered via the discover feature (PUSH_CODE_CONTROL_DATA).
public struct DiscoveredNode: Identifiable, Sendable {
    public var id: Data { publicKey }

    public let publicKey: Data
    public let name: String
    public let type: ContactType
    public let snr: Int8
    public let rssi: Int8
    public let pathLen: UInt8
    public let latitude: Double
    public let longitude: Double

    public init(publicKey: Data, name: String, type: ContactType, snr: Int8, rssi: Int8, pathLen: UInt8, latitude: Double = 0, longitude: Double = 0) {
        self.publicKey = publicKey
        self.name = name
        self.type = type
        self.snr = snr
        self.rssi = rssi
        self.pathLen = pathLen
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// A hop in a trace route result.
public struct TraceHop: Identifiable, Sendable {
    public let id = UUID()
    public let nodeHash: Data
    public let snr: Int8

    public init(nodeHash: Data, snr: Int8) {
        self.nodeHash = nodeHash
        self.snr = snr
    }
}

/// Result of a trace route request.
public struct TraceResult: Sendable {
    public let tag: UInt32
    public let hops: [TraceHop]

    public init(tag: UInt32, hops: [TraceHop]) {
        self.tag = tag
        self.hops = hops
    }
}

/// A telemetry reading from a sensor contact.
public struct TelemetryReading: Identifiable, Sendable {
    public let id = UUID()
    public let name: String
    public let value: Double
    public let unit: String

    public init(name: String, value: Double, unit: String) {
        self.name = name
        self.value = value
        self.unit = unit
    }
}

/// Status response from a remote device.
public struct RemoteStatusInfo: Sendable {
    public let batteryMV: UInt16
    public let uptime: UInt32
    public let contacts: UInt16
    public let rawData: Data

    public init(batteryMV: UInt16, uptime: UInt32, contacts: UInt16, rawData: Data) {
        self.batteryMV = batteryMV
        self.uptime = uptime
        self.contacts = contacts
        self.rawData = rawData
    }
}

/// An allowed repeat frequency range. Values are in kHz (matching firmware FreqRange struct).
public struct FrequencyRange: Sendable {
    public let lowerKHz: UInt32
    public let upperKHz: UInt32

    public init(lowerKHz: UInt32, upperKHz: UInt32) {
        self.lowerKHz = lowerKHz
        self.upperKHz = upperKHz
    }
}

/// Result of a path discovery request (PUSH_CODE_PATH_DISCOVERY_RESPONSE 0x8D).
/// Contains bidirectional path info: how to reach the contact (outPath) and how the contact reaches us (inPath).
public struct PathDiscoveryResult: Sendable {
    public let pubKeyPrefix: Data    // 6 bytes
    public let outPathLen: UInt8     // encoded: hopCount = outPathLen & 0x3F
    public let outPathBytes: Data
    public let inPathLen: UInt8      // encoded: hopCount = inPathLen & 0x3F
    public let inPathBytes: Data
    public let timestamp: Date

    public var outHopCount: Int { Int(outPathLen & 0x3F) }
    public var inHopCount: Int { Int(inPathLen & 0x3F) }

    public init(pubKeyPrefix: Data, outPathLen: UInt8, outPathBytes: Data, inPathLen: UInt8, inPathBytes: Data, timestamp: Date) {
        self.pubKeyPrefix = pubKeyPrefix
        self.outPathLen = outPathLen
        self.outPathBytes = outPathBytes
        self.inPathLen = inPathLen
        self.inPathBytes = inPathBytes
        self.timestamp = timestamp
    }
}

/// Advert path info for a contact.
public struct AdvertPathInfo: Sendable {
    public let recvTimestamp: UInt32
    public let pathLen: UInt8
    public let pathHashes: [Data]

    public init(recvTimestamp: UInt32, pathLen: UInt8, pathHashes: [Data]) {
        self.recvTimestamp = recvTimestamp
        self.pathLen = pathLen
        self.pathHashes = pathHashes
    }
}
