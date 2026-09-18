import Foundation
import XCTest
@testable import MeshtasticKit

final class LSKCaptureRecorderTests: XCTestCase {
    private func object() -> [String: Any] {
        ["src": 1, "dst": 2, "proto": "Meshtastic", "port": 1, "hops": 0,
         "kind": "TEXT", "sim": false, "rssi_x10": -975, "snr_x10": -32,
         "seq": 7, "ts": 1_000_000, "pf": 0x67, "freq": 906_875_000, "bw": 250_000,
         "br": 0, "fdev": 0, "air": 0, "ferr": -12345, "pre": 16, "sync": 43,
         "prof": 1, "rstat": -17, "txp": -8, "sf": 11, "cr": 5, "ch": 0,
         "ridx": 0, "mod": 1, "dir": 1, "crc": 2, "mflags": 0, "olen": 2, "hex": "0001"]
    }

    private func frame(_ object: [String: Any]) throws -> LSKHeardFrame {
        let bytes = try JSONSerialization.data(withJSONObject: object, options: .sortedKeys)
        guard case .frame(let frame) = LSKDecoder.line("LSK F " + String(decoding: bytes, as: UTF8.self)) else {
            throw NSError(domain: "fixture", code: 1)
        }
        return frame
    }

    func testRecordsPreserveHeaderSignedReadingsAndPayload() throws {
        var recorder = LSKCaptureRecorder()
        XCTAssertEqual(recorder.append(try frame(object())), .recorded)
        let bytes = recorder.snapshot()
        XCTAssertEqual(bytes.count, 106)
        XCTAssertEqual(Array(bytes[0..<12]), [76, 83, 67, 80, 1, 0, 1, 0, 24, 0, 80, 0])
        XCTAssertEqual(Array(bytes[24..<36]), [76, 83, 70, 82, 80, 0, 1, 0, 2, 0, 2, 0])
        XCTAssertEqual(Array(bytes[80..<84]), [0x31, 0xfc, 0xe0, 0xff]) // -975 / -32, LE int16
        XCTAssertEqual(Array(bytes.suffix(2)), [0, 1])
    }

    func testLimitsStopBeforeAnIncompleteRecordIsAppended() throws {
        let value = try frame(object())
        for var recorder in [LSKCaptureRecorder(frameLimit: 1), LSKCaptureRecorder(byteLimit: 106)] {
            XCTAssertEqual(recorder.append(value), .recorded)
            let complete = recorder.snapshot()
            XCTAssertEqual(recorder.append(value), .limitReached)
            XCTAssertEqual(recorder.frameCount, 1)
            XCTAssertEqual(recorder.snapshot(), complete)
        }
    }

    func testIncompleteOrInvalidRawFieldsCannotBecomeZeroMetadata() throws {
        for key in ["ts", "pf", "mflags", "olen", "sf", "freq"] {
            var raw = object(); raw.removeValue(forKey: key)
            let value = try frame(raw)
            XCTAssertNil(value.raw, key)
            var recorder = LSKCaptureRecorder()
            XCTAssertEqual(recorder.append(value), .incompleteRecord)
            XCTAssertEqual(recorder.skippedCount, 1)
            XCTAssertEqual(recorder.byteCount, 24)
        }
        for (key, value) in [("sf", 256 as Any), ("txp", -129), ("olen", 1), ("rssi_x10", -32769),
                             ("pf", true), ("seq", 1.5), ("ts", -1)] {
            var raw = object(); raw[key] = value
            XCTAssertNil(try frame(raw).raw, key)
        }
        var raw = object(); raw["hex"] = String(repeating: "00", count: 256); raw["olen"] = 256
        XCTAssertNil(try frame(raw).raw)
    }

    func testNetAndSyntheticFlagsSurviveAndContradictorySimulationIsNotLost() throws {
        var recorder = LSKCaptureRecorder()
        var raw = object(); raw["mflags"] = 12
        XCTAssertEqual(recorder.append(try frame(raw)), .recorded)
        XCTAssertEqual(recorder.networkCount, 1)
        XCTAssertEqual(recorder.syntheticCount, 0)
        XCTAssertEqual(recorder.snapshot()[100], 12)
        raw["mflags"] = 0; raw["sim"] = true
        XCTAssertEqual(recorder.append(try frame(raw)), .recorded)
        XCTAssertEqual(recorder.syntheticCount, 1)
        XCTAssertEqual(recorder.snapshot()[182], 4)
    }

    func testLargeUnsignedTimestampIsNotTruncatedToSignedRange() throws {
        var raw = object(); raw["ts"] = UInt64.max
        let value = try frame(raw)
        XCTAssertEqual(value.raw?.timestampMicroseconds, UInt64.max)
        var recorder = LSKCaptureRecorder()
        XCTAssertEqual(recorder.append(value), .recorded)
        XCTAssertEqual(Array(recorder.snapshot()[44..<52]), Array(repeating: 255, count: 8))
    }
}
