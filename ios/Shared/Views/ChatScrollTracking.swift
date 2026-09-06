import SwiftUI

/// Only a person's scroll opts out of following new messages. A larger content
/// size after insertion must not look like the person scrolled into history.
private struct ChatScrollTracking: ViewModifier {
    @Binding var followsLatest: Bool
    @State private var isUserScrolling = false

    func body(content: Content) -> some View {
        content
            .onScrollPhaseChange { _, phase in
                isUserScrolling = phase == .interacting || phase == .decelerating
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.visibleRect.maxY >= geometry.contentSize.height - 60
            } action: { _, nearBottom in
                if isUserScrolling || nearBottom {
                    followsLatest = nearBottom
                }
            }
    }
}

extension View {
    func chatScrollTracking(followsLatest: Binding<Bool>) -> some View {
        modifier(ChatScrollTracking(followsLatest: followsLatest))
    }
}
