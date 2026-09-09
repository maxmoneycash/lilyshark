import SwiftUI
import MeshCoreKit

/// Shared typing, length feedback, and send affordance for direct, channel,
/// and room messages. Input stays intact until the store accepts a send.
struct MessageComposer: View {
    @Binding var text: String
    let budget: MessageTextBudget
    let isConnected: Bool
    var sendLabel = "Send message"
    let connect: () -> Void
    let send: () -> Void

    private var canSend: Bool { isConnected && budget.canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            HStack(alignment: .bottom, spacing: Design.Space.snug) {
                TextField("Type a message…", text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .font(Design.Text.message)
                    .padding(.horizontal, Design.Space.regular)
                    .padding(.vertical, Design.Space.snug)
                    .background(MeshTheme.surfaceLight)
                    .clipShape(RoundedRectangle(cornerRadius: Design.Radius.bubble, style: .continuous))
                    .foregroundStyle(MeshTheme.textPrimary)
                    .accessibilityLabel("Message")
                    .onSubmit { if canSend { send() } }

                Button {
                    if canSend { send() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(Design.Text.controlGlyph)
                        .foregroundStyle(canSend ? MeshTheme.textOnAccent : MeshTheme.textSecondary)
                        .frame(width: Design.sendButton, height: Design.sendButton)
                        .background(Circle().fill(canSend ? MeshTheme.accent : MeshTheme.surfaceLight))
                }
                .buttonStyle(.pressable)
                .meshAnimation(Design.Motion.quick, value: canSend)
                .disabled(!canSend)
                .accessibilityLabel(sendLabel)
            }
            if budget.remaining < 0 {
                Label("\(-budget.remaining) bytes over the limit. Shorten your message.", systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !text.isEmpty {
                Text("\(budget.remaining) bytes left")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(MeshTheme.textSecondary)
            }
            if !isConnected {
                Button("Connect a deck to send", systemImage: "antenna.radiowaves.left.and.right", action: connect)
                    .buttonStyle(.meshSecondary)
            }
        }
        .padding(.horizontal, Design.Space.snug)
        .padding(.vertical, Design.Space.tight)
        .background(MeshTheme.surface)
    }
}
