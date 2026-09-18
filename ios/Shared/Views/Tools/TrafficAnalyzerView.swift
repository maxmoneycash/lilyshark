#if !os(watchOS)
import SwiftUI
import Charts
import UniformTypeIdentifiers

struct TrafficAnalyzerView: View {
    #if os(macOS)
    let usbSession: USBCaptureSession
    private var usbBusy: Bool { usbSession.isRecording || usbSession.isSaving }
    #else
    private var usbBusy: Bool { false }
    #endif
    @State private var showingFilePicker = false
    @State private var importRequest: ImportRequest?
    @State private var analysis: CaptureAnalysis?
    @State private var selection: CaptureAnalysis?
    @State private var filter = CaptureFilter()
    @State private var appliedFilter = CaptureFilter()
    @State private var revision = UUID()
    @State private var isFiltering = false
    @State private var exportRequest: ExportFormat?
    @State private var exportDocument: CaptureDocument?
    @State private var showingExport = false
    @State private var exportFormat = ExportFormat.capture
    @State private var exportName = "capture.lscap"
    @State private var filename = ""
    @State private var isLoading = false
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Design.Space.regular) {
                #if os(macOS)
                USBCaptureControls(session: usbSession) { importRequest = ImportRequest(url: $0) }
                #endif
                if isLoading { ProgressView("Opening capture…") }
                if exportRequest != nil { ProgressView("Preparing export…") }
                if let errorText {
                    Label(errorText, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(MeshTheme.textSecondary)
                        .accessibilityLabel("Capture operation failed. \(errorText)")
                }
                if let analysis {
                    Text(filename).font(.headline).textSelection(.enabled)
                    Text("\(selection?.capture.frames.count ?? analysis.capture.frames.count) of \(analysis.capture.frames.count) frames · \(analysis.syntheticCount) marked synthetic in file")
                        .font(.subheadline)
                    Text("Times are elapsed since the first timed frame, not calendar time. Protocol labels describe the recorded radio profile.")
                        .font(.caption).foregroundStyle(MeshTheme.textSecondary)
                    if let recovery = analysis.capture.recoveryMessage {
                        Label("\(recovery) Recovered complete frames; \(analysis.capture.trailingBytes) trailing bytes were not read.", systemImage: "exclamationmark.triangle")
                            .font(.callout)
                    }
                    if analysis.capture.frames.isEmpty {
                        ContentUnavailableView("No complete frames", systemImage: "waveform.path.ecg", description: Text("Open another capture to inspect its radio traffic."))
                    } else {
                        filterControls
                        if isFiltering { ProgressView("Filtering frames…") }
                        let visible = selection ?? analysis
                        if visible.capture.frames.isEmpty {
                            ContentUnavailableView("No matching frames", systemImage: "line.3.horizontal.decrease", description: Text("Change or reset the filters to see more traffic."))
                        }
                        if !visible.capture.frames.isEmpty {
                            IoGraphView(points: visible.points, untimedCount: visible.untimedCount)
                        }
                        LazyVStack(spacing: Design.Space.tight) {
                            ForEach(visible.capture.frames) { frame in
                                NavigationLink {
                                    CaptureFrameView(frame: frame, originUs: analysis.originUs)
                                } label: {
                                    FrameRowView(frame: frame, originUs: analysis.originUs)
                                }
                                .buttonStyle(.meshPlain)
                            }
                        }
                    }
                } else if !isLoading {
                    ContentUnavailableView {
                        Label("Radio captures", systemImage: "waveform.path.ecg")
                    } description: {
                        Text("Open an .lscap file to explore its traffic, radio readings, and packet bytes. Captures up to 32 MB and 100,000 frames are supported.")
                    } actions: {
                        Button("Open capture") { showingFilePicker = true }
                            .buttonStyle(.meshPrimary)
                            .disabled(usbBusy)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(MeshTheme.background)
        .navigationTitle("Traffic Analyzer")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu("Export", systemImage: "square.and.arrow.up") {
                    Button("Matching frames (.lscap)") { exportRequest = .capture }
                    Button("Matching frames (CSV)") { exportRequest = .csv }
                }
                .disabled(selection?.capture.frames.isEmpty != false || isLoading || isFiltering || appliedFilter != filter || exportRequest != nil || usbBusy)
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Open") { showingFilePicker = true }.disabled(isLoading || exportRequest != nil || usbBusy)
            }
        }
        .fileExporter(isPresented: $showingExport, document: exportDocument,
                      contentType: exportFormat == .csv ? .commaSeparatedText : .data,
                      defaultFilename: exportName) { result in
            if case .failure(let error) = result { errorText = error.localizedDescription }
            exportDocument = nil
        }
        .task(id: FilterRequest(revision: revision, filter: filter)) {
            guard let analysis else { return }
            isFiltering = true
            defer { isFiltering = false }
            let requestedFilter = filter
            do {
                try await Task.sleep(for: .milliseconds(180))
                let worker = Task.detached(priority: .userInitiated) { try analysis.filtered(by: requestedFilter) }
                let result = try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
                try Task.checkCancellation()
                selection = result
                appliedFilter = requestedFilter
            } catch is CancellationError {
            } catch { errorText = error.localizedDescription }
        }
        .task(id: exportRequest) {
            guard let request = exportRequest, let selection else { return }
            defer { exportRequest = nil }
            let sourceFilename = filename
            let worker = Task.detached(priority: .userInitiated) {
                try request == .capture ? CaptureExport.lscap(selection.capture) : CaptureExport.csv(selection.capture)
            }
            do {
                let bytes = try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
                try Task.checkCancellation()
                exportFormat = request
                exportName = URL(fileURLWithPath: sourceFilename).deletingPathExtension().lastPathComponent + "-filtered." + (request == .csv ? "csv" : "lscap")
                exportDocument = CaptureDocument(data: bytes)
                showingExport = true
            } catch is CancellationError {
            } catch { errorText = error.localizedDescription }
        }
        .fileImporter(isPresented: $showingFilePicker, allowedContentTypes: [.data]) { result in
            switch result {
            case .success(let url): importRequest = ImportRequest(url: url)
            case .failure(let error): errorText = error.localizedDescription
            }
        }
        .task(id: importRequest) {
            guard let request = importRequest else { return }
            let url = request.url
            isLoading = true
            errorText = nil
            defer {
                if importRequest?.id == request.id {
                    isLoading = false
                    importRequest = nil
                }
            }
            let worker = Task.detached(priority: .userInitiated) {
                try CaptureAnalysis.load(url)
            }
            do {
                let loaded = try await withTaskCancellationHandler {
                    try await worker.value
                } onCancel: { worker.cancel() }
                try Task.checkCancellation()
                guard importRequest?.id == request.id else { return }
                analysis = loaded
                selection = loaded
                filter = CaptureFilter()
                appliedFilter = filter
                revision = UUID()
                filename = url.lastPathComponent
            } catch is CancellationError {
                // Dismissal leaves the previous capture intact.
            } catch {
                if importRequest?.id == request.id { errorText = error.localizedDescription }
            }
        }
        #if os(macOS)
        .onChange(of: usbSession.completedURL, initial: true) { _, url in
            if let url { importRequest = ImportRequest(url: url) }
        }
        #endif
    }

    private var filterControls: some View {
        DisclosureGroup("Filter frames") {
            VStack(alignment: .leading, spacing: Design.Space.tight) {
                TextField("Sequence number or payload hex", text: $filter.query)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                LabeledContent("Recorded profile") {
                    Picker("", selection: $filter.profile) {
                        ForEach(["All", "Meshtastic", "MeshCore", "Reticulum", "Custom", "Unknown"], id: \.self) { Text($0).tag($0) }
                    }
                    .labelsHidden()
                    .frame(minHeight: Design.minimumTouchTarget)
                }
                LabeledContent("Origin") {
                    Picker("", selection: $filter.origin) {
                        ForEach(["All", "Synthetic", "Network relayed", "Unspecified"], id: \.self) { Text($0).tag($0) }
                    }
                    .labelsHidden()
                    .frame(minHeight: Design.minimumTouchTarget)
                }
                LabeledContent("CRC") {
                    Picker("", selection: $filter.crc) {
                        ForEach(["All", "valid", "invalid", "absent", "unknown"], id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .labelsHidden()
                    .frame(minHeight: Design.minimumTouchTarget)
                }
                LabeledContent("Direction") {
                    Picker("", selection: $filter.direction) {
                        ForEach(["All", "rx", "tx", "unknown"], id: \.self) { Text($0.uppercased()).tag($0) }
                    }
                    .labelsHidden()
                    .frame(minHeight: Design.minimumTouchTarget)
                }
                Toggle("Truncated frames only", isOn: $filter.truncatedOnly)
                Button { filter = CaptureFilter() } label: {
                    Text("Reset filters").touchable()
                }
                .buttonStyle(.meshPlain)
                Text("Unspecified origin does not establish local radio reception. Exports include matching complete records; a damaged file tail is omitted.")
                    .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            }
            .labeledContentStyle(CaptureFilterLabelStyle())
            .padding(.top, Design.Space.tight)
        }
    }

    private struct ImportRequest: Equatable {
        let id = UUID()
        let url: URL
    }

    private struct FilterRequest: Equatable {
        let revision: UUID
        let filter: CaptureFilter
    }
    private enum ExportFormat: Sendable { case capture, csv }
}

private struct CaptureFilterLabelStyle: LabeledContentStyle {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeBody(configuration: Configuration) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                configuration.label
                configuration.content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack {
                configuration.label
                Spacer()
                configuration.content
            }
        }
    }
}

private struct CaptureDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data, .commaSeparatedText] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let bytes = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        data = bytes
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private struct FrameRowView: View {
    let frame: LSCapParser.Frame
    let originUs: UInt64?

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: Design.Space.hairline) {
                Text("Frame \(frame.sequence) · \(frame.protocolHint) profile")
                    .font(.subheadline.weight(.semibold))
                Text(CaptureAnalysis.timeLabel(frame, originUs: originUs))
                    .font(.caption.monospacedDigit())
                if frame.originLabel != "Unspecified" {
                    Label(frame.originLabel, systemImage: frame.synthetic ? "flask" : "network")
                        .font(.caption)
                }
            }
            Spacer(minLength: Design.Space.tight)
            VStack(alignment: .trailing, spacing: Design.Space.hairline) {
                Text("\(frame.capturedLength) B").font(.caption.monospacedDigit())
                Image(systemName: "chevron.right").font(.caption)
            }
        }
        .foregroundStyle(MeshTheme.textPrimary)
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MeshTheme.surface, in: RoundedRectangle(cornerRadius: Design.Radius.card))
        .touchable()
        .accessibilityElement(children: .combine)
    }
}

private struct IoGraphView: View {
    let points: [CaptureAnalysis.Point]
    let untimedCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Design.Space.tight) {
            Text("Traffic over time").font(.headline)
            if points.isEmpty {
                Text("No timestamps were recorded.")
            } else {
                Chart(points) { point in
                    BarMark(x: .value("Elapsed seconds", point.seconds), y: .value("Frames", point.count))
                        .foregroundStyle(by: .value("Source", point.source))
                }
                .chartXAxisLabel("Elapsed seconds")
                .chartYAxisLabel("Frames")
                .frame(height: 180)
            }
            if untimedCount > 0 {
                Text("\(untimedCount) frames have no timestamp and are excluded from the chart.")
                    .font(.caption).foregroundStyle(MeshTheme.textSecondary)
            }
        }
        .padding()
        .background(MeshTheme.surface, in: RoundedRectangle(cornerRadius: Design.Radius.card))
    }
}
#endif
