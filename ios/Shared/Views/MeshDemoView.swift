//
//  MeshDemoView.swift
//  Lilyshark
//
//  What the app is for, shown to someone who has no deck yet.
//
//  A day on a trail with no cell signal: you, a friend two hops away, and a
//  repeater on the ridge between you. Send a message and watch it hop through
//  the repeater, come back with a delivery receipt, and get an answer. That is
//  the whole reason to own a deck, and it takes ten seconds to feel.
//
//  Everything here is local and simulated, and says so on screen the whole
//  time. It touches no store and no radio: the messages live in this view's
//  state and vanish when it closes. Mock data presented as real was a problem
//  in this app before, so the label is not optional.
//

#if os(iOS)
import SwiftUI
import MeshCoreKit

struct MeshDemoView: View {
    var onConnect: () -> Void
    var onClose: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    private struct DemoMessage: Identifiable, Equatable {
        enum Status: Equatable { case sending, delivered(String), received(String) }
        let id = UUID()
        let text: String
        let isOutgoing: Bool
        var status: Status
        let date: Date
    }

    @State private var messages: [DemoMessage] = [
        DemoMessage(text: "Made it to the ridge. No bars up here at all.", isOutgoing: false,
                    status: .received("2 hops · via Ridge repeater"), date: .now.addingTimeInterval(-240)),
        DemoMessage(text: "Same down here. Glad the decks work.", isOutgoing: true,
                    status: .delivered("Delivered · 1.9 s · via Ridge repeater"), date: .now.addingTimeInterval(-180)),
    ]
    @State private var draft = ""
    @State private var packet: Packet?
    @State private var isAlexTyping = false
    @State private var replies = 0
    @State private var busy = false
    @State private var sentSuggestions: Set<String> = []

    private let suggestions = ["Where are you now?", "Heading to the lookout", "Need any water?"]

    /// Canned answers, in order. Each one says something true about the mesh.
    private let answers = [
        "Coming down the east side. Your message took two hops through the ridge repeater.",
        "Got it. Nobody here has signal, but we can all hear the repeater.",
        "Copy. See you at the lookout in twenty.",
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: Design.Space.loose) {
                        intro
                        DemoMeshMap(packet: packet)
                            .frame(height: 210)
                            .chatGlass(RoundedRectangle(cornerRadius: 28, style: .continuous))
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("Map of the demo mesh: you, a repeater on the ridge, Alex two hops away, and Sam out of range.")
                        conversation
                        if replies > 0 {
                            callToAction
                                .id("cta")
                                .transition(.opacity.combined(with: .move(edge: .bottom)))
                        }
                    }
                    .padding(.horizontal, Design.Space.regular)
                    .padding(.top, Design.Space.tight)
                    .padding(.bottom, Design.Space.regular)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: messages.count) {
                    guard let last = messages.last?.id else { return }
                    withMeshAnimation(ChatGlass.arrival, reduceMotion: reduceMotion) {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
                .onChange(of: replies) {
                    withMeshAnimation(reduceMotion: reduceMotion) { proxy.scrollTo("cta", anchor: .bottom) }
                }
            }
            suggestionRow
            MessageComposer(
                text: $draft,
                budget: MessageTextBudget(draft),
                isConnected: true,
                sendLabel: "Send demo message to Alex",
                connect: {},
                send: { send(draft) }
            )
            .disabled(busy)
        }
        .background(MeshTheme.background.ignoresSafeArea())
        // An inset rather than an overlay: the conversation scrolls under
        // the bar and fades out, instead of running into the demo label.
        .safeAreaInset(edge: .top, spacing: 0) { topBar }
        .meshAnimation(ChatGlass.arrival, value: messages)
        .meshAnimation(ChatGlass.snap, value: isAlexTyping)
        .meshAnimation(ChatGlass.snap, value: replies)
        .meshAnimation(ChatGlass.snap, value: sentSuggestions)
        #if DEBUG && targetEnvironment(simulator)
        // Screenshot QA without taps (`--lilyshark-demo-autoplay`).
        .task {
            guard ProcessInfo.processInfo.arguments.contains("--lilyshark-demo-autoplay") else { return }
            try? await Task.sleep(for: .seconds(3))
            send(suggestions[0])
        }
        #endif
    }

    // MARK: - Pieces

    private var topBar: some View {
        HStack {
            Label("Demo · simulated, no radio", systemImage: "play.circle.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(MeshTheme.accent)
                .padding(.horizontal, Design.Space.snug)
                .frame(minHeight: 36)
                .chatGlass(Capsule(), tint: MeshTheme.brandPink.opacity(0.1))
                .accessibilityLabel("Demo. Simulated messages, no radio is used.")
            Spacer()
            Button(action: onClose) {
                GlassCircleLabel(systemImage: "xmark", size: Design.minimumTouchTarget)
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Close demo")
        }
        .padding(.horizontal, Design.Space.regular)
        .padding(.top, Design.Space.tight)
        .padding(.bottom, Design.Space.snug)
        .background {
            // Solid behind the bar, fading out just below it.
            VStack(spacing: 0) {
                MeshTheme.background
                ChatFadeEdge(edge: .top, height: 28)
            }
            .padding(.bottom, -28)
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
        }
    }

    private var intro: some View {
        VStack(spacing: Design.Space.tight) {
            Text("A day on the trail")
                .font(.title2.weight(.bold))
                .foregroundStyle(MeshTheme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("Nobody has cell signal. Your T-Deck and Alex's pass messages over LoRa radio, hopping through a repeater on the ridge. Send Alex a message.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var conversation: some View {
        LazyVStack(spacing: 0) {
            ChatDayHeading(title: String(localized: "Today"))
            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                ChatMessageRow(
                    isOutgoing: message.isOutgoing,
                    run: .of(index, in: messages, isOutgoing: \.isOutgoing, timestamp: \.date),
                    orb: message.isOutgoing ? nil : NodeOrb(name: "Alex", size: ChatGlass.bubbleOrb)
                ) {
                    Text(message.text).chatBubble(isOutgoing: message.isOutgoing)
                } footer: {
                    footer(for: message)
                }
                .id(message.id)
                .transition(.bubbleArrival(isOutgoing: message.isOutgoing))
            }
            if isAlexTyping {
                HStack(spacing: Design.Space.tight) {
                    NodeOrb(name: "Alex", size: ChatGlass.bubbleOrb)
                    TypingDots()
                        .padding(.horizontal, 18)
                        .frame(minHeight: 44)
                        .chatGlass(ChatBubbleShape(isOutgoing: false), style: .clear, tint: ChatGlass.incomingTint)
                    Spacer()
                }
                .transition(.opacity)
                .accessibilityLabel("Alex is replying")
            }
        }
    }

    @ViewBuilder
    private func footer(for message: DemoMessage) -> some View {
        switch message.status {
        case .sending:
            MessageMetadataRow(isOutgoing: true) {
                ProgressView().controlSize(.mini)
                Text("Hopping through the mesh")
            }
        case .delivered(let detail), .received(let detail):
            MessageMetadataRow(isOutgoing: message.isOutgoing) {
                if message.isOutgoing {
                    Image(systemName: "checkmark.circle")
                }
                Text(detail)
            }
        }
    }

    private var suggestionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Design.Space.tight) {
                ForEach(suggestions.filter { !sentSuggestions.contains($0) }, id: \.self) { suggestion in
                    Button {
                        send(suggestion)
                    } label: {
                        Text(suggestion)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(MeshTheme.textPrimary)
                            .padding(.horizontal, Design.Space.regular)
                            .frame(minHeight: 36)
                            .chatGlass(Capsule(), style: .clear, interactive: true)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
            }
            .padding(.horizontal, Design.Space.regular)
        }
        .opacity(busy ? 0.4 : 1)
    }

    private var callToAction: some View {
        VStack(spacing: Design.Space.snug) {
            Text("That's the mesh.")
                .font(.headline)
                .foregroundStyle(MeshTheme.textPrimary)
            Text("A T-Deck running Lilyshark does this for real: kilometres per hop, no towers, no accounts.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onConnect) {
                Label("Connect my T-Deck", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .touchable()
            }
            .buttonStyle(.meshPrimary)
            Button("Put Lilyshark on a T-Deck") {
                if let url = URL(string: "https://lilyshark.com/flash") { openURL(url) }
            }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.meshPlain)
            .foregroundStyle(MeshTheme.accent)
        }
        .padding(Design.Space.regular)
        .chatGlass(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    // MARK: - Script

    private func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !busy else { return }
        busy = true
        draft = ""
        sentSuggestions.insert(trimmed)
        let outgoing = DemoMessage(text: trimmed, isOutgoing: true, status: .sending, date: .now)
        messages.append(outgoing)
        Task { @MainActor in
            // Out through the repeater to Alex.
            packet = Packet(path: [.you, .ridge, .alex], start: .now, duration: reduceMotion ? 0.1 : 1.6)
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.3 : 1.7))
            // The acknowledgement comes back the same way.
            packet = Packet(path: [.alex, .ridge, .you], start: .now, duration: reduceMotion ? 0.1 : 1.2)
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.3 : 1.3))
            packet = nil
            if let index = messages.firstIndex(where: { $0.id == outgoing.id }) {
                messages[index].status = .delivered(String(localized: "Delivered · 2.9 s · via Ridge repeater"))
            }
            try? await Task.sleep(for: .seconds(0.6))
            isAlexTyping = true
            try? await Task.sleep(for: .seconds(1.8))
            packet = Packet(path: [.alex, .ridge, .you], start: .now, duration: reduceMotion ? 0.1 : 1.4)
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.3 : 1.5))
            packet = nil
            isAlexTyping = false
            messages.append(DemoMessage(
                text: answers[replies % answers.count],
                isOutgoing: false,
                status: .received(String(localized: "2 hops · via Ridge repeater")),
                date: .now
            ))
            replies += 1
            busy = false
        }
    }
}

// MARK: - Map

/// Where a simulated packet is, as it travels a path of demo nodes.
private struct Packet: Equatable {
    let path: [DemoNode]
    let start: Date
    let duration: TimeInterval
}

private enum DemoNode: CaseIterable {
    case you, ridge, alex, sam

    /// Unit-space position on the little map.
    var point: CGPoint {
        switch self {
        case .you: CGPoint(x: 0.14, y: 0.74)
        case .ridge: CGPoint(x: 0.48, y: 0.26)
        case .alex: CGPoint(x: 0.84, y: 0.62)
        case .sam: CGPoint(x: 0.9, y: 0.16)
        }
    }

    var title: String {
        switch self {
        case .you: String(localized: "You")
        case .ridge: String(localized: "Ridge repeater")
        case .alex: String(localized: "Alex · 3.1 km")
        case .sam: String(localized: "Sam · out of range")
        }
    }
}

/// A stylised trail map: contour lines, the trail, the nodes, the links that
/// can hear each other, and the packet in flight.
private struct DemoMeshMap: View {
    let packet: Packet?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: reduceMotion || packet == nil)) { context in
            Canvas { ctx, size in
                func at(_ node: DemoNode) -> CGPoint {
                    CGPoint(x: node.point.x * size.width, y: node.point.y * size.height)
                }
                // Contours, so it reads as terrain rather than a diagram.
                for ring in 1...5 {
                    let r = CGFloat(ring) * size.height * 0.14
                    let rect = CGRect(x: at(.ridge).x - r * 1.6, y: at(.ridge).y - r * 0.8, width: r * 3.2, height: r * 1.6)
                    ctx.stroke(Path(ellipseIn: rect), with: .color(MeshTheme.textSecondary.opacity(0.08)), lineWidth: 1)
                }
                // The trail.
                var trail = Path()
                trail.move(to: at(.you))
                trail.addCurve(to: at(.alex),
                               control1: CGPoint(x: size.width * 0.35, y: size.height * 1.05),
                               control2: CGPoint(x: size.width * 0.62, y: size.height * 0.2))
                ctx.stroke(trail, with: .color(MeshTheme.textSecondary.opacity(0.25)),
                           style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [2, 6]))
                // Radio links that work.
                for (a, b) in [(DemoNode.you, DemoNode.ridge), (.ridge, .alex)] {
                    var link = Path()
                    link.move(to: at(a))
                    link.addLine(to: at(b))
                    ctx.stroke(link, with: .color(MeshTheme.brandPink.opacity(0.35)), lineWidth: 1.5)
                }
                // The one that does not.
                var gap = Path()
                gap.move(to: at(.ridge))
                gap.addLine(to: at(.sam))
                ctx.stroke(gap, with: .color(MeshTheme.textSecondary.opacity(0.25)),
                           style: StrokeStyle(lineWidth: 1, dash: [3, 5]))
                // The packet.
                if let packet, packet.path.count > 1 {
                    let elapsed = context.date.timeIntervalSince(packet.start)
                    let progress = min(max(elapsed / packet.duration, 0), 1)
                    let segments = Double(packet.path.count - 1)
                    let position = progress * segments
                    let segment = min(Int(position), packet.path.count - 2)
                    let local = CGFloat(position - Double(segment))
                    let a = at(packet.path[segment]), b = at(packet.path[segment + 1])
                    let p = CGPoint(x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local)
                    let glow = Path(ellipseIn: CGRect(x: p.x - 12, y: p.y - 12, width: 24, height: 24))
                    ctx.fill(glow, with: .color(MeshTheme.brandPink.opacity(0.25)))
                    let dot = Path(ellipseIn: CGRect(x: p.x - 5, y: p.y - 5, width: 10, height: 10))
                    ctx.fill(dot, with: .color(MeshTheme.brandPink))
                }
            }
        }
        .overlay {
            GeometryReader { geo in
                ForEach(DemoNode.allCases, id: \.self) { node in
                    VStack(spacing: 4) {
                        orb(for: node)
                        Text(node.title)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(node == .sam ? MeshTheme.textSecondary : MeshTheme.textPrimary)
                            .fixedSize()
                    }
                    .opacity(node == .sam ? 0.6 : 1)
                    .position(x: node.point.x * geo.size.width, y: node.point.y * geo.size.height + 12)
                }
            }
        }
    }

    private func orb(for node: DemoNode) -> NodeOrb {
        switch node {
        case .you: NodeOrb(name: "You", size: 34)
        case .ridge: NodeOrb(seed: Data("Ridge repeater".utf8), title: "Ridge", symbol: "antenna.radiowaves.left.and.right", size: 34)
        case .alex: NodeOrb(name: "Alex", size: 34)
        case .sam: NodeOrb(name: "Sam", size: 30)
        }
    }
}

/// Three dots breathing in turn while the other side is writing.
private struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { dot in
                    let phase = (sin((t * 5) - Double(dot) * 0.7) + 1) / 2
                    Circle()
                        .fill(MeshTheme.textSecondary.opacity(0.35 + 0.5 * (reduceMotion ? 0.5 : phase)))
                        .frame(width: 8, height: 8)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
#endif
