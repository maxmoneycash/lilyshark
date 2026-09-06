//
//  ChatView.swift
//  PommeCore
//
//  Direct message chat UI with delivery status, search, and location sharing.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif
#if !os(watchOS)
import CoreLocation
#endif
#if canImport(AppKit)
import AppKit
#endif

extension Notification.Name {
    static let insertMention = Notification.Name("insertMention")
}

struct ChatView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var followsLatest = true
    @State private var hasPositionedInitially = false
    @State private var isVisible = false
    @Environment(NavigationStore.self) private var navigationStore
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var messageText = ""
    @State private var showNotes = false
    @State private var showContactDetail = false
    @State private var showNicknameSheet = false
    @State private var nicknameText = ""
    @State private var unreadDividerIndex: Int?
    @State private var isSearching = false
    @State private var searchText = ""
    @State private var showPathEditor = false
    @State private var quotedMessage: Message?
    @State private var signNextMessage = false
    @State private var forwardMessage: Message?
    @State private var showForwardPicker = false
    @State private var chatExportItems: [Any] = []
    @State private var showChatExport = false
    @State private var showLocationUnavailableAlert = false

    /// Live contact from ViewModel (picks up optimistic path updates).
    private var liveContact: Contact {
        contactStore.contacts.first(where: { $0.publicKey == contact.publicKey }) ?? contact
    }
    @State private var exportURL: URL?
    @State private var showExportSheet = false
    /// Ticks every 30s to refresh the relative "last seen" text.
    @State private var refreshTick = Date()
    private let refreshTimer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    private let maxMessageLength = 160

    private var messages: [Message] {
        messageStoreManager.messages(for: contact)
    }

    private var lastSeenText: String? {
        _ = refreshTick // depend on timer for periodic refresh
        let c = liveContact
        var latest = TimeInterval(contactStore.nodeObservations[c.publicKeyPrefix]?.lastHeard ?? c.lastAdvert)
        if !isMeshtasticContact, let received = messages.last(where: { !$0.isOutgoing }) {
            latest = max(latest, received.timestamp.timeIntervalSince1970)
        }
        guard latest > 1_000_000_000 else { return nil }
        let date = Date(timeIntervalSince1970: latest)
        guard Date().timeIntervalSince(date) < 365 * 24 * 60 * 60 else { return nil }
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .abbreviated
        return fmt.localizedString(for: date, relativeTo: Date())
    }

    private var toolbarName: (text: String, font: Font) {
        (contactStore.displayName(for: liveContact), .headline)
    }

    private var isMeshtasticContact: Bool {
        #if canImport(MeshtasticKit)
        MeshtasticIdentity.nodeNum(forSyntheticKey: contact.publicKey) != nil
        #else
        false
        #endif
    }

    private var routeLabel: String {
        let c = liveContact
        if isMeshtasticContact {
            let observation = contactStore.nodeObservations[c.publicKeyPrefix]
            if observation?.viaMQTT == true { return "Via MQTT" }
            guard let hops = observation?.hops else { return "Hops not reported" }
            return hops == 0 ? "Direct report" : "\(hops) hops reported"
        }
        if c.outPathLen == 0 { return "Direct" }
        if c.outPathLen < 0 { return c.outPath.isEmpty ? "Auto" : "Flood" }
        // Lower 6 bits = hop count (upper 2 bits = hash_mode)
        let hops = Int(c.outPathLen) & 0x3F
        return String(localized: "^[\(hops) hop](inflect: true)")
    }

    private var routeColor: Color {
        let c = liveContact
        if isMeshtasticContact { return MeshTheme.textSecondary }
        if c.outPathLen == 0 { return MeshTheme.connected }
        if c.outPathLen < 0 { return c.outPath.isEmpty ? MeshTheme.textSecondary : .orange }
        return MeshTheme.accent
    }

    private var displayedMessages: [Message] {
        if searchText.isEmpty { return messages }
        return messages.filter { $0.text.localizedCaseInsensitiveContains(searchText) }
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(MeshTheme.textSecondary)
            TextField("Search messages...", text: $searchText)
                .foregroundStyle(MeshTheme.textPrimary)
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .touchable()
                }
                .buttonStyle(.meshPlain)
                .accessibilityLabel("Clear message search")
            }
        }
        .padding(8)
        .background(MeshTheme.surfaceLight)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }

    var body: some View {
        VStack(spacing: 0) {
            if isSearching {
                searchBar.transition(.opacity)
            }
            messageList
            Divider()
                .overlay(MeshTheme.surfaceLight)
            messageInput
        }
        .background(MeshTheme.background)
        .onReceive(refreshTimer) { refreshTick = $0 }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #else
        .navigationTitle(toolbarName.text)
        .navigationSubtitle(routeLabel)
        #endif
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(toolbarName.text)
                        .font(toolbarName.font)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        Text(routeLabel)
                            .font(.caption2)
                            .foregroundStyle(routeColor)
                        if let lastSeen = lastSeenText {
                            Text("\u{2022}").font(.caption2).foregroundStyle(MeshTheme.textSecondary)
                            Text(lastSeen)
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                }
                .contentShape(Rectangle())
                .contextMenu {
                    Button {
                        nicknameText = contactStore.nickname(for: contact) ?? ""
                        showNicknameSheet = true
                    } label: {
                        contactStore.nickname(for: contact) != nil
                            ? Label("Edit Nickname", systemImage: "pencil")
                            : Label("Set Nickname", systemImage: "pencil")
                    }
                    if !isMeshtasticContact {
                        Button { showPathEditor = true } label: {
                            Label("Edit Path", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                        }
                    }
                    Button { showContactDetail = true } label: {
                        Label("Contact Details", systemImage: "info.circle")
                    }
                    Divider()
                    Button { exportChatHistory() } label: {
                        Label("Export Chat", systemImage: "square.and.arrow.up")
                    }
                }
            }
            #endif
            ToolbarItem(placement: .automatic) {
                HStack(spacing: 12) {
                    #if os(macOS)
                    if !isMeshtasticContact {
                        Button {
                            showPathEditor = true
                        } label: {
                            Text(routeLabel)
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.accent)
                                .touchable()
                        }
                        .buttonStyle(.meshPlain)
                    }
                    #endif
                    Button {
                        withMeshAnimation(reduceMotion: reduceMotion) { isSearching.toggle() }
                        if !isSearching { searchText = "" }
                    } label: {
                        Image(systemName: isSearching ? "magnifyingglass.circle.fill" : "magnifyingglass")
                            .foregroundStyle(MeshTheme.accent)
                            .touchable()
                    }
                    .accessibilityLabel(isSearching ? Text("Close search") : Text("Search messages"))
                    Menu {
                        Button { showContactDetail = true } label: {
                            Label("Contact Details", systemImage: "info.circle")
                        }
                        #if !os(watchOS)
                        Button { sendLocationAsDM() } label: {
                            Label("Send Location", systemImage: "location.fill")
                        }
                        #if os(macOS)
                        Button { exportChatHistory() } label: {
                            Label("Export Chat", systemImage: "square.and.arrow.up")
                        }
                        #endif
                        #endif
                        Button { showNotes = true } label: {
                            Label("Notes", systemImage: "note.text")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(MeshTheme.accent)
                            .touchable()
                    }
                    .accessibilityLabel("Conversation actions")
                }
            }
        }
        .sheet(isPresented: $showNotes) {
            ContactNotesSheet(contact: contact)
        }
        .alert("Location Unavailable", isPresented: $showLocationUnavailableAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Your location could not be determined. Enable Location Services for Lilyshark in Settings.")
        }
        .alert("Set Nickname", isPresented: $showNicknameSheet) {
            TextField("Nickname", text: $nicknameText)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                contactStore.setNickname(nicknameText.trimmingCharacters(in: .whitespaces), for: contact)
            }
        } message: {
            Text("Set a local nickname for \(contact.name.isEmpty ? "this contact" : contact.name). This is only visible to you.")
        }
        .sheet(isPresented: $showContactDetail) {
            ContactDetailSheet(contact: liveContact)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showPathEditor) {
            ManualPathEditor(contact: liveContact)
        }
        .sheet(isPresented: $showExportSheet) {
            if let url = exportURL {
                #if os(iOS)
                ShareSheetView(activityItems: [url])
                #elseif os(macOS)
                VStack(spacing: 16) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.largeTitle)
                        .foregroundStyle(MeshTheme.connected)
                    Text("Chat exported")
                        .font(.headline)
                    Text(url.lastPathComponent)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Copy File Path") {
                        copyToClipboard(url.path)
                        showExportSheet = false
                    }
                    .buttonStyle(.meshPrimary)
                    Button("Done") { showExportSheet = false }
                }
                .padding(32)
                .frame(minWidth: 300)
                #endif
            } else {
                VStack(spacing: 12) {
                    Text("Export failed")
                        .font(.headline)
                    Button("Done") { showExportSheet = false }
                }
                .padding(24)
            }
        }
        .sheet(isPresented: $showForwardPicker) {
            ForwardContactPicker { targetContact in
                if let msg = forwardMessage {
                    let fwdText = "Fwd from \(contactStore.displayName(for: contact)): \(msg.text)"
                    messageStoreManager.sendTextMessage(String(fwdText.prefix(160)), to: targetContact)
                }
                forwardMessage = nil
                showForwardPicker = false
            }
        }
        #if os(iOS)
        .sheet(isPresented: $showChatExport) {
            if !chatExportItems.isEmpty {
                ShareSheetView(activityItems: chatExportItems)
            }
        }
        #endif
        .onAppear {
            isVisible = true
            navigationStore.visibleConversationKey = contact.publicKeyPrefix
            if messageText.isEmpty {
                messageText = messageStoreManager.loadDraft(for: contact.publicKeyPrefix)
            }
            DispatchQueue.main.async {
                markAsReadIfVisible()
            }
        }
        .onDisappear {
            isVisible = false
            if navigationStore.visibleConversationKey == contact.publicKeyPrefix {
                navigationStore.visibleConversationKey = nil
            }
            messageStoreManager.saveDraft(messageText, for: contact.publicKeyPrefix)
        }
    }

    private func markAsReadIfVisible() {
        guard isVisible, navigationStore.isMessagesSectionVisible,
              navigationStore.visibleConversationKey == contact.publicKeyPrefix else { return }
        #if os(macOS)
        guard NSApplication.shared.isUserViewing else { return }
        #else
        guard scenePhase == .active else { return }
        #endif
        messageStoreManager.markAsRead(contactKey: contact.publicKeyPrefix)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if !searchText.isEmpty && displayedMessages.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                } else if messages.isEmpty {
                    ContentUnavailableView("Start a conversation", systemImage: "bubble.left.and.bubble.right",
                                           description: Text("Messages you send and receive with this contact will appear here."))
                }
                LazyVStack(spacing: 4) {
                    if !searchText.isEmpty {
                        Text("^[\(displayedMessages.count) result](inflect: true)")
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .padding(.vertical, 4)
                    }
                    ForEach(Array(displayedMessages.enumerated()), id: \.element.id) { index, message in
                        if searchText.isEmpty && (index == 0 || isDifferentDay(displayedMessages[index - 1].timestamp, message.timestamp)) {
                            DateSeparator(date: message.timestamp)
                        }
                        if searchText.isEmpty && index == unreadDividerIndex {
                            UnreadDivider()
                        }
                        MessageBubble(
                            message: message,
                            onQuote: { quotedMessage = $0 },
                            onReact: { msg, emoji in
                                messageStoreManager.addReaction(emoji, to: msg)
                            },
                            onForward: { msg in
                                forwardMessage = msg
                                showForwardPicker = true
                            }
                        )
                            .id(message.id)
                            .transition(.opacity)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .meshAnimation(Design.Motion.quick, value: messages.last?.id)
            }
            .chatScrollTracking(followsLatest: $followsLatest)
            #if !os(watchOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .safeAreaInset(edge: .bottom) {
                if !followsLatest && !messages.isEmpty && searchText.isEmpty {
                    Button {
                        followsLatest = true
                        if let last = messages.last {
                            withMeshAnimation(reduceMotion: reduceMotion) {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                    } label: {
                        Label("Latest messages", systemImage: "arrow.down")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal)
                            .touchable()
                    }
                    .buttonStyle(.meshSecondary)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 8)
                    .transition(.opacity)
                }
            }
            .onChange(of: messages.last?.id) {
                guard isVisible && navigationStore.isMessagesSectionVisible else { return }
                if let last = messages.last, searchText.isEmpty && (followsLatest || last.isOutgoing) {
                    followsLatest = true
                    withMeshAnimation(Design.Motion.quick, reduceMotion: reduceMotion) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
                // Only mark as read when the user is actively viewing the chat
                #if os(macOS)
                guard NSApplication.shared.isUserViewing else { return }
                #else
                guard scenePhase == .active else { return }
                #endif
                withMeshAnimation(reduceMotion: reduceMotion) { unreadDividerIndex = nil }
                DispatchQueue.main.async {
                    markAsReadIfVisible()
                }
            }
            #if os(macOS)
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification).merge(with: NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification))) { _ in
                guard isVisible && navigationStore.isMessagesSectionVisible else { return }
                withMeshAnimation(reduceMotion: reduceMotion) { unreadDividerIndex = nil }
                DispatchQueue.main.async {
                    markAsReadIfVisible()
                }
            }
            #else
            .onChange(of: scenePhase) { _, newPhase in
                if newPhase == .active && isVisible && navigationStore.isMessagesSectionVisible {
                    withMeshAnimation(reduceMotion: reduceMotion) { unreadDividerIndex = nil }
                    DispatchQueue.main.async {
                        markAsReadIfVisible()
                    }
                }
            }
            #endif
            .onAppear {
                guard !hasPositionedInitially else { return }
                hasPositionedInitially = true
                unreadDividerIndex = messageStoreManager.firstUnreadIndex(in: messages, for: contact.publicKeyPrefix)
                // Delay scroll to let LazyVStack lay out content
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    if let idx = unreadDividerIndex, idx < messages.count {
                        followsLatest = idx >= messages.count - 1
                        proxy.scrollTo(messages[idx].id, anchor: .center)
                    } else if let last = messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
                // Clear the divider after user has had time to see it
                if unreadDividerIndex != nil {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        withMeshAnimation(reduceMotion: reduceMotion) { unreadDividerIndex = nil }
                    }
                }
            }
        }
    }

    private var messageInput: some View {
        VStack(spacing: 4) {
            // Quote preview bar
            if let quoted = quotedMessage {
                HStack(spacing: 8) {
                    Rectangle()
                        .fill(MeshTheme.accent)
                        .frame(width: 3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(quoted.isOutgoing ? "You" : contactStore.displayName(for: contact))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(MeshTheme.accent)
                        Text(quoted.text)
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                            .lineLimit(2)
                    }
                    Spacer()
                    Button { quotedMessage = nil } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .buttonStyle(.meshPlain)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(MeshTheme.surfaceLight)
            }
            // The composer.
            //
            // Sized from Design rather than by hand: the message field is the
            // control this app exists for, and it was set at 15pt in a 40pt
            // row -- the size of a search box in a settings screen. The send
            // button was a 28pt glyph with no padding, well under the 44pt
            // minimum, on the edge of the screen where the thumb lands.
            //
            // The button also now says something when it is disabled. It used
            // to go grey and stay the same size, which reads as "broken"
            // rather than "type something first".
            HStack(spacing: Design.Space.snug) {
                TextField("Type a message...", text: $messageText, axis: .vertical)
                    // Up to five lines before it scrolls. A long message
                    // typed into a one-line field is written blind.
                    .lineLimit(1...5)
                    .font(Design.Text.message)
                    .padding(.horizontal, Design.Space.regular)
                    .padding(.vertical, Design.Space.snug)
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: Design.Radius.bubble, style: .continuous))
                    .foregroundStyle(MeshTheme.textPrimary)
                    .onChange(of: messageText) { _, newValue in
                        if newValue.count > maxMessageLength {
                            messageText = String(newValue.prefix(maxMessageLength))
                        }
                    }
                    #if !os(watchOS)
                    .onSubmit { send() }
                    #endif

                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(Design.Text.controlGlyph)
                        .foregroundStyle(canSend ? Color.white : MeshTheme.textSecondary)
                        .frame(width: Design.sendButton, height: Design.sendButton)
                        .background(
                            Circle().fill(canSend ? MeshTheme.accent : MeshTheme.surfaceLight)
                        )
                        // Grows into its filled state as the first character
                        // is typed, so the control tells you it is ready
                        // before you reach for it.
                        .scaleEffect(canSend ? 1 : 0.88)
                }
                .buttonStyle(.pressable)
                .meshAnimation(Design.Motion.quick, value: canSend)
                .disabled(!canSend)
                .accessibilityLabel("Send message")
            }
            .padding(.horizontal, Design.Space.snug)

            if !messageText.isEmpty {
                HStack {
                    Spacer()
                    Text("\(messageText.count)/\(maxMessageLength)")
                        .font(.caption2)
                        .foregroundStyle(
                            messageText.count > maxMessageLength - 10
                                ? Color.orange
                                : MeshTheme.textSecondary
                        )
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 8)
        .background(MeshTheme.surface)
    }

    /// Whether there is anything to send. Named because the composer asks
    /// three times and an inline trim in each is three chances to disagree.
    private var canSend: Bool {
        !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        var text = messageText
        if let quoted = quotedMessage {
            // MeshCore One compatible quote format: @[senderName]\n>preview..\nreply
            let senderName = quoted.isOutgoing ? "Me" : contactStore.displayName(for: contact)
            let preview = String(quoted.text.prefix(10))
            let suffix = quoted.text.count > 10 ? ".." : ""
            text = "@[\(senderName)]\n>\(preview)\(suffix)\n\(text)"
        }
        messageStoreManager.sendTextMessage(text, to: contact, signed: signNextMessage)
        messageStoreManager.playHapticFeedback()
        signNextMessage = false
        messageText = ""
        quotedMessage = nil
        messageStoreManager.saveDraft("", for: contact.publicKeyPrefix)
    }

    #if !os(watchOS)
    private func exportChatHistory() {
        let name = contactStore.displayName(for: contact)
        let msgs = messages.sorted(by: { $0.timestamp < $1.timestamp })
        var lines = ["Chat with \(name)", "Exported \(Date().formatted(date: .abbreviated, time: .shortened))", ""]
        for msg in msgs {
            let time = msg.timestamp.formatted(date: .numeric, time: .shortened)
            let sender = msg.isOutgoing ? "Me" : name
            lines.append("[\(time)] \(sender): \(msg.text)")
        }
        let text = lines.joined(separator: "\n")
        #if os(iOS)
        chatExportItems = [text]
        showChatExport = true
        #elseif os(macOS)
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        #endif
    }

    private func sendLocationAsDM() {
        guard let location = SharedLocation.manager.location else {
            DebugLogger.shared.log("LOCATION: unavailable for send", level: .warning)
            showLocationUnavailableAlert = true
            return
        }
        let lat = location.coordinate.latitude
        let lon = location.coordinate.longitude
        let (fLat, fLon) = PommeCoreViewModel.fudgeLocation(lat: lat, lon: lon)
        let text = "Location: \(formatCoordinate(fLat)), \(formatCoordinate(fLon))"
        messageStoreManager.sendTextMessage(text, to: contact)
        messageStoreManager.playHapticFeedback()
        DebugLogger.shared.log("LOCATION: sent to \(contact.name)", level: .tx)
    }
    #endif
}
