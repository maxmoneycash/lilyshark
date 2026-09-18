#if !os(watchOS)
import SwiftUI

struct CaptureFrameView: View {
    let frame: LSCapParser.Frame
    let originUs: UInt64?
    @State private var selectedBytes: Range<Int>?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Design.Space.regular) {
                GroupBox("Radio metadata") {
                    VStack(spacing: Design.Space.tight) {
                        LabeledContent("Elapsed time", value: CaptureAnalysis.timeLabel(frame, originUs: originUs))
                        LabeledContent("Recorded profile", value: frame.hasField(10) ? "\(frame.profileId) · \(frame.protocolHint)" : "Not recorded")
                        LabeledContent("Frequency", value: frame.hasField(1) ? String(format: "%.3f MHz", Double(frame.centerFrequencyHz) / 1_000_000) : "Not recorded")
                        LabeledContent("Bandwidth", value: frame.hasField(2) ? String(format: "%.1f kHz", Double(frame.bandwidthHz) / 1_000) : "Not recorded")
                        LabeledContent("RSSI", value: frame.hasField(5) ? String(format: "%.1f dBm", frame.rssiDbm) : "Not recorded")
                        LabeledContent("SNR", value: frame.hasField(6) ? String(format: "%.1f dB", frame.snrDb) : "Not recorded")
                        LabeledContent("Direction", value: frame.direction.rawValue.uppercased())
                        LabeledContent("CRC", value: frame.crc.rawValue.capitalized)
                        LabeledContent("Bytes", value: "\(frame.capturedLength) captured / \(frame.originalLength) original")
                    }
                    .font(.callout)
                    .textSelection(.enabled)
                }
                Label(frame.originLabel == "Unspecified" ? "Origin unspecified; radio origin is not authenticated." : frame.originLabel, systemImage: frame.synthetic ? "flask" : "info.circle")
                    .font(.callout).foregroundStyle(MeshTheme.textSecondary)
                if frame.truncated {
                    Label("This frame was truncated in the capture. Only available bytes are shown.", systemImage: "exclamationmark.triangle")
                }
                protocolFields
                PacketDissectorView(frameBytes: frame.bytes, selectedBytes: $selectedBytes)
            }
            .padding()
        }
        .background(MeshTheme.background)
        .navigationTitle("Frame \(frame.sequence)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private var protocolFields: some View {
        let decoded = CaptureDissection(frame: frame)
        return VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text("Protocol fields").font(.headline)
            Text(decoded.summary).font(.callout)
            if let problem = decoded.problem {
                Label(problem, systemImage: "exclamationmark.triangle").font(.callout)
            }
            ForEach(decoded.fields) { field in
                Button {
                    selectedBytes = selectedBytes == field.bytes ? nil : field.bytes
                } label: {
                    VStack(alignment: .leading, spacing: Design.Space.hairline) {
                        Text(field.name).font(.caption).foregroundStyle(MeshTheme.textSecondary)
                        Text(field.value).font(.callout.monospaced()).foregroundStyle(MeshTheme.textPrimary)
                    }
                    .frame(maxWidth: .infinity, minHeight: Design.minimumTouchTarget, alignment: .leading)
                    .padding(.horizontal, Design.Space.tight)
                    .background(selectedBytes == field.bytes ? MeshTheme.accent.opacity(0.15) : Color.clear)
                }
                .buttonStyle(.meshPlain)
                .accessibilityValue(selectedBytes == field.bytes ? "Selected" : "")
                .accessibilityHint("Highlights the corresponding packet bytes below")
            }
        }
        .padding()
        .background(MeshTheme.surface, in: RoundedRectangle(cornerRadius: Design.Radius.card))
    }
}

/// Raw payload inspection never infers a sender or encryption state from a radio preset.
struct PacketDissectorView: View {
    let frameBytes: Data
    @Binding var selectedBytes: Range<Int>?
    private let bytesPerRow = 8

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text("Packet bytes").font(.headline)
            Text("Exact RF payload. Select a protocol field above or a byte row to inspect and copy its bytes.")
                .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            if frameBytes.isEmpty {
                Text("No payload bytes were captured.")
            } else {
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: Design.Space.hairline) {
                        ForEach(0..<rowCount, id: \.self) { row in
                            Button {
                                let range = rowRange(row)
                                selectedBytes = selectedBytes == range ? nil : range
                            } label: {
                                Text(rowText(row))
                                    .font(.system(.callout, design: .monospaced))
                                    .foregroundStyle(MeshTheme.textPrimary)
                                    .padding(.horizontal, Design.Space.tight)
                                    .frame(minHeight: Design.minimumTouchTarget, alignment: .leading)
                                    .background(isSelected(row) ? MeshTheme.accent.opacity(0.15) : Color.clear)
                            }
                            .buttonStyle(.meshPlain)
                            .accessibilityLabel("Bytes \(row * bytesPerRow) through \(min(frameBytes.count, (row + 1) * bytesPerRow) - 1). \(rowText(row))")
                            .accessibilityValue(isSelected(row) ? "Selected" : "")
                        }
                    }
                }
                if let selectedBytes, !selectedBytes.isEmpty {
                    Text(frameBytes.dropFirst(selectedBytes.lowerBound).prefix(selectedBytes.count).map { String(format: "%02X", $0) }.joined(separator: " "))
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
        }
        .padding()
        .background(MeshTheme.surface, in: RoundedRectangle(cornerRadius: Design.Radius.card))
    }

    private var rowCount: Int { (frameBytes.count + bytesPerRow - 1) / bytesPerRow }

    private func rowRange(_ row: Int) -> Range<Int> {
        (row * bytesPerRow)..<min(frameBytes.count, (row + 1) * bytesPerRow)
    }

    private func isSelected(_ row: Int) -> Bool {
        selectedBytes?.overlaps(rowRange(row)) == true
    }

    private func rowText(_ row: Int) -> String {
        let start = row * bytesPerRow
        let bytes = frameBytes.dropFirst(start).prefix(bytesPerRow)
        let hex = bytes.map { String(format: "%02X", $0) }.joined(separator: " ")
        let ascii = String(bytes.map { $0 >= 32 && $0 < 127 ? Character(UnicodeScalar($0)) : "." })
        return String(format: "%04X  ", start) + hex.padding(toLength: 23, withPad: " ", startingAt: 0) + "  " + ascii
    }
}
#endif
