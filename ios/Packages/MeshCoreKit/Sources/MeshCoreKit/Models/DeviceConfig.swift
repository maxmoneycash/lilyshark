//
//  DeviceConfig.swift
//  MeshCoreKit
//
//  Observable device configuration populated by any transport.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import Observation

/// Determines which settings/features are available based on device type.
/// Companion radios (BLE-connected local device) have limited features.
/// Repeaters and room servers expose more configuration options.
public struct DeviceCapabilities {
    public let canRepeat: Bool
    public let hasChat: Bool
    public let hasACL: Bool
    public let hasGuestPassword: Bool
    public let hasAdminPassword: Bool
    public let hasNeighbors: Bool
    public let hasReadOnlyMode: Bool
    public let hasPowerSaving: Bool
    public let hasOwnerInfo: Bool
    public let hasAdvertIntervals: Bool
    public let hasRegionManagement: Bool

    /// Companion radio — the locally BLE-connected device. Limited feature set.
    public static let companion = DeviceCapabilities(
        canRepeat: false, hasChat: true, hasACL: false,
        hasGuestPassword: false, hasAdminPassword: false, hasNeighbors: false,
        hasReadOnlyMode: false, hasPowerSaving: false, hasOwnerInfo: false,
        hasAdvertIntervals: false, hasRegionManagement: false
    )

    /// Repeater node — relay-only device with full admin features.
    public static let repeater = DeviceCapabilities(
        canRepeat: true, hasChat: false, hasACL: true,
        hasGuestPassword: true, hasAdminPassword: true, hasNeighbors: true,
        hasReadOnlyMode: false, hasPowerSaving: true, hasOwnerInfo: true,
        hasAdvertIntervals: true, hasRegionManagement: true
    )

    /// Room server — chat-capable managed device with full admin features.
    public static let roomServer = DeviceCapabilities(
        canRepeat: true, hasChat: true, hasACL: true,
        hasGuestPassword: true, hasAdminPassword: true, hasNeighbors: false,
        hasReadOnlyMode: true, hasPowerSaving: true, hasOwnerInfo: true,
        hasAdvertIntervals: true, hasRegionManagement: true
    )

    /// Determine capabilities from contact type.
    public static func forContactType(_ type: ContactType) -> DeviceCapabilities {
        switch type {
        case .repeater: return .repeater
        case .room: return .roomServer
        default: return .companion
        }
    }
}

/// Complete device configuration populated from various response codes.
/// @Observable for fine-grained SwiftUI tracking — views only re-render
/// when the specific properties they read change.
@Observable
public final class DeviceConfig {

    // MARK: - Device Info (from RESP_CODE_DEVICE_INFO code 13 + SELF_INFO code 5)

    public var deviceName: String = ""
    /// Device self type from SELF_INFO: 1=companion, 2=repeater, 3=room server
    public var selfType: UInt8 = 1
    public var firmwareVersion: String = ""  // from DEVICE_INFO firmwareVer byte
    public var buildDate: String = ""         // from DEVICE_INFO 12-char cstring
    public var manufacturer: String = ""      // from DEVICE_INFO null-terminated model
    public var semanticVersion: String = ""   // from DEVICE_INFO null-terminated version
    public var publicKeyHex: String = ""      // from SELF_INFO 32-byte public key
    public var maxTXPower: UInt8 = 22
    public var maxContacts: UInt16 = 0        // from DEVICE_INFO maxContactsDiv2 × 2
    public var maxChannels: UInt8 = 0         // from DEVICE_INFO (group channels)

    // MARK: - Battery (from RESP_CODE_BATT_AND_STORAGE code 12)

    public var batteryMillivolts: UInt16 = 0

    // MARK: - Identity & Advertising

    public var latitude: Double = 0.0
    public var longitude: Double = 0.0
    public var advertLocPolicy: UInt8 = 0  // 0=don't share, 1=share

    // MARK: - Radio Configuration

    public var radioFrequency: UInt32 = 906000  // freq * 1000, kHz
    public var radioBandwidth: UInt32 = 250000   // BW * 1000
    public var radioSpreadingFactor: UInt8 = 12
    public var radioCodingRate: UInt8 = 5  // 5=4/5, 6=4/6, 7=4/7, 8=4/8
    public var radioTXPower: UInt8 = 22
    public var repeatMode: Bool = false

    // MARK: - Tuning Parameters

    public var rxDelayBase: UInt32 = 0  // value * 1000
    public var airtimeFactor: UInt32 = 0 // value * 1000
    public var txDelay: UInt32 = 0       // value * 1000
    public var directTxDelay: UInt32 = 0 // value * 1000

    // MARK: - Privacy & Security

    public var manualAddContacts: UInt8 = 0
    public var telemetryBase: UInt8 = 0      // bits 0-1
    public var telemetryLocation: UInt8 = 0   // bits 2-3
    public var multiACK: UInt8 = 0
    public var blePIN: UInt32 = 0

    /// Auto-add bitmask: bit 0 = chat, bit 1 = repeater, bit 2 = room, bit 3 = sensor.
    public var autoAddBitmask: UInt8 = 0x0F  // default: all types
    /// Maximum hop count for auto-add. From RESP_CODE_AUTOADD_CONFIG byte 2.
    public var autoAddMaxHops: UInt8 = 3

    // MARK: - Default Flood Scope (firmware 1.15.0+)

    /// Region name used as default flood scope. Empty string = not configured.
    public var defaultFloodScope: String = ""

    // MARK: - Time

    public var deviceTimeEpoch: UInt32 = 0

    // MARK: - Custom Variables

    public var customVars: [(name: String, value: String)] = []

    // MARK: - Statistics

    // Core stats (sub_type 0)
    public var statsBatteryMV: Int16 = 0
    public var statsUptime: UInt32 = 0
    public var statsErrorFlags: UInt16 = 0
    public var statsQueueLength: UInt8 = 0

    // Radio stats (sub_type 1)
    public var statsNoiseFloor: Int16 = 0
    public var statsLastRSSI: Int8 = 0
    public var statsLastSNR: Int8 = 0          // SNR * 4
    public var statsTXAirtime: UInt32 = 0      // seconds
    public var statsRXAirtime: UInt32 = 0      // seconds

    // Packet stats (sub_type 2)
    public var statsPacketsReceived: UInt32 = 0
    public var statsPacketsSent: UInt32 = 0
    public var statsFloodCount: UInt32 = 0     // sent flood
    public var statsDirectCount: UInt32 = 0    // sent direct
    public var statsRecvFlood: UInt32 = 0
    public var statsRecvDirect: UInt32 = 0
    public var statsReceiveErrors: UInt32 = 0

    // MARK: - Loading State

    public var isLoading: Bool = false
    public var loadedSections: Set<String> = []

    public init() {}

    /// Reset all properties to defaults. Keeps the same instance so environment
    /// references remain valid (important for @Environment injection).
    public func reset() {
        deviceName = ""
        selfType = 1
        firmwareVersion = ""
        buildDate = ""
        manufacturer = ""
        semanticVersion = ""
        publicKeyHex = ""
        maxTXPower = 22
        maxContacts = 0
        maxChannels = 0
        batteryMillivolts = 0
        latitude = 0.0
        longitude = 0.0
        advertLocPolicy = 0
        radioFrequency = 906000
        radioBandwidth = 250000
        radioSpreadingFactor = 12
        radioCodingRate = 5
        radioTXPower = 22
        repeatMode = false
        rxDelayBase = 0
        airtimeFactor = 0
        txDelay = 0
        directTxDelay = 0
        manualAddContacts = 0
        telemetryBase = 0
        telemetryLocation = 0
        multiACK = 0
        blePIN = 0
        autoAddBitmask = 0x0F
        autoAddMaxHops = 3
        defaultFloodScope = ""
        deviceTimeEpoch = 0
        customVars = []
        statsBatteryMV = 0
        statsUptime = 0
        statsErrorFlags = 0
        statsQueueLength = 0
        statsNoiseFloor = 0
        statsLastRSSI = 0
        statsLastSNR = 0
        statsTXAirtime = 0
        statsRXAirtime = 0
        statsPacketsReceived = 0
        statsPacketsSent = 0
        statsFloodCount = 0
        statsDirectCount = 0
        statsRecvFlood = 0
        statsRecvDirect = 0
        statsReceiveErrors = 0
        isLoading = false
        loadedSections = []
        batteryCalibration = nil
    }

    public var batteryVoltage: Double {
        Double(batteryMillivolts) / 1000.0
    }

    /// Battery percentage using the given chemistry profile.
    public func batteryPercent(chemistry: BatteryChemistry = .lipo) -> Int {
        chemistry.profile.percentage(forMillivolts: Int(batteryMillivolts))
    }

    public var frequencyMHz: Double {
        Double(radioFrequency) / 1000.0
    }

    public var bandwidthKHz: Double {
        Double(radioBandwidth) / 1000.0
    }

    public var rxDelaySeconds: Double {
        Double(rxDelayBase) / 1000.0
    }

    public var airtimeMultiplier: Double {
        Double(airtimeFactor) / 1000.0
    }

    public var deviceTimeDate: Date? {
        guard deviceTimeEpoch > 0 else { return nil }
        return deviceTimeEpoch.asDate
    }

    // MARK: - Battery Calibration (per-device, iCloud synced)

    public var batteryCalibration: BatteryCalibration?

    public func loadBatteryCalibration() {
        let key = "battery.cal.\(publicKeyHex)"
        let store = NSUbiquitousKeyValueStore.default
        guard let data = store.data(forKey: key),
              let cal = try? JSONDecoder().decode(BatteryCalibration.self, from: data) else { return }
        batteryCalibration = cal
    }

    public func saveBatteryCalibration(_ cal: BatteryCalibration) {
        let syncEnabled = UserDefaults.standard.object(forKey: "iCloudSyncEnabled") == nil
            ? true : UserDefaults.standard.bool(forKey: "iCloudSyncEnabled")
        guard syncEnabled else { return }
        let key = "battery.cal.\(publicKeyHex)"
        let store = NSUbiquitousKeyValueStore.default
        if let data = try? JSONEncoder().encode(cal) {
            store.set(data, forKey: key)
            store.synchronize()
        }
    }

    public func resetBatteryCalibration() {
        let key = "battery.cal.\(publicKeyHex)"
        let store = NSUbiquitousKeyValueStore.default
        store.removeObject(forKey: key)
        store.synchronize()
        batteryCalibration = nil
    }

    public func updateBatteryCalibration(rawMillivolts: UInt16, chemistry: BatteryChemistry) {
        let rawVoltage = Double(rawMillivolts) / 1000.0
        var cal = batteryCalibration ?? BatteryCalibration(chemistry: chemistry.rawValue)
        cal.chemistry = chemistry.rawValue
        cal.updateWithReading(rawVoltage, theoreticalMax: chemistry.theoreticalMax)
        batteryCalibration = cal
        saveBatteryCalibration(cal)
    }
}
