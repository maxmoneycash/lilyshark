#if os(iOS) || os(macOS)
import SwiftUI

/// The disconnected home: an interactive T-Deck, a clear Connect action, and
/// a labelled demonstration of how Meshtastic floods versus MeshCore routes.
struct WelcomeHomeView: View {
    @Binding var showScanner: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var capabilityIndex = 0
    @State private var routingDemo = MeshRoutingDemoView.Mode.flood

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: Design.Space.loose) {
                    hero(stageHeight: TDeckStage.height(
                        in: geo.size.height,
                        accessibility: dynamicTypeSize.isAccessibilitySize,
                        fraction: 0.52
                    ))
                    header
                        .padding(.horizontal, Design.Space.loose)
                    connectSteps
                        .padding(.horizontal, Design.Space.loose)
                    capabilitiesSection
                        .padding(.horizontal, Design.Space.loose)
                    meshTutorial
                        .padding(.horizontal, Design.Space.loose)
                }
                .padding(.bottom, Design.Space.section)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            .contentMargins(.bottom, Design.Space.regular, for: .scrollContent)
        }
        .background(MeshTheme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            connectAction
                .padding(.horizontal, Design.Space.loose)
                .padding(.top, Design.Space.regular)
                .padding(.bottom, Design.Space.snug)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                .background {
                    LinearGradient(
                        colors: [MeshTheme.background.opacity(0), MeshTheme.background],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .padding(.top, -Design.Space.snug)
                    .allowsHitTesting(false)
                }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Design.Space.snug) {
            Text("Welcome to Lilyshark")
                .font(.title2.weight(.semibold))
                .foregroundStyle(MeshTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text("Off-grid messages, maps, and radio analysis. Pair a deck to begin — or explore it here first.")
                .font(.subheadline)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Interactive deck hero

    private func hero(stageHeight: CGFloat) -> some View {
        VStack(spacing: Design.Space.snug) {
            TDeckSceneView(
                screenFileName: Self.capabilities[capabilityIndex].screenFileName,
                pageOnVerticalDrag: false
            )
            .frame(height: stageHeight)
            .frame(maxWidth: .infinity)
            .padding(.top, -Design.Space.tight)
            .task(id: reduceMotion) {
                await autoAdvanceCapabilities()
            }
            Text("Drag sideways to turn the deck")
                .font(Design.Text.label)
                .foregroundStyle(MeshTheme.textSecondary.opacity(0.85))
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Design.Space.loose)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
    }

    private func advanceCapability(by delta: Int) {
        let count = Self.capabilities.count
        guard count > 0 else { return }
        withMeshAnimation(reduceMotion: reduceMotion) {
            capabilityIndex = (capabilityIndex + delta + count) % count
        }
    }

    /// Same idle cycling as TDeckHeroView, but it moves the capability cards
    /// too, so the copy under the model always matches the screen on its LCD.
    private func autoAdvanceCapabilities() async {
        guard !reduceMotion, Self.capabilities.count > 1 else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            guard !Task.isCancelled else { return }
            advanceCapability(by: 1)
        }
    }

    // MARK: - Connect

    private var connectAction: some View {
        Button {
            showScanner = true
        } label: {
            Label("Connect a Deck", systemImage: "antenna.radiowaves.left.and.right")
                .frame(maxWidth: .infinity)
                .touchable()
        }
        .buttonStyle(.meshPrimary)
        .foregroundStyle(MeshTheme.textOnAccent)
        .sensoryFeedback(.impact(weight: .light), trigger: showScanner)
        .accessibilityHint("Scans for nearby decks and radios")
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
    }

    private struct ConnectStep: Identifiable {
        let number: Int
        let symbol: String
        let title: String
        let detail: String
        var id: Int { number }
    }

    private static let steps: [ConnectStep] = [
        ConnectStep(number: 1, symbol: "power", title: "Power on the deck", detail: "Keep the deck or radio close to this device."),
        ConnectStep(number: 2, symbol: "hand.tap", title: "Tap Connect a Deck", detail: "The scanner lists every mesh device it can hear."),
        ConnectStep(number: 3, symbol: "lock", title: "Choose it and enter the PIN", detail: "The radio shows its PIN on its own screen."),
    ]

    private var connectSteps: some View {
        VStack(alignment: .leading, spacing: Design.Space.snug) {
            sectionHeader("Connect in three steps")
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: Design.Space.regular) {
                    ForEach(Self.steps) { step in
                        stepCard(step)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                VStack(alignment: .leading, spacing: Design.Space.regular) {
                    ForEach(Self.steps) { step in
                        stepCard(step)
                    }
                }
            }
        }
    }

    private func stepCard(_ step: ConnectStep) -> some View {
        HStack(alignment: .top, spacing: Design.Space.snug) {
            ZStack {
                Circle()
                    .fill(MeshTheme.accent.opacity(0.15))
                Text(verbatim: "\(step.number)")
                    .font(Design.Text.label.weight(.semibold))
                    .foregroundStyle(MeshTheme.accent)
            }
            .frame(width: 28, height: 28)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Label(step.title, systemImage: step.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MeshTheme.textPrimary)
                Text(step.detail)
                    .font(Design.Text.detail)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Capabilities

    private struct DeckCapability: Identifiable {
        let screenFileName: String
        let symbol: String
        let title: String
        let detail: String
        var id: String { screenFileName }
    }

    private static let capabilities: [DeckCapability] = [
        DeckCapability(screenFileName: "home", symbol: "bubble.left.and.bubble.right",
                       title: "Messages",
                       detail: "Text the mesh from the deck or the phone — no cell service needed."),
        DeckCapability(screenFileName: "map", symbol: "map",
                       title: "Mesh map",
                       detail: "Positions of the nodes your radio has actually heard."),
        DeckCapability(screenFileName: "traffic-live", symbol: "antenna.radiowaves.left.and.right",
                       title: "Live traffic",
                       detail: "Frames decoded as they arrive, with protocol and RF fields."),
        DeckCapability(screenFileName: "spectrum-live", symbol: "waveform",
                       title: "Live spectrum",
                       detail: "A waterfall of the band: noise floor, occupancy, busy warnings."),
        DeckCapability(screenFileName: "survey", symbol: "figure.walk",
                       title: "Coverage survey",
                       detail: "Capture coverage on a walk or drive to see where the mesh reaches."),
    ]

    private var capabilitiesSection: some View {
        VStack(alignment: .leading, spacing: Design.Space.snug) {
            sectionHeader("What it can do")
            Text("Tap a card to see that screen on the deck above.")
                .font(Design.Text.detail)
                .foregroundStyle(MeshTheme.textSecondary)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: Design.Space.snug) {
                    ForEach(Array(Self.capabilities.enumerated()), id: \.element.id) { index, capability in
                        capabilityCard(capability, index: index)
                    }
                }
                .padding(Design.Space.hairline)
            }
            .scrollIndicators(.hidden)
            .sensoryFeedback(.selection, trigger: capabilityIndex)
        }
    }

    private func capabilityCard(_ capability: DeckCapability, index: Int) -> some View {
        let selected = index == capabilityIndex
        return Button {
            withMeshAnimation(reduceMotion: reduceMotion) { capabilityIndex = index }
        } label: {
            VStack(alignment: .leading, spacing: Design.Space.tight) {
                Image(systemName: capability.symbol)
                    .font(.title3)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(selected ? MeshTheme.accent : MeshTheme.textSecondary)
                    .accessibilityHidden(true)
                Text(capability.title)
                    .font(.headline)
                    .foregroundStyle(MeshTheme.textPrimary)
                Text(capability.detail)
                    .font(Design.Text.detail)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Design.Space.regular)
            .padding(.bottom, Design.Space.tight)
            .frame(width: 200, alignment: .topLeading)
            .background(
                selected ? MeshTheme.accent.opacity(0.14) : MeshTheme.surface,
                in: RoundedRectangle(cornerRadius: Design.Radius.card, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Design.Radius.card, style: .continuous)
                    .strokeBorder(selected ? MeshTheme.accent.opacity(0.35) : Color.clear, lineWidth: 1)
            }
            .touchable()
        }
        .buttonStyle(.pressable)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: - How the mesh works

    private var meshTutorial: some View {
        VStack(alignment: .leading, spacing: Design.Space.snug) {
            sectionHeader("How the mesh works")
            Text("Two mesh stacks, two ways to move a packet. Watch the pulse:")
                .font(.body)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Picker("Routing strategy", selection: $routingDemo) {
                ForEach(MeshRoutingDemoView.Mode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            MeshRoutingDemoView(mode: routingDemo)
                .frame(height: 220)
                .frame(maxWidth: .infinity)
                .background(
                    MeshTheme.surface,
                    in: RoundedRectangle(cornerRadius: Design.Radius.card, style: .continuous)
                )
                .overlay(alignment: .topTrailing) {
                    demoBadge
                        .padding(Design.Space.tight)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Demonstration of \(routingDemo.accessibilitySummary)")
            Text(routingDemo.explanation)
                .font(Design.Text.detail)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .meshAnimation(Design.Motion.quick, value: routingDemo)
    }

    /// The demo draws simplified nodes, hop counts, and timing; the badge keeps
    /// anyone from mistaking it for a live capture.
    private var demoBadge: some View {
        Text("ILLUSTRATIVE DEMO")
            .font(Design.Text.label.weight(.semibold))
            .tracking(1.2)
            .foregroundStyle(MeshTheme.textSecondary)
            .padding(.horizontal, Design.Space.tight)
            .padding(.vertical, Design.Space.hairline)
            .background(MeshTheme.surfaceLight, in: Capsule())
    }

    private func sectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.title3.weight(.semibold))
            .foregroundStyle(MeshTheme.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A packet hopping node to node for the welcome tutorial's routing demo.
///
/// The scene is schematic by design — seven fixed nodes, a four-second cycle,
/// no radio math — and the host view badges it "ILLUSTRATIVE DEMO". Reduce
/// Motion freezes it on a mid-flight frame, so the routes are still readable
/// as a static diagram rather than disappearing.
struct MeshRoutingDemoView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case flood
        case routed

        var id: String { rawValue }

        var title: String {
            switch self {
            case .flood: return String(localized: "Meshtastic · Flood")
            case .routed: return String(localized: "MeshCore · Routed")
            }
        }

        var explanation: String {
            switch self {
            case .flood:
                return String(localized: "Meshtastic floods: every node that hears a packet repeats it. Simple and resilient, but one message becomes many transmissions — about seven per delivered message in measured captures — and reach drops as the mesh grows.")
            case .routed:
                return String(localized: "MeshCore routes: the path is discovered up front, then packets follow only that route — up to 64 hops — and a delivery receipt travels back along it. Lilyshark decks speak Meshtastic; MeshCore radios also expose radio settings and remote management.")
            }
        }

        var accessibilitySummary: String {
            switch self {
            case .flood:
                return String(localized: "Meshtastic flood routing, where a packet is rebroadcast by every node until it reaches the destination.")
            case .routed:
                return String(localized: "MeshCore source routing, where a packet follows a single discovered path and returns a delivery receipt.")
            }
        }
    }

    let mode: Mode

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Link: Hashable {
        let a: Int
        let b: Int
        /// Flood waves fire in sequence; the route demo ignores this.
        let wave: Int
    }

    /// Unit-space node positions: 0 is "you", last is the peer.
    private static let nodes: [CGPoint] = [
        CGPoint(x: 0.10, y: 0.50),
        CGPoint(x: 0.30, y: 0.20),
        CGPoint(x: 0.32, y: 0.80),
        CGPoint(x: 0.54, y: 0.50),
        CGPoint(x: 0.74, y: 0.22),
        CGPoint(x: 0.76, y: 0.76),
        CGPoint(x: 0.92, y: 0.50),
    ]

    private static let labels = ["You", "", "", "", "", "", "Peer"]

    private static let floodLinks: [Link] = [
        Link(a: 0, b: 1, wave: 0), Link(a: 0, b: 2, wave: 0),
        Link(a: 1, b: 3, wave: 1), Link(a: 1, b: 4, wave: 1),
        Link(a: 2, b: 3, wave: 1), Link(a: 2, b: 5, wave: 1),
        Link(a: 3, b: 6, wave: 2), Link(a: 4, b: 6, wave: 2),
        Link(a: 5, b: 6, wave: 2), Link(a: 3, b: 4, wave: 2),
        Link(a: 3, b: 5, wave: 2),
    ]

    private static let route: [Int] = [0, 2, 5, 6]

    private static let allLinks: [Link] = floodLinks

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            Canvas { ctx, size in
                let cycle = 4.0
                let progress = reduceMotion
                    ? 0.36
                    : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle

                func point(_ index: Int) -> CGPoint {
                    CGPoint(x: Self.nodes[index].x * size.width, y: Self.nodes[index].y * size.height)
                }

                func stroke(_ from: Int, _ to: Int, color: Color, width: CGFloat = 1) {
                    var path = Path()
                    path.move(to: point(from))
                    path.addLine(to: point(to))
                    ctx.stroke(path, with: .color(color), lineWidth: width)
                }

                func pulse(_ from: Int, _ to: Int, at fraction: Double, color: Color) {
                    let a = point(from)
                    let b = point(to)
                    let f = CGFloat(min(max(fraction, 0), 1))
                    let center = CGPoint(x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f)
                    let dot = Path(ellipseIn: CGRect(x: center.x - 4, y: center.y - 4, width: 8, height: 8))
                    ctx.fill(dot, with: .color(color))
                }

                for link in Self.allLinks {
                    stroke(link.a, link.b, color: MeshTheme.textSecondary.opacity(0.25))
                }

                switch mode {
                case .flood:
                    for link in Self.floodLinks {
                        let start = 0.05 + Double(link.wave) * 0.22
                        let local = (progress - start) / 0.18
                        guard local > 0, local < 1 else { continue }
                        stroke(link.a, link.b, color: MeshTheme.accent.opacity(0.55), width: 1.5)
                        pulse(link.a, link.b, at: local, color: MeshTheme.accent)
                    }
                case .routed:
                    for hop in 0..<(Self.route.count - 1) {
                        stroke(Self.route[hop], Self.route[hop + 1], color: MeshTheme.interactiveGreen.opacity(0.6), width: 1.5)
                    }
                    let hopDuration = 0.18
                    let hops = Self.route.count - 1
                    let outboundStart = 0.06
                    let inboundStart = 0.64
                    if progress >= outboundStart, progress < outboundStart + Double(hops) * hopDuration {
                        let hop = min(hops - 1, Int((progress - outboundStart) / hopDuration))
                        let local = (progress - outboundStart - Double(hop) * hopDuration) / hopDuration
                        pulse(Self.route[hop], Self.route[hop + 1], at: local, color: MeshTheme.interactiveGreen)
                    } else if progress >= inboundStart, progress < inboundStart + Double(hops) * hopDuration {
                        let hop = min(hops - 1, Int((progress - inboundStart) / hopDuration))
                        let local = (progress - inboundStart - Double(hop) * hopDuration) / hopDuration
                        pulse(Self.route[hops - hop], Self.route[hops - hop - 1], at: local, color: MeshTheme.textPrimary)
                    }
                }

                for index in Self.nodes.indices {
                    let center = point(index)
                    let dot = Path(ellipseIn: CGRect(x: center.x - 6, y: center.y - 6, width: 12, height: 12))
                    let color: Color = switch index {
                    case 0: MeshTheme.interactiveGreen
                    case Self.nodes.count - 1: MeshTheme.accent
                    default: MeshTheme.textSecondary.opacity(0.6)
                    }
                    ctx.fill(dot, with: .color(color))
                    let label = Self.labels[index]
                    if !label.isEmpty {
                        ctx.draw(
                            Text(label)
                                .font(Design.Text.label.weight(.semibold))
                                .foregroundStyle(color),
                            at: CGPoint(x: center.x, y: center.y + 16)
                        )
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}

#Preview("Welcome home") {
    @Previewable @State var showScanner = false
    NavigationStack {
        WelcomeHomeView(showScanner: $showScanner)
            .lilysharkNavigationTitle()
    }
    .meshTheme()
}
#endif
