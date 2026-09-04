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
        // A radio that reports its own percentage is measuring a cell we can
        // only guess at from voltage, so its number wins.
        //
        // The 87 here is arbitrary, chosen only so it CANNOT be the value the
        // curve would produce — 3.92 V interpolates to 64 — which is what
        // makes the assertion prove that `.reported` was taken rather than
        // `.estimated`.
        //
        // An earlier version of this comment claimed the firmware's LiPo table
        // and the app's "disagree because they are different tables". That was
        // invented. src/device/battery_model.cpp:15-18 and
        // BatteryProfile.swift:139-149 are the SAME curve — the app's is the
        // firmware's with 3750/3850/3950 dropped, and those points sit exactly
        // on the app's interpolation. Both give 64 at 3.92 V. The real
        // divergence is per-device calibration, which exists only on the
        // MeshCore path.
        let config = DeviceConfig()
        config.batteryMillivolts = 3920
        config.reportedBatteryPercent = 87
        XCTAssertEqual(config.batteryReading(), .reported(87))
    }

    func testAVoltageThatStopsBeingReportedGoesBackToUnknown() {
        // The bug this exists to prevent. The firmware stops sending a battery
        // once the cell falls below its `present` floor, and the handler used
        // to assign batteryMillivolts only when a voltage arrived — so the
        // last good reading stayed on screen, redated on every packet, for a
        // deck that had stopped reporting one.
        //
        // Zero is the sentinel for "not reported", and it must read as unknown
        // rather than as a flat battery, which is the one number an operator
        // would act on.
        let config = DeviceConfig()
        config.batteryMillivolts = 3920
        XCTAssertEqual(config.batteryReading(), .estimated(64))

        config.batteryMillivolts = 0
        XCTAssertEqual(
            config.batteryReading(),
            .unknown,
            "a battery that stopped being reported is unknown, not empty"
        )
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
