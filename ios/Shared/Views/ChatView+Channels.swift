//
//  ChatView+Channels.swift
//  PommeCore
//
//  Channel and room chat views split from ChatView.swift.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MeshCoreKit
#if !os(watchOS)
import CoreLocation
#endif
#if canImport(AppKit)
import AppKit
#endif

// MARK: - Channel Chat View

struct ChannelChatView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @State private var followsLatest = true
    @State private var hasPositionedInitially = false
    @State private var isVisible = false
    @Environment(NavigationStore.self) private var navigationStore
    let channelIndex: UInt8
    let channelName: String
    @Environment(ContactStore.self) private var contactStore
    @Environment(ChannelStore.self) private var channelStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var showSendError = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var messageText = ""
    @State private var unreadDividerIndex: Int?
    @State private var mentionQuery: String?
    @State private var notifyMode: String = "all"
    @State private var showChannelDetail = false
    @State private var showLocationUnavailableAlert = false


    private var channelKey: Data { Data([channelIndex]) }

    private var messages: [Message] {
        messageStoreManager.messagesByContact[channelKey] ?? []
    }

    private var channelSymbol: String {
        channelStore.channels.first { $0.index == channelIndex }?.channelType.iconName ?? "number"
    }

    var body: some View {
        messageList
            .background(MeshTheme.background)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                messageInput
            }
        #if os(iOS)
        .toolbar(horizontalSizeClass == .compact ? .hidden : .automatic, for: .tabBar)
        #endif
        .alert("Message not sent", isPresented: $showSendError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(messageStoreManager.lastSendError ?? "Your draft is still here. Try again when the deck is ready.")
        }
        .navigationTitle(channelName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        #if !os(watchOS)
        .sheet(isPresented: $showChannelDetail) {
            ChannelDetailSheet(channelIndex: channelIndex, channelName: channelName, notifyMode: $notifyMode)
        }
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .principal) {
                Button { showChannelDetail = true } label: {
                    HStack(spacing: Design.Space.tight) {
                        NodeOrb(seed: Data([channelIndex]) + Data(channelName.utf8), title: channelName,
                                symbol: channelSymbol, size: 34)
                        Text(channelName)
                            .font(.headline)
                            .foregroundStyle(MeshTheme.textPrimary)
                            .lineLimit(1)
                    }
                    .touchable()
                }
                .buttonStyle(.meshPlain)
                .accessibilityLabel("Channel details for \(channelName)")
            }
            #endif
            ToolbarItem(placement: .automatic) {
                Button {
                    // Cycle notification mode: all → mentions → muted → all
                    let next: String
                    switch notifyMode {
                    case "all": next = "mentions"
                    case "mentions": next = "muted"
                    default: next = "all"
                    }
                    notifyMode = next
                    if let mode = ChannelStore.ChannelNotifyMode(rawValue: next) {
                        channelStore.setChannelNotifyMode(mode, for: channelName)
                    }
                } label: {
                    Image(systemName: notifyMode == "muted" ? "bell.slash" : notifyMode == "mentions" ? "at" : "bell.fill")
                        .foregroundStyle(MeshTheme.accent)
                        .touchable()
                }
                .accessibilityLabel("Channel notifications")
                .accessibilityValue(notifyMode == "muted" ? "Muted" : notifyMode == "mentions" ? "Mentions only" : "All messages")
                .accessibilityHint("Changes the notification setting for this channel")
            }
        }
        #endif
        .onAppear {
            isVisible = true
            navigationStore.visibleConversationKey = channelKey
            notifyMode = channelStore.channelNotifyMode(for: channelName).rawValue
            if messageText.isEmpty {
                messageText = messageStoreManager.loadDraft(for: channelKey)
            }
            DispatchQueue.main.async {
                markAsReadIfVisible()
            }
        }
        .onDisappear {
            isVisible = false
            if navigationStore.visibleConversationKey == channelKey {
                navigationStore.visibleConversationKey = nil
            }
            messageStoreManager.saveDraft(messageText, for: channelKey)
        }
        .onReceive(NotificationCenter.default.publisher(for: .insertMention)) { notification in
            if let sender = notification.object as? String {
                messageText += "@\(sender) "
            }
        }
        .alert("Location Unavailable", isPresented: $showLocationUnavailableAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Your location could not be determined. Enable Location Services for Lilyshark in Settings.")
        }
    }

    private func markAsReadIfVisible() {
        guard isVisible, navigationStore.isMessagesSectionVisible,
              navigationStore.visibleConversationKey == channelKey else { return }
        #if os(macOS)
        guard NSApplication.shared.isUserViewing else { return }
        #else
        guard scenePhase == .active else { return }
        #endif
        messageStoreManager.markAsRead(contactKey: channelKey)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if messages.isEmpty {
                    ContentUnavailableView("Channel messages", systemImage: "number.square",
                                           description: Text("Messages this deck reports for the channel will appear here."))
                }
                LazyVStack(spacing: 0) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if index == 0 || isDifferentDay(messages[index - 1].timestamp, message.timestamp) {
                            DateSeparator(date: message.timestamp)
                        }
                        if index == unreadDividerIndex {
                            UnreadDivider()
                        }
                        ChannelMessageBubble(
                            message: message,
                            run: .of(index, in: messages, isOutgoing: \.isOutgoing,
                                     sender: { $0.senderName }, timestamp: \.timestamp)
                        )
                            .id(message.id)
                            .transition(.bubbleArrival(isOutgoing: message.isOutgoing))
                    }
                }
                .padding(.horizontal, Design.Space.regular)
                .padding(.vertical, Design.Space.tight)
                .meshAnimation(ChatGlass.arrival, value: messages.last?.id)
            }
            .chatScrollTracking(followsLatest: $followsLatest)
            #if !os(watchOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .safeAreaInset(edge: .bottom) {
                if !followsLatest && !messages.isEmpty {
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
                            .foregroundStyle(MeshTheme.textPrimary)
                            .padding(.horizontal, Design.Space.regular)
                            .touchable()
                            .chatGlass(Capsule(), interactive: true)
                    }
                    .buttonStyle(.pressable)
                    .padding(.bottom, Design.Space.tight)
                    .transition(.opacity)
                }
            }
            .onChange(of: messages.last?.id) {
                guard isVisible && navigationStore.isMessagesSectionVisible else { return }
                if let last = messages.last, followsLatest || last.isOutgoing {
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
                unreadDividerIndex = messageStoreManager.firstUnreadIndex(in: messages, for: channelKey)
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

    private var mentionCandidates: [Contact] {
        let chatContacts = contactStore.contacts.filter { $0.type == .chat }
        guard let query = mentionQuery, !query.isEmpty else { return chatContacts }
        return chatContacts.filter {
            contactStore.displayName(for: $0).localizedCaseInsensitiveContains(query)
        }
    }

    private var messageInput: some View {
        VStack(spacing: 0) {
            if mentionQuery != nil && !mentionCandidates.isEmpty {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(mentionCandidates.prefix(5)) { contact in
                            Button {
                                insertMention(contact)
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "person.fill")
                                        .foregroundStyle(MeshTheme.accent)
                                        .font(.caption)
                                    Text(contactStore.displayName(for: contact))
                                        .foregroundStyle(MeshTheme.textPrimary)
                                    Spacer()
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                            }
                            .buttonStyle(.meshPlain)
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 200)
                .chatGlass(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(.horizontal, Design.Space.regular)
                .padding(.top, Design.Space.tight)
            }

            MessageComposer(
                text: $messageText,
                budget: MessageTextBudget(messageText, limit: messageStoreManager.messageByteLimit),
                isConnected: messageStoreManager.canSendMessages,
                sendLabel: "Send to \(channelName)",
                shareLocation: sendLocationToChannel,
                connect: { connectionManager.requestShowScanner = true },
                send: send
            )
            .onChange(of: messageText) { _, text in mentionQuery = detectMentionQuery(in: text) }
        }
    }

    /// Detect an in-progress @mention at end of text.
    private func detectMentionQuery(in text: String) -> String? {
        guard let atIndex = text.lastIndex(of: "@") else { return nil }
        let query = String(text[text.index(after: atIndex)...])
        // Don't trigger if there's a space after @ (completed mention)
        if query.contains(" ") { return nil }
        return query
    }

    /// Insert the selected contact's name at the current @ position.
    private func insertMention(_ contact: Contact) {
        guard let atIndex = messageText.lastIndex(of: "@") else { return }
        let name = contactStore.displayName(for: contact)
        messageText = String(messageText[messageText.startIndex...atIndex]) + name + " "
        mentionQuery = nil
    }

    private func send() {
        guard messageStoreManager.sendChannelMessage(messageText, channelIndex: channelIndex) else {
            showSendError = true
            return
        }
        messageStoreManager.playHapticFeedback()
        messageText = ""
        mentionQuery = nil
        messageStoreManager.saveDraft("", for: channelKey)
    }

    private func sendLocationToChannel() {
        guard let location = SharedLocation.manager.location else {
            showLocationUnavailableAlert = true
            return
        }
        let (fLat, fLon) = PommeCoreViewModel.fudgeLocation(lat: location.coordinate.latitude, lon: location.coordinate.longitude)
        let text = "Location: \(formatCoordinate(fLat)), \(formatCoordinate(fLon))"
        guard messageStoreManager.sendChannelMessage(text, channelIndex: channelIndex) else {
            showSendError = true
            return
        }
        messageStoreManager.playHapticFeedback()
        DebugLogger.shared.log("LOCATION: sent to channel \(channelIndex)", level: .tx)
    }
}

// MARK: - Room Chat View

/// Chat view for room servers — requires login, shows room messages, has gear icon for management.
struct RoomChatView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @Environment(\.scenePhase) private var scenePhase
    @State private var followsLatest = true
    @State private var hasPositionedInitially = false
    @State private var isVisible = false
    @Environment(NavigationStore.self) private var navigationStore
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var showSendError = false
    @ObservedObject var session: RemoteDeviceSession
    @State private var messageText = ""
    @State private var password = ""
    @State private var rememberPassword = true
    @State private var showManagement = false
    @State private var showContactDetail = false


    /// Accent for remote management icon.
    private var remoteAccent: Color { MeshTheme.remoteRoom }

    private var messages: [Message] {
        messageStoreManager.messages(for: contact)
    }

    private var isLoggedIn: Bool {
        if case .loggedIn = session.loginState { return true }
        return false
    }

    private var permission: RemotePermission {
        if case .loggedIn(let p) = session.loginState { return p }
        return .guest
    }

    private var loginStatusText: String {
        switch session.loginState {
        case .loggedIn(let permission): permission.displayName
        case .loggingIn: String(localized: "Logging in...")
        case .loginFailed: String(localized: "Login failed")
        case .notLoggedIn: String(localized: "Not logged in")
        }
    }

    private var statusBarColor: Color {
        switch permission {
        case .guest: return MeshTheme.textSecondary
        case .readOnly: return .yellow
        case .readWrite: return .blue
        case .admin: return MeshTheme.connected
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if isLoggedIn {
                // Status bar — session persists until firmware timeout or reboot
                HStack(spacing: 6) {
                    Image(systemName: "circle.fill")
                        .font(.caption2)
                        .foregroundStyle(statusBarColor)
                    Text(loginStatusText)
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(MeshTheme.surface)

                messageList
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if permission.canPost {
                            roomMessageInput
                        } else {
                            readOnlyInputBar
                        }
                    }
            } else {
                roomLoginPrompt
            }
        }
        .background(MeshTheme.background)
        #if os(iOS)
        .toolbar(horizontalSizeClass == .compact && isLoggedIn ? .hidden : .automatic, for: .tabBar)
        #endif
        .alert("Message not sent", isPresented: $showSendError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(messageStoreManager.lastSendError ?? "Your draft is still here. Try again when the deck is ready.")
        }
        .navigationTitle(contactStore.displayName(for: contact))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .principal) {
                HStack(spacing: Design.Space.tight) {
                    NodeOrb(seed: contact.publicKey, title: contactStore.displayName(for: contact),
                            symbol: "server.rack", size: 34)
                    Text(contactStore.displayName(for: contact))
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .lineLimit(1)
                }
            }
            #endif
            #if !os(watchOS)
            ToolbarItem(placement: .automatic) {
                Button { showContactDetail = true } label: {
                    Image(systemName: "info.circle")
                        .foregroundStyle(MeshTheme.accent)
                }
                .help("Network Tools")
            }
            #endif
            ToolbarItem(placement: .automatic) {
                if isLoggedIn, permission.canRead {
                    Button {
                        showManagement = true
                    } label: {
                        Image(systemName: "wrench.and.screwdriver")
                            .foregroundStyle(remoteAccent)
                    }
                    .help("Remote Management — \(contactStore.displayName(for: contact))")
                }
            }
        }
        #if !os(watchOS)
        .sheet(isPresented: $showContactDetail) {
            ContactDetailSheet(contact: contact)
            #if os(macOS) || targetEnvironment(macCatalyst)
                .frame(minWidth: 360, minHeight: 400)
            #endif
        }
        .sheet(isPresented: $showManagement) {
            NavigationStack {
                RemoteManagementView(
                    contact: contact,
                    session: session
                )
                .lilysharkSheet { showManagement = false }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 400, minHeight: 500)
            #endif
        }
        #endif
        .onAppear {
            isVisible = true
            navigationStore.visibleConversationKey = isLoggedIn ? contact.publicKeyPrefix : nil
            DispatchQueue.main.async {
                markAsReadIfVisible()
            }
        }
        .onDisappear {
            isVisible = false
            if navigationStore.visibleConversationKey == contact.publicKeyPrefix {
                navigationStore.visibleConversationKey = nil
            }
        }
        #if os(macOS)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification).merge(with: NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification))) { _ in
            DispatchQueue.main.async { markAsReadIfVisible() }
        }
        #else
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                DispatchQueue.main.async { markAsReadIfVisible() }
            }
        }
        #endif
        // No onDisappear logout — firmware handles session timeout.
        // Clearing local state causes mismatch with firmware and unresponsiveness.
        // Dismiss management sheet if logged out while it's open
        .onChange(of: isLoggedIn) { _, loggedIn in
            if !loggedIn {
                showManagement = false
            }
            if isVisible && navigationStore.isMessagesSectionVisible {
                navigationStore.visibleConversationKey = loggedIn ? contact.publicKeyPrefix : nil
                if loggedIn {
                    DispatchQueue.main.async { markAsReadIfVisible() }
                }
            }
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if index == 0 || isDifferentDay(messages[index - 1].timestamp, message.timestamp) {
                            DateSeparator(date: message.timestamp)
                        }
                        RoomMessageBubble(
                            message: message,
                            run: .of(index, in: messages, isOutgoing: \.isOutgoing,
                                     sender: { RoomMessageBubble.parse($0).sender }, timestamp: \.timestamp)
                        )
                            .id(message.id)
                            .transition(.bubbleArrival(isOutgoing: message.isOutgoing))
                    }
                }
                .padding(.horizontal, Design.Space.regular)
                .padding(.vertical, Design.Space.tight)
                .meshAnimation(ChatGlass.arrival, value: messages.last?.id)
            }
            .chatScrollTracking(followsLatest: $followsLatest)
            #if !os(watchOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .safeAreaInset(edge: .bottom) {
                if !followsLatest && !messages.isEmpty {
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
                            .foregroundStyle(MeshTheme.textPrimary)
                            .padding(.horizontal, Design.Space.regular)
                            .touchable()
                            .chatGlass(Capsule(), interactive: true)
                    }
                    .buttonStyle(.pressable)
                    .padding(.bottom, Design.Space.tight)
                    .transition(.opacity)
                }
            }
            .onChange(of: messages.last?.id) {
                guard isVisible && navigationStore.isMessagesSectionVisible else { return }
                if let last = messages.last, followsLatest || last.isOutgoing {
                    followsLatest = true
                    withMeshAnimation(Design.Motion.quick, reduceMotion: reduceMotion) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            .onAppear {
                guard !hasPositionedInitially else { return }
                hasPositionedInitially = true
                if let last = messages.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private func markAsReadIfVisible() {
        guard isLoggedIn, isVisible, navigationStore.isMessagesSectionVisible,
              navigationStore.visibleConversationKey == contact.publicKeyPrefix else { return }
        #if os(macOS)
        guard NSApplication.shared.isUserViewing else { return }
        #else
        guard scenePhase == .active else { return }
        #endif
        messageStoreManager.markAsRead(contactKey: contact.publicKeyPrefix)
    }

    private var roomMessageInput: some View {
        MessageComposer(
            text: $messageText,
            budget: MessageTextBudget(messageText),
            isConnected: messageStoreManager.canSendMessages,
            sendLabel: "Send message to room",
            connect: { connectionManager.requestShowScanner = true },
            send: sendRoomMessage
        )
    }

    private var readOnlyInputBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill")
                .foregroundStyle(MeshTheme.textSecondary)
            Text("Read-only access \u{2014} posting not available")
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 58)
        .chatGlass(RoundedRectangle(cornerRadius: 29, style: .continuous))
        .padding(.horizontal, Design.Space.regular)
        .padding(.vertical, Design.Space.tight)
    }

    private var roomLoginPrompt: some View {
        ScrollView {
            roomLoginContent
                .padding(.vertical, Design.Space.section)
                .padding(.horizontal, Design.Space.regular)
        }
    }

    private var roomLoginContent: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 12) {
                Image(systemName: "lock.shield")
                    .font(.largeTitle)
                    .foregroundStyle(MeshTheme.textSecondary)
                Text("Login Required")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(MeshTheme.textPrimary)
                Text("Enter this room's password to join. Your access depends on the room's permissions.")
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            VStack(spacing: 12) {
                HStack {
                    Image(systemName: "lock")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    #if os(watchOS)
                    SecureField("Password", text: $password)
                        .foregroundStyle(MeshTheme.textPrimary)
                    #else
                    SecureField("Password", text: $password)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .textFieldStyle(MeshTextFieldStyle())
                        .onSubmit { login() }
                        .onChange(of: password) { _, new in
                            if new.count > 15 { password = String(new.prefix(15)) }
                        }
                    #endif
                }
                .padding(.horizontal, 32)

                Text("Passwords are case-sensitive, max 15 characters.")
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.textSecondary)

                // Default password info card
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        Image(systemName: "info.circle")
                        Text("Default Passwords")
                            .fontWeight(.medium)
                    }
                    .foregroundStyle(MeshTheme.accent)
                    Text("Admin: **password**")
                    if contact.type == .room {
                        Text("Guest: **hello**")
                    }
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.shield")
                            .foregroundStyle(.orange)
                        Text("Change default passwords after login via Remote Management \u{2192} Security.")
                            .foregroundStyle(.orange)
                    }
                }
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .padding(12)
                .frame(maxWidth: 300, alignment: .leading)
                .background(MeshTheme.surfaceLight)
                .clipShape(RoundedRectangle(cornerRadius: 8))

                #if !os(watchOS)
                Toggle("Remember Password", isOn: $rememberPassword)
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .padding(.horizontal, 32)
                #endif

                if isLoggingIn {
                    HStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(0.8)
                            .tint(MeshTheme.textSecondary)
                        Text("Logging in...")
                            .foregroundStyle(MeshTheme.textSecondary)
                        Button("Cancel") {
                            remoteSessionManager.cancelLogin(for: contact)
                        }
                        .foregroundStyle(.red)
                    }
                } else {
                    Button(action: login) {
                        Label("Log in", systemImage: "arrow.right.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.meshPrimary)
                    .padding(.horizontal, 32)
                }

                if case .loginFailed(let msg) = session.loginState {
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                        Text(msg)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                if KeychainManager.hasPassword(forDevice: contact.publicKey) {
                    Button(role: .destructive) {
                        KeychainManager.deleteAllPasswords(forDevice: contact.publicKey)
                        password = ""
                    } label: {
                        Label("Forget Saved Password", systemImage: "trash")
                            .font(.caption)
                    }
                    .buttonStyle(.meshPlain)
                }
            }

            #if !os(watchOS)
            Button { showContactDetail = true } label: {
                Label("Network Tools", systemImage: "info.circle")
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.accent)
            }
            .buttonStyle(.meshPlain)
            #endif

            Spacer()
        }
        .onAppear {
            // Auto-fill saved password
            if let saved = KeychainManager.getSavedPassword(forDevice: contact.publicKey) {
                password = saved
            }
        }
    }

    private var isLoggingIn: Bool {
        if case .loggingIn = session.loginState { return true }
        return false
    }

    private func login() {
        remoteSessionManager.loginToRemoteDevice(contact, password: password, remember: rememberPassword)
    }

    private func sendRoomMessage() {
        guard messageStoreManager.sendRoomMessage(messageText, to: contact) else {
            showSendError = true
            return
        }
        messageStoreManager.playHapticFeedback()
        messageText = ""
    }
}

/// Message bubble for room chat — shows sender name for incoming messages.
struct RoomMessageBubble: View {
    let message: Message
    var run = ChatRunPosition()
    @State private var messageDetails: MessageDetailsSelection?
    @Environment(ContactStore.self) private var contactStore
    @Environment(MessageStoreManager.self) private var messageStoreManager

    /// Try to extract sender name from room server message prefix.
    /// Room servers often prefix messages with "SenderName: actual message"
    static func parse(_ message: Message) -> (sender: String?, text: String) {
        if !message.isOutgoing {
            let text = message.interfaceText
            // Look for "Name: message" pattern (common room server format)
            if let colonRange = text.range(of: ": ") {
                let potentialName = String(text[text.startIndex..<colonRange.lowerBound])
                // Reasonable name: 1-30 chars, no newlines
                if potentialName.count >= 1 && potentialName.count <= 30
                    && !potentialName.contains("\n") {
                    let remainder = String(text[colonRange.upperBound...])
                    return (potentialName, remainder)
                }
            }
            // Also check senderName field from protocol
            if let name = message.senderName, !name.isEmpty {
                return (name, text)
            }
        }
        return (nil, message.interfaceText)
    }

    private func showDetails() {
        messageDetails = MessageDetailsSelection(message: message, conversation: .room, store: messageStoreManager)
    }

    @ViewBuilder private func messageActions(text: String) -> some View {
        Button(action: showDetails) {
            Label("Message details", systemImage: "info.circle")
        }
        Button {
            copyToClipboard(text)
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }
        Divider()
        Button(role: .destructive) {
            messageStoreManager.deleteMessage(message, in: message.contactKeyHash)
        } label: {
            Label("Delete Message", systemImage: "trash")
        }
    }

    var body: some View {
        let parsed = Self.parse(message)
        let sender = parsed.sender.map { contactStore.channelSenderDisplayName($0) }
        ChatMessageRow(
            isOutgoing: message.isOutgoing,
            run: run,
            orb: message.isOutgoing ? nil : NodeOrb(name: sender ?? "?", size: ChatGlass.bubbleOrb),
            senderLabel: sender
        ) {
            linkifyMeshcoreURLs(parsed.text)
                .chatBubble(isOutgoing: message.isOutgoing)
                .contextMenu { messageActions(text: parsed.text) }
                .accessibilityAction(named: "Message details", showDetails)
                .accessibilityAction(named: "Copy text") { copyToClipboard(parsed.text) }
        } footer: {
            if run.endsRun || message.needsDeliveryFooter(acknowledged: true) {
                MessageMetadataRow(isOutgoing: message.isOutgoing) {
                    Text(message.timestamp, style: .time)
                    if message.isOutgoing {
                        MessageDeliveryButton(message: message, conversation: .room, action: showDetails)
                    } else {
                        if let hops = message.hops {
                            MetadataDot()
                            hopSummary(hops)
                        }
                        if let snr = message.snr {
                            MetadataDot()
                            Text(formatSNR(snr))
                        }
                    }
                }
            }
            if message.isOutgoing && message.status == .failed {
                MessageSendFailure(message: message)
            }
        }
        .sheet(item: $messageDetails) { MessageDetailsView(selection: $0) }
    }
}

// MARK: - Repeater Login View

/// Login gate for repeaters — shows management screen after login.
struct RepeaterLoginView: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @ObservedObject var session: RemoteDeviceSession
    @State private var password = ""
    @State private var rememberPassword = true

    private var isLoggedIn: Bool {
        if case .loggedIn = session.loginState { return true }
        return false
    }

    private var isLoggingIn: Bool {
        if case .loggingIn = session.loginState { return true }
        return false
    }

    var body: some View {
        if isLoggedIn {
            RemoteManagementView(
                contact: contact,
                session: session
            )
        } else {
            ScrollView {
                repeaterLoginContent
                    .padding(.vertical, Design.Space.section)
                    .padding(.horizontal, Design.Space.regular)
            }
            .background(MeshTheme.background)
            .navigationTitle(contactStore.displayName(for: contact))
            .onAppear {
                if let saved = KeychainManager.getSavedPassword(forDevice: contact.publicKey) {
                    password = saved
                }
            }
        }
    }

    private var repeaterLoginContent: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 12) {
                let remoteAccent: Color = contact.type == .room ? MeshTheme.remoteRoom : MeshTheme.remoteRepeater
                let deviceLabel = contact.type == .room ? "Room Server" : contact.type == .sensor ? "Sensor" : "Repeater"
                let deviceIcon = contact.type == .room ? "server.rack" : "antenna.radiowaves.left.and.right"
                Image(systemName: deviceIcon)
                    .font(.largeTitle)
                    .foregroundStyle(remoteAccent)
                Text("\(deviceLabel) Login")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(remoteAccent)
                Text("Enter the admin password to manage this \(deviceLabel.lowercased()).")
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            VStack(spacing: 12) {
                HStack {
                    Image(systemName: "lock")
                        .foregroundStyle(MeshTheme.accent)
                        .frame(width: 24)
                    #if os(watchOS)
                    SecureField("Password", text: $password)
                        .foregroundStyle(MeshTheme.textPrimary)
                    #else
                    SecureField("Password", text: $password)
                        .foregroundStyle(MeshTheme.textPrimary)
                        .textFieldStyle(MeshTextFieldStyle())
                        .onSubmit { login() }
                        .onChange(of: password) { _, new in
                            if new.count > 15 { password = String(new.prefix(15)) }
                        }
                    #endif
                }
                .padding(.horizontal, 32)

                Text("Passwords are case-sensitive, max 15 characters.")
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.textSecondary)

                #if !os(watchOS)
                Toggle("Remember Password", isOn: $rememberPassword)
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.accent)
                    .padding(.horizontal, 32)
                #endif

                if isLoggingIn {
                    HStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(0.8)
                            .tint(MeshTheme.textSecondary)
                        Text("Logging in...")
                            .foregroundStyle(MeshTheme.textSecondary)
                        Button("Cancel") {
                            remoteSessionManager.cancelLogin(for: contact)
                        }
                        .foregroundStyle(.red)
                    }
                } else {
                    Button(action: login) {
                        Label("Log in", systemImage: "arrow.right.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.meshPrimary)
                    .padding(.horizontal, 32)
                }

                if case .loginFailed(let msg) = session.loginState {
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                        Text(msg)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                if KeychainManager.hasPassword(forDevice: contact.publicKey) {
                    Button(role: .destructive) {
                        KeychainManager.deleteAllPasswords(forDevice: contact.publicKey)
                        password = ""
                    } label: {
                        Label("Forget Saved Password", systemImage: "trash")
                            .font(.caption)
                    }
                    .buttonStyle(.meshPlain)
                }
            }

            Spacer()
        }
    }

    private func login() {
        guard !isLoggingIn else { return }
        remoteSessionManager.loginToRemoteDevice(contact, password: password, remember: rememberPassword)
    }
}
