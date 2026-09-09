import XCTest
@testable import MeshCoreKit

final class MeshMapperCoverageTests: XCTestCase {
    private func report() throws -> MeshMapperCoverage {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "meshmapper-v2", withExtension: "json", subdirectory: "Fixtures"))
        return try MeshMapperCoverage.decode(Data(contentsOf: url))
    }
    func testNullableFieldsFutureTypesAndInvalidCoordinates() throws {
        let report = try report()
        XCTAssertEqual(report.validCells.count, 3)
        XCTAssertNil(report.dataAgeSeconds)
        XCTAssertNil(report.gridSquares[1].snr)
        XCTAssertNil(report.gridSquares[2].type)
        XCTAssertEqual(report.validCells.first?.statusMask, 37)
        XCTAssertTrue(report.validCells[0].bounds.contains(latitude: 0, longitude: 0))
    }
    func testFiltersDoNotInventSignalOrTimestamps() throws {
        let report = try report()
        var filter = MeshMapperFilter()
        XCTAssertEqual(report.gridSquares.filter(filter.includes).count, 3)
        filter.minimumSNR = 0
        XCTAssertEqual(report.gridSquares.filter(filter.includes).count, 2)
        filter.since = Date(timeIntervalSince1970: 1710547150)
        XCTAssertEqual(report.gridSquares.filter(filter.includes).map(\.id), ["test-1"])
        filter = MeshMapperFilter()
        filter.types = [.receive]
        XCTAssertEqual(report.gridSquares.filter(filter.includes).map(\.id), ["test-2"])
        filter.types = []
        XCTAssertTrue(report.gridSquares.filter(filter.includes).isEmpty)
    }
    func testRepeaterCollisionsAndExplicitZeroPosition() throws {
        let report = try report()
        XCTAssertEqual(report.locatedRepeaters.count, 2)
        XCTAssertNotEqual(report.locatedRepeaters[0].id, report.locatedRepeaters[1].id)
        XCTAssertTrue(report.locatedRepeaters[0].isAmbiguous)
    }
    func testOverlappingRecordsHaveUniqueStableMapIdentities() throws {
        let original = try report()
        var payload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        let cells = try XCTUnwrap(payload["grid_squares"] as? [[String: Any]])
        let nodes = try XCTUnwrap(payload["repeaters"] as? [[String: Any]])
        payload["grid_squares"] = cells + [cells[0]]
        payload["repeaters"] = nodes + [nodes[0]]
        let decoded = try MeshMapperCoverage.decode(JSONSerialization.data(withJSONObject: payload))
        XCTAssertEqual(decoded.gridSquares.map(\.id), original.gridSquares.map(\.id))
        XCTAssertEqual(decoded.repeaters?.map(\.id), original.repeaters?.map(\.id))
    }
    func testRateLimitHeadersAndDailyResetAreRespected() {
        XCTAssertEqual(MeshMapperRefreshPolicy.retryDelay(resetsInHours: 12.5, retryAfter: "60"), 45000)
        XCTAssertEqual(MeshMapperRefreshPolicy.retryDelay(resetsInHours: nil, retryAfter: "3600"), 3600)
        XCTAssertEqual(MeshMapperRefreshPolicy.retryDelay(resetsInHours: -1, retryAfter: "bad"), 900)
        let now = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(MeshMapperRefreshPolicy.retryDelay(resetsInHours: nil, retryAfter: "Thu, 01 Jan 1970 01:00:00 GMT", now: now), 3600)
    }
    func testErrorEnvelopeIsNotAValidSnapshot() {
        XCTAssertThrowsError(try MeshMapperCoverage.decode(Data(#"{"success":false,"error":"invalid_key"}"#.utf8)))
    }
}
