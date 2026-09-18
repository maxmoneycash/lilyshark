#if os(iOS) && !targetEnvironment(macCatalyst)
import SwiftUI
import MeshCoreKit

struct NewMessageView: View {
    let select: (SidebarSelection) -> Void
    @Environment(ContactStore.self) private var contacts
    @Environment(ChannelStore.self) private var channels
    @Environment(DeviceConfig.self) private var config
    @State private var search = ""

    private var recipients: [Contact] {
        MeshNodePresentation.nodes(in: contacts, config: config).filter {
            ($0.type == .chat || $0.type == .room)
                && (search.isEmpty || contacts.displayName(for: $0).localizedStandardContains(search)
                    || MeshNodePresentation.identifier($0).localizedStandardContains(search))
        }
    }
    private var matchingChannels: [MeshChannel] {
        channels.channels.filter { search.isEmpty || $0.name.localizedStandardContains(search) }
    }

    var body: some View {
        List {
            if !matchingChannels.isEmpty {
                Section("Channels") {
                    ForEach(matchingChannels) { channel in
                        Button { select(channel.index == 0 ? .publicChannel : .channel(channel.index)) } label: {
                            Label(channel.name.isEmpty ? "Channel \(channel.index)" : channel.name,
                                  systemImage: "number")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                                .touchable()
                        }
                        .buttonStyle(.meshPlain)
                    }
                }
            }
            if recipients.contains(where: { $0.type == .chat }) {
                Section("Direct messages") {
                    ForEach(recipients.filter { $0.type == .chat }) { contact in
                        Button { select(.contact(contact.publicKeyPrefix)) } label: {
                            Label(contacts.displayName(for: contact), systemImage: "person.crop.circle")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                                .touchable()
                        }
                        .buttonStyle(.meshPlain)
                    }
                }
            }
            if recipients.contains(where: { $0.type == .room }) {
                Section("Rooms") {
                    ForEach(recipients.filter { $0.type == .room }) { contact in
                        Button { select(.contact(contact.publicKeyPrefix)) } label: {
                            Label(contacts.displayName(for: contact), systemImage: "person.2")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                                .touchable()
                        }
                        .buttonStyle(.meshPlain)
                    }
                }
            }
            if recipients.isEmpty && search.isEmpty {
                Section {
                    Text("No contacts yet. Start on a channel, or wait for your radio to hear other nodes.")
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
        }
        .overlay {
            if !search.isEmpty && matchingChannels.isEmpty && recipients.isEmpty {
                ContentUnavailableView.search(text: search)
            }
        }
        .searchable(text: $search, prompt: "Channel, name, or node ID")
        .meshListStyle()
        .navigationTitle("New message")
    }
}
#endif
