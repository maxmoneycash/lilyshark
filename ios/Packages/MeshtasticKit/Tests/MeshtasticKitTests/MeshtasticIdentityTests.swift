//
//  MeshtasticIdentityTests.swift
//  MeshtasticKitTests
//
//  The derivation that lets a deck's nodes live in stores keyed by MeshCore
//  public keys. Everything here is pure Data arithmetic, so it runs with no
//  radio and no simulator.
//

import XCTest
@testable import MeshtasticKit

final class MeshtasticIdentityTests: XCTestCase {

    func testSyntheticKeyIsTaggedBigEndianAndZeroPadded() {
        let key = MeshtasticIdentity.syntheticKey(forNodeNum: 0x96f6_1b44)
        XCTAssertEqual(key.count, 32)
        XCTAssertEqual(Array(key.prefix(6)), [0x4d, 0x54, 0x96, 0xf6, 0x1b, 0x44])
        XCTAssertEqual(Array(key.dropFirst(6)), Array(repeating: 0, count: 26))
    }

    func testNodeNumberSurvivesTheRoundTripThroughAKey() {
        for num: UInt32 in [1, 0x0000_00ff, 0x1234_5678, 0xffff_fffe, .max] {
            let key = MeshtasticIdentity.syntheticKey(forNodeNum: num)
            XCTAssertEqual(MeshtasticIdentity.nodeNum(forSyntheticKey: key), num)
        }
    }

    /// A stored message keeps only the six-byte prefix of a key, so a reply
    /// typed into a conversation has nothing else to address the deck with.
    func testNodeNumberIsRecoverableFromTheSixByteRoutingPrefixAlone() {
        let key = MeshtasticIdentity.syntheticKey(forNodeNum: 0xdead_beef)
        XCTAssertEqual(
            MeshtasticIdentity.nodeNum(forSyntheticKey: key.prefix(6)),
            0xdead_beef
        )
    }

    func testKeysThatDidNotComeFromHereAreRefused() {
        // A real MeshCore public key: no tag, so no node number.
        let meshCoreKey = Data((0..<32).map { UInt8($0) })
        XCTAssertNil(MeshtasticIdentity.nodeNum(forSyntheticKey: meshCoreKey))
        // Too short to hold a tagged number at all.
        XCTAssertNil(MeshtasticIdentity.nodeNum(forSyntheticKey: Data([0x4d, 0x54, 0x01])))
        XCTAssertNil(MeshtasticIdentity.nodeNum(forSyntheticKey: Data()))
    }

    /// Distinct nodes must never share a routing prefix; two conversations
    /// keyed the same are one conversation with both operators' words in it.
    func testEveryNodeNumberGetsItsOwnRoutingPrefix() {
        let nums: [UInt32] = [0, 1, 2, 0x0100_0000, 0x0000_0100, 0xffff_ffff]
        let prefixes = Set(nums.map { MeshtasticIdentity.syntheticKey(forNodeNum: $0).prefix(6) })
        XCTAssertEqual(prefixes.count, nums.count)
    }

    func testSNRConvertsIntoTheQuarterDecibelUnitsTheUIDividesBack() {
        XCTAssertEqual(MeshtasticIdentity.snrQuarterDecibels(from: -8.5), -34)
        XCTAssertEqual(MeshtasticIdentity.snrQuarterDecibels(from: 0), 0)
        XCTAssertEqual(MeshtasticIdentity.snrQuarterDecibels(from: 5.25), 21)
        // An out-of-range reading saturates rather than wrapping to the
        // opposite sign, which would draw a dead link as an excellent one.
        XCTAssertEqual(MeshtasticIdentity.snrQuarterDecibels(from: 200), 127)
        XCTAssertEqual(MeshtasticIdentity.snrQuarterDecibels(from: -200), -128)
    }

    func testDefaultLabelMatchesTheIdStockFirmwarePrints() {
        XCTAssertEqual(MeshtasticIdentity.defaultLabel(forNodeNum: 0x96f6_1b44), "!96f61b44")
        XCTAssertEqual(MeshtasticIdentity.defaultLabel(forNodeNum: 1), "!00000001")
    }

    func testNodeDisplayNameFallsBackBeforeItFallsBlank() {
        let named = MeshtasticProto.NodeInfo(
            num: 7, id: "!00000007", longName: "Grizzly Peak", shortName: "GRIZ"
        )
        XCTAssertEqual(named.displayName, "Grizzly Peak")

        let shortOnly = MeshtasticProto.NodeInfo(
            num: 7, id: "!00000007", longName: "", shortName: "GRIZ"
        )
        XCTAssertEqual(shortOnly.displayName, "GRIZ")

        let anonymous = MeshtasticProto.NodeInfo(
            num: 7, id: "", longName: "", shortName: ""
        )
        XCTAssertEqual(anonymous.displayName, "!00000007")
    }

    /// The farewell the deck's `parseApiToRadio` acts on: field 4, varint, and
    /// non-zero. A zero would parse to `Kind::None` and be discarded silently.
    func testDisconnectEncodesTheFieldTheFirmwareActsOn() {
        XCTAssertEqual(Array(MeshtasticProto.encodeDisconnect()), [0x20, 0x01])
    }
}
