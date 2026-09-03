//
//  MeshProfileExport.swift
//  PommeCore
//
//  Versioned Codable model for .meshprofile config export files.
//  Version history:
//    1 — initial: radio params + channels. privateKeyHex reserved (always nil).
//

import Foundation

struct MeshProfileExport: Codable {
    let version: Int
    let exportedAt: Date
    let appVersion: String
    let radio: MeshProfileRadio
    let channels: [MeshProfileChannel]
    // Reserved — always nil until firmware adds PIN-protected binary key export.
    let privateKeyHex: String?
    let exportedWithPIN: Bool?

    static let currentVersion = 1
}

extension MeshProfileExport {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        exportedAt = try c.decodeIfPresent(Date.self, forKey: .exportedAt) ?? Date()
        appVersion = try c.decodeIfPresent(String.self, forKey: .appVersion) ?? ""
        radio = try c.decode(MeshProfileRadio.self, forKey: .radio)
        channels = try c.decodeIfPresent([MeshProfileChannel].self, forKey: .channels) ?? []
        privateKeyHex = try c.decodeIfPresent(String.self, forKey: .privateKeyHex)
        exportedWithPIN = try c.decodeIfPresent(Bool.self, forKey: .exportedWithPIN)
    }
}

struct MeshProfileRadio: Codable {
    let deviceName: String
    let advertName: String
    let radioFrequency: UInt32    // kHz × 1000
    let radioBandwidth: UInt32    // Hz
    let radioSpreadingFactor: UInt8
    let radioCodingRate: UInt8
    let radioTXPower: UInt8
    let repeatMode: Bool
    let manualAddContacts: UInt8
    let telemetryBase: UInt8
    let telemetryLocation: UInt8
    let advertLocPolicy: UInt8
    let multiACK: UInt8
    let autoAddBitmask: UInt8
    let defaultFloodScope: String
    let rxDelayBase: UInt32
    let airtimeFactor: UInt32
}

extension MeshProfileRadio {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deviceName = try c.decodeIfPresent(String.self, forKey: .deviceName) ?? ""
        advertName = try c.decodeIfPresent(String.self, forKey: .advertName) ?? ""
        radioFrequency = try c.decodeIfPresent(UInt32.self, forKey: .radioFrequency) ?? 0
        radioBandwidth = try c.decodeIfPresent(UInt32.self, forKey: .radioBandwidth) ?? 0
        radioSpreadingFactor = try c.decodeIfPresent(UInt8.self, forKey: .radioSpreadingFactor) ?? 9
        radioCodingRate = try c.decodeIfPresent(UInt8.self, forKey: .radioCodingRate) ?? 5
        radioTXPower = try c.decodeIfPresent(UInt8.self, forKey: .radioTXPower) ?? 22
        repeatMode = try c.decodeIfPresent(Bool.self, forKey: .repeatMode) ?? false
        manualAddContacts = try c.decodeIfPresent(UInt8.self, forKey: .manualAddContacts) ?? 0
        telemetryBase = try c.decodeIfPresent(UInt8.self, forKey: .telemetryBase) ?? 0
        telemetryLocation = try c.decodeIfPresent(UInt8.self, forKey: .telemetryLocation) ?? 0
        advertLocPolicy = try c.decodeIfPresent(UInt8.self, forKey: .advertLocPolicy) ?? 0
        multiACK = try c.decodeIfPresent(UInt8.self, forKey: .multiACK) ?? 0
        autoAddBitmask = try c.decodeIfPresent(UInt8.self, forKey: .autoAddBitmask) ?? 0
        defaultFloodScope = try c.decodeIfPresent(String.self, forKey: .defaultFloodScope) ?? ""
        rxDelayBase = try c.decodeIfPresent(UInt32.self, forKey: .rxDelayBase) ?? 0
        airtimeFactor = try c.decodeIfPresent(UInt32.self, forKey: .airtimeFactor) ?? 0
    }
}

struct MeshProfileChannel: Codable {
    let index: UInt8
    let name: String
    let flags: UInt8
    // 16-byte PSK as lowercase hex. Nil for public channel (index 0) and hash channels.
    let secretHex: String?
}
