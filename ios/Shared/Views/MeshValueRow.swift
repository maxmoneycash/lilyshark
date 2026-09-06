import SwiftUI

/// Keep labels and readings intact. Stack them when a row cannot fit both at
/// the reader's chosen text size instead of squeezing each into narrow columns.
struct MeshValueRow: View {
    let label: LocalizedStringKey
    let value: String
    var valueColor: Color = MeshTheme.textPrimary

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: Design.Space.regular) {
                labelText.fixedSize()
                Spacer(minLength: Design.Space.regular)
                valueText.fixedSize()
            }
            VStack(alignment: .leading, spacing: Design.Space.tight) {
                labelText
                valueText
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var labelText: some View {
        Text(label)
            .foregroundStyle(MeshTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var valueText: some View {
        Text(value)
            .monospacedDigit()
            .foregroundStyle(valueColor)
            .fixedSize(horizontal: false, vertical: true)
    }
}
