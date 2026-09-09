import SwiftUI

/// A short introduction with scrollable content and a persistent action bar.
struct OnboardingView: View {
    enum Mode {
        case firstRun
        case replay
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var hasCompletedOnboarding: Bool
    var navigateToSettings: (() -> Void)? = nil
    var mode: Mode = .firstRun
    @State private var currentPage = 0
    #if os(iOS) || os(macOS)
    @State private var showDeck = false
    #endif
    private let lastPage = 3

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: Design.Space.loose) {
                    pageContent(containerHeight: geo.size.height)
                }
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(Design.Space.loose)
                .padding(.bottom, Design.Space.section)
                .transition(.opacity)
            }
            .id(currentPage)
            .scrollClipDisabled()
        }
        .background(MeshTheme.background)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                progressDots
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Step \(currentPage + 1) of \(lastPage + 1)")
                Spacer()
                if currentPage < lastPage {
                    Button { complete() } label: {
                        Text(mode == .replay ? "Close" : "Skip")
                            .font(.body.weight(.semibold))
                            .touchable()
                    }
                    .buttonStyle(.meshPlain)
                    .foregroundStyle(MeshTheme.textSecondary)
                    .accessibilityLabel(mode == .replay ? "Close welcome guide" : "Skip introduction")
                }
            }
            .padding(.horizontal, Design.Space.loose)
            .padding(.vertical, Design.Space.snug)
            .background(MeshTheme.background)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            navigationControls
                .padding(.horizontal, Design.Space.loose)
                .padding(.top, Design.Space.regular)
                .padding(.bottom, Design.Space.snug)
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
        .tint(MeshTheme.interactiveGreen)
        .meshAnimation(Design.Motion.quick, value: currentPage)
        #if os(iOS) || os(macOS)
        .sheet(isPresented: $showDeck) {
            NavigationStack {
                TDeckExperienceView()
                    .lilysharkSheet { showDeck = false }
            }
            .meshTheme()
        }
        #endif
    }

    @ViewBuilder
    private func pageContent(containerHeight: CGFloat) -> some View {
        switch currentPage {
        case 0:
            #if os(iOS) || os(macOS)
            TDeckHeroView()
                .frame(height: TDeckStage.height(
                    in: containerHeight,
                    accessibility: dynamicTypeSize.isAccessibilitySize,
                    fraction: 0.56
                ))
                .frame(maxWidth: .infinity)
                .padding(.horizontal, -Design.Space.loose)
            Text("Drag sideways to turn the deck")
                .font(Design.Text.label)
                .foregroundStyle(MeshTheme.textSecondary.opacity(0.85))
                .frame(maxWidth: .infinity)
                .accessibilityHidden(true)
            Button {
                showDeck = true
            } label: {
                Text("Look around the deck")
                    .font(.body.weight(.semibold))
                    .touchable()
            }
            .buttonStyle(.meshPlain)
            .foregroundStyle(MeshTheme.accent)
            .frame(maxWidth: .infinity)
            #else
            ZStack {
                MeshAnimationBackdrop()
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.largeTitle)
                    .foregroundStyle(MeshTheme.accent)
            }
            .frame(height: dynamicTypeSize.isAccessibilitySize ? 100 : 160)
            .accessibilityHidden(true)
            #endif
            pageTitle("Welcome to Lilyshark")
            paragraph("Message nearby people through your deck or radio, even without internet or cell service.")
        case 1:
            pageTitle("Connect your radio")
            paragraph("Use a Lilyshark deck or a MeshCore radio with Bluetooth enabled.")
            feature("Power on", symbol: "power", detail: "Keep the radio close to your phone.")
            feature("Choose your device", symbol: "antenna.radiowaves.left.and.right", detail: "Open Connect and select its name.")
            feature("Pair if asked", symbol: "lock", detail: "Enter the PIN displayed by your radio.")
            paragraph("Contacts and channels appear as the radio reports them.")
        case 2:
            pageTitle("Start a conversation")
            feature("Direct messages", symbol: "person", detail: "Choose a contact to send a message.")
            feature("Channels", symbol: "number", detail: "Share messages with people using the same channel.")
            feature("Delivery status", symbol: "checkmark.message", detail: "A send confirmation can come from your deck. It does not always confirm the recipient received your message.")
        default:
            pageTitle("Check your setup")
            paragraph("Choose the radio profile used by your local mesh. Nearby radios need compatible protocol and channel settings.")
            feature("Deck controls", symbol: "gearshape", detail: "Configure a Lilyshark deck on the deck itself. MeshCore radios also offer device controls in Settings.")
            feature("App preferences", symbol: "slider.horizontal.3", detail: "Open Settings for appearance, notifications, and your connected device.")
            #if !os(watchOS)
            if navigateToSettings != nil {
                Button {
                    complete()
                    navigateToSettings?()
                } label: {
                    Label("Open Settings", systemImage: "gearshape")
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshSecondary)
            }
            #endif
        }
    }

    private var progressDots: some View {
        HStack(spacing: Design.Space.tight) {
            ForEach(0...lastPage, id: \.self) { index in
                Capsule()
                    .fill(index == currentPage ? MeshTheme.accent : MeshTheme.textSecondary.opacity(0.28))
                    .frame(width: index == currentPage ? 22 : 8, height: 8)
            }
        }
        .meshAnimation(Design.Motion.quick, value: currentPage)
        .accessibilityHidden(true)
    }

    private func pageTitle(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.title2.weight(.semibold))
            .foregroundStyle(MeshTheme.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    private func paragraph(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(MeshTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func feature(_ title: LocalizedStringKey, symbol: String, detail: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Label(title, systemImage: symbol)
                .font(.headline)
                .foregroundStyle(MeshTheme.textPrimary)
            paragraph(detail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var navigationControls: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: Design.Space.tight) { navigationButtons }
            } else {
                HStack(spacing: Design.Space.regular) { navigationButtons }
            }
        }
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var navigationButtons: some View {
        if currentPage > 0 {
            Button {
                withMeshAnimation(reduceMotion: reduceMotion) { currentPage -= 1 }
            } label: {
                Text("Back")
                    .frame(maxWidth: .infinity)
                    .touchable()
            }
            .buttonStyle(.meshSecondary)
            .accessibilityLabel("Previous introduction page")
        }
        Button {
            if currentPage < lastPage {
                withMeshAnimation(reduceMotion: reduceMotion) { currentPage += 1 }
            } else {
                complete()
            }
        } label: {
            Text(currentPage < lastPage ? "Continue" : (mode == .replay ? "Done" : "Get Started"))
                .font(.headline)
                .frame(maxWidth: .infinity)
                .touchable()
        }
        .buttonStyle(.meshPrimary)
        .foregroundStyle(MeshTheme.textOnAccent)
        .accessibilityLabel(currentPage < lastPage ? "Next introduction page" : (mode == .replay ? "Close welcome guide" : "Get started with Lilyshark"))
    }

    private func complete() {
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
