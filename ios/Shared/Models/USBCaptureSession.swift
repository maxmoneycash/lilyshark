#if os(macOS)
import Combine
import Foundation
import MeshtasticKit
import Observation

/// Owned by Tools so an unfinished save remains available if its sheet closes.
@MainActor @Observable
final class USBCaptureSession {
    private(set) var state: LSKLinkState = .off
    private(set) var ports: [LSKSerialPort] = []
    private(set) var isRecording = false
    private(set) var isSaving = false
    private(set) var frameCount = 0
    private(set) var skippedCount = 0
    private(set) var syntheticCount = 0
    private(set) var networkCount = 0
    private(set) var savedCaptures: [URL] = []
    private(set) var completedURL: URL?
    private(set) var error: String?
    private(set) var stopReason: String?
    private(set) var hasUnsavedCapture = false

    @ObservationIgnored private let link: LSKSerialLink
    @ObservationIgnored private var subscriptions: Set<AnyCancellable> = []
    @ObservationIgnored private var recorder = LSKCaptureRecorder()
    @ObservationIgnored private var pendingData: Data?
    @ObservationIgnored private let captureDirectory: URL?

    init(link: LSKSerialLink = LSKSerialLink(), captureDirectory: URL? = nil) {
        self.link = link
        self.captureDirectory = captureDirectory
        // LSKSerialLink delivers state and lines on the main queue.
        link.$state.sink { [weak self] value in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.state = value
                if !value.isLinked && self.isRecording {
                    self.stopRecording(reason: "USB disconnected. The frames already recorded were kept.")
                }
            }
        }.store(in: &subscriptions)
        link.$availablePorts.sink { [weak self] in self?.ports = $0 }.store(in: &subscriptions)
        link.lines.sink { [weak self] value in
            MainActor.assumeIsolated { self?.receive(value) }
        }.store(in: &subscriptions)
        link.malformedKinds.sink { [weak self] kind in
            MainActor.assumeIsolated {
                guard let self, self.isRecording, kind == "F" else { return }
                self.recorder.noteMalformedFrame()
                self.skippedCount = self.recorder.skippedCount
            }
        }.store(in: &subscriptions)
    }

    func refreshPorts() { link.refreshPorts() }

    func connect(to port: String) {
        guard !isRecording, !isSaving, !hasUnsavedCapture else { return }
        error = nil
        link.connect(to: port)
    }

    func disconnect() {
        if isRecording { stopRecording(reason: "Recording stopped before disconnecting USB.") }
        link.disconnect()
    }

    func startRecording() {
        guard state.isLinked, !isRecording, !isSaving, !hasUnsavedCapture else { return }
        recorder = LSKCaptureRecorder()
        frameCount = 0
        skippedCount = 0
        syntheticCount = 0
        networkCount = 0
        completedURL = nil
        stopReason = nil
        error = nil
        isRecording = true
    }

    func stopRecording(reason: String? = nil) {
        guard isRecording else { return }
        isRecording = false
        stopReason = reason
        guard recorder.frameCount > 0 else {
            stopReason = "No complete frames were recorded. A quiet radio or older firmware may send no capture records."
            return
        }
        pendingData = recorder.snapshot()
        hasUnsavedCapture = true
        savePendingCapture()
    }

    func savePendingCapture() {
        guard let data = pendingData, !isSaving else { return }
        isSaving = true
        error = nil
        // Keep this session alive until its save completes, even if dismissed.
        Task {
            let directory = captureDirectory
            let writer = Task.detached(priority: .utility) { try USBCaptureFiles.save(data, in: directory) }
            do {
                completedURL = try await writer.value
                pendingData = nil
                hasUnsavedCapture = false
                recorder = LSKCaptureRecorder()
                await refreshSavedCaptures()
            } catch {
                self.error = "Capture could not be saved: \(error.localizedDescription) Retry saving before starting another recording."
            }
            isSaving = false
        }
    }

    func refreshSavedCaptures() async {
        let directory = captureDirectory
        let reader = Task.detached(priority: .utility) { try USBCaptureFiles.list(in: directory) }
        do { savedCaptures = try await reader.value }
        catch { self.error = "Saved captures could not be listed: \(error.localizedDescription)" }
    }

    private func receive(_ line: LSKLine) {
        guard isRecording, state.isLinked, case .frame(let frame) = line else { return }
        let result = recorder.append(frame)
        frameCount = recorder.frameCount
        skippedCount = recorder.skippedCount
        syntheticCount = recorder.syntheticCount
        networkCount = recorder.networkCount
        if result == .limitReached {
            stopRecording(reason: "Recording reached the 32 MB or 100,000-frame limit. Later frames were not recorded.")
        }
    }
}

enum USBCaptureFiles {
    static func directory() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
            .appendingPathComponent("Lilyshark/USB Captures", isDirectory: true)
    }

    static func save(_ data: Data, in captureDirectory: URL? = nil) throws -> URL {
        let folder = try captureDirectory ?? directory()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let url = folder.appendingPathComponent("usb-\(stamp)-\(UUID().uuidString.prefix(8)).lscap")
        try data.write(to: url, options: .atomic)
        return url
    }

    static func list(in captureDirectory: URL? = nil) throws -> [URL] {
        let folder = try captureDirectory ?? directory()
        do {
            return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil,
                                                               options: .skipsHiddenFiles)
                .filter { $0.pathExtension == "lscap" && $0.lastPathComponent.hasPrefix("usb-") }
                .sorted { $0.lastPathComponent > $1.lastPathComponent }
                .prefix(50).map { $0 }
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return []
        }
    }
}
#endif
