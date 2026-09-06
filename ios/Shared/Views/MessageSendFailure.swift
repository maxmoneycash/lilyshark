import SwiftUI
import MeshCoreKit

struct MessageSendFailure: View {
    let message: Message
    @Environment(MessageStoreManager.self) private var messageStoreManager

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Delivery not confirmed", systemImage: "exclamationmark.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(MeshTheme.disconnected)
            Text(message.failureReason ?? "No delivery confirmation arrived. Retrying may send a duplicate.")
                .font(.caption)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                messageStoreManager.retryMessage(message)
            } label: {
                Label("Retry message", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 8)
                    .touchable()
            }
            .buttonStyle(.meshSecondary)
            .accessibilityHint("Sends this message again through the connected deck")
        }
        .padding(12)
        .background(MeshTheme.surfaceLight, in: RoundedRectangle(cornerRadius: Design.Radius.control))
        .accessibilityElement(children: .contain)
    }
}
