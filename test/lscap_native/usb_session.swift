import Foundation
import MeshtasticKit

/// Host integration: real serial descriptor + app session + filesystem.
/// No simulator, physical radio, or UI automation is involved.
@main
struct USBCaptureSessionCheck {
    @MainActor static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let deck = try PseudoDeck()
        defer { deck.closePort() }
        let link = LSKSerialLink(timing: .init(helloAfterOpen: 0.01, helloRepeat: 0.05,
            identifyTimeout: 2, reenumerateWait: 0.1, maximumAttempts: 1))
        let folder = root.appendingPathComponent("captures")
        let session = USBCaptureSession(link: link, captureDirectory: folder)
        session.connect(to: deck.path)
        try await waitUntil {
            deck.answerHello()
            return session.state.isLinked
        }
        session.startRecording()
        deck.say(frameLine)
        try await waitUntil { session.frameCount == 1 }
        session.stopRecording()
        try await waitUntil { !session.isSaving && session.completedURL != nil }
        let first = try require(session.completedURL)
        let firstBytes = try Data(contentsOf: first)
        precondition(firstBytes.count == 106, "Saved \(firstBytes.count) bytes instead of 106")
        // Foundation can enumerate /var through its /private/var alias.
        precondition(session.savedCaptures.contains {
            $0.resolvingSymlinksInPath() == first.resolvingSymlinksInPath()
        }, "Saved recording is missing from recent captures")
        precondition(!session.hasUnsavedCapture)

        session.startRecording()
        deck.say(frameLine)
        try await waitUntil { session.frameCount == 1 }
        deck.closePort()
        try await waitUntil { !session.state.isLinked && !session.isSaving && session.completedURL != nil }
        let disconnected = try require(session.completedURL)
        precondition(disconnected != first)
        let disconnectedBytes = try Data(contentsOf: disconnected)
        precondition(disconnectedBytes == firstBytes)
        precondition(session.stopReason?.contains("disconnected") == true)

        // Make the capture directory unwritable by occupying it with a file.
        // This reproduces a failed atomic save without touching user storage.
        let badFolder = root.appendingPathComponent("blocked")
        try Data([1]).write(to: badFolder)
        let secondDeck = try PseudoDeck()
        defer { secondDeck.closePort() }
        let secondLink = LSKSerialLink(timing: .init(helloAfterOpen: 0.01, helloRepeat: 0.05,
            identifyTimeout: 2, reenumerateWait: 0.1, maximumAttempts: 1))
        let retrySession = USBCaptureSession(link: secondLink, captureDirectory: badFolder)
        retrySession.connect(to: secondDeck.path)
        try await waitUntil { secondDeck.answerHello(); return retrySession.state.isLinked }
        retrySession.startRecording()
        secondDeck.say(frameLine)
        try await waitUntil { retrySession.frameCount == 1 }
        retrySession.disconnect()
        try await waitUntil { !retrySession.isSaving && retrySession.hasUnsavedCapture }
        precondition(retrySession.completedURL == nil && retrySession.error != nil)
        retrySession.startRecording()
        precondition(!retrySession.isRecording)
        try FileManager.default.removeItem(at: badFolder)
        retrySession.savePendingCapture()
        try await waitUntil { !retrySession.isSaving && retrySession.completedURL != nil }
        precondition(!retrySession.hasUnsavedCapture)
        let retried = try require(retrySession.completedURL)
        let retriedBytes = try Data(contentsOf: retried)
        precondition(retriedBytes == firstBytes)
        print("USB session: stop/save, cable-loss save, failed-save retention, and retry passed")
    }

    @MainActor static func waitUntil(_ predicate: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(5)
        while !predicate() {
            guard Date() < deadline else { throw NSError(domain: "USB session timeout", code: 1) }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    static func require<T>(_ value: T?) throws -> T {
        guard let value else { throw NSError(domain: "Missing test value", code: 1) }
        return value
    }

    static let frameLine = #"LSK F {"src":1,"dst":2,"proto":"Meshtastic","port":0,"hops":0,"kind":"DATA","sim":false,"rssi_x10":-975,"snr_x10":-32,"seq":7,"ts":1000000,"pf":103,"freq":906875000,"bw":250000,"br":0,"fdev":0,"air":0,"ferr":-12345,"pre":16,"sync":43,"prof":1,"rstat":-17,"txp":-8,"sf":11,"cr":5,"ch":0,"ridx":0,"mod":1,"dir":1,"crc":2,"mflags":0,"olen":2,"hex":"0001"}"#
}

private final class PseudoDeck {
    private var descriptor: Int32
    let path: String
    private var pending = ""

    init() throws {
        let fd = posix_openpt(O_RDWR | O_NOCTTY | O_NONBLOCK)
        guard fd >= 0 else { throw NSError(domain: "PTY", code: 1) }
        guard grantpt(fd) == 0, unlockpt(fd) == 0, let name = ptsname(fd) else {
            close(fd)
            throw NSError(domain: "PTY", code: 2)
        }
        descriptor = fd
        path = String(cString: name)
    }

    func closePort() {
        if descriptor >= 0 { close(descriptor); descriptor = -1 }
    }

    func answerHello() {
        var bytes = [UInt8](repeating: 0, count: 1024)
        let count = read(descriptor, &bytes, bytes.count)
        guard count > 0 else { return }
        pending += String(decoding: bytes[..<count], as: UTF8.self)
        while let newline = pending.firstIndex(of: "\n") {
            let line = String(pending[..<newline])
            pending.removeSubrange(...newline)
            if line == "LSK HELLO" {
                say(#"LSK ID {"app":"lilyshark","fw":"test","board":"t-deck","node":"!12345678"}"#)
            }
        }
    }

    func say(_ line: String) {
        let bytes = Array((line + "\n").utf8)
        let count = bytes.withUnsafeBytes { write(descriptor, $0.baseAddress, $0.count) }
        precondition(count == bytes.count)
    }
}
