import XCTest
@testable import MeshCoreKit

final class PublicMeshNodeTests: XCTestCase {
    private let key = String(repeating: "ab", count: 32)
    private func record(_ changes: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = ["public_key": key, "adv_name": "Published node", "adv_lat": 37.8,
            "adv_lon": -122.3, "type": 2, "last_advert": "2025-12-14T10:00:00.000Z",
            "updated_date": "2026-09-15T10:00:00.000Z", "source": "app",
            "params": ["freq": 910.525, "bw": 62.5, "sf": 7, "cr": 5]]
        value.merge(changes) { _, new in new }
        return value
    }
    private func decode(_ records: [[String: Any]]) throws -> [PublicMeshNode] {
        try PublicMeshNode.decodeDirectory(JSONSerialization.data(withJSONObject: records))
    }

    func testPreservesIdentityCoordinatesRadioSettingsAndDistinctDates() throws {
        let node = try XCTUnwrap(decode([record()]).first)
        XCTAssertEqual(node.publicKey, key)
        XCTAssertEqual(node.latitude, 37.8)
        XCTAssertEqual(node.longitude, -122.3)
        XCTAssertEqual(node.radioFreq, 910.525)
        XCTAssertEqual(node.radioBW, 62.5)
        XCTAssertEqual(node.radioSF, 7)
        XCTAssertEqual(node.radioCR, 5)
        XCTAssertEqual(node.typeName, "Repeater")
        XCTAssertEqual(node.sourceDescription, "App-submitted public record")
        XCTAssertLessThan(try XCTUnwrap(node.advertisementDate), try XCTUnwrap(node.updateDate))
        XCTAssertEqual(try JSONDecoder().decode(PublicMeshNode.self, from: JSONEncoder().encode(node)), node)
    }

    func testRejectsMalformedFeedInsteadOfReplacingSavedDirectory() throws {
        XCTAssertThrowsError(try PublicMeshNode.decodeDirectory(Data("{\"error\":\"unavailable\"}".utf8)))
        XCTAssertThrowsError(try decode([record(["public_key": "aabb"])]))
        XCTAssertTrue(try decode([]).isEmpty)
    }

    func testInvalidCoordinatesAndIdentitiesNeverBecomePins() throws {
        let records = [record(), record(["adv_lat": 91.0]), record(["adv_lon": -181.0]),
            record(["adv_lat": 0.0, "adv_lon": 0.0]), record(["adv_lat": NSNull()]),
            record(["public_key": String(repeating: "z", count: 64)])]
        XCTAssertEqual(try decode(records).count, 1)
    }

    func testDeduplicatesFullIdentityAndKeepsNewestRecord() throws {
        let older = record(["public_key": key.uppercased(), "adv_name": "Old name", "updated_date": "2025-01-01T00:00:00.000Z"])
        let otherKey = String(key.prefix(12)) + String(repeating: "cd", count: 26)
        for rows in [[record(), older], [older, record()]] {
            XCTAssertEqual(try decode(rows).map(\.name), ["Published node"])
        }
        XCTAssertEqual(try decode([record(), record(["public_key": otherKey])]).count, 2)
    }

    func testMissingFreshnessStaysUnknownAndEmptyNameUsesIdentity() throws {
        let node = try XCTUnwrap(decode([record(["adv_name": "  ", "last_advert": "", "updated_date": "invalid"])]).first)
        XCTAssertEqual(node.name, String(key.prefix(12)))
        XCTAssertNil(node.advertisementDate)
        XCTAssertNil(node.updateDate)
    }

    func testKeepsEveryPublishedNodeRole() throws {
        for (type, title) in [(1, "Contact"), (2, "Repeater"), (3, "Room"), (4, "Sensor")] {
            XCTAssertEqual(try decode([record(["type": type])]).first?.typeName, title)
        }
    }
}
