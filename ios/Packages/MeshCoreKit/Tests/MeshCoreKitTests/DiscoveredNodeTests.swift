import XCTest
@testable import MeshCoreKit

final class DiscoveredNodeTests: XCTestCase {
    func testAdvertNeverTurnsOutgoingRouteIntoReceivedPathOrSignal() {
        for outgoingPath in [Int8(-1), 0, 3] {
            let contact = Contact(publicKey: Data(repeating: 0x42, count: 32), name: "Peer",
                                  type: .repeater, outPathLen: outgoingPath,
                                  latitude: 37.5, longitude: -122.2)
            let node = DiscoveredNode(advert: contact)
            XCTAssertNil(node.snr)
            XCTAssertNil(node.rssi)
            XCTAssertNil(node.pathLen)
            XCTAssertEqual(node.publicKey, contact.publicKeyPrefix)
            XCTAssertEqual(node.name, contact.name)
            XCTAssertEqual(node.type, contact.type)
            XCTAssertEqual(node.latitude, contact.latitude)
            XCTAssertEqual(node.longitude, contact.longitude)
        }
    }

    func testControlDataKeepsExplicitZeroMeasurementsAndDirectPath() {
        let node = DiscoveredNode(publicKey: Data(repeating: 0x42, count: 32), name: "Peer",
                                  type: .chat, snr: 0, rssi: 0, pathLen: 0)
        XCTAssertEqual(node.snr, 0)
        XCTAssertEqual(node.rssi, 0)
        XCTAssertEqual(node.pathLen, 0)
    }
}
