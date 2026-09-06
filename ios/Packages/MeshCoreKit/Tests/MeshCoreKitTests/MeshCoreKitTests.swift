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
    private var selfInfoPayload: Data {
        var data = Data([1, 22, 30]) // Type, transmit power, maximum power.
        data.append(Data(repeating: 0xAB, count: 32))
        data.append(Data(repeating: 0, count: 8)) // Latitude and longitude.
        data.append(contentsOf: [1, 0, 0, 1]) // ACK, location, telemetry, contact policy.
        data.append(contentsOf: [0x10, 0xD3, 0x0D, 0x00]) // 906000 kHz, little endian.
        data.append(contentsOf: [0x90, 0xD0, 0x03, 0x00]) // 250000 Hz.
        data.append(contentsOf: [11, 5]) // Spreading factor, coding rate.
        return data
    }

    func testSelfInfoRejectsEveryTruncatedFixedPayload() {
        let payload = selfInfoPayload
        XCTAssertEqual(payload.count, 57)
        for count in 0..<payload.count {
            let truncated = Data(payload.prefix(count))
            let frame = Data([MeshCoreResponseCode.selfInfo.rawValue]) + truncated
            guard case .unknown(let type, let retainedPayload) = FrameParser.parse(frame) else {
                XCTFail("Accepted truncated self info with \(count) payload bytes")
                continue
            }
            XCTAssertEqual(type, MeshCoreResponseCode.selfInfo.rawValue)
            XCTAssertEqual(retainedPayload, truncated)
        }
    }

    func testSelfInfoAcceptsCompleteFixedPayloadWithoutAName() {
        let frame = Data([MeshCoreResponseCode.selfInfo.rawValue]) + selfInfoPayload
        guard case .selfInfo(let info) = FrameParser.parse(frame) else {
            return XCTFail("Rejected complete self info")
        }
        XCTAssertEqual(info.publicKey, Data(repeating: 0xAB, count: 32))
        XCTAssertEqual(info.radioFreq, 906000)
        XCTAssertEqual(info.radioBW, 250000)
        XCTAssertEqual(info.radioSF, 11)
        XCTAssertEqual(info.radioCR, 5)
        XCTAssertEqual(info.name, "")
    }

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

    // MARK: - Statistics receipt and malformed replies

    func testStatisticsStayUnknownUntilTheirOwnReplyArrives() {
        let config = DeviceConfig()
        XCTAssertNil(config.availableUptimeSeconds)
        XCTAssertFalse(config.hasCoreStats)
        XCTAssertFalse(config.hasRadioStats)
        XCTAssertFalse(config.hasPacketStats)

        XCTAssertTrue(config.applyStats(subType: 0, payload: Data(repeating: 0, count: 9)))
        XCTAssertTrue(config.hasCoreStats)
        XCTAssertEqual(config.availableUptimeSeconds, 0, "A zero-second uptime is a valid reported reading")
        XCTAssertFalse(config.hasRadioStats, "Core statistics cannot certify the radio readings")
        XCTAssertFalse(config.hasPacketStats)

        config.reportedUptimeSeconds = 42
        XCTAssertEqual(config.availableUptimeSeconds, 42)
    }

    func testTruncatedStatisticsNeverCreateOrOverwriteReadings() {
        for (subType, minimumLength) in [(UInt8(0), 9), (UInt8(1), 12), (UInt8(2), 24)] {
            let config = DeviceConfig()
            for length in 0..<minimumLength {
                XCTAssertFalse(config.applyStats(subType: subType, payload: Data(repeating: 0, count: length)))
                XCTAssertFalse(config.hasCoreStats)
                XCTAssertFalse(config.hasRadioStats)
                XCTAssertFalse(config.hasPacketStats)
            }
        }

        let config = DeviceConfig()
        let complete = Data([0x3C, 0x0F, 0x78, 0x56, 0x34, 0x12, 0x02, 0x01, 0x03])
        XCTAssertTrue(config.applyStats(subType: 0, payload: complete))
        XCTAssertEqual(config.statsBatteryMV, 3900)
        XCTAssertEqual(config.statsUptime, 0x12345678)
        XCTAssertEqual(config.statsErrorFlags, 0x0102)
        XCTAssertEqual(config.statsQueueLength, 3)
        XCTAssertFalse(config.applyStats(subType: 0, payload: complete.dropLast()))
        XCTAssertFalse(config.applyStats(subType: 99, payload: complete))
        XCTAssertEqual(config.statsUptime, 0x12345678)
    }

    func testRadioStatisticsPreserveSignedReadingsAndValidZeroSNR() {
        let config = DeviceConfig()
        XCTAssertTrue(config.applyStats(subType: 1, payload: Data([0x8A, 0xFF, 0x94, 0, 1, 0, 0, 0, 2, 0, 0, 0])))
        XCTAssertTrue(config.hasRadioStats)
        XCTAssertEqual(config.statsNoiseFloor, -118)
        XCTAssertEqual(config.statsLastRSSI, -108)
        XCTAssertEqual(config.statsLastSNR, 0)
        XCTAssertEqual(config.statsTXAirtime, 1)
        XCTAssertEqual(config.statsRXAirtime, 2)
    }

    func testOptionalReceiveErrorsRequireACompleteCounterAndResetWithTheRadio() {
        let config = DeviceConfig()
        let base = Data([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0])
        XCTAssertTrue(config.applyStats(subType: 2, payload: base + Data([7, 0, 0, 0])))
        XCTAssertTrue(config.hasReceiveErrorStats)
        XCTAssertEqual(config.statsReceiveErrors, 7)
        for suffixLength in 0...3 {
            XCTAssertTrue(config.applyStats(subType: 2, payload: base + Data(repeating: 0, count: suffixLength)))
            XCTAssertTrue(config.hasPacketStats)
            XCTAssertFalse(config.hasReceiveErrorStats)
        }
        XCTAssertEqual(config.statsPacketsReceived, 1)
        XCTAssertEqual(config.statsPacketsSent, 2)
        XCTAssertEqual(config.statsRecvDirect, 6)
        XCTAssertTrue(config.applyStats(subType: 0, payload: Data(repeating: 0, count: 9)))
        XCTAssertTrue(config.applyStats(subType: 1, payload: Data(repeating: 0, count: 12)))
        config.reset()
        XCTAssertNil(config.availableUptimeSeconds)
        XCTAssertFalse(config.hasCoreStats)
        XCTAssertFalse(config.hasRadioStats)
        XCTAssertFalse(config.hasPacketStats)
        XCTAssertFalse(config.hasReceiveErrorStats)
    }
}
