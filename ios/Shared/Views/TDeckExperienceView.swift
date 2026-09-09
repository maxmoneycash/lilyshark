#if os(iOS) || os(macOS)
import SwiftUI

/// Scroll-driven firmware tour on the reconstructed T-Deck, matching the site.
struct TDeckExperienceView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var index = 0

    private var screen: TDeckScreen { TDeckScreen.all[index] }

    var body: some View {
        VStack(spacing: 0) {
            TDeckSceneView(
                screenFileName: screen.fileName,
                onVerticalPage: { delta in
                    move(by: delta)
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(MeshTheme.background)

            caption
                .padding(.horizontal, Design.Space.regular)
                .padding(.vertical, Design.Space.snug)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
                .background(MeshTheme.surface)
        }
        .background(MeshTheme.background)
        .navigationTitle("The Deck")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: move(by: 1)
            case .decrement: move(by: -1)
            default: break
            }
        }
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text(screen.title)
                .font(.headline)
                .foregroundStyle(MeshTheme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(screen.detail)
                .font(.body)
                .foregroundStyle(MeshTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(index + 1) of \(TDeckScreen.all.count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(MeshTheme.textSecondary)
            HStack(spacing: Design.Space.regular) {
                Button {
                    move(by: -1)
                } label: {
                    Text("Previous screen")
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshSecondary)
                .disabled(index == 0)
                Button {
                    move(by: 1)
                } label: {
                    Text(index == TDeckScreen.all.count - 1 ? "First screen" : "Next screen")
                        .frame(maxWidth: .infinity)
                        .touchable()
                }
                .buttonStyle(.meshPrimary)
            }
        }
    }

    private func move(by delta: Int) {
        let count = TDeckScreen.all.count
        guard count > 0 else { return }
        let next = (index + delta + count) % count
        if reduceMotion {
            index = next
        } else {
            withMeshAnimation(reduceMotion: reduceMotion) { index = next }
        }
    }
}

/// Auto-paging hero used on the welcome page.
struct TDeckHeroView: View {
    var interactive: Bool = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var index = 0
    private let files = ["splash", "home", "traffic-live", "map", "spectrum-live"]

    var body: some View {
        TDeckSceneView(screenFileName: files[index], interactive: interactive)
            .task(id: reduceMotion) {
                guard !reduceMotion, files.count > 1 else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 2_100_000_000)
                    guard !Task.isCancelled else { return }
                    index = (index + 1) % files.count
                }
            }
    }
}
#endif
