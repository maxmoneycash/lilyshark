import XCTest
@testable import MeshCoreKit

final class MessagePersistenceTests: XCTestCase {
    func testReportedFailureSurvivesPersistence() throws {
        let original = Message(text: "Meet at the trailhead", timestamp: Date(),
                               isOutgoing: true, status: .failed,
                               failureReason: "duty cycle limit reached")
        let decoded = try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(decoded.id, original.id)
        XCTAssertEqual(decoded.status, .failed)
        XCTAssertEqual(decoded.failureReason, "duty cycle limit reached")
    }

    func testOlderStoredMessagesHaveNoInventedFailureReason() throws {
        let original = Message(text: "A saved message", timestamp: Date(), isOutgoing: true, status: .failed)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        json.removeValue(forKey: "failureReason")
        let decoded = try JSONDecoder().decode(Message.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(decoded.failureReason)
        XCTAssertEqual(decoded.text, original.text)
        XCTAssertEqual(decoded.status, .failed)
    }

    func testInterruptedPendingSendsCanBeRetriedAfterPersistence() throws {
        for status in [DeliveryStatus.sending, .retrying, .flooding] {
            let original = Message(text: "Meet at the trailhead", timestamp: Date(),
                                   isOutgoing: true, status: status, expectedACK: 0x1234)
            var restored = try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(original))
            XCTAssertTrue(restored.recoverInterruptedSend())
            XCTAssertEqual(restored.id, original.id)
            XCTAssertEqual(restored.timestamp, original.timestamp)
            XCTAssertEqual(restored.text, original.text)
            XCTAssertEqual(restored.status, .failed)
            XCTAssertNil(restored.expectedACK)
            XCTAssertTrue(try XCTUnwrap(restored.failureReason).contains("unconfirmed"))
            XCTAssertTrue(try XCTUnwrap(restored.failureReason).contains("duplicate"))
            let persisted = try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(restored))
            XCTAssertEqual(persisted.status, .failed)
            XCTAssertEqual(persisted.failureReason, restored.failureReason)
        }
    }

    func testRecoveryPreservesReportedOutcomesAndIncomingMessages() {
        for status in [DeliveryStatus.sent, .delivered, .repeated, .failed] {
            var message = Message(text: "Saved result", timestamp: Date(), isOutgoing: true,
                                  status: status, expectedACK: 0x1234, failureReason: "Reported reason")
            XCTAssertFalse(message.recoverInterruptedSend())
            XCTAssertEqual(message.status, status)
            XCTAssertEqual(message.expectedACK, 0x1234)
            XCTAssertEqual(message.failureReason, "Reported reason")
        }
        for status in [DeliveryStatus.sending, .retrying, .flooding] {
            var incoming = Message(text: "Incoming", timestamp: Date(), isOutgoing: false, status: status)
            XCTAssertFalse(incoming.recoverInterruptedSend())
            XCTAssertEqual(incoming.status, status)
            XCTAssertNil(incoming.failureReason)
        }
    }
}
