//
//  MeshtasticProtoTests.swift
//  MeshtasticKitTests
//
//  The phone side of the Meshtastic BLE conversation, held to the same
//  hand-computed wire bytes that the firmware's test/meshtastic_api and the web
//  client's meshtasticProto.test pin. If any of the three ends drifts, one of
//  the three suites fails, and the pairing bug is caught on a desk instead of
//  over a Bluetooth link.
//

import XCTest
@testable import MeshtasticKit

final class MeshtasticProtoTests: XCTestCase {

    // MARK: - ToRadio

    func testWantConfigEncodesToTheFirmwaresExpectedBytes() {
        // ToRadio.want_config_id (field 3 varint) = 42: 0x18 0x2a.
        XCTAssertEqual(Array(MeshtasticProto.encodeWantConfig(nonce: 42)), [0x18, 0x2a])
    }

    func testTextPacketRoundTripsExactlyLikeTheFirmwaresVector() {
        // The firmware's parser test feeds these bytes; our encoder must
        // produce a message it accepts, so build the same packet and compare.
        let bytes = MeshtasticProto.encodeTextPacket(
            to: 0x1122_3344,
            channel: 0,
            packetID: 0,
            text: "hi",
            wantAck: true
        )
        XCTAssertEqual(
            Array(bytes),
            [
                0x0a, 0x0f,                    // ToRadio.packet, 15 bytes
                0x15, 0x44, 0x33, 0x22, 0x11,  // MeshPacket.to fixed32
                0x22, 0x06,                    // MeshPacket.decoded, 6 bytes
                0x08, 0x01,                    // Data.portnum = TEXT
                0x12, 0x02, 0x68, 0x69,        // Data.payload "hi"
                0x50, 0x01                     // MeshPacket.want_ack
            ]
        )
    }

    // MARK: - FromRadio

    func testMyInfoParsesFromTheFirmwaresExactEncoding() {
        // The firmware's encoder test pins these bytes for my_node_num = 1.
        let bytes = Data([0x1a, 0x06, 0x08, 0x01, 0x58, 0xf8, 0xeb, 0x01])
        XCTAssertEqual(MeshtasticProto.parseFromRadio(bytes), .myInfo(num: 1))
    }

    func testConfigCompleteEchoesItsNonce() {
        XCTAssertEqual(
            MeshtasticProto.parseFromRadio(Data([0x38, 0xa5, 0x01])),
            .configComplete(nonce: 0xa5)
        )
        // A zero nonce must still be recognised, or the app waits forever.
        XCTAssertEqual(
            MeshtasticProto.parseFromRadio(Data([0x38, 0x00])),
            .configComplete(nonce: 0)
        )
    }

    func testRoutingResultCarriesTheAckedIdAndTheError() {
        // FromRadio{packet{from,to,decoded{portnum=5,payload=Routing{err:0},
        // request_id},priority}} -- as the firmware's encodeApiRoutingAck emits.
        let bytes = Data([
            0x12, 0x19,                    // FromRadio.packet, 25 bytes
            0x0d, 0xe0, 0x72, 0xa1, 0xcd,  // from
            0x15, 0xe0, 0x72, 0xa1, 0xcd,  // to
            0x22, 0x0b,                    // decoded, 11 bytes
            0x08, 0x05,                    // portnum ROUTING
            0x12, 0x02, 0x18, 0x00,        // payload Routing{error_reason: NONE}
            0x35, 0x44, 0x33, 0x22, 0x11,  // request_id fixed32
            0x58, 0x78                     // priority ACK
        ])
        XCTAssertEqual(
            MeshtasticProto.parseFromRadio(bytes),
            .routing(requestID: 0x1122_3344, error: 0)
        )
    }

    func testHeardBroadcastTextSurfacesFromChannelAndBody() {
        var echo = Array(
            MeshtasticProto.encodeTextPacket(
                to: MeshtasticProto.broadcast,
                channel: 0,
                packetID: 77,
                text: "TRACK IS WASHED OUT",
                wantAck: false
            )
        )
        // Rewrite the outer tag from ToRadio.packet (field 1) to
        // FromRadio.packet (field 2) -- the same trick the firmware test uses,
        // which works because both are length-delimited MeshPackets.
        XCTAssertEqual(echo[0], 0x0a)
        echo[0] = 0x12

        guard case .text(let message)? = MeshtasticProto.parseFromRadio(Data(echo)) else {
            return XCTFail("expected a text message")
        }
        XCTAssertEqual(message.from, 0)
        XCTAssertEqual(message.to, MeshtasticProto.broadcast)
        XCTAssertEqual(message.packetID, 77)
        XCTAssertEqual(message.channel, 0)
        XCTAssertEqual(message.text, "TRACK IS WASHED OUT")
    }

    func testPositionPacketResolvesToSignedDegrees() {
        // Position{latitude_i = 373952800, longitude_i = -1220841600} -- the
        // exact little-endian bytes the firmware's testPositionExactBytes pins.
        let clean = Data([
            0x12, 0x15,
            0x0d, 0x44, 0x1b, 0xf6, 0x96,
            0x22, 0x0e,
            0x08, 0x03,
            0x12, 0x0a,
            0x0d, 0x20, 0x11, 0x4a, 0x16,
            0x15, 0x80, 0x6f, 0x3b, 0xb7
        ])
        guard case .position(let position)? = MeshtasticProto.parseFromRadio(clean) else {
            return XCTFail("expected a position")
        }
        XCTAssertEqual(position.from, 0x96f6_1b44)
        XCTAssertEqual(position.latitude, 37.39528, accuracy: 1e-6)
        XCTAssertEqual(position.longitude, -122.08416, accuracy: 1e-6)
    }

    func testMalformedBytesReturnNilUnknownMessagesReturnOther() {
        // A length-delimited field promising 127 bytes with one byte left.
        XCTAssertNil(MeshtasticProto.parseFromRadio(Data([0x0a, 0x7f, 0x15])))
        XCTAssertEqual(MeshtasticProto.parseFromRadio(Data([0x40, 0x01])), .other)
    }

    // MARK: - Messages the web client's vectors do not reach

    func testNodeInfoCarriesTheUserRecordAndSNR() {
        // Assembled from writeNodeInfoMessage/writeUser in the firmware's
        // meshtastic_api.cpp for node 0x96f61b44 labelled "96F61B44" at
        // -8.5 dB SNR: NodeInfo{num, user{id, long_name, short_name}, snr}.
        // The short name is the tail of the label, as stock firmware falls
        // back to, and the SNR is an IEEE-754 float in a fixed32.
        let bytes = Data([
            0x22, 0x28,                                      // FromRadio.node_info, 40 bytes
            0x08, 0xc4, 0xb6, 0xd8, 0xb7, 0x09,              // num varint
            0x12, 0x1b,                                      // user, 27 bytes
            0x0a, 0x09, 0x21, 0x39, 0x36, 0x66, 0x36,        // id "!96f61b44"
            0x31, 0x62, 0x34, 0x34,
            0x12, 0x08, 0x39, 0x36, 0x46, 0x36,              // long_name "96F61B44"
            0x31, 0x42, 0x34, 0x34,
            0x1a, 0x04, 0x31, 0x42, 0x34, 0x34,              // short_name "1B44"
            0x25, 0x00, 0x00, 0x08, 0xc1                     // snr = -8.5
        ])
        XCTAssertEqual(
            MeshtasticProto.parseFromRadio(bytes),
            .nodeInfo(
                MeshtasticProto.NodeInfo(
                    num: 0x96f6_1b44,
                    id: "!96f61b44",
                    longName: "96F61B44",
                    shortName: "1B44",
                    snr: -8.5
                )
            )
        )
    }

    func testMetadataCarriesTheFirmwareVersion() {
        // FromRadio.device_metadata (field 13) wrapping
        // DeviceMetadata.firmware_version (field 1 string), which is the
        // string the app displays and gates features on.
        var bytes = Data([0x6a, 0x11, 0x0a, 0x0f])
        bytes.append(contentsOf: Array("2.6.0-lilyshark".utf8))
        XCTAssertEqual(
            MeshtasticProto.parseFromRadio(bytes),
            .metadata(firmware: "2.6.0-lilyshark")
        )
    }

    // MARK: - Transport

    func testBLEUUIDsMatchTheOnesTheDeckAdvertises() {
        XCTAssertEqual(
            MeshtasticBLEConstants.serviceUUIDString,
            "6ba1b218-15a8-461f-9fa8-5dcae273eafd"
        )
        XCTAssertEqual(
            MeshtasticBLEConstants.fromRadioUUIDString,
            "2c55e69e-4993-11ed-b878-0242ac120002"
        )
        XCTAssertEqual(
            MeshtasticBLEConstants.toRadioUUIDString,
            "f75c76d2-129e-4dad-a1dd-7866124401e7"
        )
        XCTAssertEqual(
            MeshtasticBLEConstants.fromNumUUIDString,
            "ed9da18c-a800-4f66-a670-aa7547e34453"
        )
        // CBUUID upcases what it is handed, so the round trip is checked
        // case-insensitively rather than against the literal above.
        XCTAssertEqual(
            MeshtasticBLEConstants.serviceUUID.uuidString.lowercased(),
            MeshtasticBLEConstants.serviceUUIDString
        )
    }

    /// A zero nonce must still go on the wire. Proto3 omits zero scalars by
    /// default, and want_config_id is the one field where that convention is
    /// wrong: the phone waits for its own nonce to come back, so a dropped
    /// zero leaves the app configuring forever. A reviewer proved this was
    /// unpinned by mutating the encoder to the omitting form and watching
    /// every other test stay green.
    func testZeroNonceIsStillEncoded() {
        XCTAssertEqual(Array(MeshtasticProto.encodeWantConfig(nonce: 0)), [0x18, 0x00])
        XCTAssertEqual(Array(MeshtasticProto.encodeWantConfig(nonce: 42)), [0x18, 0x2a])
    }
}
