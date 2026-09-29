import SwiftUI

/// The first screen anyone sees.
///
/// It used to be four pages of text about PINs and radio profiles. A first
/// screen has one job: say what this is for, in words a person without a
/// radio would use, and put the two next steps under their thumb. Connect a
/// deck, or feel what it does in the demo. Everything else the old pages
/// explained is now said where it happens, in the connect flow itself.
struct OnboardingView: View {
    enum Mode {
        case firstRun
        case replay
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.openURL) private var openURL
    @Binding var hasCompletedOnboarding: Bool
    var navigateToSettings: (() -> Void)? = nil
    var mode: Mode = .firstRun
    /// What the app opens once it is showing: "connect" or "demo". ContentView
    /// reads and clears it, because this screen is shown before the stores the
    /// connect flow needs exist.
    @AppStorage("afterOnboarding") private var afterOnboarding = ""

    private let useCases: [(symbol: String, title: LocalizedStringKey, detail: LocalizedStringKey)] = [
        ("mountain.2.fill", "Off the grid", "Stay in touch on trails, at sea and in the backcountry, where there are no bars."),
        ("person.3.fill", "In a crowd", "Find your group when festival and stadium networks jam."),
        ("bolt.slash.fill", "When the network is down", "Keep talking through outages and storms. The mesh has no towers to lose."),
    ]

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: Design.Space.loose) {
                    #if os(iOS) || os(macOS)
                    TDeckHeroView()
                        .frame(height: TDeckStage.height(
                            in: geo.size.height,
                            accessibility: dynamicTypeSize.isAccessibilitySize,
                            fraction: 0.42
                        ))
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, -Design.Space.loose)
                    #endif
                    VStack(spacing: Design.Space.snug) {
                        Text("Talk to the mesh around you")
                            .font(.largeTitle.weight(.bold))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(MeshTheme.textPrimary)
                            .accessibilityAddTraits(.isHeader)
                        Text("Pair your iPhone with a T-Deck and message people kilometres away. No cell service, no internet, no account.")
                            .font(.body)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    VStack(spacing: Design.Space.tight) {
                        ForEach(useCases, id: \.symbol) { useCase in
                            HStack(alignment: .top, spacing: Design.Space.regular) {
                                Image(systemName: useCase.symbol)
                                    .font(.title3.weight(.semibold))
                                    .foregroundStyle(MeshTheme.accent)
                                    .frame(width: 32)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(useCase.title)
                                        .font(.headline)
                                        .foregroundStyle(MeshTheme.textPrimary)
                                    Text(useCase.detail)
                                        .font(.subheadline)
                                        .foregroundStyle(MeshTheme.textSecondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(Design.Space.regular)
                            .chatGlass(RoundedRectangle(cornerRadius: 22, style: .continuous))
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Design.Space.loose)
                .padding(.bottom, Design.Space.section)
            }
            .scrollClipDisabled()
        }
        .background(MeshTheme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            actions
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Design.Space.loose)
                .padding(.top, Design.Space.regular)
                .padding(.bottom, Design.Space.snug)
                .background {
                    ChatFadeEdge(edge: .bottom, height: 200)
                        .ignoresSafeArea(edges: .bottom)
                }
        }
        .overlay(alignment: .topTrailing) {
            if mode == .replay {
                Button { dismiss() } label: {
                    GlassCircleLabel(systemImage: "xmark", size: Design.minimumTouchTarget)
                }
                .buttonStyle(.pressable)
                .padding(Design.Space.regular)
                .accessibilityLabel("Close welcome")
            }
        }
    }

    private var actions: some View {
        VStack(spacing: Design.Space.snug) {
            Button { choose("connect") } label: {
                Label("Connect my T-Deck", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .touchable()
            }
            .buttonStyle(.meshPrimary)
            .accessibilityHint("Turns on Bluetooth and looks for your deck")
            Button { choose("demo") } label: {
                Label("Explore the demo", systemImage: "play.circle")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .touchable()
            }
            .buttonStyle(.meshSecondary)
            .accessibilityHint("Shows a simulated mesh. No radio needed.")
            Button("No T-Deck yet? Put Lilyshark on one") {
                if let url = URL(string: "https://lilyshark.com/flash") { openURL(url) }
            }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.meshPlain)
            .foregroundStyle(MeshTheme.accent)
        }
    }

    private func choose(_ next: String) {
        afterOnboarding = next
        if mode == .replay {
            dismiss()
            return
        }
        withMeshAnimation(reduceMotion: reduceMotion) { hasCompletedOnboarding = true }
    }
}

// MARK: - Mesh Animation

/// A quiet particle mesh behind the welcome page: nodes drift on slow
/// elliptical orbits and link up whenever they come within range, the same
/// way the radios do. Deterministic seeds keep the scene calm and identical
/// on every launch; Reduce Motion freezes it to a still constellation.
struct MeshAnimationBackdrop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Node {
        let cx: CGFloat, cy: CGFloat   // orbit center, unit space
        let rx: CGFloat, ry: CGFloat   // orbit radii
        let speed: Double, phase: Double
    }

    private struct SeededGenerator: RandomNumberGenerator {
        var state: UInt64
        init(seed: UInt64) { state = seed }
        mutating func next() -> UInt64 {
            state ^= state << 13
            state ^= state >> 7
            state ^= state << 17
            return state
        }
    }

    private static let nodes: [Node] = {
        var generator = SeededGenerator(seed: 0x5EED)
        return (0..<14).map { _ in
            Node(
                cx: CGFloat.random(in: 0.08...0.92, using: &generator),
                cy: CGFloat.random(in: 0.10...0.90, using: &generator),
                rx: CGFloat.random(in: 0.02...0.07, using: &generator),
                ry: CGFloat.random(in: 0.02...0.07, using: &generator),
                speed: Double.random(in: 0.15...0.45, using: &generator),
                phase: Double.random(in: 0...(2 * .pi), using: &generator)
            )
        }
    }()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            Canvas { ctx, size in
                let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
                let points: [CGPoint] = Self.nodes.map { node in
                    CGPoint(
                        x: (node.cx + node.rx * CGFloat(cos(t * node.speed + node.phase))) * size.width,
                        y: (node.cy + node.ry * CGFloat(sin(t * node.speed * 0.8 + node.phase))) * size.height
                    )
                }
                let linkRange = min(size.width, size.height) * 0.42
                for i in points.indices {
                    for j in points.indices where j > i {
                        let dx = points[i].x - points[j].x
                        let dy = points[i].y - points[j].y
                        let dist = (dx * dx + dy * dy).squareRoot()
                        guard dist < linkRange else { continue }
                        var line = Path()
                        line.move(to: points[i])
                        line.addLine(to: points[j])
                        let fade = 1 - dist / linkRange
                        ctx.stroke(
                            line,
                            with: .color(MeshTheme.accent.opacity(0.10 + 0.25 * fade)),
                            lineWidth: 1
                        )
                    }
                }
                for p in points {
                    let dot = Path(ellipseIn: CGRect(x: p.x - 2.5, y: p.y - 2.5, width: 5, height: 5))
                    ctx.fill(dot, with: .color(MeshTheme.accent.opacity(0.8)))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
