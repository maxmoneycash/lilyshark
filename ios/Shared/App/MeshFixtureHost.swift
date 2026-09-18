#if DEBUG && LILYSHARK_UI_CHAT_FIXTURE && LILYSHARK_UI_MESH_FIXTURE && os(iOS)
import SwiftUI
import MeshCoreKit
import MeshtasticKit

/// Uses the existing chat fixture's persistence guards and the production tab routes.
/// No coordinator is created; commands cannot reach a radio.
struct MeshFixtureHost: View {
    @State private var fixture = MeshFixtureState(populated: true)
    @AppStorage("uiFixtureTextSize") private var textSize = FixtureTextSize.defaultValue.rawValue

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("UI fixture · \(fixture.meshtastic ? "Meshtastic" : "MeshCore")").font(.caption)
                Spacer()
                Menu("Scenario") {
                    Button("Node map") { fixture = MeshFixtureState(populated: true, locations: true) }
                    Button("MeshCore mesh") { fixture = MeshFixtureState(populated: true) }
                    Button("Meshtastic mesh") { fixture = MeshFixtureState(populated: true, meshtastic: true) }
                    Button("Message delivery") { fixture = MeshFixtureState(populated: true, delivery: true) }
                    Button("Meshtastic delivery") { fixture = MeshFixtureState(populated: true, meshtastic: true, delivery: true) }
                    Button("Empty mesh") { fixture = MeshFixtureState(populated: false) }
                    Button("Nodes, no conversations") { fixture = MeshFixtureState(populated: true, withMessages: false) }
                    if let room = fixture.contacts.contacts.first(where: { $0.type == .room }) {
                        Button("Simulate room access") {
                            fixture.remote.remoteSession(for: room).loginState = .loggedIn(permission: .readWrite)
                        }
                    }
                    Button("Saved data, offline") {
                        fixture.connection.setMeshFixtureConnected(false, meshtastic: fixture.meshtastic)
                    }
                    Section("Text size") {
                        Button("Standard text") { textSize = FixtureTextSize.standard.rawValue }
                        Button("Large text") { textSize = FixtureTextSize.large.rawValue }
                        Button("Largest text") { textSize = FixtureTextSize.largest.rawValue }
                    }
                }
                .font(.caption)
                .touchable()
            }
            // Test controls stay compact and do not consume the app's layout.
            .dynamicTypeSize(.large)
            .padding(.horizontal, Design.Space.regular)
            .background(MeshTheme.surface)
            ContentView()
                .environment(fixture.contacts)
                .environment(fixture.channels)
                .environment(fixture.messages)
                .environment(fixture.connection)
                .environment(fixture.remote)
                .environment(fixture.navigation)
                .environment(fixture.config)
                .environment(fixture.lineOfSight)
                .environment(fixture.rf)
                .environment(fixture.geofences)
                .id(ObjectIdentifier(fixture))
        }
        .meshTheme()
        .task(id: ObjectIdentifier(fixture)) {
            // Let the inactive transports publish their initial disconnected
            // values before applying this explicitly simulated UI state.
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            fixture.connection.setMeshFixtureConnected(true, meshtastic: fixture.meshtastic)
        }
    }
}

@MainActor @Observable
private final class MeshFixtureState {
    let contacts = ContactStore()
    let channels = ChannelStore()
    let messages = MessageStoreManager()
    let connection = ConnectionManager()
    let remote = RemoteSessionManager()
    let navigation = NavigationStore()
    let config = DeviceConfig()
    let lineOfSight = LineOfSightStore()
    let rf = RFMonitorStore()
    let geofences = GeofenceStore()
    let meshtastic: Bool

    init(populated: Bool, meshtastic: Bool = false, withMessages: Bool = true, delivery: Bool = false, locations: Bool = false) {
        self.meshtastic = meshtastic
        connection.setMeshFixtureConnected(true, meshtastic: meshtastic)
        config.deviceName = "Trail Deck"
        config.publicKeyHex = meshtastic ? "00f17a00" : Data(repeating: 0xA0, count: 32).hexCompact
        config.reportedBatteryPercent = 76
        config.loadedSections.insert("selfInfo")
        channels.channels = [MeshChannel(index: 0, name: meshtastic ? "Primary" : "Public", flags: 0)]
        if !meshtastic { channels.channels.append(MeshChannel(index: 1, name: "Trail crew", flags: 0)) }
        channels.hasCompletedInitialChannelSync = true
        messages.canSendMessagesProvider = { [weak connection] in connection?.connectionState == .ready }
        messages.meshtasticNodeNum = meshtastic ? 0x00F17A00 : 0
        let contactStore = contacts
        messages.contactProvider = { key in contactStore.contacts.first { $0.publicKeyPrefix == key } }
        messages.displayNameProvider = { key in contactStore.contacts.first { $0.publicKeyPrefix == key }?.name ?? "Unknown" }
        remote.contactsProvider = { contactStore.contacts }
        if delivery && !meshtastic {
            // Exercise the real retry/response handlers, with explicitly
            // simulated responses. No connection coordinator or transport.
            var acknowledgement: UInt32 = 9000
            messages.sendCommand = { [weak messages] _, _ in
                acknowledgement += 1
                let code = acknowledgement
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(1))
                    messages?.handleSentResponse(expectedACK: code, suggestedTimeoutMs: 6000)
                    try? await Task.sleep(for: .seconds(2))
                    messages?.handleSendConfirmed(ackCode: code, roundTripMs: 1250)
                }
            }
        }
        guard populated else { return }
        let now = UInt32(Date().timeIntervalSince1970)
        let nodes: [(String, ContactType)] = meshtastic
            ? [("Alex · North trail", .chat), ("Sam · Base camp", .chat), ("Ridge lookout", .chat)]
            : [("Alex · North trail", .chat), ("Sam · Base camp", .chat), ("Ridge repeater", .repeater),
               ("Trail room", .room), ("Weather station", .sensor), ("Jordan · South trail", .chat), ("Casey · Creek crossing", .chat)]
        for (index, node) in nodes.enumerated() {
            let key = meshtastic ? MeshtasticIdentity.syntheticKey(forNodeNum: 0x00F17A01 + UInt32(index))
                : Data(repeating: UInt8(0xA1 + index), count: 32)
            let contact = Contact(publicKey: key,
                                  name: node.0, type: node.1, flags: 0, outPathLen: -1,
                                  outPath: Data(), lastAdvert: now - UInt32(120 + index * 300),
                                  latitude: locations && index < 5 ? 37.88 + Double(index) * 0.025 : 0,
                                  longitude: locations && index < 5 ? -122.57 + Double(index) * 0.018 : 0, lastmod: 0)
            contacts.contacts.append(contact)
            if meshtastic {
                contacts.nodeObservations[contact.publicKeyPrefix] = .init(source: .packet, snr: index == 2 ? nil : 6.5,
                rssi: index == 2 ? nil : -92 - Int32(index * 8), hops: UInt32(index),
                lastHeard: contact.lastAdvert, viaMQTT: index == 2 ? true : false)
                if index < 2 {
                    contacts.nodePositions[contact.publicKeyPrefix] = .init(latitude: 37.88 + Double(index) * 0.01, longitude: -122.57)
                }
            }
        }
        if locations { navigation.section = .map }
        guard withMessages else { return }
        messages.isInBackground = true
        let alex = contacts.contacts[0]
        let sam = contacts.contacts[1]
        var samples: [(Data, Data, String, TimeInterval)] = [
            (Data([0]), alex.publicKeyPrefix, "At the trail junction. Which way are you heading?", -180),
            (alex.publicKeyPrefix, alex.publicKeyPrefix, "Great, see you at the lookout.", -1200),
            (sam.publicKeyPrefix, sam.publicKeyPrefix, "Base camp is set up. Signal is good here.", -300)
        ]
        if !meshtastic {
            let room = contacts.contacts[3]
            samples.append((room.publicKeyPrefix, room.publicKeyPrefix, "Alex: Meeting at the north trailhead at 9.", -2400))
            messages.saveDraft("Are you near the creek crossing?", for: contacts.contacts[5].publicKeyPrefix)
        }
        for (key, sender, text, age) in samples {
            _ = messages.handleIncomingMessage(Message(senderKeyHash: sender, contactKeyHash: key,
                text: text, timestamp: Date().addingTimeInterval(age), isOutgoing: false, status: .sent,
                channelIndex: key.count == 1 ? 0 : nil))
        }
        messages.markAsRead(contactKey: sam.publicKeyPrefix)
        messages.isInBackground = false
        if delivery {
            messages.messagesByContact[alex.publicKeyPrefix] = [
                Message(contactKeyHash: alex.publicKeyPrefix, text: "Meet at the north trailhead at 9.", timestamp: Date().addingTimeInterval(-600),
                        isOutgoing: true, status: meshtastic ? .sent : .delivered, roundTripMs: meshtastic ? nil : 1250),
                Message(contactKeyHash: alex.publicKeyPrefix, text: "Can you hear me from the lookout?", timestamp: Date().addingTimeInterval(-300),
                        isOutgoing: true, status: .sent, expectedACK: 1234),
                Message(contactKeyHash: alex.publicKeyPrefix, text: "I will wait by the creek crossing.", timestamp: Date().addingTimeInterval(-60),
                        isOutgoing: true, status: .failed, failureReason: "No acknowledgement arrived before the attempt ended.")
            ]
            messages.messagesByContact[Data([0])] = [
                Message(contactKeyHash: Data([0]), text: "Anyone near the north trail?", timestamp: Date().addingTimeInterval(-180),
                        isOutgoing: true, status: .sent, channelIndex: 0),
                Message(contactKeyHash: Data([0]), text: "Meeting at base camp at 6.", timestamp: Date().addingTimeInterval(-60),
                        isOutgoing: true, status: meshtastic ? .sent : .repeated, channelIndex: 0)
            ]
            if let room = contacts.contacts.first(where: { $0.type == .room }) {
                messages.messagesByContact[room.publicKeyPrefix] = [
                    Message(contactKeyHash: room.publicKeyPrefix, text: "We have reached base camp.", timestamp: Date().addingTimeInterval(-30),
                            isOutgoing: true, status: .delivered, roundTripMs: 800)
                ]
                remote.remoteSession(for: room).loginState = .loggedIn(permission: .readWrite)
            }
            navigation.sidebarSelection = .contact(alex.publicKeyPrefix)
        }
    }
}
#endif
