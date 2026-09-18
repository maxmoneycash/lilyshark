#if os(macOS)
import SwiftUI
import MeshtasticKit

struct USBCaptureControls: View {
    let session: USBCaptureSession
    let openCapture: (URL) -> Void
    @State private var selectedPort = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text("Record from a USB radio").font(.headline)
            switch session.state {
            case .linked(_, let identity):
                Text("\(identity.board) · firmware \(identity.firmwareVersion)").font(.callout)
                HStack {
                    if session.isRecording {
                        Button("Stop and inspect") { session.stopRecording() }.buttonStyle(.meshPrimary)
                    } else {
                        Button("Start recording") { session.startRecording() }
                            .buttonStyle(.meshPrimary)
                            .disabled(session.isSaving || session.hasUnsavedCapture)
                    }
                    Button("Disconnect") { session.disconnect() }.buttonStyle(.meshPlain)
                }
            case .connecting:
                HStack {
                    ProgressView("Connecting to USB radio…")
                    Button("Cancel") { session.disconnect() }.buttonStyle(.meshPlain)
                }
            case .off, .failed:
                Picker("USB port", selection: $selectedPort) {
                    Text("Select a port").tag("")
                    ForEach(session.ports, id: \.path) { Text($0.name).tag($0.path) }
                }
                HStack {
                    Button("Refresh ports") { session.refreshPorts() }.buttonStyle(.meshPlain)
                    Button("Connect USB") { session.connect(to: selectedPort) }
                        .buttonStyle(.meshPrimary)
                        .disabled(selectedPort.isEmpty || session.isSaving || session.hasUnsavedCapture)
                }
                if case .failed(let reason) = session.state { Text(reason).font(.callout) }
            }
            if session.isRecording {
                Label("Recording · \(session.frameCount) frames", systemImage: "record.circle")
                    .foregroundStyle(MeshTheme.accent)
                Text("\(session.syntheticCount) synthetic · \(session.networkCount) network relayed · \(session.skippedCount) incomplete records skipped")
                    .font(.caption)
            } else if session.frameCount > 0 || session.skippedCount > 0 {
                Text("Last recording: \(session.frameCount) frames · \(session.skippedCount) incomplete records skipped")
                    .font(.caption)
            }
            if session.isSaving { ProgressView("Saving capture…") }
            if let reason = session.stopReason { Text(reason).font(.callout) }
            if let error = session.error {
                Label(error, systemImage: "exclamationmark.triangle").font(.callout)
            }
            if session.hasUnsavedCapture && !session.isSaving {
                Button("Retry saving capture") { session.savePendingCapture() }.buttonStyle(.meshPrimary)
            }
            Text("Stop to save and inspect the captured frames. Closing the analyzer or losing USB also stops and saves. Recordings stop at 32 MB or 100,000 frames.")
                .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            if !session.savedCaptures.isEmpty {
                Menu("Recent USB captures", systemImage: "folder") {
                    ForEach(session.savedCaptures, id: \.self) { url in
                        Button(url.lastPathComponent) { openCapture(url) }
                    }
                }
                .disabled(session.isRecording || session.isSaving)
                Button("Show saved captures in Finder") {
                    if let url = session.savedCaptures.first { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                }.buttonStyle(.meshPlain)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MeshTheme.surface, in: RoundedRectangle(cornerRadius: Design.Radius.card))
        .task {
            session.refreshPorts()
            await session.refreshSavedCaptures()
        }
    }
}
#endif
