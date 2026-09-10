#if os(iOS) || os(macOS)
import SwiftUI

/// The disconnected home: an interactive T-Deck, and the narrative
/// copy matched identically to lilyshark.com.
struct WelcomeHomeView: View {
    @Binding var showScanner: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var visibleSectionIndex = 0
    @State private var routingDemo = MeshRoutingDemoView.Mode.flood

    struct WelcomeSection: Identifiable {
        let id = UUID()
        let headline: String
        let body: String
        let screens: [String]
    }

    let sections: [WelcomeSection] = [
        WelcomeSection(
            headline: "Turn a $60 handheld into a LoRa packet sniffer.",
            body: "Lilyshark is C++ firmware that turns the LILYGO T-Deck Plus — a $60 handheld with a LoRa radio, QWERTY keyboard and GPS — into a packet sniffer and RF analyzer for off-grid mesh networks.",
            screens: ["splash", "home"]
        ),
        WelcomeSection(
            headline: "Mesh networks already carry hundreds of thousands of users.",
            body: "Meshtastic passed 40,000 GitHub stars and an 80,000-member subreddit, with 100+ supported boards, sub-$50 entry devices, and active meshes in most major US cities. When India ordered a mesh app off GitHub during the Delhi protests, it was carrying 430,000 daily users — and stayed up.",
            screens: ["traffic", "traffic-live", "protocols", "protocol-detail", "nodes"]
        ),
        WelcomeSection(
            headline: "LoRa carries kilometers per hop, not meters.",
            body: "Bluetooth mesh dies at 30–300 m — it works at a protest because a protest is a crowd. LoRa carries 2–15 km per hop, across a city, a county, a disaster zone; MeshCore's source routing now spans 64 hops with deterministic delivery receipts.",
            screens: ["map", "node-detail", "survey"]
        ),
        WelcomeSection(
            headline: "Flooded meshes deliver less as they grow. We measured it.",
            body: "A LongFast channel moves about 987 bit/s and flood routing repeats everything: we measured 7.36 transmissions per delivered message, reach collapsing from 68.6% to 25.8% as the mesh grows, saturation near 6,721 nodes. Growth is exactly what breaks it.",
            screens: ["utilization", "timeline", "timeline-live", "traffic-filter"]
        ),
        WelcomeSection(
            headline: "The firmware measures everything the radio hears.",
            body: "So we built the instrument: a live spectrum waterfall with noise floor and channel occupancy, node rosters with SNR, RSSI and hop-count history, survey mode for coverage runs, and every frame kept with its radio physics.",
            screens: ["spectrum", "spectrum-live", "spectrum-warning"]
        ),
        WelcomeSection(
            headline: "Every anomaly becomes a logged event.",
            body: "CRC failures, profile changes, storage faults, capture starts and stops — the firmware keeps a running event log with one-line causes, and each entry opens into its own detail screen. When something went wrong in the field, you can read back exactly when and why.",
            screens: ["events", "event-detail"]
        ),
        WelcomeSection(
            headline: "Three mesh protocols, one capture engine.",
            body: "Meshtastic, MeshCore and Reticulum share one capture engine. Each decoder claims only what it can prove from the frame: packet fields, RF measurements and decode state are separate tabs on the same packet, so interpretation never overwrites measurement.",
            screens: ["packet-detail", "packet-live", "packet-pkt", "packet-rf", "packet-dec"]
        ),
        WelcomeSection(
            headline: "Down to the last byte.",
            body: "What a decoder cannot prove stays as raw hex with frequency, bandwidth, SF, CR, CRC state and airtime. Captures write to microSD as .lscap and export as LoRaTap PCAP — desktop Wireshark opens them.",
            screens: ["packet-hex", "packet-hex-2", "packet-hex-3", "packet-raw"]
        ),
        WelcomeSection(
            headline: "A guided first run, not a config file.",
            body: "The device explains its tools, checks what hardware it is running on, and walks a first-time user through network and radio-profile selection before the Home screen ever appears. No companion app, no serial console, no YAML.",
            screens: ["setup-welcome", "setup-capabilities", "setup-network", "setup-profile"]
        ),
        WelcomeSection(
            headline: "It teaches its own controls.",
            body: "The trackball, keyboard and shortcuts are taught on the device, the hardware check reports radio, storage, GPS and battery, and Help stays one keypress away. A field tool has to work where the manual is whatever the screen says.",
            screens: ["setup-controls", "setup-ready", "device-status", "help"]
        ),
        WelcomeSection(
            headline: "Every control lives on the device.",
            body: "Radio profiles, display and input, capture and storage, setup reset — all of it adjustable from the T-Deck itself. Change a spreading factor at the trailhead without opening a laptop.",
            screens: ["settings", "radio-profile", "display-input", "about", "reset-setup"]
        ),
        WelcomeSection(
            headline: "Captures are stored on Shelby; the mesh carries an 82-byte pointer.",
            body: "Captures are evidence, so they live in Shelby's content-addressed storage on Aptos. A radio has no uplink — it broadcasts an 82-byte pointer instead, and any connected node resolves the bytes. Radio-frequency capture meets verifiable storage for the first time.",
            screens: ["storage"]
        )
    ]

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                LazyVStack(spacing: Design.Space.section, pinnedViews: [.sectionHeaders]) {
                    Section {
                        // The scrolling sections
                        ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                            VStack(alignment: .leading, spacing: Design.Space.snug) {
                                Text(section.headline)
                                    .font(.title2.weight(.semibold))
                                    .foregroundStyle(MeshTheme.textPrimary)
                                
                                Text(section.body)
                                    .font(.subheadline)
                                    .lineSpacing(4)
                                    .foregroundStyle(MeshTheme.textSecondary)

                                // Inject mesh demo into the routing/flooding sections
                                if index == 2 || index == 3 {
                                    meshTutorial
                                        .padding(.top, Design.Space.regular)
                                }
                            }
                            .padding(.horizontal, Design.Space.loose)
                            .frame(maxWidth: 640, alignment: .leading)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Design.Space.loose)
                            .onAppear {
                                withMeshAnimation(reduceMotion: reduceMotion) {
                                    visibleSectionIndex = index
                                }
                            }
                        }
                    } header: {
                        // Pinned 3D model
                        hero(stageHeight: TDeckStage.height(
                            in: geo.size.height,
                            accessibility: dynamicTypeSize.isAccessibilitySize,
                            fraction: 0.50
                        ))
                        .background(MeshTheme.background)
                    }
                }
                .padding(.bottom, Design.Space.section)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
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

    // MARK: - Interactive deck hero

    private func hero(stageHeight: CGFloat) -> some View {
        let currentScreen = sections[visibleSectionIndex].screens.first ?? "home"
        
        return VStack(spacing: 0) {
            TDeckSceneView(
                screenFileName: currentScreen,
                pageOnVerticalDrag: false
            )
            .frame(height: stageHeight)
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Connect

    private var connectAction: some View {
        Button {
            showScanner = true
        } label: {
            Label("Connect a Radio", systemImage: "antenna.radiowaves.left.and.right")
                .frame(maxWidth: .infinity)
                .touchable()
        }
        .buttonStyle(.meshPrimary)
        .foregroundStyle(MeshTheme.textOnAccent)
        .sensoryFeedback(.impact(weight: .light), trigger: showScanner)
        .accessibilityHint("Scans for nearby decks and radios")
    }

    // MARK: - How the mesh works

    private var meshTutorial: some View {
        VStack(alignment: .leading, spacing: Design.Space.snug) {
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
                    Text("ILLUSTRATIVE DEMO")
                        .font(Design.Text.label.weight(.semibold))
                        .tracking(1.2)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .padding(.horizontal, Design.Space.tight)
                        .padding(.vertical, Design.Space.hairline)
                        .background(MeshTheme.surfaceLight, in: Capsule())
                        .padding(Design.Space.tight)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Demonstration of \(routingDemo.accessibilitySummary)")
        }
        .meshAnimation(Design.Motion.quick, value: routingDemo)
    }
}

/// A packet hopping node to node for the welcome tutorial's routing demo.
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
