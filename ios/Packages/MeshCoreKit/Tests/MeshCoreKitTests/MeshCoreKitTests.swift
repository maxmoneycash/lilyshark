//
//  MeshCoreKitTests.swift
//  MeshCoreKit
//
//  Protocol frame validation tests.
//
//  Created by Michael P. Bedworth on 04/06/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import XCTest
@testable import MeshCoreKit

final class MeshCoreKitTests: XCTestCase {
    func testBuildAppStart() {
        let frame = MeshCoreProtocol.buildAppStart()
        XCTAssertEqual(frame[0], 0x01, "First byte should be appStart command")
        XCTAssertGreaterThan(frame.count, 1, "Frame should include app version and name")
    }

    func testBuildGetBattAndStorage() {
        let frame = MeshCoreProtocol.buildGetBattAndStorage()
        XCTAssertEqual(frame, Data([0x14]))
    }

    func testPublicKeyHash() {
        let keyData = Data(repeating: 0xAB, count: 32)
        let hash = MeshCoreCrypto.publicKeyHash(from: keyData)
        XCTAssertEqual(hash.count, 6)
    }

    // MARK: - Battery reading

    func testNothingReportedIsUnknownAndNotZeroPercent() {
        // The whole point of the enum. With no voltage,
        // BatteryProfile.percentage(forMillivolts: 0) returns 0, so anything
        // that resolves to an Int here hands the UI a flat battery for a radio
        // that has simply not said anything yet.
        let config = DeviceConfig()
        XCTAssertEqual(config.batteryReading(), .unknown)
    }

    func testTheRadiosOwnPercentWinsOverTheVoltageCurve() {
        // 3.92 V interpolates to 64% off the LiPo table, but the radio said
        // 87%. Its own number wins, and the case says which one is on screen —
        // the two disagree because they are different tables, and only ours
        // gets the per-device calibration.
        let config = DeviceConfig()
        config.batteryMillivolts = 3920
        config.reportedBatteryPercent = 87
        XCTAssertEqual(config.batteryReading(), .reported(87))
    }

    func testVoltageAloneIsAnEstimate() {
        let config = DeviceConfig()
        config.batteryMillivolts = 3920
        XCTAssertEqual(config.batteryReading(), .estimated(64))
    }

    func testExternalPowerIsNeverShownAsAFullBattery() {
        // A charging rail sits at a full cell's voltage. Running that through
        // the curve prints 100% for a deck that may have no cell in it.
        let config = DeviceConfig()
        config.batteryMillivolts = 4200
        config.isExternallyPowered = true
        XCTAssertEqual(config.batteryReading(), .externalPower)
    }

    func testUptimeFallsBackToTelemetryWhenStatsAreSilent() {
        // A deck answers no CMD_GET_STATS, so statsUptime stays 0 forever and
        // every uptime row read an em dash while telemetry was carrying one.
        let config = DeviceConfig()
        config.reportedUptimeSeconds = 3600
        XCTAssertEqual(config.displayUptimeSeconds, 3600)
    }

    func testResetClearsWhatTheRadioReported() {
        // reset() keeps the same instance for @Environment, so a field it
        // forgets carries the last radio's health onto the next one.
        let config = DeviceConfig()
        config.reportedBatteryPercent = 87
        config.isExternallyPowered = true
        config.reportedUptimeSeconds = 3600
        config.healthReportedAt = Date()

        config.reset()

        XCTAssertNil(config.reportedBatteryPercent)
        XCTAssertFalse(config.isExternallyPowered)
        XCTAssertNil(config.reportedUptimeSeconds)
        XCTAssertNil(config.healthReportedAt)
        XCTAssertEqual(config.batteryReading(), .unknown)
    }
}
