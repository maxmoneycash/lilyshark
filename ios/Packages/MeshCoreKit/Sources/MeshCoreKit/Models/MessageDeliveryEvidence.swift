import Foundation

/// Interprets the evidence actually retained by the companion's message store.
/// A send state, an expected ACK, and nearby RF activity are distinct observations.
public struct MessageDeliveryEvidence: Sendable {
    public enum Transport: Sendable { case meshCore, meshtastic }
    public enum Conversation: Sendable { case direct, room, channel }
    public enum Outcome: Sendable {
        case received, sendRequested, acceptedByRadio, transmittedByRadio
        case acknowledged, channelConfirmation, radioActivity, retrying, findingRoute, unconfirmed
    }

    public let outcome: Outcome
    public let canRetry: Bool
    public let failureReason: String?
    public let acknowledgedRoundTripMs: UInt32?
    public let requestedRouteReset: Bool
    public let receivedHops: UInt8?
    public let receivedSNR: Int8?

    public init(message: Message, transport: Transport, conversation: Conversation) {
        canRetry = message.isOutgoing && message.status == .failed
        failureReason = canRetry ? message.failureReason.flatMap {
            let reason = $0.trimmingCharacters(in: .whitespacesAndNewlines)
            return reason.isEmpty ? nil : reason
        } : nil
        requestedRouteReset = message.isOutgoing && transport == .meshCore
            && conversation != .channel && message.didResetPath
        receivedHops = !message.isOutgoing && message.hops != 0xFF ? message.hops : nil
        receivedSNR = !message.isOutgoing ? message.snr : nil
        let hasRecipientACK = message.isOutgoing && message.status == .delivered
            && transport == .meshCore && conversation != .channel
        acknowledgedRoundTripMs = hasRecipientACK && (message.roundTripMs ?? 0) > 0 ? message.roundTripMs : nil

        if !message.isOutgoing {
            outcome = .received
        } else {
            switch message.status {
            case .sending: outcome = .sendRequested
            case .sent:
                outcome = transport == .meshtastic ? .transmittedByRadio
                    : conversation == .channel ? .sendRequested : .acceptedByRadio
            case .delivered:
                outcome = hasRecipientACK ? .acknowledged : .channelConfirmation
            case .repeated:
                // Legacy store records inferred this from any LOG_RX_DATA within
                // 30 seconds of a channel send. There is no message correlation.
                outcome = .radioActivity
            case .retrying: outcome = .retrying
            case .flooding: outcome = .findingRoute
            case .failed: outcome = .unconfirmed
            }
        }
    }
}
