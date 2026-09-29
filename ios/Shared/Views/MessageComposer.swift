import SwiftUI
import MeshCoreKit

/// Shared typing, length feedback, and send affordance for direct, channel,
/// and room messages. Input stays intact until the store accepts a send.
///
/// Astra's floating composer: a 58pt glass field with a 44pt leading action,
/// and a separate 52pt glass send button that the field flows into on iOS 26.
/// It floats over the conversation instead of sitting on a bar, so messages
/// scroll under the glass; a fade behind it keeps them from colliding.
struct MessageComposer: View {
    @Binding var text: String
    @Environment(\.dynamicTypeSize) private var typeSize
    let budget: MessageTextBudget
    let isConnected: Bool
    var sendLabel = "Send message"
    /// Offered from the field's + button. Nil hides the button.
    var shareLocation: (() -> Void)?
    let connect: () -> Void
    let send: () -> Void

    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canSend: Bool { isConnected && budget.canSend && hasText }

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            if !isConnected {
                Button(action: connect) {
                    Label(typeSize.isAccessibilitySize ? "Connect radio" : "Connect a deck to send",
                          systemImage: "antenna.radiowaves.left.and.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(MeshTheme.accent)
                        .padding(.horizontal, Design.Space.regular)
                        .touchable()
                        .chatGlass(Capsule(), interactive: true)
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Connect a radio to send messages")
            }
            budgetNotice
            ChatGlassContainer(spacing: 18) {
                HStack(alignment: .bottom, spacing: Design.Space.tight) {
                    field
                    sendButton
                }
            }
        }
        .padding(.horizontal, Design.Space.regular)
        .padding(.top, 10)
        .padding(.bottom, Design.Space.tight)
        .background(alignment: .bottom) {
            ChatFadeEdge(edge: .bottom, height: 120)
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private var field: some View {
        HStack(alignment: .bottom, spacing: Design.Space.tight) {
            #if !os(watchOS)
            if let shareLocation {
                Menu {
                    Button("Share my location", systemImage: "location.fill", action: shareLocation)
                        .disabled(!isConnected)
                } label: {
                    Image(systemName: "plus")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(MeshTheme.textPrimary)
                        .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget)
                        .contentShape(Rectangle())
                }
                .menuIndicator(.hidden)
                .accessibilityLabel("Attach")
            }
            #endif
            TextField("Message", text: $text, axis: .vertical)
                .lineLimit(1...(typeSize.isAccessibilitySize ? 3 : 5))
                .font(Design.Text.message)
                .submitLabel(.send)
                .foregroundStyle(MeshTheme.textPrimary)
                .padding(.vertical, 11)
                .padding(.leading, hasLeadingAction ? 0 : Design.Space.snug)
                .padding(.trailing, Design.Space.tight)
                .frame(minHeight: Design.minimumTouchTarget)
                .accessibilityLabel("Message")
                .onSubmit { if canSend { send() } }
        }
        .padding(7)
        .frame(minHeight: 58)
        .chatGlass(RoundedRectangle(cornerRadius: 29, style: .continuous), interactive: true)
    }

    private var hasLeadingAction: Bool {
        #if os(watchOS)
        false
        #else
        shareLocation != nil
        #endif
    }

    private var sendButton: some View {
        Button {
            if canSend { send() }
        } label: {
            GlassCircleLabel(
                systemImage: "arrow.up",
                size: Design.sendButton,
                tint: canSend ? MeshTheme.brandPink.opacity(0.75) : nil,
                foreground: canSend ? .white : MeshTheme.textSecondary
            )
        }
        // Astra squeezes the button to 82% on send and lets it spring back.
        .buttonStyle(Design.PressableStyle(scale: 0.82))
        .meshAnimation(ChatGlass.snap, value: canSend)
        .disabled(!canSend)
        .padding(.bottom, 3)
        .accessibilityLabel(sendLabel)
    }

    @ViewBuilder
    private var budgetNotice: some View {
        if budget.remaining < 0 {
            Label("\(-budget.remaining) bytes over the limit. Shorten your message.", systemImage: "exclamationmark.circle")
                .font(.caption)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, Design.Space.tight)
        } else if !text.isEmpty {
            Text("\(budget.remaining) bytes left")
                .font(.caption.monospacedDigit())
                .foregroundStyle(MeshTheme.textSecondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.horizontal, Design.Space.tight)
        }
    }
}
