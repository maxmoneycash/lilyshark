import SwiftUI
import MeshCoreKit

/// Capture the radio context when opening details, so a later radio switch
/// cannot reinterpret this message or enable a retry through another radio.
struct MessageDetailsSelection: Identifiable {
    let message: Message
    let conversation: MessageDeliveryEvidence.Conversation
    let transport: MessageDeliveryEvidence.Transport
    let radioPrefix: String?
    let localNodeNumber: UInt32
    var id: UUID { message.id }

    @MainActor init(message: Message, conversation: MessageDeliveryEvidence.Conversation, store: MessageStoreManager) {
        self.message = message
        self.conversation = conversation
        transport = store.meshtasticNodeNum == 0 ? .meshCore : .meshtastic
        radioPrefix = store.radioPrefix12
        localNodeNumber = store.meshtasticNodeNum
    }
}

/// An explicit, accessible entry point below each outgoing bubble.
struct MessageDeliveryButton: View {
    let message: Message
    let conversation: MessageDeliveryEvidence.Conversation
    let action: () -> Void
    @Environment(MessageStoreManager.self) private var store

    var body: some View {
        let evidence = MessageDeliveryEvidence(message: message,
            transport: store.meshtasticNodeNum == 0 ? .meshCore : .meshtastic, conversation: conversation)
        Button(action: action) {
            Label(evidence.shortTitle(conversation: conversation), systemImage: evidence.symbol)
                .font(.caption)
                .foregroundStyle(evidence.canRetry ? MeshTheme.disconnected : MeshTheme.accent)
                .fixedSize(horizontal: false, vertical: true)
                .contentShape(Rectangle())
                .touchable()
        }
        .buttonStyle(.meshPlain)
        .accessibilityLabel("Message details: \(evidence.shortTitle(conversation: conversation))")
        .accessibilityHint("Explains the radio's report for this message")
    }
}

struct MessageDetailsView: View {
    let selection: MessageDetailsSelection
    @State private var copied = false
    @Environment(MessageStoreManager.self) private var store
    @Environment(ContactStore.self) private var contacts
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize

    private var currentMessage: Message? {
        guard store.radioPrefix12 == selection.radioPrefix,
              store.meshtasticNodeNum == selection.localNodeNumber else { return nil }
        return store.messagesByContact[selection.message.contactKeyHash]?.first { $0.id == selection.id }
    }
    private var message: Message { currentMessage ?? selection.message }
    private var evidence: MessageDeliveryEvidence {
        MessageDeliveryEvidence(message: message, transport: selection.transport, conversation: selection.conversation)
    }
    private var recipientAvailable: Bool {
        selection.conversation == .channel || contacts.contacts.contains {
            $0.publicKeyPrefix == message.contactKeyHash && !contacts.isBlocked($0)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: Design.Space.tight) {
                        Label(evidence.title(conversation: selection.conversation), systemImage: evidence.symbol)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(evidence.canRetry ? MeshTheme.disconnected : MeshTheme.textPrimary)
                        Text(evidence.explanation(conversation: selection.conversation))
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    if let reason = evidence.failureReason {
                        VStack(alignment: .leading, spacing: Design.Space.hairline) {
                            Text("Reported reason").font(.headline)
                            Text(reason).foregroundStyle(MeshTheme.textSecondary)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if currentMessage == nil {
                    Section {
                        Text("This message is no longer available in the active radio's history. These are its saved details.")
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                } else if evidence.canRetry {
                    Section {
                        Button {
                            // Re-read at the instant of the action; a confirmation
                            // may have arrived while this sheet was open.
                            guard let currentMessage, currentMessage.status == .failed,
                                  store.canSendMessages, recipientAvailable else { return }
                            store.retryMessage(currentMessage)
                        } label: {
                            Label("Retry message", systemImage: "arrow.clockwise")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.meshPrimary)
                        .disabled(!store.canSendMessages || !recipientAvailable)
                    } footer: {
                        if !recipientAvailable {
                            Text("The recipient is unavailable in this radio's contacts.")
                        } else if !store.canSendMessages {
                            Text("Reconnect this radio to retry. Your message is saved.")
                        } else if selection.transport == .meshCore && selection.conversation != .channel {
                            Text("Retry sends the same text again and asks the radio to find a route. The earlier copy may still arrive.")
                        } else {
                            Text("Retry sends the same text again. The earlier copy may already have arrived.")
                        }
                    }
                }

                Section("Message") {
                    Text(message.interfaceText)
                        .textSelection(.enabled)
                    Button {
                        copyToClipboard(message.text)
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy message", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                            .touchable()
                    }
                    .buttonStyle(.meshPlain)
                }

                Section {
                    detail(message.isOutgoing ? "Message created" : "Message time",
                           value: message.timestamp.formatted(date: .abbreviated, time: .standard))
                    detail("Conversation", value: selection.conversation == .channel ? "Channel" : selection.conversation == .room ? "Room" : "Direct message")
                    if let milliseconds = evidence.acknowledgedRoundTripMs {
                        detail("Acknowledgement round trip", value: "\(milliseconds) ms")
                    }
                    if evidence.requestedRouteReset {
                        detail("Retry route", value: "New route requested")
                    }
                    if !message.isOutgoing {
                        detail("Reported hops", value: evidence.receivedHops.map { $0 == 0 ? "Direct" : "\($0)" } ?? "Not reported")
                        if let snr = evidence.receivedSNR {
                            detail("Signal-to-noise ratio", value: formatSNR(snr))
                        }
                    }
                } header: {
                    Text("Recorded details")
                } footer: {
                    Text("A complete transmission history and the route taken by this message were not recorded.")
                }
            }
            .meshListStyle()
            .meshTheme()
            .navigationTitle("Message details")
            .lilysharkSheet { dismiss() }
        }
    }

    @ViewBuilder private func detail(_ title: String, value: String) -> some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(title).foregroundStyle(MeshTheme.textSecondary)
                Text(value)
            }
            .accessibilityElement(children: .combine)
        } else {
            LabeledContent(title, value: value)
        }
    }
}

extension MessageDeliveryEvidence {
    func shortTitle(conversation: Conversation) -> String {
        switch outcome {
        case .received: "Received"
        case .sendRequested: "Send requested"
        case .acceptedByRadio: "Radio accepted"
        case .transmittedByRadio: "Radio transmitted"
        case .acknowledged: conversation == .room ? "Room acknowledged" : "Delivered"
        case .channelConfirmation: "Confirmation recorded"
        case .radioActivity: "Radio activity"
        case .retrying: "Retrying"
        case .findingRoute: "Finding a route"
        case .unconfirmed: "Unconfirmed"
        }
    }

    func title(conversation: Conversation) -> String {
        switch outcome {
        case .acknowledged: conversation == .room ? "Room server acknowledged" : "Recipient radio acknowledged"
        case .acceptedByRadio: "Accepted by your radio"
        case .transmittedByRadio: "Your radio reported a send"
        case .radioActivity: "Radio activity heard"
        case .unconfirmed: "Delivery unconfirmed"
        default: shortTitle(conversation: conversation)
        }
    }

    var symbol: String {
        switch outcome {
        case .received: "arrow.down.message"
        case .acknowledged: "checkmark.circle"
        case .unconfirmed: "exclamationmark.circle"
        case .retrying, .findingRoute: "arrow.clockwise"
        case .radioActivity: "waveform"
        default: "info.circle"
        }
    }

    func explanation(conversation: Conversation) -> String {
        switch outcome {
        case .received:
            "This message is in your saved history. Its radio reports are shown below when available."
        case .sendRequested:
            "The app requested a send. Delivery to another radio has not been confirmed."
        case .acceptedByRadio:
            "Your radio accepted the request. No recipient acknowledgement has been recorded for this message."
        case .transmittedByRadio:
            "The deck reported that its radio sent the message. This is not confirmation from the recipient."
        case .acknowledged:
            conversation == .room
                ? "The room server acknowledged this message. That does not confirm that room members received or read it."
                : "An acknowledgement from the recipient's radio was recorded. This does not mean the person has read the message."
        case .channelConfirmation:
            "A confirmation was recorded for this send. It does not establish that every listener received the message."
        case .radioActivity:
            "Radio traffic was heard soon after this send. That traffic was not matched to this message, so a repeat and delivery remain unconfirmed."
        case .retrying:
            "The app is trying to send the message again. Delivery is still unconfirmed."
        case .findingRoute:
            "The app requested another attempt using route discovery. Delivery is still unconfirmed."
        case .unconfirmed:
            "The send attempt ended without confirmed delivery. The message may still have reached its destination."
        }
    }
}
