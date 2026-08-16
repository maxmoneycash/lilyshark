import AVFoundation
import AppKit
import CoreMedia
import CoreVideo
import Darwin
import Foundation
import ScreenCaptureKit

enum RecorderError: LocalizedError {
    case usage
    case unsupportedOS
    case invalidWindowID(String)
    case invalidDuration(String)
    case invalidOutput(String)
    case outputExists(String)
    case windowNotFound(CGWindowID)
    case invalidWindowSize(CGWindowID)
    case cannotAddWriterInput
    case writerStartFailed(String)
    case writerAppendFailed(String)
    case streamStopped(String)
    case noFrames
    case finalizationFailed(String)

    var errorDescription: String? {
        switch self {
        case .usage:
            return "usage: macos_window_recorder WINDOW_ID DURATION OUTPUT"
        case .unsupportedOS:
            return "macOS 14 or newer is required"
        case .invalidWindowID(let value):
            return "invalid WINDOW_ID: \(value)"
        case .invalidDuration(let value):
            return "invalid DURATION: \(value)"
        case .invalidOutput(let value):
            return "invalid OUTPUT path: \(value)"
        case .outputExists(let value):
            return "OUTPUT already exists: \(value)"
        case .windowNotFound(let windowID):
            return "window \(windowID) is not available to ScreenCaptureKit"
        case .invalidWindowSize(let windowID):
            return "window \(windowID) has no capturable content size"
        case .cannotAddWriterInput:
            return "AVAssetWriter rejected the H.264 video input"
        case .writerStartFailed(let detail):
            return "AVAssetWriter could not start: \(detail)"
        case .writerAppendFailed(let detail):
            return "AVAssetWriter could not append a frame: \(detail)"
        case .streamStopped(let detail):
            return "ScreenCaptureKit stopped: \(detail)"
        case .noFrames:
            return "capture produced no complete video frames"
        case .finalizationFailed(let detail):
            return "QuickTime finalization failed: \(detail)"
        }
    }
}

@available(macOS 14.0, *)
final class WindowRecorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let sampleQueue = DispatchQueue(label: "com.lilyshark.window-recorder.samples")

    private let writer: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private let outputURL: URL
    private var frameCount = 0
    private var terminalError: Error?

    init(outputURL: URL, width: Int, height: Int) throws {
        self.outputURL = outputURL
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)

        let pixels = width.multipliedReportingOverflow(by: height)
        let pixelCount = pixels.overflow ? Int.max : pixels.partialValue
        let requestedBitRate = pixelCount.multipliedReportingOverflow(by: 6)
        let averageBitRate = min(
            max(requestedBitRate.overflow ? Int.max : requestedBitRate.partialValue, 2_000_000),
            24_000_000)
        let compression: [String: Any] = [
            AVVideoAverageBitRateKey: averageBitRate,
            AVVideoExpectedSourceFrameRateKey: 60,
            AVVideoMaxKeyFrameIntervalKey: 120,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ]
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: compression,
        ]
        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        videoInput.expectsMediaDataInRealTime = true
        guard writer.canAdd(videoInput) else {
            throw RecorderError.cannotAddWriterInput
        }
        writer.add(videoInput)
        super.init()
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen, terminalError == nil,
              sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer),
              CMSampleBufferGetImageBuffer(sampleBuffer) != nil,
              isCompleteFrame(sampleBuffer) else {
            return
        }

        if writer.status == .unknown {
            guard writer.startWriting() else {
                terminalError = RecorderError.writerStartFailed(
                    writer.error?.localizedDescription ?? "unknown writer error")
                return
            }
            writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
        }

        guard writer.status == .writing else {
            terminalError = RecorderError.writerAppendFailed(
                writer.error?.localizedDescription ?? "writer is not accepting frames")
            return
        }
        guard videoInput.isReadyForMoreMediaData else {
            return
        }
        guard videoInput.append(sampleBuffer) else {
            terminalError = RecorderError.writerAppendFailed(
                writer.error?.localizedDescription ?? "append returned false")
            return
        }
        frameCount += 1
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        sampleQueue.async { [self] in
            if terminalError == nil {
                terminalError = RecorderError.streamStopped(error.localizedDescription)
            }
        }
    }

    func finish() async throws -> Int {
        try await withCheckedThrowingContinuation { continuation in
            sampleQueue.async { [self] in
                if let terminalError {
                    writer.cancelWriting()
                    removeInvalidOutput()
                    continuation.resume(throwing: terminalError)
                    return
                }
                guard frameCount > 0, writer.status == .writing else {
                    writer.cancelWriting()
                    removeInvalidOutput()
                    continuation.resume(throwing: RecorderError.noFrames)
                    return
                }

                videoInput.markAsFinished()
                writer.finishWriting { [self] in
                    sampleQueue.async { [self] in
                        guard writer.status == .completed else {
                            let detail = writer.error?.localizedDescription ??
                                "writer status \(writer.status.rawValue)"
                            removeInvalidOutput()
                            continuation.resume(
                                throwing: RecorderError.finalizationFailed(detail))
                            return
                        }
                        guard let attributes = try? FileManager.default.attributesOfItem(
                            atPath: outputURL.path),
                              let size = attributes[.size] as? NSNumber,
                              size.uint64Value > 0 else {
                            removeInvalidOutput()
                            continuation.resume(throwing: RecorderError.finalizationFailed(
                                "output file is empty"))
                            return
                        }
                        continuation.resume(returning: frameCount)
                    }
                }
            }
        }
    }

    func abort() async {
        await withCheckedContinuation { continuation in
            sampleQueue.async { [self] in
                writer.cancelWriting()
                removeInvalidOutput()
                continuation.resume()
            }
        }
    }

    private func isCompleteFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let statusValue = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: statusValue) else {
            return false
        }
        return status == .complete
    }

    private func removeInvalidOutput() {
        try? FileManager.default.removeItem(at: outputURL)
    }
}

@main
struct MacOSWindowRecorder {
    @MainActor
    static func main() async {
        do {
            guard #available(macOS 14.0, *) else {
                throw RecorderError.unsupportedOS
            }
            _ = NSApplication.shared
            NSApplication.shared.setActivationPolicy(.prohibited)
            NSApplication.shared.finishLaunching()
            try await run()
        } catch {
            let message = "macos_window_recorder: \(error.localizedDescription)\n"
            FileHandle.standardError.write(Data(message.utf8))
            exit(EXIT_FAILURE)
        }
    }

    @available(macOS 14.0, *)
    @MainActor
    private static func run() async throws {
        let arguments = CommandLine.arguments
        guard arguments.count == 4 else {
            throw RecorderError.usage
        }
        guard let parsedWindowID = UInt32(arguments[1]), parsedWindowID != 0 else {
            throw RecorderError.invalidWindowID(arguments[1])
        }
        guard let duration = Double(arguments[2]), duration.isFinite, duration > 0.0,
              duration <= Double(UInt64.max) / 1_000_000_000.0 else {
            throw RecorderError.invalidDuration(arguments[2])
        }

        let outputURL = URL(fileURLWithPath: arguments[3],
                            relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
            .standardizedFileURL
        guard !outputURL.lastPathComponent.isEmpty else {
            throw RecorderError.invalidOutput(arguments[3])
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(
            atPath: outputURL.deletingLastPathComponent().path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw RecorderError.invalidOutput(arguments[3])
        }
        guard !FileManager.default.fileExists(atPath: outputURL.path) else {
            throw RecorderError.outputExists(outputURL.path)
        }

        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: false)
        let windowID = CGWindowID(parsedWindowID)
        guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
            throw RecorderError.windowNotFound(windowID)
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = max(CGFloat(filter.pointPixelScale), 1.0)
        let contentSize = filter.contentRect.size
        guard contentSize.width > 0.0, contentSize.height > 0.0 else {
            throw RecorderError.invalidWindowSize(windowID)
        }
        let width = evenPixelDimension(contentSize.width * scale)
        let height = evenPixelDimension(contentSize.height * scale)

        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        configuration.queueDepth = 8
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = false
        configuration.showMouseClicks = false
        configuration.capturesAudio = false
        configuration.scalesToFit = true
        configuration.preservesAspectRatio = true
        configuration.captureResolution = .best
        configuration.ignoreShadowsSingleWindow = true
        configuration.ignoreGlobalClipSingleWindow = true
        configuration.shouldBeOpaque = true

        let recorder = try WindowRecorder(
            outputURL: outputURL, width: width, height: height)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: recorder)
        try stream.addStreamOutput(
            recorder, type: .screen, sampleHandlerQueue: recorder.sampleQueue)

        do {
            try await stream.startCapture()
            let nanoseconds = UInt64((duration * 1_000_000_000.0).rounded())
            try await Task<Never, Never>.sleep(nanoseconds: nanoseconds)
            try await stream.stopCapture()
            let frames = try await recorder.finish()
            print("recorded \(frames) frames at \(width)x\(height) to \(outputURL.path)")
        } catch {
            try? await stream.stopCapture()
            await recorder.abort()
            throw error
        }
    }

    private static func evenPixelDimension(_ value: CGFloat) -> Int {
        let rounded = max(Int(value.rounded(.up)), 2)
        return rounded.isMultiple(of: 2) ? rounded : rounded + 1
    }
}
