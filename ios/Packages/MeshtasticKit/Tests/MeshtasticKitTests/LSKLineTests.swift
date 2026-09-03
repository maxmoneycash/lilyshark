//
//  LSKLineTests.swift
//  MeshtasticKitTests
//
//  Every line below is built from the firmware's own printf format string in
//  src/sim_main.cpp, field for field and in the same order, so a change on
//  either side shows up here rather than on a bench.
//

import Foundation
import XCTest
@testable import MeshtasticKit

final class LSKLineTests: XCTestCase {

    // MARK: - LSK ID

    func testIdentityCarriesFirmwareBoardAndNodeNumber() {
        // handle_analyzer_link_command prints this on every LSK HELLO.
        let line = #"LSK ID {"app":"lilyshark","fw":"0.9.3","board":"t-deck","node":"!a1b2c3d4"}"#
        guard case .line(.identity(let identity)) = LSKDecoder.decode(line) else {
            return XCTFail("expected an identity, got \(LSKDecoder.decode(line))")
        }
        XCTAssertEqual(identity.app, "lilyshark")
        XCTAssertEqual(identity.firmwareVersion, "0.9.3")
        XCTAssertEqual(identity.board, "t-deck")
        XCTAssertEqual(identity.nodeID, "!a1b2c3d4")
        XCTAssertEqual(identity.nodeNum, 0xa1b2_c3d4)
        XCTAssertTrue(identity.isLilyshark)
    }

    func testIdentityFromAnotherBoardIsNotLilyshark() {
        // A dev board that answers on the same port must not pass for a deck.
        let line = #"LSK ID {"app":"something-else","fw":"1.0","board":"x","node":"!0"}"#
        guard case .line(.identity(let identity)) = LSKDecoder.decode(line) else {
            return XCTFail("expected an identity")
        }
        XCTAssertFalse(identity.isLilyshark)
    }

    func testIdentityMissingAFieldIsMalformedRatherThanAnEmptyFirmware() {
        // Accepting this would let a half-printed line link, with a blank
        // version string standing in for a firmware nobody checked.
        let line = #"LSK ID {"app":"lilyshark","board":"t-deck","node":"!1"}"#
        XCTAssertEqual(LSKDecoder.decode(line), .malformed(kind: "ID"))
    }

    // MARK: - LSK T

    func testTelemetryWithAFixParsesEveryFieldTheFirmwarePrints() {
        let line = #"LSK T {"bat":"BAT 84%","gps":"GPS 9","profile":"US 915 LONGFAST","#
            + #""frames":41,"rssi_x10":-912,"snr_x10":63,"sim":false,"#
            + #""lat":37.911000,"lon":-122.018000,"mv":3985,"pct":84,"sat":9,"#
            + #""freq_hz":906875000,"sf":11,"bw_hz":250000,"rx":128,"crc":3}"#
        guard case .line(.telemetry(let telemetry)) = LSKDecoder.decode(line) else {
            return XCTFail("expected telemetry, got \(LSKDecoder.decode(line))")
        }
        XCTAssertEqual(telemetry.batteryLabel, "BAT 84%")
        XCTAssertEqual(telemetry.gpsLabel, "GPS 9")
        XCTAssertEqual(telemetry.profileName, "US 915 LONGFAST")
        // "frames" is the newest frame's sequence number, not a count. The
        // count is "rx".
        XCTAssertEqual(telemetry.newestFrameSequence, 41)
        XCTAssertEqual(telemetry.receivedFrames, 128)
        XCTAssertEqual(telemetry.rssiDBmX10, -912)
        XCTAssertEqual(telemetry.snrDBX10, 63)
        XCTAssertFalse(telemetry.simulated)
        XCTAssertEqual(telemetry.latitude!, 37.911, accuracy: 1e-6)
        XCTAssertEqual(telemetry.longitude!, -122.018, accuracy: 1e-6)
        XCTAssertEqual(telemetry.batteryMillivolts, 3985)
        XCTAssertEqual(telemetry.batteryPercent, 84)
        XCTAssertEqual(telemetry.satellites, 9)
        XCTAssertEqual(telemetry.centerFrequencyHz, 906_875_000)
        XCTAssertEqual(telemetry.spreadingFactor, 11)
        XCTAssertEqual(telemetry.bandwidthHz, 250_000)
        XCTAssertEqual(telemetry.crcErrors, 3)
        XCTAssertTrue(telemetry.hasFix)
    }

    func testTelemetryWithoutAFixHasNoCoordinates() {
        // The firmware prints a second, shorter format when the GPS has no fix.
        let line = #"LSK T {"bat":"BAT --","gps":"GPS --","profile":"US 915 LONGFAST","#
            + #""frames":0,"rssi_x10":0,"snr_x10":0,"sim":true,"#
            + #""mv":0,"pct":0,"sat":0,"freq_hz":906875000,"sf":11,"bw_hz":250000,"#
            + #""rx":0,"crc":0}"#
        guard case .line(.telemetry(let telemetry)) = LSKDecoder.decode(line) else {
            return XCTFail("expected telemetry")
        }
        XCTAssertNil(telemetry.latitude)
        XCTAssertNil(telemetry.longitude)
        XCTAssertFalse(telemetry.hasFix)
        XCTAssertTrue(telemetry.simulated)
    }

    func testTelemetryWithOnlyOneCoordinateReportsNoFix() {
        // Half a fix on a map is a pin in the Gulf of Guinea.
        let line = #"LSK T {"bat":"B","gps":"G","profile":"P","frames":1,"#
            + #""rssi_x10":0,"snr_x10":0,"sim":false,"lat":37.9}"#
        guard case .line(.telemetry(let telemetry)) = LSKDecoder.decode(line) else {
            return XCTFail("expected telemetry")
        }
        XCTAssertNil(telemetry.latitude)
        XCTAssertNil(telemetry.longitude)
    }

    func testTelemetryFromOlderFirmwareKeepsTheFieldsItDoesSend() {
        // Everything after "sim" arrived later than the link itself.
        let line = #"LSK T {"bat":"B","gps":"G","profile":"P","frames":7,"#
            + #""rssi_x10":-800,"snr_x10":50,"sim":false}"#
        guard case .line(.telemetry(let telemetry)) = LSKDecoder.decode(line) else {
            return XCTFail("expected telemetry")
        }
        XCTAssertEqual(telemetry.newestFrameSequence, 7)
        XCTAssertNil(telemetry.receivedFrames)
        XCTAssertNil(telemetry.centerFrequencyHz)
    }

    // MARK: - LSK F

    /// The decoded half of a current deck's LSK F line, in the firmware's order.
    private static let defaultDecodedFields =
        #""src":2882400001,"dst":4294967295,"proto":"Meshtastic","port":1,"hops":2,"#
        + #""rssi_x10":-912,"snr_x10":63,"kind":"TEXT","sim":false,"#
        + #""name":"Bay Area Deck","short":"BAY","text":"radio check""#

    /// The whole line: decoded fields, then the .lscap record, then the hex.
    private func heardFrameLine(
        decoded: String = LSKLineTests.defaultDecodedFields,
        metadataFlags: Int = 0,
        hex: String = "0a0b0c0d"
    ) -> String {
        let record = #""seq":41,"ts":123456789,"pf":7,"freq":906875000,"bw":250000,"#
            + #""br":0,"fdev":0,"air":123456,"ferr":-42,"pre":16,"sync":43,"prof":3,"#
            + #""rstat":0,"txp":22,"sf":11,"cr":5,"ch":0,"ridx":0,"mod":0,"dir":1,"#
            + #""crc":1,"mflags":\#(metadataFlags),"olen":\#(hex.count / 2),"#
            + #""hex":"\#(hex)""#
        return "LSK F {" + decoded + "," + record + "}"
    }

    func testHeardFrameParsesDecodeAndRawRecordTogether() {
        guard case .line(.frame(let frame)) = LSKDecoder.decode(heardFrameLine()) else {
            return XCTFail("expected a frame, got \(LSKDecoder.decode(heardFrameLine()))")
        }
        XCTAssertEqual(frame.source, 2_882_400_001)
        XCTAssertEqual(frame.destination, 0xffff_ffff)
        XCTAssertEqual(frame.protocolLabel, "Meshtastic")
        XCTAssertEqual(frame.applicationPort, 1)
        XCTAssertEqual(frame.hops, 2)
        XCTAssertEqual(frame.kindLabel, "TEXT")
        XCTAssertEqual(frame.longName, "Bay Area Deck")
        XCTAssertEqual(frame.shortName, "BAY")
        XCTAssertEqual(frame.text, "radio check")

        guard let raw = frame.raw else { return XCTFail("expected a .lscap record") }
        XCTAssertEqual(raw.sequence, 41)
        XCTAssertEqual(raw.timestampMicroseconds, 123_456_789)
        XCTAssertEqual(raw.centerFrequencyHz, 906_875_000)
        XCTAssertEqual(raw.frequencyErrorHz, -42)
        XCTAssertEqual(raw.txPowerDBm, 22)
        XCTAssertEqual(raw.codingRateDenominator, 5)
        XCTAssertEqual(raw.bytes, Data([0x0a, 0x0b, 0x0c, 0x0d]))
        XCTAssertFalse(raw.isTruncated)
    }

    func testHopSentinelBecomesNilRatherThanMinusOneHops() {
        let line = heardFrameLine(
            decoded: #""src":1,"dst":2,"proto":"MeshCore","port":0,"hops":-1,"#
                + #""rssi_x10":0,"snr_x10":0,"kind":"ADV","sim":false"#
        )
        XCTAssertNotNil(LSKDecoder.line(line), "the fixture itself must be valid JSON")
        guard case .line(.frame(let frame)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a frame")
        }
        XCTAssertNil(frame.hops)
    }

    // MARK: - Provenance

    func testOverTheAirFrameIsTheOnlyOneThatClaimsToHaveBeenHeardHere() {
        guard case .line(.frame(let frame)) = LSKDecoder.decode(heardFrameLine()) else {
            return XCTFail("expected a frame")
        }
        XCTAssertEqual(frame.origin, .air)
    }

    func testNetRelayedFrameNeverReadsAsHeardHere() {
        // mflags bit 3 is FrameOrigin::Net — a frame some other radio heard,
        // injected over the cable. Presenting one as locally received is the
        // exact failure the flag exists to prevent.
        let line = heardFrameLine(metadataFlags: 8)
        guard case .line(.frame(let frame)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a frame")
        }
        XCTAssertEqual(frame.origin, .net)
        XCTAssertNotEqual(frame.origin, .air)
    }

    func testSyntheticFrameReadsAsSyntheticFromEitherSignal() {
        // mflags bit 2, and the redundant "sim" flag beside it.
        let fromFlags = heardFrameLine(metadataFlags: 4)
        guard case .line(.frame(let flagged)) = LSKDecoder.decode(fromFlags) else {
            return XCTFail("expected a frame")
        }
        XCTAssertEqual(flagged.origin, .synthetic)

        let noRecord = #"LSK F {"src":1,"dst":2,"proto":"Meshtastic","port":1,"hops":0,"#
            + #""rssi_x10":0,"snr_x10":0,"kind":"TEXT","sim":true}"#
        guard case .line(.frame(let simulated)) = LSKDecoder.decode(noRecord) else {
            return XCTFail("expected a frame")
        }
        XCTAssertEqual(simulated.origin, .synthetic)
    }

    func testFrameWithoutARawRecordIsUnstatedNotAir() {
        // Firmware older than the capture link says only "not synthetic", which
        // leaves net-relayed and over-the-air indistinguishable. Calling that
        // .air would invent a provenance claim the deck never made.
        let line = #"LSK F {"src":1,"dst":2,"proto":"Meshtastic","port":1,"hops":0,"#
            + #""rssi_x10":-900,"snr_x10":50,"kind":"TEXT","sim":false}"#
        guard case .line(.frame(let frame)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a frame")
        }
        XCTAssertNil(frame.raw)
        XCTAssertEqual(frame.origin, .unstated)
        XCTAssertNotEqual(frame.origin, .air)
    }

    func testNetFlagBeatsSyntheticFlagWhenBothAreSet() {
        // A future flag combination must never be able to downgrade a
        // net-relayed frame into something that looks locally heard.
        let line = heardFrameLine(metadataFlags: 4 | 8)
        guard case .line(.frame(let frame)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a frame")
        }
        XCTAssertEqual(frame.origin, .net)
    }

    // MARK: - Raw record integrity

    func testOddLengthHexDropsTheRawRecordRatherThanTheLastNibble() {
        // A clipped hex string still parses as JSON if the clip happened to
        // land before the closing quote. Padding it would produce a .lscap
        // record that looks complete and is not.
        let line = heardFrameLine(hex: "0a0b0")
        guard case .line(.frame(let frame)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a frame")
        }
        XCTAssertNil(frame.raw)
        // The decoded view survives: nothing is hidden, it simply does not earn
        // a capture record.
        XCTAssertEqual(frame.protocolLabel, "Meshtastic")
    }

    func testNonHexPayloadDropsTheRawRecord() {
        let line = heardFrameLine(hex: "0a0bzz")
        guard case .line(.frame(let frame)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a frame")
        }
        XCTAssertNil(frame.raw)
    }

    func testTruncatedCaptureIsFlagged() {
        // olen is the length on the air; the hex is what the capture buffer
        // held.
        let line = #"LSK F {"src":1,"dst":2,"proto":"Meshtastic","port":1,"hops":0,"#
            + #""rssi_x10":0,"snr_x10":0,"kind":"TEXT","sim":false,"#
            + #""seq":1,"ts":0,"mflags":0,"olen":64,"hex":"0a0b"}"#
        guard case .line(.frame(let frame)) = LSKDecoder.decode(line),
              let raw = frame.raw
        else { return XCTFail("expected a frame with a record") }
        XCTAssertEqual(raw.originalLength, 64)
        XCTAssertEqual(raw.bytes.count, 2)
        XCTAssertTrue(raw.isTruncated)
    }

    // MARK: - LSK S

    func testSweepKeepsTheFirmwaresBinEdgeArithmetic() {
        // f0 and f1 are outer edges, pushed half a step outward by
        // emit_analyzer_sweep_result so that bin centres land back on the
        // frequencies the SX1262 was tuned to.
        let line = #"LSK S {"f0":902000000,"f1":906000000,"bins":4,"db":[-128,-121,-96,-130]}"#
        guard case .line(.sweep(let sweep)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a sweep, got \(LSKDecoder.decode(line))")
        }
        XCTAssertEqual(sweep.startHz, 902_000_000)
        XCTAssertEqual(sweep.endHz, 906_000_000)
        XCTAssertEqual(sweep.powerDBm, [-128, -121, -96, -130])
        XCTAssertEqual(sweep.binCenterHz(0), 902_500_000, accuracy: 0.5)
        XCTAssertEqual(sweep.binCenterHz(3), 905_500_000, accuracy: 0.5)
    }

    func testSweepWhoseBinCountDisagreesWithItsArrayIsRefused() {
        // A line clipped mid-array parses as JSON often enough. Plotting the
        // surviving half stretched across the whole band would look like a real
        // measurement of a band nothing measured.
        let line = #"LSK S {"f0":902000000,"f1":906000000,"bins":64,"db":[-128,-121]}"#
        XCTAssertEqual(LSKDecoder.decode(line), .malformed(kind: "S"))
    }

    func testSweepWithAnInvertedSpanIsRefused() {
        let line = #"LSK S {"f0":906000000,"f1":902000000,"bins":2,"db":[-128,-121]}"#
        XCTAssertEqual(LSKDecoder.decode(line), .malformed(kind: "S"))
    }

    // MARK: - LSK P

    func testPointerKeepsFullOwnerAndCommitmentHex() {
        let owner = "0x" + String(repeating: "ab", count: 32)
        let commit = "0x" + String(repeating: "cd", count: 32)
        let line = #"LSK P {"size":4096,"expires":1780000000,"#
            + #""owner":"\#(owner)","commit":"\#(commit)"}"#
        guard case .line(.pointer(let pointer)) = LSKDecoder.decode(line) else {
            return XCTFail("expected a pointer, got \(LSKDecoder.decode(line))")
        }
        XCTAssertEqual(pointer.sizeBytes, 4096)
        XCTAssertEqual(pointer.expiresAtUnix, 1_780_000_000)
        XCTAssertEqual(pointer.owner, owner)
        XCTAssertEqual(pointer.commitment, commit)
    }

    // MARK: - LSK OK / LSK ERR

    func testSweepAcknowledgementCarriesItsState() {
        let line = #"LSK OK {"kind":"sweep","state":"started"}"#
        guard case .line(.ok(let ack)) = LSKDecoder.decode(line) else {
            return XCTFail("expected an ack")
        }
        XCTAssertEqual(ack.kind, "sweep")
        XCTAssertEqual(ack.state, "started")
        XCTAssertNil(ack.protocolLabel)
    }

    func testMeshcoreAdvertAcknowledgementCarriesItsReach() {
        let line = #"LSK OK {"proto":"meshcore","kind":"advert","reach":"flood"}"#
        guard case .line(.ok(let ack)) = LSKDecoder.decode(line) else {
            return XCTFail("expected an ack")
        }
        XCTAssertEqual(ack.protocolLabel, "meshcore")
        XCTAssertEqual(ack.reach, "flood")
    }

    func testRefusalCarriesItsReason() {
        let line = #"LSK ERR {"reason":"sweep-already-running"}"#
        guard case .line(.error(let fault)) = LSKDecoder.decode(line) else {
            return XCTFail("expected an error")
        }
        XCTAssertEqual(fault.reason, "sweep-already-running")
    }

    func testFailedTransmitHasNoReasonAtAllAndThatIsNotAParseFailure() {
        // handle_mesh_tx_command prints the same body for OK and ERR and only
        // swaps the word, so a failed transmit names a kind and no reason.
        let line = #"LSK ERR {"proto":"meshtastic","kind":"dm"}"#
        guard case .line(.error(let fault)) = LSKDecoder.decode(line) else {
            return XCTFail("expected an error, got \(LSKDecoder.decode(line))")
        }
        XCTAssertNil(fault.reason)
        XCTAssertEqual(fault.protocolLabel, "meshtastic")
        XCTAssertEqual(fault.kind, "dm")
    }

    // MARK: - Malformed and unknown

    func testBootBannerIsNotAnalyzerTraffic() {
        // The deck prints these on the same port before the link is up.
        XCTAssertEqual(LSKDecoder.decode("Lilyshark starting"), .notAnalyzerTraffic)
        XCTAssertEqual(LSKDecoder.decode("Lilyshark UI ready"), .notAnalyzerTraffic)
        XCTAssertEqual(LSKDecoder.decode(""), .notAnalyzerTraffic)
        XCTAssertEqual(LSKDecoder.decode("LSK"), .notAnalyzerTraffic)
        XCTAssertEqual(LSKDecoder.decode("LSK "), .notAnalyzerTraffic)
    }

    func testHostCommandsEchoedBackAreNotTreatedAsAKind() {
        // A port with echo left on hands our own commands back.
        XCTAssertEqual(LSKDecoder.decode("LSK HELLO"), .notAnalyzerTraffic)
        XCTAssertEqual(LSKDecoder.decode("LSK BYE"), .notAnalyzerTraffic)
    }

    func testTruncatedJsonIsMalformedForItsKindRatherThanSilentlyIgnored() {
        // The single most common real fault: a reset mid-print.
        XCTAssertEqual(
            LSKDecoder.decode(#"LSK T {"bat":"BAT 84%","gps":"GP"#),
            .malformed(kind: "T")
        )
        XCTAssertEqual(
            LSKDecoder.decode(#"LSK S {"f0":902000000,"f1":906000000,"bins":4,"db":[-128,-1"#),
            .malformed(kind: "S")
        )
    }

    func testJsonArrayOrScalarBodyIsMalformed() {
        XCTAssertEqual(LSKDecoder.decode("LSK T [1,2,3]"), .malformed(kind: "T"))
        XCTAssertEqual(LSKDecoder.decode("LSK T 42"), .malformed(kind: "T"))
        XCTAssertEqual(LSKDecoder.decode("LSK F not json at all"), .malformed(kind: "F"))
    }

    func testUnknownKindIsHandedBackVerbatimRatherThanGuessedAt() {
        // Firmware ships ahead of apps. A kind this build has never heard of
        // gets no grammar imposed on it.
        let line = #"LSK Q {"whatever":1}"#
        XCTAssertEqual(
            LSKDecoder.decode(line),
            .line(.unknown(kind: "Q", body: #"{"whatever":1}"#))
        )
    }

    func testUnknownKindIsNotJudgedAgainstAGrammarWeDoNotHave() {
        // Deliberately not JSON: we do not know that a future kind uses it.
        XCTAssertEqual(
            LSKDecoder.decode("LSK WATERFALL 1 2 3"),
            .line(.unknown(kind: "WATERFALL", body: "1 2 3"))
        )
    }

    // MARK: - Line assembly

    func testALineSplitAcrossReadsIsRejoined() {
        var assembler = LSKLineAssembler()
        XCTAssertEqual(assembler.append(Data(#"LSK ID {"app":"lily"#.utf8)), [])
        XCTAssertEqual(assembler.pendingByteCount, 19)
        let rest = #"shark","fw":"0.9.3","board":"t-deck","node":"!1"}"# + "\n"
        let lines = assembler.append(Data(rest.utf8))
        XCTAssertEqual(lines.count, 1)
        guard case .line(.identity(let identity)) = LSKDecoder.decode(lines[0]) else {
            return XCTFail("the rejoined line should decode")
        }
        XCTAssertEqual(identity.firmwareVersion, "0.9.3")
        XCTAssertEqual(assembler.pendingByteCount, 0)
    }

    func testOneReadCarryingSeveralLinesYieldsThemAll() {
        var assembler = LSKLineAssembler()
        let chunk = "LSK OK {\"kind\":\"inj\"}\nLSK ERR {\"reason\":\"bad-inj\"}\nLSK P {"
        let lines = assembler.append(Data(chunk.utf8))
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(LSKDecoder.decode(lines[0]).okKind, "inj")
        XCTAssertEqual(assembler.pendingByteCount, 7)
    }

    func testCarriageReturnAndNewlineBothTerminateAndProduceNoBlankLines() {
        // printf writes "\n"; Serial.println writes "\r\n". Both appear on the
        // same link, and "\r\n" must not yield an empty second line.
        var assembler = LSKLineAssembler()
        let lines = assembler.append(Data("LSK OK {\"kind\":\"node\"}\r\nLSK OK {\"kind\":\"inj\"}\n".utf8))
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(LSKDecoder.decode(lines[0]).okKind, "node")
        XCTAssertEqual(LSKDecoder.decode(lines[1]).okKind, "inj")
    }

    func testByteAtATimeDeliveryStillProducesWholeLines() {
        // USB CDC really does hand back single bytes when the host polls fast.
        var assembler = LSKLineAssembler()
        var lines: [String] = []
        for byte in Data("LSK OK {\"kind\":\"sweep\",\"state\":\"stopped\"}\n".utf8) {
            lines += assembler.append(Data([byte]))
        }
        XCTAssertEqual(lines.count, 1)
        guard case .line(.ok(let ack)) = LSKDecoder.decode(lines[0]) else {
            return XCTFail("expected an ack")
        }
        XCTAssertEqual(ack.state, "stopped")
    }

    func testInvalidUtf8InTheMiddleOfALineCostsOneCharacterNotTheLine() {
        // The deck truncates node names at a fixed byte count, so a multi-byte
        // name can arrive cut mid-sequence.
        var assembler = LSKLineAssembler()
        var bytes = Data(#"LSK F {"src":1,"dst":2,"proto":"Meshtastic","port":1,"hops":0,"#.utf8)
        bytes += Data(#""rssi_x10":0,"snr_x10":0,"kind":"TEXT","sim":false,"name":"Ba"#.utf8)
        bytes += Data([0xC3])  // a lead byte with its continuation cut off
        bytes += Data(#""}"#.utf8)
        bytes += Data([0x0A])
        let lines = assembler.append(bytes)
        XCTAssertEqual(lines.count, 1)
        guard case .line(.frame(let frame)) = LSKDecoder.decode(lines[0]) else {
            return XCTFail("expected a frame, got \(LSKDecoder.decode(lines[0]))")
        }
        XCTAssertEqual(frame.source, 1)
        XCTAssertEqual(frame.longName, "Ba\u{FFFD}")
    }

    func testAnUnterminatedFloodIsDroppedAndCountedRatherThanHeldForever() {
        var assembler = LSKLineAssembler(lineLimit: 32)
        XCTAssertEqual(assembler.append(Data(String(repeating: "x", count: 200).utf8)), [])
        XCTAssertEqual(assembler.oversizeLinesDropped, 1)
        // The tail of the over-long line is thrown away too, rather than being
        // handed on as a line of its own that no decoder can make sense of.
        let lines = assembler.append(Data("junk\nLSK OK {\"kind\":\"inj\"}\n".utf8))
        XCTAssertEqual(lines, [#"LSK OK {"kind":"inj"}"#])
        XCTAssertEqual(assembler.oversizeLinesDropped, 1)
    }

    func testResetDropsAHalfReceivedLineSoAReconnectCannotSpliceOne() {
        var assembler = LSKLineAssembler()
        _ = assembler.append(Data(#"LSK T {"bat":"BA"#.utf8))
        assembler.reset()
        XCTAssertEqual(assembler.pendingByteCount, 0)
        let lines = assembler.append(Data("T 84%\"}\n".utf8))
        // What comes back is the tail alone, which decodes as nothing — far
        // better than a spliced line that decodes as something.
        XCTAssertEqual(lines, ["T 84%\"}"])
        XCTAssertEqual(LSKDecoder.decode(lines[0]), .notAnalyzerTraffic)
    }
}

private extension LSKDecodeResult {
    /// Small reader so a test can assert on an ack without four lines of
    /// pattern matching.
    var okKind: String? {
        if case .line(.ok(let ack)) = self { return ack.kind }
        return nil
    }
}
