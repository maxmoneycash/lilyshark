//
//  BatteryProfile.swift
//  MeshCoreKit
//
//  Per-device battery voltage-to-percent calibration with iCloud sync.
//
//  Created by Michael P. Bedworth on 3/14/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation

/// Battery chemistry types supported by MeshCore devices.
public enum BatteryChemistry: String, CaseIterable, Identifiable, Sendable {
    case lipo = "lipo"
    case lifepo4 = "lifepo4"
    case li18650 = "li18650"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .lipo: return "LiPo / NMC"
        case .lifepo4: return "LiFePO4"
        case .li18650: return "Li-Ion"
        }
    }

    public var subtitle: String {
        switch self {
        case .lipo: return "Heltec, most ESP32 devices"
        case .lifepo4: return "Stable voltage, custom builds"
        case .li18650: return "RAK devices, custom builds"
        }
    }

    public var profile: BatteryProfile {
        switch self {
        case .lipo: return .lipo
        case .lifepo4: return .lifepo4
        case .li18650: return .li18650
        }
    }

    /// Theoretical maximum voltage for this chemistry.
    public var theoreticalMax: Double {
        switch self {
        case .lipo: return 4.20
        case .lifepo4: return 3.65
        case .li18650: return 4.20
        }
    }
}

/// Per-device battery calibration that auto-corrects ADC measurement error.
public struct BatteryCalibration: Codable, Sendable {
    public var chemistry: String
    public var measuredMaxVoltage: Double
    public var correctionFactor: Double

    public init(chemistry: String, measuredMaxVoltage: Double = 0, correctionFactor: Double = 1.0) {
        self.chemistry = chemistry
        self.measuredMaxVoltage = measuredMaxVoltage
        self.correctionFactor = correctionFactor
    }

    public mutating func updateWithReading(_ rawVoltage: Double, theoreticalMax: Double) {
        guard rawVoltage > 0 else { return }
        if rawVoltage > measuredMaxVoltage {
            measuredMaxVoltage = rawVoltage
            if measuredMaxVoltage > 0 {
                correctionFactor = theoreticalMax / measuredMaxVoltage
            }
        }
    }

    public func correctedVoltage(_ rawVoltage: Double) -> Double {
        rawVoltage * correctionFactor
    }

    public func correctedMillivolts(_ rawMV: UInt16) -> Int {
        Int(Double(rawMV) * correctionFactor)
    }
}

/// Voltage-to-percentage lookup table for a specific battery chemistry.
public struct BatteryProfile: Sendable {
    /// Voltage/percentage points sorted descending by voltage.
    public let points: [(voltage: Double, percentage: Int)]

    /// Interpolate battery percentage from millivolts.
    public func percentage(forMillivolts mv: Int) -> Int {
        let voltage = Double(mv) / 1000.0
        guard !points.isEmpty else { return 0 }

        // Above highest point
        if voltage >= points[0].voltage { return points[0].percentage }
        // Below lowest point
        if voltage <= points[points.count - 1].voltage { return points[points.count - 1].percentage }

        // Find the two points to interpolate between
        for i in 0..<points.count - 1 {
            let upper = points[i]
            let lower = points[i + 1]
            if voltage >= lower.voltage {
                let range = upper.voltage - lower.voltage
                guard range > 0 else { return lower.percentage }
                let delta = voltage - lower.voltage
                let pctRange = upper.percentage - lower.percentage
                return lower.percentage + Int(Double(pctRange) * delta / range)
            }
        }
        return 0
    }

    // MARK: - Predefined Profiles

    /// LiPo / NMC — most common (Heltec, most ESP32 devices).
    public static let lipo = BatteryProfile(points: [
        (4.20, 100),
        (4.10, 90),
        (4.00, 80),
        (3.90, 60),
        (3.80, 40),
        (3.70, 20),
        (3.60, 10),
        (3.50, 5),
        (3.30, 0),
    ])

    /// LiFePO4 — stable voltage curve, some custom builds.
    public static let lifepo4 = BatteryProfile(points: [
        (3.60, 100),
        (3.40, 90),
        (3.35, 80),
        (3.32, 60),
        (3.30, 40),
        (3.27, 20),
        (3.20, 10),
        (3.00, 0),
    ])

    /// Li-Ion 18650 — RAK devices, some custom builds.
    public static let li18650 = BatteryProfile(points: [
        (4.20, 100),
        (4.05, 90),
        (3.95, 80),
        (3.85, 60),
        (3.75, 40),
        (3.65, 20),
        (3.55, 10),
        (3.40, 5),
        (3.00, 0),
    ])
}
