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
    let channelIndex: UInt8
    let channelName: String
    @Environment(ContactStore.self) private var contactStore
    @Environment(ChannelStore.self) private var channelStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var messageText = ""
    @State private var unreadDividerIndex: Int?
    @State private var mentionQuery: String?
    @State private var notifyMode: String = "all"
    @State private var showChannelDetail = false
    @State private var showLocationUnavailableAlert = false

    private let maxMessageLength = 160

    private var channelKey: Data { Data([channelIndex]) }

    private var messages: [Message] {
        messageStoreManager.messagesByContact[channelKey] ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            messageList
            Divider()
                .overlay(MeshTheme.surfaceLight)
            messageInput
        }
        .background(MeshTheme.background)
        .navigationTitle(channelName)
        #if !os(watchOS)
        .sheet(isPresented: $showChannelDetail) {
            ChannelDetailSheet(channelIndex: channelIndex, channelName: channelName, notifyMode: $notifyMode)
        }
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .principal) {
                Button { showChannelDetail = true } label: {
                    Text(channelName)
                        .font(.headline)
                        .foregroundStyle(MeshTheme.textPrimary)
                }
                .buttonStyle(.plain)
            }
            #endif
            ToolbarItem(placement: .automatic) {
                HStack(spacing: 12) {
                    Button {
                        sendLocationToChannel()
                    } label: {
                        Image(systemName: "location.fill")
                            .foregroundStyle(MeshTheme.accent)
                    }
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
                    }
                }
            }
        }
        #endif
        .onAppear {
            notifyMode = channelStore.channelNotifyMode(for: channelName).rawValue
            if messageText.isEmpty {
                messageText = messageStoreManager.loadDraft(for: channelKey)
            }
            DispatchQueue.main.async {
                messageStoreManager.markAsRead(contactKey: channelKey)
            }
        }
        .onDisappear {
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
            Text("Your location could not be determined. Enable Location Services for PommeCore in Settings.")
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if messages.isEmpty {
                    VStack(spacing: 12) {
                        Spacer(minLength: 60)
                        Image(systemName: "number.square")
                            .font(.largeTitle)
                            .foregroundStyle(MeshTheme.textSecondary)
                        Text("No messages yet")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                        Text("Messages sent to this channel will appear here.")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                LazyVStack(spacing: 4) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if index == 0 || isDifferentDay(messages[index - 1].timestamp, message.timestamp) {
                            DateSeparator(date: message.timestamp)
                        }
                        if index == unreadDividerIndex {
                            UnreadDivider()
                        }
                        ChannelMessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            #if !os(watchOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .onChange(of: messages.count) {
                if let last = messages.last {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
                // Only mark as read when the user is actively viewing the chat
                #if os(macOS)
                guard NSApplication.shared.isUserViewing else { return }
                #else
                guard scenePhase == .active else { return }
                #endif
                withAnimation { unreadDividerIndex = nil }
                DispatchQueue.main.async {
                    messageStoreManager.markAsRead(contactKey: channelKey)
                }
            }
            #if os(macOS)
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification).merge(with: NotificationCenter.default.publisher(for: NSWindow.didDeminiaturizeNotification))) { _ in
                withAnimation { unreadDividerIndex = nil }
                DispatchQueue.main.async {
                    messageStoreManager.markAsRead(contactKey: channelKey)
                }
            }
            #else
            .onChange(of: scenePhase) { _, newPhase in
                if newPhase == .active {
                    withAnimation { unreadDividerIndex = nil }
                    DispatchQueue.main.async {
                        messageStoreManager.markAsRead(contactKey: channelKey)
                    }
                }
            }
            #endif
            .onAppear {
                unreadDividerIndex = messageStoreManager.firstUnreadIndex(in: messages, for: channelKey)
                // Delay scroll to let LazyVStack lay out content
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    if let idx = unreadDividerIndex, idx < messages.count {
                        proxy.scrollTo(messages[idx].id, anchor: .center)
                    } else if let last = messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
                // Clear the divider after user has had time to see it
                if unreadDividerIndex != nil {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        withAnimation { unreadDividerIndex = nil }
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
                            .buttonStyle(.plain)
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 200)
                .background(MeshTheme.surface)
            }

            VStack(spacing: 4) {
                HStack(spacing: 10) {
                    TextField("Type a message...", text: $messageText)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(MeshTheme.surfaceLight)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .foregroundStyle(MeshTheme.textPrimary)
                        .onChange(of: messageText) { _, newValue in
                            if newValue.count > maxMessageLength {
                                messageText = String(newValue.prefix(maxMessageLength))
                            }
                            mentionQuery = detectMentionQuery(in: newValue)
                        }
                        #if !os(watchOS)
                        .onSubmit { send() }
                        #endif

                    Button(action: send) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title)
                            .foregroundStyle(
                                messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    ? MeshTheme.textSecondary
                                    : MeshTheme.accent
                            )
                    }
                    .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 12)

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
        messageStoreManager.sendChannelMessage(messageText, channelIndex: channelIndex)
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
        let text = "\u{1F4CD} \(formatCoordinate(fLat)), \(formatCoordinate(fLon))"
        messageStoreManager.sendChannelMessage(text, channelIndex: channelIndex)
        messageStoreManager.playHapticFeedback()
        DebugLogger.shared.log("LOCATION: sent to channel \(channelIndex)", level: .tx)
    }
}

// MARK: - Room Chat View

/// Chat view for room servers — requires login, shows room messages, has gear icon for management.
struct RoomChatView: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(RemoteSessionManager.self) private var remoteSessionManager
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @ObservedObject var session: RemoteDeviceSession
    @State private var messageText = ""
    @State private var password = ""
    @State private var rememberPassword = true
    @State private var showManagement = false
    @State private var showContactDetail = false

    private let maxMessageLength = 160

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
                        .font(.system(size: 6))
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
                Divider()
                    .overlay(MeshTheme.surfaceLight)
                if permission.canPost {
                    roomMessageInput
                } else {
                    readOnlyInputBar
                }
            } else {
                roomLoginPrompt
            }
        }
        .background(MeshTheme.background)
        .navigationTitle(contactStore.displayName(for: contact))
        .toolbar {
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
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { showManagement = false }
                    }
                }
            }
            .meshTheme()
            #if os(macOS) || targetEnvironment(macCatalyst)
            .frame(minWidth: 400, minHeight: 500)
            #endif
        }
        #endif
        .onAppear {
            messageStoreManager.markAsRead(contact)
        }
        // No onDisappear logout — firmware handles session timeout.
        // Clearing local state causes mismatch with firmware and unresponsiveness.
        // Dismiss management sheet if logged out while it's open
        .onChange(of: isLoggedIn) { _, loggedIn in
            if !loggedIn {
                showManagement = false
            }
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if index == 0 || isDifferentDay(messages[index - 1].timestamp, message.timestamp) {
                            DateSeparator(date: message.timestamp)
                        }
                        RoomMessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            #if !os(watchOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .onChange(of: messages.count) {
                if let last = messages.last {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            .onAppear {
                if let last = messages.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private var roomMessageInput: some View {
        VStack(spacing: 4) {
            HStack(spacing: 10) {
                TextField("Type a message...", text: $messageText)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .foregroundStyle(MeshTheme.textPrimary)
                    .onChange(of: messageText) { _, newValue in
                        if newValue.count > maxMessageLength {
                            messageText = String(newValue.prefix(maxMessageLength))
                        }
                    }
                    #if !os(watchOS)
                    .onSubmit { sendRoomMessage() }
                    #endif

                Button(action: sendRoomMessage) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundStyle(
                            messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                ? MeshTheme.textSecondary
                                : MeshTheme.accent
                        )
                }
                .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, 12)

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

    private var readOnlyInputBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill")
                .foregroundStyle(MeshTheme.textSecondary)
            Text("Read-only access \u{2014} posting not available")
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(MeshTheme.surface)
    }

    private var roomLoginPrompt: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 12) {
                Image(systemName: "lock.shield")
                    .font(.largeTitle)
                    .foregroundStyle(MeshTheme.textSecondary)
                Text("Login Required")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(MeshTheme.textPrimary)
                Text("Enter the room server password to view and post messages.")
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
                        HStack {
                            Image(systemName: "arrow.right.circle")
                            Text("Login")
                        }
                        .frame(maxWidth: 200)
                        .padding(.vertical, 10)
                        .background(MeshTheme.interactiveGreen)
                        .foregroundStyle(MeshTheme.textOnAccent)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
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
                    .buttonStyle(.plain)
                }
            }

            #if !os(watchOS)
            Button { showContactDetail = true } label: {
                Label("Network Tools", systemImage: "info.circle")
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.accent)
            }
            .buttonStyle(.plain)
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
        messageStoreManager.sendRoomMessage(messageText, to: contact)
        messageStoreManager.playHapticFeedback()
        messageText = ""
    }
}

/// Message bubble for room chat — shows sender name for incoming messages.
struct RoomMessageBubble: View {
    let message: Message
    @Environment(ContactStore.self) private var contactStore
    @Environment(MessageStoreManager.self) private var messageStoreManager

    /// Try to extract sender name from room server message prefix.
    /// Room servers often prefix messages with "SenderName: actual message"
    private var senderAndText: (sender: String?, text: String) {
        if !message.isOutgoing {
            let text = message.text
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
        return (nil, message.text)
    }

    var body: some View {
        let parsed = senderAndText
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }

            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 2) {
                if !message.isOutgoing, let rawSender = parsed.sender {
                    let sender = contactStore.channelSenderDisplayName(rawSender)
                    Text(sender)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(MeshTheme.accent)
                        .padding(.horizontal, 4)
                }

                linkifyMeshcoreURLs(parsed.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(message.isOutgoing ? MeshTheme.outgoingBubble : MeshTheme.incomingBubble)
                    .foregroundStyle(MeshTheme.textOnAccent)
                    .clipShape(RoundedRectangle(cornerRadius: 18))

                HStack(spacing: 4) {
                    Text(message.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)

                    if message.isOutgoing {
                        switch message.status {
                        case .failed:
                            HStack(spacing: 2) {
                                Image(systemName: "exclamationmark.circle")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.disconnected)
                                Text("Not delivered")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.disconnected)
                            }
                        case .retrying:
                            HStack(spacing: 2) {
                                Image(systemName: "arrow.clockwise")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                                Text("Retrying (attempt \(message.attempt + 1))...")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        case .flooding:
                            HStack(spacing: 2) {
                                Image(systemName: "dot.radiowaves.left.and.right")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                                Text("Flooding...")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        case .delivered:
                            HStack(spacing: 2) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.accent)
                            }
                        default:
                            Image(systemName: message.status == .sending ? "clock" : "checkmark")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }

                    if !message.isOutgoing {
                        if let hops = message.hops {
                            Text("\u{2022}")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                            if hops == 0 || hops == 0xFF {
                                Text("direct")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.textSecondary)
                            } else {
                                Text("^[\(hops) hop](inflect: true)")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.textSecondary)
                            }
                        }
                        if let snr = message.snr {
                            Text("\u{2022}")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                            Text(formatSNR(snr))
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }
                }
                .padding(.horizontal, 4)

                if message.status == .failed {
                    Button {
                        messageStoreManager.retryMessage(message)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.clockwise")
                            Text("Tap to retry")
                        }
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(MeshTheme.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(MeshTheme.surfaceLight)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .contentShape(Rectangle())
            .contextMenu {
                Button {
                    copyToClipboard(parsed.text)
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

            if !message.isOutgoing { Spacer(minLength: 48) }
        }
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
                            HStack {
                                Image(systemName: "arrow.right.circle")
                                Text("Login")
                            }
                            .frame(maxWidth: 200)
                            .padding(.vertical, 10)
                            .background(MeshTheme.interactiveGreen)
                            .foregroundStyle(MeshTheme.textOnAccent)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
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
                        .buttonStyle(.plain)
                    }
                }

                Spacer()
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

    private func login() {
        guard !isLoggingIn else { return }
        remoteSessionManager.loginToRemoteDevice(contact, password: password, remember: rememberPassword)
    }
}
