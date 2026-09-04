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
    var onQuote: ((Message) -> Void)?
    var onReact: ((Message, String) -> Void)?
    var onForward: ((Message) -> Void)?
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @State private var linkMetadata: LinkPreviewService.LinkMetadata?
    @State private var showPathSheet = false

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
        parts.append(quotedText != nil ? replyText : message.text)
        let fmt = DateFormatter(); fmt.timeStyle = .short; fmt.dateStyle = .none
        parts.append(fmt.string(from: message.timestamp))
        switch message.status {
        case .sending: parts.append("Sending")
        case .sent: parts.append("Sent")
        case .repeated: parts.append("Sent, repeated by mesh")
        case .retrying: parts.append("Retrying, attempt \(message.attempt + 1) of 3")
        case .flooding: parts.append("Flooding mesh network")
        case .delivered:
            if let rtt = message.roundTripMs, rtt > 0 {
                parts.append("Delivered, round trip \(String(format: "%.1f", Double(rtt) / 1000.0)) seconds")
            } else { parts.append("Delivered") }
        case .failed: parts.append("Not delivered")
        }
        if !message.reactions.isEmpty { parts.append("Reactions: \(message.reactions.joined(separator: ", "))") }
        if message.isSigned { parts.append("Verified") }
        if !message.isOutgoing {
            if let hops = message.hops {
                parts.append(hops == 0 || hops == 0xFF ? "Direct" : "\(hops) \(hops == 1 ? "hop" : "hops")")
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

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }

            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 2) {
                ZStack(alignment: message.isOutgoing ? .topLeading : .topTrailing) {
                    VStack(alignment: .leading, spacing: 4) {
                        // Quoted text block
                        if let quoted = quotedText {
                            HStack(spacing: 6) {
                                Rectangle()
                                    .fill(MeshTheme.accent.opacity(0.6))
                                    .frame(width: 2)
                                Text(quoted)
                                    .font(.caption)
                                    .foregroundStyle(MeshTheme.textOnAccent.opacity(0.7))
                                    .lineLimit(2)
                            }
                            .padding(.bottom, 2)
                            .accessibilityLabel("Quoted: \(quoted)")
                        }
                        // Message text
                        linkifyMeshcoreURLs(quotedText != nil ? replyText : message.text)
                            .textSelection(.enabled)

                        // Link preview
                        if let meta = linkMetadata, meta.title != nil {
                            LinkPreviewCard(metadata: meta)
                        }

                        // Shared coordinates render as a tappable map card
                        if let coord = detectCoordinate(in: quotedText != nil ? replyText : message.text) {
                            MessageMapCard(coordinate: coord)
                        }
                    }
                    // The message is the product, and it was the smallest
                    // text on the screen -- 15pt in a 9pt-tall bubble, which
                    // is the size of a caption. Sized from Design now, so a
                    // message read at arm's length outdoors does not need a
                    // second look.
                    .font(.system(size: Design.Text.message))
                    .padding(.horizontal, Design.Space.regular)
                    .padding(.vertical, Design.Space.snug)
                    .background(message.isOutgoing ? MeshTheme.outgoingBubble : MeshTheme.incomingBubble)
                    .foregroundStyle(MeshTheme.textOnAccent)
                    // Continuous curvature, not a circular corner: at this
                    // radius the difference is visible, and the squircle is
                    // what every other rounded shape on iOS uses.
                    .clipShape(RoundedRectangle(cornerRadius: Design.Radius.bubble, style: .continuous))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(bubbleAccessibilityLabel)
                    .padding(.top, message.reactions.isEmpty ? 0 : 22)

                    if !message.reactions.isEmpty {
                        ReactionBadge(reactions: message.reactions)
                            .accessibilityHidden(true)
                    }
                }

                HStack(spacing: 4) {
                    Text(message.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)

                    if message.isOutgoing {
                        deliveryIndicator
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
                        if message.hops != nil || message.snr != nil {
                            Button {
                                showPathSheet = true
                            } label: {
                                Image(systemName: "point.topleft.down.curvedto.point.bottomright.up")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.accent)
                            }
                            .buttonStyle(.plain)
                            .sheet(isPresented: $showPathSheet) {
                                MessagePathSheet(message: message)
                            }
                            .accessibilityLabel("Show message path")
                        }
                    }

                    if message.isSigned {
                        HStack(spacing: 2) {
                            Image(systemName: "checkmark.shield.fill")
                                .font(.caption2)
                            Text("Verified")
                                .font(.caption2)
                        }
                        .foregroundStyle(MeshTheme.connected)
                    }
                }
                .padding(.horizontal, 4)
                .accessibilityHidden(true)

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
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityLabel("Message not delivered")
                    .accessibilityHint("Tap to resend")
                }
            }
            .contentShape(Rectangle())
            .contextMenu {
                Button {
                    onQuote?(message)
                } label: {
                    Label("Quote", systemImage: "text.quote")
                }
                // Quick reactions
                Menu {
                    ForEach(["👍", "❤️", "😂", "😮", "😢", "🙏"], id: \.self) { emoji in
                        Button(emoji) { onReact?(message, emoji) }
                    }
                } label: {
                    Label("React", systemImage: "face.smiling")
                }
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
                if message.isOutgoing && message.status == .failed {
                    Button {
                        messageStoreManager.retryMessage(message)
                    } label: {
                        Label("Retry Send", systemImage: "arrow.clockwise")
                    }
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
        .task(id: message.id) {
            guard linkMetadata == nil, let url = firstHTTPURL(in: message.text) else { return }
            linkMetadata = await LinkPreviewService.shared.fetchMetadata(for: url)
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

    @ViewBuilder
    private var deliveryIndicator: some View {
        switch message.status {
        case .sending:
            Image(systemName: "clock")
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
                .accessibilityLabel("Sending")
        case .sent, .repeated:
            Image(systemName: "checkmark")
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
                .accessibilityLabel(message.status == .repeated ? Text("Sent, repeated by mesh") : Text("Sent"))
        case .retrying:
            HStack(spacing: 2) {
                Image(systemName: "arrow.clockwise")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                Text("Retrying (\(message.attempt + 1)/3)...")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Retrying, attempt \(message.attempt + 1) of 3")
        case .flooding:
            HStack(spacing: 2) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                Text("Flooding...")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Flooding mesh network")
        case .delivered:
            HStack(spacing: 2) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.accent)
                    .accessibilityLabel("Delivered")
                if let rtt = message.roundTripMs, rtt > 0 {
                    Text("\u{2022}")
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.accent)
                        .accessibilityHidden(true)
                    Text(String(format: "%.1fs", Double(rtt) / 1000.0))
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.accent)
                        .accessibilityLabel("Round trip \(String(format: "%.1f", Double(rtt) / 1000.0)) seconds")
                }
            }
        case .failed:
            HStack(spacing: 2) {
                Image(systemName: "exclamationmark.circle")
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.disconnected)
                Text("Not delivered")
                    .font(.caption2)
                    .foregroundStyle(MeshTheme.disconnected)
            }
            .accessibilityLabel("Not delivered")
        }
    }
}

struct ChannelMessageBubble: View {
    let message: Message
    @Environment(ContactStore.self) private var contactStore
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(MessageStoreManager.self) private var messageStoreManager

    private var highlightedText: Text {
        if message.text.contains("meshcore://") {
            return linkifyMeshcoreURLs(message.text)
        }
        return highlightMentions(in: message.text, myName: deviceConfig.deviceName)
    }

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }

            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 2) {
                if !message.isOutgoing, let sender = message.senderName, !sender.isEmpty {
                    Text(contactStore.channelSenderDisplayName(sender))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(MeshTheme.accent)
                        .padding(.horizontal, 4)
                        .accessibilityAddTraits(.isHeader)
                }

                ZStack(alignment: message.isOutgoing ? .topLeading : .topTrailing) {
                    VStack(alignment: .leading, spacing: 4) {
                        highlightedText
                            .textSelection(.enabled)

                        // Shared coordinates render as a tappable map card
                        if let coord = detectCoordinate(in: message.text) {
                            MessageMapCard(coordinate: coord)
                        }
                    }
                    // The message is the product, and it was the smallest
                    // text on the screen -- 15pt in a 9pt-tall bubble, which
                    // is the size of a caption. Sized from Design now, so a
                    // message read at arm's length outdoors does not need a
                    // second look.
                    .font(.system(size: Design.Text.message))
                    .padding(.horizontal, Design.Space.regular)
                    .padding(.vertical, Design.Space.snug)
                    .background(message.isOutgoing ? MeshTheme.outgoingBubble : MeshTheme.incomingBubble)
                    .foregroundStyle(MeshTheme.textOnAccent)
                    // Continuous curvature, not a circular corner: at this
                    // radius the difference is visible, and the squircle is
                    // what every other rounded shape on iOS uses.
                    .clipShape(RoundedRectangle(cornerRadius: Design.Radius.bubble, style: .continuous))
                    .padding(.top, message.reactions.isEmpty ? 0 : 22)

                    if !message.reactions.isEmpty {
                        ReactionBadge(reactions: message.reactions)
                    }
                }

                HStack(spacing: 4) {
                    Text(message.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)

                    if message.isOutgoing {
                        switch message.status {
                        case .sending:
                            Image(systemName: "clock")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        case .repeated:
                            HStack(spacing: 2) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.accent)
                                Text("Repeated")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.accent)
                            }
                        default:
                            Image(systemName: "checkmark")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }

                    if !message.isOutgoing {
                        if let hops = message.hops {
                            Text("\u{2022}")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                                .accessibilityHidden(true)
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
                                .accessibilityHidden(true)
                            Text(formatSNR(snr))
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                    }

                    if message.isSigned {
                        HStack(spacing: 2) {
                            Image(systemName: "checkmark.shield.fill")
                                .font(.caption2)
                            Text("Verified")
                                .font(.caption2)
                        }
                        .foregroundStyle(MeshTheme.connected)
                    }
                }
                .padding(.horizontal, 4)
            }
            .accessibilityElement(children: .combine)
            .contentShape(Rectangle())
            .contextMenu {
                Button {
                    copyToClipboard(message.text)
                } label: {
                    Label("Copy Text", systemImage: "doc.on.doc")
                }
                if !message.isOutgoing, let sender = message.senderName, !sender.isEmpty {
                    // Channel reactions (MeshCore One format: emoji@[senderName]\nhash)
                    Menu {
                        ForEach(["👍", "❤️", "😂", "😮", "😢", "🙏"], id: \.self) { emoji in
                            Button(emoji) {
                                let hash = messageStoreManager.reactionHash(for: message)
                                let reactionText = "\(emoji)@[\(sender)]\n\(hash)"
                                if let chIdx = message.channelIndex {
                                    messageStoreManager.sendChannelMessage(reactionText, channelIndex: chIdx)
                                }
                                messageStoreManager.addReactionLocal(emoji, to: message)
                            }
                        }
                    } label: {
                        Label("React", systemImage: "face.smiling")
                    }
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

            if !message.isOutgoing { Spacer(minLength: 48) }
        }
    }
}

// MARK: - Reaction Badge

private struct ReactionBadge: View {
    let reactions: [String]
    @ScaledMetric private var circleSize: CGFloat = 34
    @ScaledMetric private var fontSize: CGFloat = 19

    var body: some View {
        HStack(spacing: 4) {
            ForEach(reactions, id: \.self) { emoji in
                ZStack {
                    Circle()
                        .fill(.regularMaterial)
                        .shadow(color: .black.opacity(0.18), radius: 3, y: 1)
                    Text(emoji)
                        .font(.system(size: fontSize))
                }
                .frame(width: circleSize, height: circleSize)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Reactions: \(reactions.joined(separator: ", "))")
    }
}

// MARK: - Date Separator

struct DateSeparator: View {
    let date: Date

    var body: some View {
        HStack {
            VStack { Divider() }
            Text(formattedDate(date))
                .font(.caption2)
                .foregroundStyle(MeshTheme.textSecondary)
                .padding(.horizontal, 8)
            VStack { Divider() }
        }
        .padding(.vertical, 4)
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
    // Check for location pin: "📍 lat, lon"
    if text.contains("\u{1F4CD}"),
       let regex = try? NSRegularExpression(pattern: "\u{1F4CD}\\s*(-?\\d+\\.\\d+),\\s*(-?\\d+\\.\\d+)"),
       let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
       let latRange = Range(match.range(at: 1), in: text),
       let lonRange = Range(match.range(at: 2), in: text),
       let lat = Double(text[latRange]),
       let lon = Double(text[lonRange]),
       let mapsURL = URL(string: "https://maps.apple.com/?ll=\(lat),\(lon)&q=Shared%20Location") {
        var attr = AttributedString(text)
        if let emojiRange = text.range(of: "\u{1F4CD}"),
           let fullRange = attr.range(of: String(text[emojiRange.lowerBound...])) {
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
        HStack {
            VStack { Divider().background(MeshTheme.accent) }
            Text("New Messages")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(MeshTheme.accent)
                .padding(.horizontal, 8)
            VStack { Divider().background(MeshTheme.accent) }
        }
        .padding(.vertical, 4)
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
                    .pickerStyle(.segmented)
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
            List(filteredContacts) { contact in
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

/// A received DM knows how many hops it traveled and the SNR of its last
/// hop; the contact record knows the current out path (repeater hash bytes).
/// Together they make the route tangible: the footer button opens this sheet
/// with the hop chain and a map of every hop whose position is known.
struct MessagePathSheet: View {
    let message: Message
    @Environment(ContactStore.self) private var contactStore
    @Environment(\.dismiss) private var dismiss

    /// The DM peer this message belongs to.
    private var contact: Contact? {
        contactStore.contacts.first { $0.publicKeyPrefix == message.contactKeyHash }
    }

    /// One entry per step of the route the message took: sender → hops → us.
    /// The stored out path is our route *to* the contact, so incoming
    /// traffic walks it in reverse.
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
                    coordinate: pathCoordinate(latitude: contact.latitude, longitude: contact.longitude),
                    symbol: "person.wave.2.fill"
                )
            )
            let pathLen = max(0, Int(contact.outPathLen))
            for hash in contact.outPath.prefix(pathLen).reversed() {
                if let repeater = contactStore.contacts.first(where: { $0.publicKey.first == hash }) {
                    result.append(
                        PathStep(
                            title: contactStore.displayName(for: repeater),
                            subtitle: "Repeater \(String(format: "%02x", hash))",
                            coordinate: pathCoordinate(latitude: repeater.latitude, longitude: repeater.longitude),
                            symbol: "antenna.radiowaves.left.and.right"
                        )
                    )
                } else {
                    result.append(
                        PathStep(
                            title: "Repeater \(String(format: "%02x", hash))",
                            subtitle: "Not in contacts",
                            coordinate: nil,
                            symbol: "antenna.radiowaves.left.and.right"
                        )
                    )
                }
            }
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
                Section("Route") {
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
                }

                Section("Signal") {
                    if let hops = message.hops {
                        LabeledContent(
                            "Hops traveled",
                            value: hops == 0 || hops == 0xFF ? "Direct" : "\(hops)"
                        )
                    }
                    if let snr = message.snr {
                        LabeledContent("Last hop SNR", value: formatSNR(snr))
                    }
                    LabeledContent("Received", value: message.timestamp.formatted(date: .abbreviated, time: .shortened))
                }

                if let region {
                    Section("Known positions") {
                        Map(initialPosition: .region(region)) {
                            let coords = mappedSteps.compactMap(\.coordinate)
                            if coords.count >= 2 {
                                MapPolyline(coordinates: coords)
                                    .stroke(MeshTheme.accent.opacity(0.7), lineWidth: 2)
                            }
                            ForEach(mappedSteps) { step in
                                if let coordinate = step.coordinate {
                                    Marker(step.title, systemImage: step.symbol, coordinate: coordinate)
                                }
                            }
                        }
                        .frame(height: 260)
                        .listRowInsets(EdgeInsets())
                        if mappedSteps.count < steps.count - 1 {
                            Text("Hops without a shared position are not shown.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Section {
                        Text("No positions are known for this route yet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
    guard abs(latitude) > 0.001 || abs(longitude) > 0.001 else { return nil }
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
        .buttonStyle(.plain)
        .accessibilityLabel("Shared position \(coordinate.latitude), \(coordinate.longitude). Opens in Maps.")
    }
}
