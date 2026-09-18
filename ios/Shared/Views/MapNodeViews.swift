#if !os(watchOS)
import SwiftUI
import MeshCoreKit

/// A pin keeps the user on the map until they choose the next action.
struct MapNodeCard: View {
    let contact: Contact
    let openConversation: () -> Void
    let openDetails: () -> Void
    let close: () -> Void
    @Environment(ContactStore.self) private var contacts
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var canMessage: Bool { contact.type == .chat || contact.type == .room }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Design.Space.snug) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: Design.Space.hairline) {
                            Text(contacts.displayName(for: contact)).font(.headline)
                            Text(contact.type.displayName).font(.subheadline).foregroundStyle(MeshTheme.textSecondary)
                        }
                        Spacer(minLength: Design.Space.tight)
                        Button("Close node summary", systemImage: "xmark") { close() }
                            .labelStyle(.iconOnly)
                            .frame(minWidth: Design.minimumTouchTarget, minHeight: Design.minimumTouchTarget)
                            .buttonStyle(.meshPlain)
                    }
                    if let position = contacts.reportedPosition(for: contact) {
                        Label(String(format: "%.5f, %.5f", position.latitude, position.longitude), systemImage: "mappin")
                            .font(.subheadline.monospaced())
                            .textSelection(.enabled)
                        Text(position.viaMQTT == true ? "Shared over MQTT · Time unavailable" : "Reported position · Time unavailable")
                            .font(.footnote).foregroundStyle(MeshTheme.textSecondary)
                        Text("This may be an older location. Fix time and accuracy are unavailable.")
                            .font(.footnote).foregroundStyle(MeshTheme.textSecondary)
                    } else {
                        Label("No position shared", systemImage: "mappin.slash").font(.subheadline)
                        Text("You can still open this node’s details or conversation.")
                            .font(.footnote).foregroundStyle(MeshTheme.textSecondary)
                    }
                }
                .padding(Design.Space.regular)
            }
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: Design.Space.tight) { actions }
                } else {
                    HStack(spacing: Design.Space.snug) { actions }
                }
            }
            .padding(.horizontal, Design.Space.regular)
            .padding(.bottom, Design.Space.regular)
        }
        .frame(height: dynamicTypeSize.isAccessibilitySize ? 360 : contacts.reportedPosition(for: contact) == nil ? 195 : 245)
        .background(MeshTheme.surface)
        .clipShape(.rect(cornerRadius: Design.Radius.card))
        .overlay { RoundedRectangle(cornerRadius: Design.Radius.card).strokeBorder(MeshTheme.textSecondary.opacity(0.15)) }
        .padding(.horizontal, Design.Space.snug)
        .padding(.bottom, Design.Space.tight)
        .accessibilityIdentifier("map-node-summary")
    }

    @ViewBuilder private var actions: some View {
        if canMessage {
            Button(action: openConversation) {
                Label(contact.type == .room ? "Open room" : "Message", systemImage: contact.type == .room ? "person.2" : "bubble.left")
                    .frame(maxWidth: .infinity)
            }.buttonStyle(.meshPrimary)
            Button(action: openDetails) {
                Label("Details", systemImage: "info.circle").frame(maxWidth: .infinity)
            }.buttonStyle(.meshSecondary)
                .accessibilityLabel("Node details")
        } else {
            Button(action: openDetails) {
                Label("Details", systemImage: "info.circle").frame(maxWidth: .infinity)
            }.buttonStyle(.meshPrimary)
                .accessibilityLabel("Node details")
        }
    }
}

/// Searching here includes nodes without coordinates, with an explicit missing
/// position state instead of silently dropping them from the map workspace.
struct MapNodeList: View {
    let nodes: [Contact]
    let select: (Contact) -> Void
    @Environment(ContactStore.self) private var contacts
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var results: [Contact] {
        nodes.filter {
            search.isEmpty || contacts.displayName(for: $0).localizedStandardContains(search)
                || $0.publicKey.hexCompact.localizedStandardContains(search)
        }.sorted { contacts.displayName(for: $0).localizedStandardCompare(contacts.displayName(for: $1)) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                let positioned = results.filter { contacts.reportedPosition(for: $0) != nil }
                let unpositioned = results.filter { contacts.reportedPosition(for: $0) == nil }
                if !positioned.isEmpty {
                    Section("With a reported position") { ForEach(positioned) { row($0) } }
                }
                if !unpositioned.isEmpty {
                    Section("No position shared") { ForEach(unpositioned) { row($0) } }
                }
            }
            .overlay {
                if results.isEmpty {
                    ContentUnavailableView(search.isEmpty ? "No nodes yet" : "No matching nodes", systemImage: "mappin.slash",
                        description: Text(search.isEmpty ? "Nodes reported by your radio will appear here." : "Try a different name or public key."))
                }
            }
            .searchable(text: $search, prompt: "Name or public key")
            .autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.never)
            #endif
            .navigationTitle("Nodes on your mesh")
            .lilysharkSheet { dismiss() }
        }.meshTheme()
    }

    private func row(_ contact: Contact) -> some View {
        Button {
            select(contact)
            dismiss()
        } label: {
            HStack(spacing: Design.Space.snug) {
                Image(systemName: contacts.reportedPosition(for: contact) == nil ? "mappin.slash" : "mappin.circle.fill")
                    .foregroundStyle(MeshTheme.accent)
                VStack(alignment: .leading, spacing: Design.Space.hairline) {
                    Text(contacts.displayName(for: contact)).foregroundStyle(MeshTheme.textPrimary)
                    Text(contact.type.displayName).font(.subheadline).foregroundStyle(MeshTheme.textSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(MeshTheme.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: Design.minimumTouchTarget, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}
#endif
