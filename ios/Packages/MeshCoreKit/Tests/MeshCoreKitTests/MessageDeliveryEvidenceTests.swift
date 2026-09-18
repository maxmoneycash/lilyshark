import XCTest
@testable import MeshCoreKit

final class MessageDeliveryEvidenceTests: XCTestCase {
    private func message(_ status: DeliveryStatus, outgoing: Bool = true) -> Message {
        Message(text: "Meet at the trailhead", timestamp: Date(), isOutgoing: outgoing,
                status: status, expectedACK: 42, snr: 0, hops: 0,
                roundTripMs: 1250, attempt: 255, didResetPath: true, failureReason: "Radio refused the request")
    }

    func testExpectedACKDoesNotEstablishDelivery() {
        for status in [DeliveryStatus.sending, .sent, .retrying, .flooding, .failed, .repeated] {
            let evidence = MessageDeliveryEvidence(message: message(status), transport: .meshCore, conversation: .direct)
            XCTAssertNotEqual(evidence.outcome, .acknowledged)
            XCTAssertNil(evidence.acknowledgedRoundTripMs, "Stale RTT cannot establish a new acknowledgement")
        }
    }

    func testSendMeansDifferentThingsForEachTransportAndConversation() {
        let sent = message(.sent)
        XCTAssertEqual(MessageDeliveryEvidence(message: sent, transport: .meshCore, conversation: .direct).outcome, .acceptedByRadio)
        XCTAssertEqual(MessageDeliveryEvidence(message: sent, transport: .meshCore, conversation: .channel).outcome, .sendRequested)
        XCTAssertEqual(MessageDeliveryEvidence(message: sent, transport: .meshtastic, conversation: .direct).outcome, .transmittedByRadio)
    }

    func testRoomAcknowledgementIsAvailableButChannelHasNoRecipientConfirmation() {
        for conversation in [MessageDeliveryEvidence.Conversation.direct, .room] {
            let evidence = MessageDeliveryEvidence(message: message(.delivered), transport: .meshCore, conversation: conversation)
            XCTAssertEqual(evidence.outcome, .acknowledged)
            XCTAssertEqual(evidence.acknowledgedRoundTripMs, 1250)
        }
        for transport in [MessageDeliveryEvidence.Transport.meshCore, .meshtastic] {
            let evidence = MessageDeliveryEvidence(message: message(.delivered), transport: transport, conversation: .channel)
            XCTAssertNotEqual(evidence.outcome, .acknowledged)
            XCTAssertNil(evidence.acknowledgedRoundTripMs)
        }
    }

    func testLegacyRepeatedStateIsOnlyRadioActivity() {
        let evidence = MessageDeliveryEvidence(message: message(.repeated), transport: .meshCore, conversation: .channel)
        XCTAssertEqual(evidence.outcome, .radioActivity)
        XCTAssertFalse(evidence.canRetry)
        XCTAssertFalse(evidence.requestedRouteReset)
    }

    func testIncomingMessagesNeverOfferRetryOrOutgoingEvidence() {
        for status in [DeliveryStatus.failed, .delivered, .sent] {
            let evidence = MessageDeliveryEvidence(message: message(status, outgoing: false), transport: .meshCore, conversation: .direct)
            XCTAssertEqual(evidence.outcome, .received)
            XCTAssertFalse(evidence.canRetry)
            XCTAssertNil(evidence.failureReason)
            XCTAssertNil(evidence.acknowledgedRoundTripMs)
            XCTAssertFalse(evidence.requestedRouteReset)
            XCTAssertEqual(evidence.receivedHops, 0)
            XCTAssertEqual(evidence.receivedSNR, 0)
        }
    }

    func testOnlyFailureOffersRetryAndAnAvailableReason() {
        for status in [DeliveryStatus.sending, .sent, .delivered, .failed, .retrying, .flooding, .repeated] {
            let evidence = MessageDeliveryEvidence(message: message(status), transport: .meshCore, conversation: .direct)
            XCTAssertEqual(evidence.canRetry, status == .failed)
            XCTAssertEqual(evidence.failureReason != nil, status == .failed)
            XCTAssertNil(evidence.receivedHops)
            XCTAssertNil(evidence.receivedSNR)
        }
        var failed = message(.failed)
        failed.failureReason = "  \n "
        XCTAssertNil(MessageDeliveryEvidence(message: failed, transport: .meshCore, conversation: .direct).failureReason)
    }

    func testMissingAndUnknownReceptionValuesAreNotInvented() {
        let incoming = Message(text: "Received", timestamp: Date(), isOutgoing: false, hops: 0xFF)
        let evidence = MessageDeliveryEvidence(message: incoming, transport: .meshCore, conversation: .direct)
        XCTAssertNil(evidence.receivedHops)
        XCTAssertNil(evidence.receivedSNR)
        var delivered = message(.delivered)
        delivered.roundTripMs = 0
        XCTAssertNil(MessageDeliveryEvidence(message: delivered, transport: .meshCore, conversation: .direct).acknowledgedRoundTripMs)
    }
}
