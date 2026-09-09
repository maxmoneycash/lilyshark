#if DEBUG && LILYSHARK_UI_CHAT_FIXTURE && os(iOS)
import SwiftUI
import MeshCoreKit
import MeshtasticKit

/// A separate compile-time entry point. This never creates the production
/// coordinator, activates a transport, or loads a radio's persisted messages.
@main
struct ChatFixtureApp: App {
    var body: some Scene {
        WindowGroup { ChatFixtureHost() }
    }
}

private struct ChatFixtureHost: View {
    @State private var fixture = ChatFixtureState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: Design.Space.tight) {
                Text("UI fixture · Messages")
                    .font(.headline)
                    .accessibilityIdentifier("chat-fixture-banner")
                Text("Simulated messages. No radio or cloud. Reset discards this session.")
                    .font(.caption)
                    .foregroundStyle(MeshTheme.textSecondary)
                HStack(spacing: Design.Space.tight) {
                    Button("Receive A") { fixture.receive(from: 0) }
                        .accessibilityIdentifier("chat-fixture-receive-a")
                    Button("Receive B") { fixture.receive(from: 1) }
                        .accessibilityIdentifier("chat-fixture-receive-b")
                    Button("Reset") { fixture = ChatFixtureState() }
                        .accessibilityIdentifier("chat-fixture-reset")
                }
                .buttonStyle(.meshSecondary)
                Toggle("Simulated connection", isOn: $fixture.isConnected)
                    .font(.caption)
                    .accessibilityIdentifier("chat-fixture-connection")
                Text("A: \(fixture.messageStore.unreadCount(for: fixture.contacts[0])) unread · B: \(fixture.messageStore.unreadCount(for: fixture.contacts[1])) unread")
                    .font(.caption.monospacedDigit())
                    .accessibilityIdentifier("chat-fixture-unread-counts")
                Text(fixture.retryCheckStatus)
                    .font(.caption)
                    .accessibilityIdentifier("chat-fixture-retry-status")
            }
            .padding(Design.Space.regular)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MeshTheme.surface)

            ContentView()
                .environment(fixture.contactStore)
                .environment(fixture.channelStore)
                .environment(fixture.messageStore)
                .environment(fixture.connectionManager)
                .environment(fixture.remoteSessionManager)
                .environment(fixture.navigation)
                .environment(fixture.deviceConfig)
                .environment(fixture.lineOfSightStore)
                // Replace the environment together with the view hierarchy.
                // Old onDisappear callbacks must save into the old session.
                .id(ObjectIdentifier(fixture))
        }
        .meshTheme()
        .task(id: ObjectIdentifier(fixture)) { await fixture.checkRetryCancellation() }
        .onChange(of: scenePhase) { _, phase in
            fixture.messageStore.isInBackground = phase != .active
        }
    }
}

@MainActor @Observable
private final class ChatFixtureState {
    let contactStore = ContactStore()
    let channelStore = ChannelStore()
    let messageStore = MessageStoreManager()
    let connectionManager = ConnectionManager()
    let remoteSessionManager = RemoteSessionManager()
    let navigation = NavigationStore()
    let deviceConfig = DeviceConfig()
    let lineOfSightStore = LineOfSightStore()
    let contacts: [Contact]
    var isConnected = true
    private var arrivals = [0, 0]
    var retryCheckStatus = "Retry checks pending"

    init() {
        contacts = [
            Self.contact(node: 0x00F17A01, name: "Fixture A"),
            Self.contact(node: 0x00F17A02, name: "Fixture B"),
        ]
        messageStore.canSendMessagesProvider = { [weak self] in self?.isConnected ?? false }
        messageStore.sendCommand = { _, label in
            DebugLogger.shared.log("Fixture accepted \(label); no transport is attached.")
        }
        let store = contactStore
        messageStore.contactProvider = { key in
            store.contacts.first { $0.publicKeyPrefix == key }
        }
        messageStore.displayNameProvider = { key in
            store.contacts.first { $0.publicKeyPrefix == key }?.name ?? "Fixture"
        }
        remoteSessionManager.contactsProvider = { store.contacts }
        // Send commands end at the recorder. Neither Bluetooth central is activated.
        messageStore.isInBackground = true // Avoid 160 seed-message haptics.
        let historyEnd = Date().addingTimeInterval(-60)
        for contact in contacts {
            contactStore.handleAdvert(contact, isLiveAdvert: false)
            for index in 1...80 {
                let marker = String(format: "%03d", index)
                _ = messageStore.handleIncomingMessage(Message(
                    senderKeyHash: contact.publicKeyPrefix,
                    contactKeyHash: contact.publicKeyPrefix,
                    text: "\(contact.name) history \(marker). This numbered message is fixture content for scrolling.",
                    timestamp: historyEnd.addingTimeInterval(Double(index - 80) * 60),
                    isOutgoing: false, status: .sent
                ))
            }
            messageStore.markAsRead(contactKey: contact.publicKeyPrefix)
        }
        messageStore.isInBackground = false
    }

    func receive(from index: Int) {
        let contact = contacts[index]
        arrivals[index] += 1
        let marker = String(format: "%03d", arrivals[index])
        // Use the live visible key, not merely the last sidebar selection.
        messageStore.selectedContactKey = navigation.isMessagesSectionVisible
            ? navigation.visibleConversationKey : nil
        _ = messageStore.handleIncomingMessage(Message(
            senderKeyHash: contact.publicKeyPrefix,
            contactKeyHash: contact.publicKeyPrefix,
            text: "\(contact.name) arrival \(marker). Triggered by the fixture control.",
            timestamp: Date(), isOutgoing: false, status: .sent
        ))
    }

    func checkRetryCancellation() async {
        retryCheckStatus = "Checking retry cancellation…"
        var failures = checkMessageValidation()
        for mode in ["retry", "path refresh"] {
        for scenario in ["normal", "disconnect", "delete", "switch radio"] {
            guard !Task.isCancelled else { return }
            let manager = MessageStoreManager()
            manager.isInBackground = true
            manager.canSendMessagesProvider = { true }
            manager.activateForRadio("f17a00000001")
            let contact = Self.contact(node: 0x00F17A01, name: "Fixture A", outPathLen: mode == "path refresh" ? 1 : -1)
            manager.contactProvider = { _ in contact }
            var commands = 0
            let requestedAt = Date()
            manager.sendCommand = { _, label in
                let expectedLabel = mode == "retry" ? "MANUAL_RETRY_FLOOD" : "SEND_TXT(path_refreshed)"
                if label == expectedLabel {
                    commands += 1
                    DebugLogger.shared.log("Fixture retry \(scenario): command after \(Date().timeIntervalSince(requestedAt))s")
                }
            }
            let message: Message
            if mode == "retry" {
                message = Message(contactKeyHash: contact.publicKeyPrefix, text: "Fixture retry \(scenario)",
                                  timestamp: Date(), isOutgoing: true, status: .failed)
                _ = manager.handleIncomingMessage(message)
                manager.retryMessage(message)
            } else {
                guard manager.sendTextMessage("Fixture path check \(scenario)", to: contact),
                      let sent = manager.messages(for: contact).last else {
                    failures.append("Path check was not accepted")
                    continue
                }
                message = sent
                manager.handleAdvertPathForPendingSend(AdvertPathInfo(recvTimestamp: 0, pathLen: 0, pathHashes: []))
            }
            // The retry's 500ms delay starts when its child task runs, not
            // when retryMessage returns. Yield before observing cancellation.
            await Task.yield()
            switch scenario {
            case "disconnect": manager.deactivate()
            case "delete": manager.deleteMessage(message, in: contact.publicKeyPrefix)
            case "switch radio": manager.activateForRadio("f17a00000002")
            default: break
            }
            let clock = ContinuousClock()
            let deadline = clock.now.advanced(by: .seconds(3))
            do {
                while clock.now < deadline {
                    if scenario == "normal", commands > 0 { break }
                    try await Task.sleep(for: .milliseconds(40))
                }
            } catch { manager.deactivate(); return }
            let expected = scenario == "normal" ? 1 : 0
            if commands != expected { failures.append("\(mode) \(scenario): \(commands), expected \(expected)") }
            let status = manager.messages(for: contact).first?.status.rawValue ?? "absent"
            DebugLogger.shared.log("Fixture retry \(scenario): \(commands) commands, state=\(status), protocol node=\(manager.meshtasticNodeNum), radio=\(manager.radioPrefix12 ?? "none")")
            manager.deactivate()
        }
        }
        retryCheckStatus = failures.isEmpty ? "Send checks passed" : "Send check failed: \(failures.joined(separator: "; "))"
        DebugLogger.shared.log(retryCheckStatus, level: failures.isEmpty ? .info : .error)
    }

    private func checkMessageValidation() -> [String] {
        let manager = MessageStoreManager()
        manager.activateForRadio("f17a00000001")
        var ready = false
        var frames: [Data] = []
        manager.canSendMessagesProvider = { ready }
        manager.sendCommand = { frame, _ in frames.append(frame) }
        let contact = contacts[0]
        var failures: [String] = []
        if manager.sendTextMessage("Offline draft", to: contact) || !frames.isEmpty || !manager.messages(for: contact).isEmpty {
            failures.append("Disconnected text was accepted")
        }
        ready = true
        let tooLong = String(repeating: "é", count: 81)
        if manager.sendTextMessage(tooLong, to: contact) || !frames.isEmpty || !manager.messages(for: contact).isEmpty {
            failures.append("Over-budget direct text was accepted")
        }
        if manager.sendChannelMessage(tooLong) || manager.sendRoomMessage(tooLong, to: contact) || !frames.isEmpty {
            failures.append("Over-budget channel or room text was accepted")
        }
        let exact = String(repeating: "é", count: 80)
        if !manager.sendTextMessage(exact, to: contact) || frames.count != 1
            || String(data: frames.last?.dropFirst(13) ?? Data(), encoding: .utf8) != exact
            || manager.messages(for: contact).last?.text != exact {
            failures.append("Encoded text did not survive sending unchanged")
        }
        manager.deactivate()
        failures += checkSentResponseMatching()
        return failures
    }

    private func checkSentResponseMatching() -> [String] {
        let manager = MessageStoreManager()
        manager.activateForRadio("f17a00000001")
        manager.canSendMessagesProvider = { true }
        manager.sendCommand = { _, _ in }
        let routed = Self.contact(node: 0x00F17A01, name: "Fixture A", outPathLen: 1)
        let direct = Self.contact(node: 0x00F17A02, name: "Fixture B", outPathLen: -1)
        var failures: [String] = []

        guard manager.sendTextMessage("on the wire", to: direct),
              manager.sendTextMessage("waiting for path", to: routed),
              let wired = manager.messages(for: direct).last,
              let waiting = manager.messages(for: routed).last else {
            manager.deactivate()
            return ["Path-check pairing was not accepted"]
        }
        manager.handleSentResponse(expectedACK: 42, suggestedTimeoutMs: 8000)
        let wiredAfter = manager.messages(for: direct).last
        let waitingAfter = manager.messages(for: routed).last
        if wiredAfter?.id != wired.id || wiredAfter?.status != .sent || wiredAfter?.expectedACK != 42 {
            failures.append("RESP_SENT attached to the path-check message instead of the transmitted one")
        }
        if waitingAfter?.id != waiting.id || waitingAfter?.status != .sending || waitingAfter?.expectedACK != nil {
            failures.append("Unsent path-check message was marked sent")
        }

        manager.handleAdvertPathForPendingSend(AdvertPathInfo(recvTimestamp: 0, pathLen: 0, pathHashes: []))
        let third = Self.contact(node: 0x00F17A03, name: "Fixture C", outPathLen: -1)
        guard manager.sendTextMessage("after refresh", to: third),
              let later = manager.messages(for: third).last else {
            manager.deactivate()
            failures.append("Follow-up send after path refresh was not accepted")
            return failures
        }
        manager.handleSentResponse(expectedACK: 99, suggestedTimeoutMs: 8000)
        if manager.messages(for: third).last?.id != later.id
            || manager.messages(for: third).last?.expectedACK != 99 {
            failures.append("Follow-up RESP_SENT did not stay with the later transmitted message")
        }
        if manager.messages(for: routed).last?.expectedACK != nil {
            failures.append("Delayed path-refresh message consumed a later RESP_SENT")
        }

        manager.deactivate()
        return failures
    }

    private static func contact(node: UInt32, name: String, outPathLen: Int8 = -1) -> Contact {
        Contact(
            publicKey: MeshtasticIdentity.syntheticKey(forNodeNum: node),
            name: name, type: .chat, flags: 0,
            outPathLen: outPathLen, outPath: Data(), lastAdvert: 0,
            latitude: 0, longitude: 0, lastmod: 0
        )
    }
}
#endif
