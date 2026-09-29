//
//  GlassChat.swift
//  Lilyshark
//
//  The chat's Liquid Glass surfaces: message bubbles, the floating composer's
//  glass, and the glass marbles that stand in for portraits.
//
//  The design is ported from Appllama's liquid-glass-chat-ui (MIT), Cookbook 2
//  "Astra": https://github.com/Appllama/liquid-glass-chat-ui. That project is
//  React Native, so none of its code is here. What carries over are its
//  measured numbers (bubble radii, padding, tints, springs), quoted where they
//  are used so anyone can check them against the source.
//
//  Two things differ on purpose:
//
//    - Astra's people have photographs. Mesh nodes do not, so a node is a
//      glass marble tinted from its public key: the same colour on every launch
//      and every phone, and different for two nodes that happen to share a name.
//    - Astra is monochrome with a blue unread dot. This app is light with a
//      pink mark, so outgoing glass and the unread dot are pink.
//
//  Liquid Glass arrived in iOS 26 and the app still supports iOS 18, so every
//  surface goes through `chatGlass`, which falls back to a frosted material in
//  the same shape and tint. An iOS 18 phone keeps the layout and the motion and
//  loses only the refraction.
//

import SwiftUI

// MARK: - Tuning

enum ChatGlass {
    /// Astra's bubble radius is 27, with the lower corner on the sender's side
    /// cut to 15 so a bubble reads as coming from that side.
    static let bubbleRadius: CGFloat = 27
    static let tailRadius: CGFloat = 15

    /// Astra pads 18 x 14 around 16pt text. Message text here is .body (17pt
    /// at the default size) because the messages were asked to be bigger, so
    /// the vertical padding gives back a point to keep a one-line bubble the
    /// same height.
    static let bubblePadding = EdgeInsets(top: 13, leading: 18, bottom: 13, trailing: 18)

    /// Astra caps a bubble at 70% of the screen width. The gutter on the far
    /// side is what enforces it here, so it scales with the screen.
    static let farSideGutter: CGFloat = 56

    /// Space between two messages in one run, and after a run ends. Astra
    /// spaces every message 14 apart; a run is tighter so it reads as one turn.
    static let runSpacing: CGFloat = 4
    static let groupSpacing: CGFloat = 14

    /// A run is broken by a pause this long as well as by a change of sender.
    static let runBreak: TimeInterval = 5 * 60

    /// The small portrait beside an incoming run. Astra: 25pt.
    static let bubbleOrb: CGFloat = 26

    /// Outgoing glass is the brand pink, thin enough that black text on it
    /// keeps nearly the contrast of text on white. Astra's is a slate at 17%.
    static var outgoingTint: Color { MeshTheme.brandPink.opacity(0.17) }
    /// Incoming glass is whiter than the page, so the bubble lifts off it.
    static let incomingTint = Color.white.opacity(0.62)

    /// Astra's shadow under a bubble is y 5, blur 15, #2A373C. Its 3% is too
    /// faint to survive the lighter page here, so this is 6%.
    static let bubbleShadow = Color(red: 0.165, green: 0.216, blue: 0.235).opacity(0.06)

    /// Astra's arrival spring: damping 23, stiffness 245, mass 0.7.
    static let arrival = Animation.interpolatingSpring(mass: 0.7, stiffness: 245, damping: 23)
    /// Astra's snap spring (damping 26, stiffness 270, mass 0.9), for a
    /// control settling after a press.
    static let snap = Animation.interpolatingSpring(mass: 0.9, stiffness: 270, damping: 26)
}

// MARK: - Glass

enum ChatGlassStyle {
    /// Frosted: for fields and panels whose content must stay readable over
    /// whatever scrolls beneath.
    case regular
    /// Clear: for bubbles and round buttons, which carry their own tint.
    case clear
}

extension View {
    /// Put this view on glass of `shape`.
    ///
    /// On iOS 26 and later this is Apple's Liquid Glass. Before that it is the
    /// regular material with the same tint and a hairline rim, so the shape
    /// and colour survive and only the lensing is lost.
    @ViewBuilder
    func chatGlass<S: Shape>(
        _ shape: S,
        style: ChatGlassStyle = .regular,
        tint: Color? = nil,
        interactive: Bool = false
    ) -> some View {
        if #available(iOS 26.0, macOS 26.0, watchOS 26.0, *) {
            glassEffect(
                (style == .clear ? Glass.clear : Glass.regular).tint(tint).interactive(interactive),
                in: shape
            )
        } else {
            background {
                ZStack {
                    shape.fill(.regularMaterial)
                    if let tint { shape.fill(tint) }
                }
            }
            .overlay { shape.stroke(Color.white.opacity(0.7), lineWidth: 0.5) }
        }
    }

    /// The glass a message sits on.
    func chatBubble(isOutgoing: Bool) -> some View {
        font(Design.Text.message)
            .foregroundStyle(MeshTheme.textPrimary)
            .padding(ChatGlass.bubblePadding)
            .chatGlass(
                ChatBubbleShape(isOutgoing: isOutgoing),
                style: .clear,
                tint: isOutgoing ? ChatGlass.outgoingTint : ChatGlass.incomingTint,
                interactive: true
            )
            .shadow(color: ChatGlass.bubbleShadow, radius: 7.5, y: 5)
    }
}

/// Lets neighbouring glass shapes blend into each other on iOS 26, the way the
/// composer's field and send button do in Astra. A plain container before that.
struct ChatGlassContainer<Content: View>: View {
    var spacing: CGFloat
    @ViewBuilder var content: Content

    var body: some View {
        if #available(iOS 26.0, macOS 26.0, watchOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

/// A bubble with its sender-side lower corner tightened.
struct ChatBubbleShape: Shape {
    let isOutgoing: Bool

    func path(in rect: CGRect) -> Path {
        UnevenRoundedRectangle(
            topLeadingRadius: ChatGlass.bubbleRadius,
            bottomLeadingRadius: isOutgoing ? ChatGlass.bubbleRadius : ChatGlass.tailRadius,
            bottomTrailingRadius: isOutgoing ? ChatGlass.tailRadius : ChatGlass.bubbleRadius,
            topTrailingRadius: ChatGlass.bubbleRadius,
            style: .continuous
        )
        .path(in: rect)
    }
}

// MARK: - Arrival

/// Astra's arrival: a new message rises 36pt and grows from 86% of its width
/// and 78% of its height, settling on the arrival spring. It is used only as
/// an insertion transition, so opening a conversation never replays it; only
/// a message that turns up while you are looking does.
private struct BubbleArrival: ViewModifier {
    let progress: CGFloat
    let isOutgoing: Bool

    func body(content: Content) -> some View {
        content
            .scaleEffect(
                x: 0.86 + 0.14 * progress,
                y: 0.78 + 0.22 * progress,
                anchor: isOutgoing ? .bottomTrailing : .bottomLeading
            )
            .offset(y: (1 - progress) * 36)
    }
}

extension AnyTransition {
    static func bubbleArrival(isOutgoing: Bool) -> AnyTransition {
        .asymmetric(
            insertion: .modifier(
                active: BubbleArrival(progress: 0, isOutgoing: isOutgoing),
                identity: BubbleArrival(progress: 1, isOutgoing: isOutgoing)
            ),
            removal: .opacity
        )
    }
}

// MARK: - Runs

/// Where a message sits in a run of messages from one sender.
///
/// Only the end of a run carries a timestamp, delivery state, and the sender's
/// portrait, the way Astra shows them once per turn rather than on every line.
struct ChatRunPosition: Equatable {
    var startsRun = true
    var endsRun = true

    /// `sender` names who wrote a message, so a channel run breaks when the
    /// speaker changes even if every message is incoming.
    static func of<Item>(
        _ index: Int,
        in items: [Item],
        isOutgoing: (Item) -> Bool,
        sender: (Item) -> String? = { _ in nil },
        timestamp: (Item) -> Date
    ) -> ChatRunPosition {
        func continues(_ a: Item, _ b: Item) -> Bool {
            isOutgoing(a) == isOutgoing(b)
                && sender(a) == sender(b)
                && abs(timestamp(b).timeIntervalSince(timestamp(a))) < ChatGlass.runBreak
                && Calendar.current.isDate(timestamp(a), inSameDayAs: timestamp(b))
        }
        let item = items[index]
        let starts = index == 0 || !continues(items[index - 1], item)
        let ends = index == items.count - 1 || !continues(item, items[index + 1])
        return ChatRunPosition(startsRun: starts, endsRun: ends)
    }
}

/// Lines an incoming run's portrait up with the bottom of its last bubble
/// rather than the bottom of the timestamp under it.
extension VerticalAlignment {
    private enum BubbleBottom: AlignmentID {
        static func defaultValue(in dimensions: ViewDimensions) -> CGFloat { dimensions[.bottom] }
    }

    static let bubbleBottom = VerticalAlignment(BubbleBottom.self)
}

// MARK: - Node orb

/// A glass marble standing in for a portrait.
///
/// Astra seats each photograph in a convex glass lens. A node has no photo,
/// so the marble is tinted instead: a colour picked from the node's key, lit
/// from the upper left, with a window reflection, a hairline of rim light,
/// and a soft shadow that seats it on the page. The initials (or a symbol for
/// infrastructure) sit inside the glass.
struct NodeOrb: View {
    let seed: Data
    let title: String
    var symbol: String?
    var size: CGFloat = 44
    /// Astra's green presence dot, for a node heard in the last few minutes.
    var isRecentlyHeard = false

    init(seed: Data, title: String, symbol: String? = nil, size: CGFloat = 44, isRecentlyHeard: Bool = false) {
        self.seed = seed
        self.title = title
        self.symbol = symbol
        self.size = size
        self.isRecentlyHeard = isRecentlyHeard
    }

    /// For a sender known only by name, like a channel speaker.
    init(name: String, size: CGFloat = 44) {
        self.init(seed: Data(name.utf8), title: name, size: size)
    }

    var body: some View {
        let hue = Self.hue(for: seed)
        ZStack {
            // The body, lit from the upper left and deepening to the far rim.
            Circle().fill(
                RadialGradient(
                    colors: [hue.light, hue.base, hue.deep],
                    center: UnitPoint(x: 0.34, y: 0.26),
                    startRadius: 0,
                    endRadius: size * 0.92
                )
            )
            label
                .shadow(color: hue.deep.opacity(0.55), radius: size * 0.02, y: size * 0.012)
            // The glass is thickest at its edge.
            Circle().fill(
                RadialGradient(
                    colors: [.clear, .clear, hue.deep.opacity(0.32)],
                    center: .center,
                    startRadius: 0,
                    endRadius: size * 0.5
                )
            )
            // Light returning along the lower rim.
            Ellipse()
                .fill(Color.white.opacity(0.24))
                .frame(width: size * 0.62, height: size * 0.2)
                .offset(y: size * 0.36)
                .blur(radius: size * 0.06)
            // The window reflection, and its small hot core.
            Ellipse()
                .fill(Color.white.opacity(0.6))
                .frame(width: size * 0.46, height: size * 0.2)
                .rotationEffect(.degrees(-28))
                .offset(x: -size * 0.13, y: -size * 0.26)
                .blur(radius: size * 0.045)
            Circle()
                .fill(Color.white.opacity(0.7))
                .frame(width: size * 0.1, height: size * 0.1)
                .offset(x: -size * 0.23, y: -size * 0.25)
                .blur(radius: size * 0.02)
            // A hairline of rim light, brightest toward the window.
            Circle().strokeBorder(
                AngularGradient(
                    colors: [
                        .white.opacity(0.85), .white.opacity(0.15), .white.opacity(0.1),
                        .white.opacity(0.45), .white.opacity(0.12), .white.opacity(0.85),
                    ],
                    center: .center,
                    angle: .degrees(-130)
                ),
                lineWidth: max(0.75, size * 0.018)
            )
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        // Astra seats a portrait with a shadow of y 9%, blur 13% of its size.
        .shadow(color: Color(red: 0.09, green: 0.14, blue: 0.14).opacity(0.16), radius: size * 0.065, y: size * 0.09)
        .overlay(alignment: .bottomTrailing) {
            if isRecentlyHeard {
                Circle()
                    .fill(Self.presence)
                    .frame(width: max(8, size * 0.16), height: max(8, size * 0.16))
                    .overlay { Circle().strokeBorder(MeshTheme.background, lineWidth: 2) }
                    .offset(x: -size * 0.02, y: -size * 0.02)
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var label: some View {
        if let symbol {
            Image(systemName: symbol)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundStyle(.white)
        } else {
            let letters = Self.initials(for: title, limit: size >= 40 ? 2 : 1)
            Text(letters)
                .font(.system(size: size * (letters.count > 1 ? 0.34 : 0.42), weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
    }

    // MARK: Colour

    struct Hue {
        let light: Color
        let base: Color
        let deep: Color

        init(_ light: UInt32, _ base: UInt32, _ deep: UInt32) {
            self.light = Color(hex: light)
            self.base = Color(hex: base)
            self.deep = Color(hex: deep)
        }
    }

    /// Eight mid-tone hues, each deep enough to carry white initials and soft
    /// enough to sit next to the pink mark without fighting it. There is no
    /// pure pink here on purpose: pink means "you" in this app.
    static let palette: [Hue] = [
        Hue(0xF4C0B8, 0xE29282, 0xB9634F), // coral
        Hue(0xF6CFA6, 0xE7A56C, 0xBD7840), // apricot
        Hue(0xEEDBA2, 0xD5B05E, 0xA7833A), // sand
        Hue(0xC4DEC2, 0x86B38A, 0x5A875F), // sage
        Hue(0xB3DEDB, 0x63B0AC, 0x3D8581), // teal
        Hue(0xBCD4F2, 0x75A2DC, 0x4A74AE), // sky
        Hue(0xD3C8F0, 0x9D8AD6, 0x6F5CAC), // lavender
        Hue(0xE3C1E4, 0xB77EBB, 0x8A5390), // plum
    ]

    /// FNV-1a over the seed: stable across launches and devices, unlike
    /// Swift's `hashValue`, which is salted per process.
    static func hue(for seed: Data) -> Hue {
        var hash: UInt32 = 2_166_136_261
        for byte in seed {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return palette[Int(hash % UInt32(palette.count))]
    }

    static func initials(for title: String, limit: Int) -> String {
        let words = title.split { !$0.isLetter && !$0.isNumber }
        let letters = words.prefix(limit).compactMap(\.first).map { String($0).uppercased() }
        return letters.isEmpty ? "?" : letters.joined()
    }

    /// Astra's presence green, #759B88.
    static let presence = Color(hex: 0x759B88)
}

private extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

// MARK: - Small glass pieces

/// A round glass button with one symbol, Astra's 46pt control. The glyph
/// follows the reader's text size, as every control glyph here does.
struct GlassCircleLabel: View {
    let systemImage: String
    var size: CGFloat = 46
    var tint: Color?
    var foreground: Color = MeshTheme.textPrimary

    var body: some View {
        Image(systemName: systemImage)
            .font(Design.Text.controlGlyph)
            .foregroundStyle(foreground)
            .frame(width: size, height: size)
            .chatGlass(Circle(), style: .clear, tint: tint, interactive: true)
            .contentShape(Circle())
    }
}

/// Astra's date heading: small, centred, spaced, and without rules.
struct ChatDayHeading: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.caption.weight(.medium))
            .tracking(0.4)
            .foregroundStyle(MeshTheme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.top, Design.Space.regular)
            .padding(.bottom, Design.Space.tight)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The page fading out under floating glass, so a line of text passing under
/// the composer or header softens instead of colliding with it.
struct ChatFadeEdge: View {
    enum Edge { case top, bottom }
    let edge: Edge
    var height: CGFloat = 36

    var body: some View {
        LinearGradient(
            colors: [MeshTheme.background.opacity(0), MeshTheme.background.opacity(0.92)],
            startPoint: edge == .bottom ? .top : .bottom,
            endPoint: edge == .bottom ? .bottom : .top
        )
        .frame(height: height)
        .allowsHitTesting(false)
    }
}

// MARK: - Message row

/// The layout every message shares: the side it sits on, the sender's orb at
/// the end of an incoming run, a sender name at the start of one, the bubble,
/// its reactions, and whatever the caller shows under it.
struct ChatMessageRow<Bubble: View, Footer: View>: View {
    let isOutgoing: Bool
    var run = ChatRunPosition()
    /// Nil leaves no portrait column, for a conversation with one other side
    /// whose orb is already in the header.
    var orb: NodeOrb?
    /// Shown above the first bubble of an incoming run, where speakers vary.
    var senderLabel: String?
    var reactions: [String] = []
    @ViewBuilder var bubble: Bubble
    @ViewBuilder var footer: Footer

    var body: some View {
        HStack(alignment: .bubbleBottom, spacing: Design.Space.tight) {
            if isOutgoing {
                Spacer(minLength: ChatGlass.farSideGutter)
            } else if let orb {
                if run.endsRun {
                    // Astra seats the portrait 2pt above the bubble's bottom edge.
                    orb.alignmentGuide(.bubbleBottom) { $0[.bottom] + 2 }
                } else {
                    Color.clear.frame(width: orb.size, height: 1)
                }
            }
            VStack(alignment: isOutgoing ? .trailing : .leading, spacing: Design.Space.hairline) {
                if !isOutgoing, run.startsRun, let senderLabel {
                    Text(senderLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(MeshTheme.textSecondary)
                        .padding(.horizontal, Design.Space.tight)
                        .accessibilityAddTraits(.isHeader)
                }
                bubble
                    .overlay(alignment: isOutgoing ? .bottomLeading : .bottomTrailing) {
                        if !reactions.isEmpty {
                            ReactionBadge(reactions: reactions)
                                .padding(.horizontal, 10)
                                .offset(y: 16)
                        }
                    }
                    .alignmentGuide(.bubbleBottom) { $0[.bottom] }
                    // Room for the badge hanging below the bubble.
                    .padding(.bottom, reactions.isEmpty ? 0 : 16)
                footer
            }
            if !isOutgoing { Spacer(minLength: ChatGlass.farSideGutter) }
        }
        .padding(.bottom, run.endsRun ? ChatGlass.groupSpacing : ChatGlass.runSpacing)
    }
}

/// Reactions on a message: Astra's small glass capsule hanging off the
/// bubble's lower corner.
struct ReactionBadge: View {
    let reactions: [String]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(reactions, id: \.self) { emoji in
                Image(systemName: MessageReaction.symbolName(for: emoji))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MeshTheme.textPrimary)
            }
        }
        .padding(.horizontal, 11)
        .frame(minHeight: 30)
        .chatGlass(Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Reactions: \(reactions.map { MessageReaction.label(for: $0) }.joined(separator: ", "))")
    }
}

/// The separator between facts in a message's footer.
struct MetadataDot: View {
    var body: some View {
        Text("\u{00B7}").accessibilityHidden(true)
    }
}
