//
//  DesignSystem.swift
//  Lilyshark
//
//  One place that decides what this app feels like.
//
//  The app inherited PommeCore's sizing, which is compact the way a settings
//  app is compact: 15pt body text in chat bubbles, 32pt tap targets, no motion
//  anywhere. That is fine for a form and wrong for the thing you hold in one
//  hand outdoors to read a message from a stranger two kilometres away. The
//  message IS the product, and it was the smallest thing on the screen.
//
//  Every number here is a decision, and the comment says which. A design
//  system whose values are unexplained is a palette, and a palette drifts:
//  the next person picks 14 because 15 looked slightly too big on their
//  screen, and six months later nothing matches anything.
//
//  Rules this file exists to enforce:
//
//    - Nothing interactive is smaller than 44pt. Apple's minimum, and the real
//      reason is a cold hand on a hillside, not a guideline.
//    - Motion is short and interruptible. An animation an operator has to WAIT
//      for is a worse experience than none; every duration here is under a
//      quarter second, and springs are used so an interrupted gesture does not
//      snap.
//    - Reduce Motion is honoured, everywhere, without exception. Someone who
//      has asked the system for stillness has asked us too.
//

import SwiftUI

enum Design {

    // MARK: - Type

    /// Type scale, in points.
    ///
    /// Chat body is 17 rather than the inherited 15: a message read at arm's
    /// length in daylight is the one piece of text in this app that must never
    /// need a second look, and 15 is the size of a caption in Apple's own
    /// scale. Everything else is sized in relation to it.
    enum Text {
        /// The message itself. The largest text that is not a heading.
        static let message: CGFloat = 17
        /// Names, list rows, anything the eye lands on while scanning.
        static let row: CGFloat = 16
        /// Timestamps, delivery state, RSSI — read deliberately, not scanned.
        static let detail: CGFloat = 13
        /// Section labels. Small, but never below 11, which is where the
        /// system's own smallest label sits.
        static let label: CGFloat = 12
        /// A glyph inside a control -- the send arrow, a toolbar icon. Sized
        /// to the control rather than to the text scale, because it is read
        /// as a shape and not as a word.
        static let controlGlyph: CGFloat = 19
    }

    // MARK: - Space

    /// Spacing, in points. A four-point grid: every value is a multiple of 4,
    /// so anything laid out with these lines up with anything else without
    /// anyone measuring.
    enum Space {
        static let hairline: CGFloat = 4
        static let tight: CGFloat = 8
        static let snug: CGFloat = 12
        static let regular: CGFloat = 16
        static let loose: CGFloat = 24
        static let section: CGFloat = 32
    }

    // MARK: - Touch

    /// The smallest thing a finger is asked to hit.
    ///
    /// 44 is Apple's documented minimum and the number every reviewer checks,
    /// but the reason it is a hard floor HERE is that this app is used outside
    /// with cold hands, sometimes in a hurry. A 32pt send button is a missed
    /// message.
    static let minimumTouchTarget: CGFloat = 44

    /// The send button. Deliberately larger than the minimum: it is the single
    /// most-pressed control in the app and it sits at the screen edge where
    /// the thumb naturally falls.
    static let sendButton: CGFloat = 52

    // MARK: - Shape

    enum Radius {
        /// Message bubbles. Large enough to read as a bubble rather than a
        /// box, small enough that a one-word message is not a circle.
        static let bubble: CGFloat = 20
        /// Cards and sheets.
        static let card: CGFloat = 16
        /// Buttons and chips.
        static let control: CGFloat = 12
    }

    // MARK: - Motion

    /// How the app moves.
    ///
    /// Springs, not curves, and short ones. A spring that is interrupted
    /// mid-flight continues from where it is rather than snapping, which is
    /// what makes a list that is being scrolled while it updates feel solid
    /// instead of glitchy — and this app updates lists while they are being
    /// scrolled, because frames keep arriving.
    enum Motion {
        /// A message appearing, a button responding. Fast enough that it
        /// reads as the app being quick rather than as an animation.
        static let quick = SwiftUI.Animation.spring(response: 0.28, dampingFraction: 0.86)
        /// A sheet, a screen, anything covering what was there.
        static let sheet = SwiftUI.Animation.spring(response: 0.38, dampingFraction: 0.88)
        /// A value ticking — signal strength, battery. Smooth, not springy:
        /// a number that overshoots and settles reads as a wrong number
        /// briefly, and a wrong number is worse than a slow one.
        static let value = SwiftUI.Animation.easeOut(duration: 0.22)
    }

    /// The press feedback every control uses, so a button in one screen feels
    /// the same as a button in another.
    struct PressableStyle: ButtonStyle {
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var scale: CGFloat = 0.96

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                // Scale only. No opacity change: a control that dims under
                // the thumb is harder to read at the moment you are looking
                // at it, which is exactly backwards.
                .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
                .animation(reduceMotion ? nil : Design.Motion.quick, value: configuration.isPressed)
        }
    }
}

extension ButtonStyle where Self == Design.PressableStyle {
    /// `.buttonStyle(.pressable)` — the app's standard press feedback.
    static var pressable: Design.PressableStyle { Design.PressableStyle() }
}

extension View {
    /// Guarantee a control is at least as big as a fingertip.
    ///
    /// Applied to the tappable area, not the drawn shape: a 24pt icon can stay
    /// 24pt and still be comfortable to hit, and growing the icon instead
    /// would make the design coarse to fix an ergonomics problem.
    func touchable(_ size: CGFloat = Design.minimumTouchTarget) -> some View {
        frame(minWidth: size, minHeight: size)
            .contentShape(Rectangle())
    }

    /// Animate with `animation`, unless the operator asked the system for
    /// stillness. Every animated change in the app goes through this, so
    /// honouring Reduce Motion is not something anyone has to remember.
    func meshAnimation<V: Equatable>(_ animation: Animation, value: V) -> some View {
        modifier(MeshAnimationModifier(animation: animation, value: value))
    }
}

private struct MeshAnimationModifier<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation
    let value: V

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : animation, value: value)
    }
}
