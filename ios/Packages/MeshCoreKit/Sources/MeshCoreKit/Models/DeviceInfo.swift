//
//  DeviceInfo.swift
//  MeshCoreKit
//
//  Parsed RESP_CODE_DEVICE_INFO and RESP_CODE_SELF_INFO payloads.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// Information about a connected MeshCore device.
public struct DeviceInfo: Codable, Sendable {
    /// Device display name.
    public let name: String

    /// Firmware version string.
    public let firmwareVersion: String

    /// Battery level (0–100), if available.
    public let batteryLevel: Int?

    /// Raw payload data for future parsing enhancements.
    public let rawData: Data

    public init(name: String, firmwareVersion: String, batteryLevel: Int?, rawData: Data) {
        self.name = name
        self.firmwareVersion = firmwareVersion
        self.batteryLevel = batteryLevel
        self.rawData = rawData
    }
}
