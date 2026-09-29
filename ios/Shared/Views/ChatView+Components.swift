//
//  ChatView+Components.swift
//  PommeCore
//
//  Message bubbles and shared chat components split from ChatView.swift.
//
//  Created by Michael P. Bedworth on 3/13/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import SwiftUI
import MapKit
import MeshCoreKit

// MARK: - Message Bubbles

struct MessageBubble: View {
    let message: Message
    /// Where this message sits in its run. Only a run's end shows the time,
    /// the delivery state, and the other person's orb.
    var run = ChatRunPosition()
    /// The other person, shown beside the end of their runs.
    var peer: NodeOrb?
    var onQuote: ((Message) -> Void)?
    var onReact: ((Message, String) -> Void)?
    var onForward: ((Message) -> Void)?
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @State private var linkMetadata: LinkPreviewService.LinkMetadata?
    @State private var showPathSheet = false
    @State private var messageDetails: MessageDetailsSelection?

    /// Parse quoted text from message. Supports both formats:
    /// MeshCore One: @[name]\n>preview..\nreply
    /// Legacy: > quoted text\nreply
    private var quotedText: String? {
        let lines = message.text.components(separatedBy: "\n")
        // MeshCore One format: @[name] on first line, >preview on second
        if let first = lines.first, first.hasPrefix("@["),
           lines.count >= 2, lines[1].hasPrefix(">") {
            return String(lines[1].dropFirst()) // drop the ">"
        }
        // Legacy format: > text
        if let first = lines.first, first.hasPrefix("> ") {
            return String(first.dropFirst(2))
        }
        return nil
    }

    private var bubbleAccessibilityLabel: String {
        var parts: [String] = []
        if let quoted = quotedText { parts.append("Quoted: \(quoted)") }
        parts.append(quotedText != nil ? replyText : message.interfaceText)
        let fmt = DateFormatter(); fmt.timeStyle = .short; fmt.dateStyle = .none
        parts.append(fmt.string(from: message.timestamp))
        let evidence = MessageDeliveryEvidence(message: message,
            transport: messageStoreManager.meshtasticNodeNum == 0 ? .meshCore : .meshtastic, conversation: .direct)
        parts.append(evidence.shortTitle(conversation: .direct))
        if let milliseconds = evidence.acknowledgedRoundTripMs {
            parts.append("Acknowledgement round trip \(milliseconds) milliseconds")
        }
        if !message.reactions.isEmpty { parts.append("Reactions: \(message.reactions.map { MessageReaction.label(for: $0) }.joined(separator: ", "))") }
        if message.isSigned { parts.append("Verified") }
        if !message.isOutgoing {
            if let hops = message.hops {
                parts.append(hops == 0xFF ? "Hop count not reported" : hops == 0 ? "Direct" : "\(hops) \(hops == 1 ? "hop" : "hops")")
            }
            if let snr = message.snr { parts.append(formatSNR(snr)) }
        }
        return parts.joined(separator: ", ")
    }

    /// The reply text (everything after the quote lines)
    private var replyText: String {
        let lines = message.text.components(separatedBy: "\n")
        // MeshCore One format: skip @[name] and >preview lines
        if let first = lines.first, first.hasPrefix("@["),
           lines.count >= 2, lines[1].hasPrefix(">") {
            return lines.dropFirst(2).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // Legacy format: skip > line
        if lines.first?.hasPrefix("> ") == true {
            return lines.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return message.text
    }

    private var bodyText: String { quotedText != nil ? replyText : message.interfaceText }

    private var hasSignalReport: Bool { !message.isOutgoing && (message.hops != nil || message.snr != nil) }

    private func showDetails() {
        messageDetails = MessageDetailsSelection(message: message, conversation: .direct, store: messageStoreManager)
    }

    @ViewBuilder private var messageActions: some View {
        Button(action: showDetails) {
            Label("Message details", systemImage: "info.circle")
        }
        Button {
            onQuote?(message)
        } label: {
            Label("Quote", systemImage: "text.quote")
        }
        // Quick reactions
        Menu {
            ForEach(MessageReaction.allCases) { reaction in
                Button {
                    onReact?(message, reaction.rawValue)
                } label: {
                    Label(reaction.label, systemImage: reaction.symbolName)
                }
            }
        } label: {
            Label("React", systemImage: "face.smiling")
        }
        .disabled(!messageStoreManager.canSendMessages)
        Button {
            copyToClipboard(message.text)
        } label: {
            Label("Copy Text", systemImage: "doc.on.doc")
        }
        Button {
            onForward?(message)
        } label: {
            Label("Forward", systemImage: "arrowshape.turn.up.right")
        }
        if hasSignalReport {
            Button { showPathSheet = true } label: {
                Label("Signal path", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
            }
        }
        if message.isOutgoing && message.status == .failed {
            Button {
                messageStoreManager.retryMessage(message)
            } label: {
                Label("Retry Send", systemImage: "arrow.clockwise")
            }
            .disabled(!messageStoreManager.canSendMessages)
        }
        Divider()
        Button(role: .destructive) {
            messageStoreManager.deleteMessage(message, in: message.contactKeyHash)
        } label: {
            Label("Delete Message", systemImage: "trash")
        }
    }

    var body: some View {
        ChatMessageRow(isOutgoing: message.isOutgoing, run: run, orb: peer, reactions: message.reactions) {
            bubble
        } footer: {
            if run.endsRun || message.needsDeliveryFooter(acknowledged: true) { metadata }
            if message.isOutgoing && message.status == .failed {
                MessageSendFailure(message: message)
            }
        }
        .sheet(item: $messageDetails) { MessageDetailsView(selection: $0) }
        .sheet(isPresented: $showPathSheet) { MessagePathSheet(message: message) }
        .task(id: message.id) {
            guard linkMetadata == nil, let url = firstHTTPURL(in: message.text) else { return }
            linkMetadata = await LinkPreviewService.shared.fetchMetadata(for: url)
        }
    }

    // A long press opens the actions, as in Messages. The text is not
    // selectable inside the bubble: selection claimed the same long press, so
    // the menu was unreliable and needed a separate button on every message.
    // Copy Text is in the menu.
    private var bubble: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let quoted = quotedText {
                Text(quoted)
                    .font(.subheadline)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .lineLimit(2)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Capsule().fill(MeshTheme.brandPink.opacity(0.7)).frame(width: 3)
                    }
                    .padding(.bottom, 2)
            }
            linkifyMeshcoreURLs(bodyText)
            if let meta = linkMetadata, meta.title != nil {
                LinkPreviewCard(metadata: meta)
            }
            // Shared coordinates render as a tappable map card
            if let coord = detectCoordinate(in: bodyText) {
                MessageMapCard(coordinate: coord)
            }
        }
        .chatBubble(isOutgoing: message.isOutgoing)
        .contextMenu { messageActions }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(bubbleAccessibilityLabel)
        .accessibilityAction(named: "Message details", showDetails)
        .accessibilityAction(named: "Quote") { onQuote?(message) }
        .accessibilityAction(named: "Copy text") { copyToClipboard(message.text) }
        .accessibilityAction(named: "Forward") { onForward?(message) }
    }

    private var metadata: some View {
        MessageMetadataRow(isOutgoing: message.isOutgoing) {
            Text(message.timestamp, style: .time)
            if message.isOutgoing {
                MessageDeliveryButton(message: message, conversation: .direct, action: showDetails)
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
            if message.isSigned { VerifiedMark() }
        }
    }

    /// Shared detector — NSDataDetector init is expensive; never create per-render.
    private static let linkDetector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    /// Extract the first http/https URL from message text.
    private func firstHTTPURL(in text: String) -> URL? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = Self.linkDetector?.firstMatch(in: text, range: range),
              let url = match.url,
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        return url
    }

}

extension Message {
    /// Only the end of a run shows its footer, but every mesh message is
    /// confirmed on its own. An outgoing message whose outcome is still open,
    /// or went wrong, keeps its footer anywhere in a run, so a stuck message in
    /// the middle is never hidden behind a later one that was delivered.
    /// `acknowledged` conversations (direct, room) wait for the recipient's
    /// ACK; a channel send is finished once the radio has sent it.
    func needsDeliveryFooter(acknowledged: Bool) -> Bool {
        guard isOutgoing else { return false }
        switch status {
        case .failed, .sending, .retrying, .flooding: return true
        case .sent: return acknowledged
        case .delivered, .repeated: return false
        }
    }
}

/// How far a received message came, in the words the footer uses.
func hopSummary(_ hops: UInt8) -> Text {
    switch hops {
    case 0: Text("direct")
    case 0xFF: Text("hops not reported")
    default: Text("^[\(Int(hops)) hop](inflect: true)")
    }
}

/// A signed message's mark in the footer.
struct VerifiedMark: View {
    var body: some View {
        Label("Verified", systemImage: "checkmark.shield.fill")
            .labelStyle(.titleAndIcon)
            .foregroundStyle(MeshTheme.connected)
    }
}

struct ChannelMessageBubble: View {
    let message: Message
    var run = ChatRunPosition()
    @State private var messageDetails: MessageDetailsSelection?
    @Environment(ContactStore.self) private var contactStore
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(MessageStoreManager.self) private var messageStoreManager

    private var highlightedText: Text {
        if message.text.contains("meshcore://") {
            return linkifyMeshcoreURLs(message.text)
        }
        return highlightMentions(in: message.interfaceText, myName: deviceConfig.deviceName)
    }

    private var senderName: String? {
        guard !message.isOutgoing, let sender = message.senderName, !sender.isEmpty else { return nil }
        return contactStore.channelSenderDisplayName(sender)
    }

    private func showDetails() {
        messageDetails = MessageDetailsSelection(message: message, conversation: .channel, store: messageStoreManager)
    }

    @ViewBuilder private var messageActions: some View {
        Button(action: showDetails) {
            Label("Message details", systemImage: "info.circle")
        }
        Button {
            copyToClipboard(message.text)
        } label: {
            Label("Copy Text", systemImage: "doc.on.doc")
        }
        if !message.isOutgoing, let sender = message.senderName, !sender.isEmpty {
            // Channel reactions (MeshCore One format: emoji@[senderName]\nhash)
            Menu {
                ForEach(MessageReaction.allCases) { reaction in
                    Button {
                        let hash = messageStoreManager.reactionHash(for: message)
                        let reactionText = "\(reaction.rawValue)@[\(sender)]\n\(hash)"
                        guard let chIdx = message.channelIndex,
                              messageStoreManager.sendChannelMessage(reactionText, channelIndex: chIdx),
                              messageStoreManager.lastSendError == nil else { return }
                        messageStoreManager.addReactionLocal(reaction.rawValue, to: message)
                    } label: {
                        Label(reaction.label, systemImage: reaction.symbolName)
                    }
                }
            } label: {
                Label("React", systemImage: "face.smiling")
            }
            .disabled(!messageStoreManager.canSendMessages)
            Button {
                NotificationCenter.default.post(name: .insertMention, object: sender)
            } label: {
                Label("@\(sender)", systemImage: "at")
            }
        }
        Divider()
        Button(role: .destructive) {
            messageStoreManager.deleteMessage(message, in: message.contactKeyHash)
        } label: {
            Label("Delete Message", systemImage: "trash")
        }
    }

    var body: some View {
        ChatMessageRow(
            isOutgoing: message.isOutgoing,
            run: run,
            // Every incoming channel message keeps the portrait column, so a
            // message from someone the channel never named still lines up.
            orb: message.isOutgoing ? nil : NodeOrb(name: senderName ?? "?", size: ChatGlass.bubbleOrb),
            senderLabel: senderName,
            reactions: message.reactions
        ) {
            VStack(alignment: .leading, spacing: 6) {
                highlightedText
                // Shared coordinates render as a tappable map card
                if let coord = detectCoordinate(in: message.text) {
                    MessageMapCard(coordinate: coord)
                }
            }
            .chatBubble(isOutgoing: message.isOutgoing)
            .contextMenu { messageActions }
            .accessibilityElement(children: .combine)
            .accessibilityAction(named: "Message details", showDetails)
            .accessibilityAction(named: "Copy text") { copyToClipboard(message.text) }
        } footer: {
            if run.endsRun || message.needsDeliveryFooter(acknowledged: false) {
                MessageMetadataRow(isOutgoing: message.isOutgoing) {
                    Text(message.timestamp, style: .time)
                    if message.isOutgoing {
                        MessageDeliveryButton(message: message, conversation: .channel, action: showDetails)
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
                    if message.isSigned { VerifiedMark() }
                }
            }
            if message.isOutgoing && message.status == .failed {
                MessageSendFailure(message: message)
            }
        }
        .sheet(item: $messageDetails) { MessageDetailsView(selection: $0) }
    }
}

// MARK: - Footer and day headings

/// A message's footer: time, delivery or signal, in one quiet line. At
/// accessibility sizes an outgoing footer stacks, so the delivery action stays
/// readable beside a long timestamp. The message keeps the reader's text size.
struct MessageMetadataRow<Content: View>: View {
    let isOutgoing: Bool
    @ViewBuilder var content: Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = isOutgoing && typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .trailing, spacing: Design.Space.hairline))
            : AnyLayout(HStackLayout(spacing: Design.Space.hairline))
        layout { content }
            .font(.caption)
            .foregroundStyle(MeshTheme.textSecondary)
            .padding(.horizontal, Design.Space.tight)
    }
}

struct DateSeparator: View {
    let date: Date

    var body: some View {
        ChatDayHeading(title: formattedDate(date))
    }

    private func formattedDate(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return String(localized: "Today") }
        if Calendar.current.isDateInYesterday(date) { return String(localized: "Yesterday") }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

/// Highlight @mentions in message text. Own name gets a stronger highlight.
func highlightMentions(in text: String, myName: String) -> Text {
    let pattern = "@(\\w+)"
    guard let regex = try? NSRegularExpression(pattern: pattern) else {
        return Text(text)
    }
    let nsText = text as NSString
    let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length))
    guard !matches.isEmpty else { return Text(text) }

    var result = Text("")
    var lastEnd = 0
    for match in matches {
        let range = match.range
        // Text before the match
        if range.location > lastEnd {
            let prefix = nsText.substring(with: NSRange(location: lastEnd, length: range.location - lastEnd))
            result = result + Text(prefix)
        }
        let mention = nsText.substring(with: range)
        let mentionName = nsText.substring(with: match.range(at: 1))
        let isMe = mentionName.localizedCaseInsensitiveCompare(myName) == .orderedSame
        result = result + Text(mention)
            .foregroundColor(isMe ? .orange : MeshTheme.accent)
            .bold()
        lastEnd = range.location + range.length
    }
    if lastEnd < nsText.length {
        result = result + Text(nsText.substring(from: lastEnd))
    }
    return result
}

#if os(iOS)
struct ShareSheetView: UIViewControllerRepresentable {
    let activityItems: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
#endif

/// Make meshcore:// URLs in text tappable as links.
func linkifyMeshcoreURLs(_ text: String) -> Text {
    // Recognize the current location label and older messages without rewriting
    // either message's content.
    if let regex = try? NSRegularExpression(pattern: "(?:Location:|\u{1F4CD})\\s*(-?\\d+\\.\\d+),\\s*(-?\\d+\\.\\d+)"),
       let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
       let latRange = Range(match.range(at: 1), in: text),
       let lonRange = Range(match.range(at: 2), in: text),
       let lat = Double(text[latRange]),
       let lon = Double(text[lonRange]),
       let mapsURL = URL(string: "https://maps.apple.com/?ll=\(lat),\(lon)&q=Shared%20Location") {
        var attr = AttributedString(text)
        if let locationRange = Range(match.range, in: text),
           let fullRange = attr.range(of: String(text[locationRange])) {
            attr[fullRange].link = mapsURL
            attr[fullRange].foregroundColor = .accentColor
        }
        return Text(attr)
    }

    // Check for meshcore:// URL
    guard let range = text.range(of: "meshcore://", options: .caseInsensitive) else {
        return Text(text)
    }
    var endIdx = range.upperBound
    while endIdx < text.endIndex && !text[endIdx].isWhitespace {
        endIdx = text.index(after: endIdx)
    }
    let before = String(text[text.startIndex..<range.lowerBound])
    let urlString = String(text[range.lowerBound..<endIdx])
    let after = String(text[endIdx...])

    if let url = URL(string: urlString) {
        var linked = AttributedString(urlString)
        linked.link = url
        linked.foregroundColor = .accentColor
        return Text(before) + Text(linked) + Text(after)
    }
    return Text(text)
}

struct UnreadDivider: View {
    var body: some View {
        Text("New messages")
            .font(.caption.weight(.semibold))
            .foregroundStyle(MeshTheme.accent)
            .padding(.horizontal, Design.Space.snug)
            .padding(.vertical, 6)
            .chatGlass(Capsule(), tint: MeshTheme.brandPink.opacity(0.1))
            .frame(maxWidth: .infinity)
            .padding(.vertical, Design.Space.tight)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Returns true if two dates fall on different calendar days.
func isDifferentDay(_ a: Date, _ b: Date) -> Bool {
    !Calendar.current.isDate(a, inSameDayAs: b)
}

// MARK: - Contact Notes Sheet

struct ContactNotesSheet: View {
    let contact: Contact
    @Environment(ContactStore.self) private var contactStore
    @Environment(\.dismiss) private var dismiss
    @State private var noteText = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Notes") {
                    TextEditor(text: $noteText)
                        .frame(minHeight: 120)
                        .font(.body)
                }
            }
            .navigationTitle("Notes for \(contactStore.displayName(for: contact))")
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        contactStore.setNote(noteText, for: contact)
                        dismiss()
                    }
                }
            }
            .onAppear {
                noteText = contactStore.note(for: contact)
            }
        }
    }
}

// MARK: - Channel Detail Sheet

struct ChannelDetailSheet: View {
    let channelIndex: UInt8
    let channelName: String
    @Binding var notifyMode: String
    @Environment(ChannelStore.self) private var channelStore
    @Environment(\.dismiss) private var dismiss
    @State private var showRemoveConfirm = false

    private var channel: MeshChannel? {
        channelStore.channels.first { $0.index == channelIndex }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Channel Info") {
                    LabeledContent("Name", value: channelName)
                    LabeledContent("Index", value: "\(channelIndex)")
                    if let ch = channel {
                        LabeledContent("Type", value: ch.channelType == .publicChannel ? "Public" : ch.channelType == .hashChannel ? "Hashtag" : "Private")
                        LabeledContent("Secret", value: ch.secret != nil ? "Set (\(ch.secret!.count) bytes)" : "None")
                    }
                }

                Section("Notifications") {
                    Picker("Mode", selection: $notifyMode) {
                        Text("All").tag("all")
                        Text("Mentions").tag("mentions")
                        Text("Muted").tag("muted")
                    }
                    .pickerStyle(.menu)
                    .frame(minHeight: Design.minimumTouchTarget)
                    .onChange(of: notifyMode) { _, mode in
                        if let notifyMode = ChannelStore.ChannelNotifyMode(rawValue: mode) {
                            channelStore.setChannelNotifyMode(notifyMode, for: channelName)
                        }
                    }
                }

                if channelIndex > 0 {
                    Section {
                        Button(role: .destructive) {
                            showRemoveConfirm = true
                        } label: {
                            Label("Leave Channel", systemImage: "xmark.circle")
                        }
                    }
                }
            }
            .navigationTitle(channelName)
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("Leave Channel?", isPresented: $showRemoveConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Leave", role: .destructive) {
                    channelStore.setChannel(index: channelIndex, name: "", secret: nil)
                    dismiss()
                }
            } message: {
                Text("Messages in this channel will be deleted from your device.")
            }
        }
        .meshTheme()
    }
}

// MARK: - Forward Contact Picker

struct ForwardContactPicker: View {
    let onSelect: (Contact) -> Void
    @Environment(ContactStore.self) private var contactStore
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var filteredContacts: [Contact] {
        let chatContacts = contactStore.contacts.filter { $0.type == .chat }
        if search.isEmpty { return chatContacts }
        return chatContacts.filter {
            contactStore.displayName(for: $0).localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Choose a contact, then review the forwarded text before sending. Existing draft text is kept.")
                        .font(.footnote)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(filteredContacts) { contact in
                Button {
                    onSelect(contact)
                } label: {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(contactStore.contactStatusColor(for: contact))
                            .frame(width: 8, height: 8)
                        Text(contactStore.displayName(for: contact))
                            .foregroundStyle(MeshTheme.textPrimary)
                    }
                }
                .listRowBackground(MeshTheme.surface)
                }
            }
            .overlay {
                if filteredContacts.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .meshTheme()
            .searchable(text: $search, prompt: "Search contacts")
            .navigationTitle("Forward To")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        #if os(macOS) || targetEnvironment(macCatalyst)
        .frame(minWidth: 300, minHeight: 400)
        #endif
    }
}

// MARK: - Link Preview Card

struct LinkPreviewCard: View {
    let metadata: LinkPreviewService.LinkMetadata

    var body: some View {
        Link(destination: metadata.url) {
            VStack(alignment: .leading, spacing: 4) {
                if let imageURL = metadata.imageURL {
                    AsyncImage(url: imageURL) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(maxHeight: 120)
                            .clipped()
                    } placeholder: {
                        Color.clear.frame(height: 0)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    if let title = metadata.title {
                        Text(title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(MeshTheme.textOnAccent)
                            .lineLimit(2)
                    }
                    if let desc = metadata.description {
                        Text(desc)
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.textOnAccent.opacity(0.7))
                            .lineLimit(2)
                    }
                    if let site = metadata.siteName {
                        Text(site)
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.accent)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
            .frame(maxWidth: 240)
            .background(Color.black.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Message Path

/// A received DM may report hop count and last-hop SNR, but it does not carry
/// a verified repeater chain. The contact's current outgoing path is unrelated
/// to the historical incoming route and must not be drawn as that route.
struct MessagePathSheet: View {
    let message: Message
    @Environment(ContactStore.self) private var contactStore
    @Environment(\.dismiss) private var dismiss

    /// The DM peer this message belongs to.
    private var contact: Contact? {
        contactStore.contacts.first { $0.publicKeyPrefix == message.contactKeyHash }
    }

    /// Known endpoints only; intermediate repeaters are not identified.
    private struct PathStep: Identifiable {
        let id = UUID()
        let title: String
        let subtitle: String?
        let coordinate: CLLocationCoordinate2D?
        let symbol: String
    }

    private var steps: [PathStep] {
        var result: [PathStep] = []
        if let contact {
            result.append(
                PathStep(
                    title: contactStore.displayName(for: contact),
                    subtitle: "Sender",
                    coordinate: contactStore.nodePositions[contact.publicKeyPrefix].map {
                        CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                    } ?? pathCoordinate(latitude: contact.latitude, longitude: contact.longitude),
                    symbol: "person.wave.2.fill"
                )
            )
        } else {
            result.append(PathStep(title: "Sender", subtitle: "Contact record unavailable", coordinate: nil, symbol: "person.wave.2.fill"))
        }
        result.append(PathStep(title: "You", subtitle: nil, coordinate: nil, symbol: "iphone.gen3"))
        return result
    }

    private var mappedSteps: [PathStep] { steps.filter { $0.coordinate != nil } }

    private var region: MKCoordinateRegion? {
        let coords = mappedSteps.compactMap(\.coordinate)
        guard let first = coords.first else { return nil }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for c in coords {
            minLat = min(minLat, c.latitude); maxLat = max(maxLat, c.latitude)
            minLon = min(minLon, c.longitude); maxLon = max(maxLon, c.longitude)
        }
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: MKCoordinateSpan(
                latitudeDelta: max(0.02, (maxLat - minLat) * 1.6),
                longitudeDelta: max(0.02, (maxLon - minLon) * 1.6)
            )
        )
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                        HStack(spacing: 12) {
                            Image(systemName: step.symbol)
                                .foregroundStyle(MeshTheme.accent)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(step.title)
                                if let subtitle = step.subtitle {
                                    Text(subtitle)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if index < steps.count - 1 {
                                Image(systemName: "arrow.down")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                } header: {
                    Text("Known endpoints")
                } footer: {
                    Text("The received message does not identify its repeaters. A saved outgoing path cannot establish the route this message took.")
                }

                Section("Signal") {
                    if let hops = message.hops, hops != 0xFF {
                        LabeledContent(
                            "Hops traveled",
                            value: hops == 0 ? "Direct" : "\(hops)"
                        )
                    } else {
                        LabeledContent("Hops traveled", value: "Not reported")
                    }
                    if let snr = message.snr {
                        LabeledContent("Last hop SNR", value: formatSNR(snr))
                    } else {
                        LabeledContent("Last hop SNR", value: "Not reported")
                    }
                    LabeledContent("Received", value: message.timestamp.formatted(date: .abbreviated, time: .shortened))
                }

                if let region {
                    Section("Known positions") {
                        Map(initialPosition: .region(region)) {
                            ForEach(mappedSteps) { step in
                                if let coordinate = step.coordinate {
                                    Marker(step.title, systemImage: step.symbol, coordinate: coordinate)
                                }
                            }
                        }
                        .frame(height: 260)
                        .listRowInsets(EdgeInsets())
                        Text("The sender's latest shared position may differ from its position when this message was sent.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        ContentUnavailableView(
                            "Sender position not reported",
                            systemImage: "mappin.slash",
                            description: Text("A map appears when the sender shares a usable position.")
                        )
                    }
                }
            }
            .navigationTitle("Message Path")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private func pathCoordinate(latitude: Double, longitude: Double) -> CLLocationCoordinate2D? {
    guard latitude != 0 || longitude != 0 else { return nil }
    guard abs(latitude) <= 90, abs(longitude) <= 180 else { return nil }
    return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
}

// MARK: - Inline coordinate preview

/// Finds the first "lat, lon" decimal pair in a message, so shared positions
/// render as a small map card instead of an opaque number pair.
func detectCoordinate(in text: String) -> CLLocationCoordinate2D? {
    let pattern = #/(-?\d{1,2}\.\d{3,8})\s*,\s*(-?\d{1,3}\.\d{3,8})/#
    guard let match = text.firstMatch(of: pattern),
          let lat = Double(match.1), let lon = Double(match.2),
          abs(lat) <= 90, abs(lon) <= 180
    else { return nil }
    return CLLocationCoordinate2D(latitude: lat, longitude: lon)
}

struct MessageMapCard: View {
    let coordinate: CLLocationCoordinate2D
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            var comps = URLComponents(string: "https://maps.apple.com/")!
            comps.queryItems = [URLQueryItem(name: "ll", value: "\(coordinate.latitude),\(coordinate.longitude)")]
            if let url = comps.url { openURL(url) }
        } label: {
            Map(initialPosition: .region(
                MKCoordinateRegion(
                    center: coordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
                )
            )) {
                Marker("Shared position", coordinate: coordinate)
            }
            .frame(height: 130)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .allowsHitTesting(false)
        }
        .buttonStyle(.meshPlain)
        .accessibilityLabel("Shared position \(coordinate.latitude), \(coordinate.longitude). Opens in Maps.")
    }
}
