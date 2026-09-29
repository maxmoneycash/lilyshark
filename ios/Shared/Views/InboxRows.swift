//
//  InboxRows.swift
//  Lilyshark
//
//  The phone inbox's rows, after Astra's chat row in Appllama's
//  liquid-glass-chat-ui (see GlassChat.swift): a large glass orb, the name
//  and a quiet time on one line, a one-line preview under it, and a dot for
//  unread. Nothing else competes with the name. Flags that used to stack in a
//  column on the right (draft, muted, notes, favourite, count) are now either
//  the preview itself or one small glyph beside the dot.
//
//  The iPad sidebar, the Mac and the contact book keep ContactRowView, which
//  was built for a denser list with more to say per node.
//

import SwiftUI
import MeshCoreKit

/// The layout both row kinds share.
struct InboxRowLayout<Preview: View>: View {
    let orb: NodeOrb
    let title: String
    var date: Date?
    var isUnread = false
    var isMuted = false
    var isFavourite = false
    @ViewBuilder var preview: Preview
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            // At accessibility sizes a name sharing its line with the time
            // broke mid-word ("Pub-lic"), so the row stacks instead.
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Design.Space.tight) {
                    HStack {
                        orb
                        Spacer(minLength: Design.Space.tight)
                        indicator
                    }
                    titleLine
                    timeText
                    previewText.lineLimit(3)
                }
            } else {
                HStack(alignment: .center, spacing: Design.Space.regular) {
                    orb
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline, spacing: Design.Space.tight) {
                            titleLine.lineLimit(1)
                            Spacer(minLength: Design.Space.tight)
                            timeText
                        }
                        HStack(alignment: .center, spacing: 10) {
                            previewText.lineLimit(1)
                            indicator
                        }
                    }
                }
            }
        }
        .padding(.vertical, Design.Space.snug)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var titleLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: Design.Space.tight) {
            Text(title)
                .font(.callout.weight(isUnread ? .semibold : .medium))
                .tracking(-0.25)
                .foregroundStyle(MeshTheme.textPrimary)
            if isFavourite {
                Image(systemName: "star.fill")
                    .font(.caption2)
                    .foregroundStyle(.yellow)
                    .accessibilityLabel("Favourite")
            }
        }
    }

    @ViewBuilder
    private var timeText: some View {
        if let date {
            Text(Self.inboxTime(date))
                .font(.caption)
                .foregroundStyle(isUnread ? MeshTheme.textPrimary : MeshTheme.textSecondary)
                .accessibilityLabel(date.formatted(date: .abbreviated, time: .shortened))
        }
    }

    private var previewText: some View {
        preview
            .font(.subheadline)
            .foregroundStyle(isUnread ? MeshTheme.textPrimary : MeshTheme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var indicator: some View {
        if isUnread {
            Circle()
                .fill(MeshTheme.brandPink)
                .frame(width: 8, height: 8)
                .accessibilityLabel("Unread")
        } else if isMuted {
            Image(systemName: "bell.slash.fill")
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
                .accessibilityLabel("Muted")
        }
    }

    /// Astra's list times: the clock today, then Yesterday, then the weekday
    /// within a week, then the date.
    static func inboxTime(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        if calendar.isDateInYesterday(date) { return String(localized: "Yesterday") }
        if let days = calendar.dateComponents([.day], from: date, to: .now).day, days < 7 {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        return date.formatted(date: .numeric, time: .omitted)
    }
}

/// A person or room in the phone inbox.
struct InboxContactRow: View {
    let contact: Contact
    /// Ticks from the list so "heard recently" stays current.
    var refreshTick = Date()
    @Environment(ContactStore.self) private var contactStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(RemoteSessionManager.self) private var remoteSessionManager

    private var liveContact: Contact {
        contactStore.contacts.first { $0.publicKeyPrefix == contact.publicKeyPrefix } ?? contact
    }

    private var latest: Message? { messageStoreManager.messages(for: contact).last }
    private var draft: String { messageStoreManager.loadDraft(for: contact.publicKeyPrefix) }

    private var isRecentlyHeard: Bool {
        _ = refreshTick
        let heard = TimeInterval(contactStore.nodeObservations[contact.publicKeyPrefix]?.lastHeard ?? liveContact.lastAdvert)
        return heard > 1_000_000_000 && Date().timeIntervalSince1970 - heard < 15 * 60
    }

    private var symbol: String? {
        switch contact.type {
        case .room: "server.rack"
        case .repeater: "antenna.radiowaves.left.and.right"
        case .sensor: "sensor.fill"
        case .chat, .unknown: nil
        }
    }

    var body: some View {
        let name = contactStore.displayName(for: contact)
        InboxRowLayout(
            orb: NodeOrb(seed: contact.publicKey, title: name, symbol: symbol, size: 56, isRecentlyHeard: isRecentlyHeard),
            title: name,
            date: latest?.timestamp,
            isUnread: messageStoreManager.unreadCount(for: contact) > 0,
            isMuted: contactStore.isContactMuted(contact),
            isFavourite: contact.isFavourite
        ) {
            preview
        }
    }

    @ViewBuilder
    private var preview: some View {
        if !draft.isEmpty {
            Text("Draft: ").foregroundStyle(MeshTheme.accent) + Text(draft)
        } else if let latest, latest.isOutgoing, latest.status == .failed {
            Label("Not delivered", systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(MeshTheme.disconnected)
        } else if let latest {
            Text(latest.isOutgoing ? "You: \(latest.interfaceText)" : latest.interfaceText)
        } else if contact.type == .room {
            Text(roomAccess)
        } else {
            Text("No messages yet")
        }
    }

    private var roomAccess: String {
        switch remoteSessionManager.remoteSession(for: contact).loginState {
        case .loggedIn(let permission): String(localized: "Room · \(permission.displayName)")
        case .loggingIn: String(localized: "Room · logging in")
        case .loginFailed: String(localized: "Room · login failed")
        case .notLoggedIn: String(localized: "Room · log in to read")
        }
    }
}

/// A channel in the phone inbox.
struct InboxChannelRow: View {
    let index: UInt8
    let title: String
    let symbol: String
    var isMuted = false
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(ContactStore.self) private var contactStore

    private var key: Data { Data([index]) }

    var body: some View {
        let messages = messageStoreManager.messagesByContact[key] ?? []
        InboxRowLayout(
            orb: NodeOrb(seed: key + Data(title.utf8), title: title, symbol: symbol, size: 56),
            title: title,
            date: messages.last?.timestamp,
            isUnread: (messageStoreManager.unreadCounts[key] ?? 0) > 0,
            isMuted: isMuted
        ) {
            if let last = messages.last {
                if last.isOutgoing {
                    Text("You: \(last.interfaceText)")
                } else if let sender = last.senderName, !sender.isEmpty {
                    Text("\(contactStore.channelSenderDisplayName(sender)): \(last.interfaceText)")
                } else {
                    Text(last.interfaceText)
                }
            } else {
                Text("No messages yet")
            }
        }
    }
}

/// Astra's search field and filter chips, above the phone inbox.
struct InboxSearchAndFilters: View {
    @Binding var search: String
    @Binding var filter: ContactListView.ConversationFilter
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.regular) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(MeshTheme.textSecondary)
                    .accessibilityHidden(true)
                TextField("Find a conversation or node", text: $search)
                    .focused($searchFocused)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .foregroundStyle(MeshTheme.textPrimary)
                    .accessibilityLabel("Search conversations")
                if !search.isEmpty {
                    Button {
                        search = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(MeshTheme.textSecondary)
                            .touchable()
                    }
                    .buttonStyle(.meshPlain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, Design.Space.regular)
            .frame(minHeight: Design.minimumTouchTarget)
            .chatGlass(Capsule())

            ScrollView(.horizontal, showsIndicators: false) {
                ChatGlassContainer(spacing: Design.Space.tight) {
                    HStack(spacing: Design.Space.tight) {
                        ForEach(ContactListView.ConversationFilter.allCases) { option in
                            let selected = option == filter
                            Button {
                                filter = option
                            } label: {
                                Text(option.chipTitle)
                                    .font(.footnote.weight(selected ? .semibold : .medium))
                                    .foregroundStyle(selected ? MeshTheme.textPrimary : MeshTheme.textSecondary)
                                    .padding(.horizontal, 18)
                                    .frame(minHeight: 36)
                                    .chatGlass(
                                        Capsule(),
                                        style: .clear,
                                        tint: selected ? MeshTheme.brandPink.opacity(0.16) : nil,
                                        interactive: true
                                    )
                                    // 36pt chips, as Astra draws them, with the
                                    // 44pt target the rest of the app promises.
                                    .padding(.vertical, 4)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selected ? .isSelected : [])
                            .accessibilityLabel("\(option.chipTitle) conversations")
                        }
                    }
                    .padding(.horizontal, Design.Space.loose)
                }
            }
            .padding(.horizontal, -Design.Space.loose)
            .meshAnimation(ChatGlass.snap, value: filter)
        }
        .padding(.horizontal, Design.Space.loose)
        .padding(.top, Design.Space.tight)
        .padding(.bottom, Design.Space.tight)
        // Only behind the field and chips: extending it up under the bar
        // painted over the large title.
        .background {
            MeshTheme.background
                .overlay(alignment: .bottom) {
                    ChatFadeEdge(edge: .top, height: 12).offset(y: 12)
                }
        }
    }
}

/// A phone inbox row sits on the page with no separator and Astra's 20pt
/// side inset; a sidebar row keeps the list's own chrome.
struct InboxRowChrome: ViewModifier {
    let glass: Bool

    func body(content: Content) -> some View {
        if glass {
            content
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                // Astra's rows carry no chevron; the orb and name say "open".
                .navigationLinkIndicatorVisibility(.hidden)
        } else {
            content
        }
    }
}

/// A standalone row, like the connection prompt, as a glass card in the
/// phone inbox.
struct InboxGlassCard: ViewModifier {
    let enabled: Bool

    func body(content: Content) -> some View {
        if enabled {
            content
                .padding(.horizontal, Design.Space.regular)
                .padding(.vertical, Design.Space.hairline)
                .chatGlass(RoundedRectangle(cornerRadius: 24, style: .continuous), interactive: true)
                .padding(.vertical, Design.Space.tight)
        } else {
            content
        }
    }
}
