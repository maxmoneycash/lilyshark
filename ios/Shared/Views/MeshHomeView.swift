#if os(iOS) && !targetEnvironment(macCatalyst)
import SwiftUI
import CoreLocation
import MeshCoreKit
import MeshtasticKit

/// The everyday starting point. Every count and preview comes from this radio's stores.
struct MeshHomeView: View {
    @Environment(ContactStore.self) private var contacts
    @Environment(ChannelStore.self) private var channels
    @Environment(MessageStoreManager.self) private var messages
    @Environment(ConnectionManager.self) private var connection
    @Environment(DeviceConfig.self) private var config
    @Environment(NavigationStore.self) private var navigation
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var selectedNode: Contact?
    @State private var pendingConversation: SidebarSelection?

    private var nodes: [Contact] { MeshNodePresentation.nodes(in: contacts, config: config) }
    private var locatedNodeCount: Int {
        nodes.filter { MeshNodePresentation.hasPosition($0, in: contacts) }.count
    }
    private var primaryChannel: MeshChannel? {
        channels.channels.first { $0.index == 0 } ?? channels.channels.first
    }
    private var recentMessages: [Message] {
        messages.messagesByContact.compactMap { key, history -> Message? in
            let knownChannel = key.count == 1 && channels.channels.contains { Data([$0.index]) == key }
            let knownContact = nodes.contains { $0.publicKeyPrefix == key && ($0.type == .chat || $0.type == .room) }
            return knownChannel || knownContact ? history.max { $0.timestamp < $1.timestamp } : nil
        }
        .sorted { $0.timestamp > $1.timestamp }
        .prefix(3).map { $0 }
    }

    var body: some View {
        List {
            Section {
                NavigationLink {
                    RadioVisibilityView()
                } label: {
                    VStack(alignment: .leading, spacing: Design.Space.tight) {
                        Label(radioStatus,
                              systemImage: connection.connectionState == .ready ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right.slash")
                            .font(.subheadline)
                            .foregroundStyle(connection.connectionState == .ready ? MeshTheme.connected : MeshTheme.textSecondary)
                        Text(radioName)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(MeshTheme.textPrimary)
                        if let batteryDescription {
                            Text(batteryDescription)
                                .font(.footnote)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                    .padding(.vertical, Design.Space.hairline)
                }
                .accessibilityIdentifier("mesh-radio-summary")
            } footer: {
                if connection.connectionState != .ready {
                    if let savedAt = config.savedRadioDataDate {
                        Text("Saved from this radio \(savedAt.formatted(date: .abbreviated, time: .shortened)). Reconnect to send or refresh reports.")
                    } else {
                        Text("You can still browse saved messages and node reports.")
                    }
                }
            }

            Section("Your network") {
                NavigationLink {
                    MeshNodeListView()
                } label: {
                    MeshActionLabel(title: "Nodes", detail: nodes.isEmpty ? "See nodes as your radio hears them" : "\(nodes.count) known to your radio",
                                    icon: "point.3.connected.trianglepath.dotted")
                }
                .accessibilityIdentifier("mesh-open-nodes")
                Button {
                    navigation.mapShowsLocalMesh = locatedNodeCount > 0
                    navigation.section = .map
                } label: {
                    MeshActionLabel(title: "Open map", detail: locatedNodeCount == 0 ? "Explore the public MeshCore network" : "\(locatedNodeCount) with a reported position", icon: "map", chevron: true)
                }
                .buttonStyle(.meshPlain)
                .accessibilityIdentifier("mesh-open-map")
            }

            Section {
                if let channel = primaryChannel {
                    Button { navigation.sidebarSelection = channel.index == 0 ? .publicChannel : .channel(channel.index) } label: {
                        MeshActionLabel(title: "Message \(channel.name.isEmpty ? "Channel \(channel.index)" : channel.name)",
                                        detail: "Talk to everyone on this channel", icon: "bubble.left.and.bubble.right", chevron: true, accented: true)
                    }
                    .buttonStyle(.meshPlain)
                    .accessibilityIdentifier("mesh-message-channel")
                } else {
                    Button { navigation.section = .messages } label: {
                        MeshActionLabel(title: "Open messages", detail: "Channels and direct conversations", icon: "bubble.left.and.bubble.right", chevron: true, accented: true)
                    }
                    .buttonStyle(.meshPlain)
                }
                ForEach(recentMessages) { message in
                    Button { open(message) } label: {
                        conversationPreview(message)
                    }
                    .buttonStyle(.meshPlain)
                }
            } header: {
                Text("Messages")
            } footer: {
                if recentMessages.isEmpty {
                    Text("Start a conversation. Replies and direct messages will appear here.")
                }
            }

            if !nodes.isEmpty {
                Section("Latest node reports") {
                    ForEach(nodes.prefix(3)) { node in
                        Button { selectedNode = node } label: {
                            MeshNodeRow(contact: node)
                        }
                        .buttonStyle(.meshPlain)
                    }
                }
            }
        }
        .meshListStyle()
        .meshTheme()
        .navigationTitle("Mesh")
        .navigationBarTitleDisplayMode(.large)
        .sheet(item: $selectedNode, onDismiss: openPendingConversation) { node in
            ContactDetailSheet(contact: node) { pendingConversation = .contact($0.publicKeyPrefix) }
        }
    }

    private var radioStatus: String {
        switch connection.connectionState {
        case .ready: "Radio connected"
        case .connecting, .connected: "Connecting to radio"
        default: "Radio offline"
        }
    }

    private func openPendingConversation() {
        if let pendingConversation {
            navigation.sidebarSelection = pendingConversation
            self.pendingConversation = nil
        }
    }

    private var radioName: String {
        if !config.deviceName.isEmpty { return config.deviceName }
        return connection.connectedDeviceName ?? "Your radio"
    }

    private var batteryDescription: String? {
        guard connection.connectionState == .ready else { return nil }
        switch config.batteryReading() {
        case .reported(let percent): return "Battery \(percent)%"
        case .estimated(let percent): return "Battery about \(percent)%"
        case .externalPower: return "External power"
        case .unknown: return nil
        }
    }

    private func conversationName(_ message: Message) -> String {
        if message.contactKeyHash.count == 1, let index = message.contactKeyHash.first {
            return channels.channels.first { $0.index == index }?.name ?? "Channel \(index)"
        }
        return nodes.first { $0.publicKeyPrefix == message.contactKeyHash }.map { contacts.displayName(for: $0) } ?? "Message"
    }

    private func open(_ message: Message) {
        if message.contactKeyHash.count == 1, let index = message.contactKeyHash.first {
            navigation.sidebarSelection = index == 0 ? .publicChannel : .channel(index)
        } else {
            navigation.sidebarSelection = .contact(message.contactKeyHash)
        }
    }

    private func conversationPreview(_ message: Message) -> some View {
        let headingLayout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Design.Space.hairline))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        return VStack(alignment: .leading, spacing: Design.Space.hairline) {
            headingLayout {
                Text(conversationName(message)).font(.headline)
                if !typeSize.isAccessibilitySize { Spacer(minLength: Design.Space.tight) }
                if messages.unreadCounts[message.contactKeyHash, default: 0] > 0 {
                    Text("\(messages.unreadCounts[message.contactKeyHash, default: 0]) unread")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(MeshTheme.accent)
                }
            }
            Text(message.isOutgoing ? "You: \(message.interfaceText)" : message.interfaceText)
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)
                .lineLimit(2)
            if message.isOutgoing && message.status == .failed {
                Label("Delivery not confirmed", systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(MeshTheme.disconnected)
            }
            Text(message.timestamp, style: .relative)
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .foregroundStyle(MeshTheme.textPrimary)
        .padding(.vertical, Design.Space.hairline)
        .accessibilityElement(children: .combine)
    }
}

/// A directory is useful even before a node has sent a text message.
struct MeshNodeListView: View {
    private enum NodeFilter: String, CaseIterable, Identifiable {
        case all = "All nodes", people = "People", repeaters = "Repeaters", rooms = "Rooms", sensors = "Sensors"
        var id: Self { self }
        func includes(_ contact: Contact) -> Bool {
            switch self {
            case .all: true
            case .people: contact.type == .chat
            case .repeaters: contact.type == .repeater
            case .rooms: contact.type == .room
            case .sensors: contact.type == .sensor
            }
        }
    }
    @Environment(ContactStore.self) private var contacts
    @Environment(DeviceConfig.self) private var config
    @Environment(NavigationStore.self) private var navigation
    @State private var search = ""
    @State private var filter: NodeFilter = .all
    @State private var selectedNode: Contact?
    @State private var pendingConversation: SidebarSelection?
    private var nodes: [Contact] {
        MeshNodePresentation.nodes(in: contacts, config: config).filter {
            filter.includes($0) && (search.isEmpty || contacts.displayName(for: $0).localizedStandardContains(search)
                || MeshNodePresentation.identifier($0).localizedStandardContains(search))
        }
    }

    var body: some View {
        List {
            Section {
                Menu {
                    Picker("Node type", selection: $filter) {
                        ForEach(NodeFilter.allCases) { Text($0.rawValue).tag($0) }
                    }
                } label: {
                    HStack {
                        Text("Show").foregroundStyle(MeshTheme.textPrimary)
                        Spacer()
                        Text(filter.rawValue)
                        Image(systemName: "chevron.up.chevron.down").font(.caption)
                    }
                    .contentShape(Rectangle())
                    .touchable()
                }
                .buttonStyle(.meshPlain)
                .accessibilityLabel("Show, \(filter.rawValue)")
                .accessibilityIdentifier("node-role-filter")
            }
            if nodes.isEmpty {
                ContentUnavailableView {
                    Label(search.isEmpty && filter == .all ? "No nodes yet" : "No matching nodes", systemImage: "point.3.connected.trianglepath.dotted")
                } description: {
                    Text(search.isEmpty && filter == .all ? "Nodes appear when your radio receives their reports. You can start talking on a channel while you wait." : "Try another name or node ID, or show all node types.")
                } actions: {
                    if filter != .all || !search.isEmpty {
                        Button("Show all nodes") { filter = .all; search = "" }
                    }
                }
            }
            Section {
                ForEach(nodes) { node in
                    Button { selectedNode = node } label: { MeshNodeRow(contact: node) }
                        .buttonStyle(.meshPlain)
                }
            } footer: {
                if !nodes.isEmpty {
                    Text("Sorted by latest report. A saved node may be out of range now.")
                }
            }
        }
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Name or node ID")
        .meshListStyle()
        .meshTheme()
        .navigationTitle("Nodes")
        .sheet(item: $selectedNode, onDismiss: {
            if let pendingConversation {
                navigation.sidebarSelection = pendingConversation
                self.pendingConversation = nil
            }
        }) { node in
            ContactDetailSheet(contact: node) { pendingConversation = .contact($0.publicKeyPrefix) }
        }
    }
}

private struct MeshActionLabel: View {
    let title: String
    let detail: String
    let icon: String
    var chevron = false
    var accented = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: Design.Space.snug) {
            if !typeSize.isAccessibilitySize {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(accented ? MeshTheme.accent : MeshTheme.textSecondary)
                    .frame(width: 28)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(title).font(.headline).foregroundStyle(accented ? MeshTheme.accent : MeshTheme.textPrimary)
                Text(detail).font(.subheadline).foregroundStyle(MeshTheme.textSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            if chevron && !typeSize.isAccessibilitySize {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
        }
        .touchable()
        .padding(.vertical, Design.Space.hairline)
        .accessibilityElement(children: .combine)
    }
}

private struct MeshNodeRow: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contacts
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: Design.Space.tight) {
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text(contacts.displayName(for: contact))
                    .font(.headline).foregroundStyle(MeshTheme.textPrimary)
                Text(contact.type == .chat ? "Person" : contact.type.displayName)
                    .font(.footnote).foregroundStyle(MeshTheme.textSecondary)
                if let timestamp = MeshNodePresentation.reportDate(contact, in: contacts) {
                    (Text(MeshtasticIdentity.nodeNum(forSyntheticKey: contact.publicKey) == nil ? "Last advert " : "Last report ") + Text(timestamp, style: .relative) + Text(" ago"))
                        .font(.subheadline).foregroundStyle(MeshTheme.textSecondary)
                } else {
                    Text("No report time available").font(.subheadline).foregroundStyle(MeshTheme.textSecondary)
                }
                let observation = contacts.nodeObservations[contact.publicKeyPrefix]
                let details = [
                    observation?.rssi.map { "\($0) dBm" },
                    observation?.viaMQTT == true ? "Via MQTT" : nil,
                    MeshNodePresentation.hasPosition(contact, in: contacts) ? "Position reported" : nil
                ].compactMap { $0 }
                if !details.isEmpty {
                    Text(details.joined(separator: " · ")).font(.footnote).foregroundStyle(MeshTheme.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !typeSize.isAccessibilitySize {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, Design.Space.hairline)
        .touchable()
        .accessibilityElement(children: .combine)
    }
}

@MainActor enum MeshNodePresentation {
    static func identifier(_ node: Contact) -> String {
        if let number = MeshtasticIdentity.nodeNum(forSyntheticKey: node.publicKey) {
            return String(format: "!%08x", number)
        }
        return node.publicKey.hexCompact
    }

    static func nodes(in store: ContactStore, config: DeviceConfig) -> [Contact] {
        store.contacts.filter { contact in
            guard !store.isBlocked(contact) else { return false }
            if let node = MeshtasticIdentity.nodeNum(forSyntheticKey: contact.publicKey) {
                return node != UInt32(config.publicKeyHex, radix: 16)
            }
            return contact.publicKey.hexCompact != config.publicKeyHex.lowercased()
        }.sorted {
            let lhs = reportDate($0, in: store) ?? .distantPast
            let rhs = reportDate($1, in: store) ?? .distantPast
            if lhs != rhs { return lhs > rhs }
            return store.displayName(for: $0).localizedStandardCompare(store.displayName(for: $1)) == .orderedAscending
        }
    }

    static func reportDate(_ node: Contact, in store: ContactStore) -> Date? {
        let timestamp = store.nodeObservations[node.publicKeyPrefix]?.lastHeard ?? node.lastAdvert
        return timestamp > 0 ? Date(timeIntervalSince1970: Double(timestamp)) : nil
    }

    static func hasPosition(_ node: Contact, in store: ContactStore) -> Bool {
        store.reportedPosition(for: node) != nil
    }
}
#endif
