//
//  LSKSerialLinkTests.swift
//  MeshtasticKitTests
//
//  The transport. The end-to-end tests below drive the real link against a
//  pseudo-terminal standing in for a deck: the link opens it, sends HELLO, and
//  the test answers with the exact lines the firmware prints. No hardware, but
//  a real file descriptor, real termios, and the real read loop.
//

import Combine
import Foundation
import XCTest
@testable import MeshtasticKit

final class LSKSerialLinkPolicyTests: XCTestCase {

    // MARK: - Availability

    func testAvailabilityAnswersForThisPlatformRatherThanShrugging() {
        #if os(macOS)
        XCTAssertEqual(LSKUSBAvailability.current, .available)
        XCTAssertNil(LSKUSBAvailability.current.reason)
        #else
        // The iOS and watchOS branches are compile-time constants; the evidence
        // that no iOS USB serial API exists is recorded in LSK.md, which names
        // the SDK probes and their output.
        XCTAssertFalse(LSKUSBAvailability.current.isAvailable)
        XCTAssertNotNil(LSKUSBAvailability.current.reason)
        #endif
    }

    func testAnUnavailablePlatformCarriesWordsAnOperatorCanRead() {
        let unavailable = LSKUSBAvailability.unavailable("no USB here")
        XCTAssertFalse(unavailable.isAvailable)
        XCTAssertEqual(unavailable.reason, "no USB here")
        XCTAssertTrue(LSKUSBAvailability.available.isAvailable)
    }

    // MARK: - Port ranking

    private func port(_ path: String, vendor: UInt16?) -> LSKSerialPort {
        LSKSerialPort(path: path, name: path, usbVendorID: vendor, usbProductID: nil)
    }

    func testPortsWithNoUsbVendorAreNotWorthAHandshake() {
        // A Bluetooth-incoming port opens happily and then says nothing, and
        // twenty seconds of that reads to an operator as a hang.
        XCTAssertFalse(port("/dev/cu.Bluetooth-Incoming-Port", vendor: nil).couldBeADeck)
        XCTAssertFalse(port("/dev/cu.debug-console", vendor: nil).couldBeADeck)
        XCTAssertTrue(port("/dev/cu.usbmodem1101", vendor: 0x303A).couldBeADeck)
        XCTAssertTrue(port("/dev/cu.wchusbserial1", vendor: 0x1A86).couldBeADeck)
    }

    func testEspressifPortsAreTriedFirstAndTheOrderIsStable() {
        let ranked = LSKSerialPort.ranked([
            port("/dev/cu.Bluetooth-Incoming-Port", vendor: nil),
            port("/dev/cu.wchusbserial2", vendor: 0x1A86),
            port("/dev/cu.usbmodem1101", vendor: 0x303A),
            port("/dev/cu.SLAB_USBtoUART", vendor: 0x10C4),
            port("/dev/cu.usbmodem0002", vendor: 0x303A)
        ])
        XCTAssertEqual(
            ranked.map(\.path),
            [
                "/dev/cu.usbmodem0002",
                "/dev/cu.usbmodem1101",
                "/dev/cu.SLAB_USBtoUART",
                "/dev/cu.wchusbserial2",
                "/dev/cu.Bluetooth-Incoming-Port"
            ]
        )
    }

    // MARK: - Handshake policy

    func testFirstDropIsTheBoardRebootingAndEarnsARetry() {
        // Opening an ESP32-S3's native USB resets it, so the stream going away
        // on the first attempt is expected rather than a failure.
        XCTAssertEqual(
            LSKHandshakePolicy.action(for: .streamDropped, deliberate: false, attempt: 0),
            .retry
        )
        XCTAssertEqual(
            LSKHandshakePolicy.action(for: .timedOut, deliberate: false, attempt: 1),
            .retry
        )
    }

    func testTheLastAttemptGivesUpRatherThanLoopingForever() {
        XCTAssertEqual(
            LSKHandshakePolicy.action(for: .timedOut, deliberate: false, attempt: 2),
            .giveUp
        )
    }

    func testACloseWeAskedForIsNeverReportedAsAFault() {
        XCTAssertEqual(
            LSKHandshakePolicy.action(for: .streamDropped, deliberate: true, attempt: 0),
            .ignore
        )
    }
}

#if os(macOS)

/// A pseudo-terminal wearing a deck's manners: it reads what the link writes
/// and answers with the firmware's own lines.
///
/// The master end is opened non-blocking and polled, so `shutDown()` never has
/// to close a descriptor out from under a blocked `read`.
private final class FakeDeck: @unchecked Sendable {
    let slavePath: String
    private let master: Int32
    private let queue = DispatchQueue(label: "fake-deck")
    private var buffer = Data()
    private let lock = NSLock()
    private var received: [String] = []
    private var running = true
    /// Called on the reader queue for every whole line the link sent.
    var onLine: ((String) -> Void)?

    init?() {
        let fd = posix_openpt(O_RDWR | O_NOCTTY | O_NONBLOCK)
        guard fd >= 0, grantpt(fd) == 0, unlockpt(fd) == 0, let name = ptsname(fd) else {
            if fd >= 0 { close(fd) }
            return nil
        }
        master = fd
        slavePath = String(cString: name)
        queue.async { [weak self] in self?.readLoop() }
    }

    private var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    private func readLoop() {
        var scratch = [UInt8](repeating: 0, count: 512)
        while isRunning {
            let count = read(master, &scratch, scratch.count)
            if count <= 0 {
                // EAGAIN is an empty buffer; ENXIO/EIO is the slave not being
                // open yet, which is the normal state before the link connects.
                usleep(5_000)
                continue
            }
            buffer.append(contentsOf: scratch[0..<count])
            while let newline = buffer.firstIndex(of: 0x0A) {
                let line = String(decoding: buffer[buffer.startIndex..<newline], as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                buffer.removeSubrange(buffer.startIndex...newline)
                guard !line.isEmpty else { continue }
                lock.lock()
                received.append(line)
                lock.unlock()
                onLine?(line)
            }
        }
        close(master)
    }

    /// Print one line, terminator included, the way `Serial.printf` does.
    func say(_ line: String) { sayRaw(line + "\n") }

    /// Write without a terminator, so a test can split one line across two
    /// writes and prove the host rejoins it.
    func sayRaw(_ text: String) {
        var remaining = Array(text.utf8)
        while !remaining.isEmpty {
            let written = remaining.withUnsafeBytes { bytes -> Int in
                write(master, bytes.baseAddress, bytes.count)
            }
            if written <= 0 {
                if errno == EAGAIN || errno == EINTR { usleep(2_000); continue }
                return
            }
            remaining.removeFirst(written)
        }
    }

    var linesReceived: [String] {
        lock.lock()
        defer { lock.unlock() }
        return received
    }

    /// Stops the reader, which closes the master on its own thread.
    func shutDown() {
        lock.lock()
        running = false
        lock.unlock()
    }
}

final class LSKSerialLinkPtyTests: XCTestCase {
    /// Short enough that a suite is not waiting on a board that does not exist,
    /// long enough that a loaded machine still gets the HELLO out.
    private let fastTiming = LSKLinkTiming(
        helloAfterOpen: 0.05,
        helloRepeat: 0.2,
        identifyTimeout: 3,
        reenumerateWait: 0.2,
        maximumAttempts: 2
    )

    private var cancellables: Set<AnyCancellable> = []

    override func tearDown() {
        cancellables.removeAll()
        super.tearDown()
    }

    private let identityLine =
        #"LSK ID {"app":"lilyshark","fw":"0.9.3","board":"t-deck","node":"!a1b2c3d4"}"#

    func testTheLinkSendsHelloAndComesUpWhenTheDeckIdentifies() throws {
        let deck = try XCTUnwrap(FakeDeck(), "could not allocate a pty")
        defer { deck.shutDown() }

        let link = LSKSerialLink(timing: fastTiming)
        deck.onLine = { line in
            // The deck answers HELLO and nothing else.
            if line == "LSK HELLO" { deck.say(self.identityLine) }
        }

        let linked = expectation(description: "link reports itself up")
        link.$state
            .receive(on: DispatchQueue.main)
            .sink { state in if state.isLinked { linked.fulfill() } }
            .store(in: &cancellables)

        link.connect(to: deck.slavePath)
        wait(for: [linked], timeout: 8)

        guard case .linked(let port, let identity) = link.state else {
            return XCTFail("expected a linked state, got \(link.state)")
        }
        XCTAssertEqual(port, deck.slavePath)
        XCTAssertEqual(identity.firmwareVersion, "0.9.3")
        XCTAssertEqual(identity.nodeNum, 0xa1b2_c3d4)
        XCTAssertTrue(deck.linesReceived.contains("LSK HELLO"))

        link.disconnect()
    }

    func testTheStreamArrivesDecodedAndInOrderEvenWhenReadsSplitLines() throws {
        let deck = try XCTUnwrap(FakeDeck(), "could not allocate a pty")
        defer { deck.shutDown() }

        let link = LSKSerialLink(timing: fastTiming)
        let telemetry = #"LSK T {"bat":"BAT 84%","gps":"GPS 9","profile":"US 915 LONGFAST","#
            + #""frames":41,"rssi_x10":-912,"snr_x10":63,"sim":false,"mv":3985,"pct":84,"#
            + #""sat":9,"freq_hz":906875000,"sf":11,"bw_hz":250000,"rx":128,"crc":3}"#
        let sweep = #"LSK S {"f0":902000000,"f1":906000000,"bins":4,"db":[-128,-121,-96,-130]}"#

        // The link keeps asking until it is answered, so the stream is written
        // once — otherwise a second HELLO would duplicate everything below and
        // the order assertion would be testing the test.
        var answered = false
        deck.onLine = { line in
            guard line == "LSK HELLO", !answered else { return }
            answered = true
            deck.say(self.identityLine)
            // Split a line across two writes on purpose: the read loop must
            // rejoin it. The pty delivers each write separately.
            let half = telemetry.prefix(40)
            deck.sayRaw(String(half))
            deck.sayRaw(String(telemetry.dropFirst(40)) + "\n")
            deck.say("Lilyshark UI ready")          // a boot banner, not traffic
            deck.say(#"LSK Q {"future":1}"#)        // a kind this build never heard of
            deck.say(#"LSK T {"bat":"BAT 8"#)       // a print cut off by a reset
            deck.say(sweep)
        }

        var received: [LSKLine] = []
        var malformed: [String] = []
        let sawSweep = expectation(description: "a sweep arrives")
        link.lines
            .receive(on: DispatchQueue.main)
            .sink { line in
                received.append(line)
                if case .sweep = line { sawSweep.fulfill() }
            }
            .store(in: &cancellables)
        link.malformedKinds
            .receive(on: DispatchQueue.main)
            .sink { malformed.append($0) }
            .store(in: &cancellables)

        link.connect(to: deck.slavePath)
        wait(for: [sawSweep], timeout: 8)
        link.disconnect()

        XCTAssertEqual(received.map(\.kindTag), ["ID", "T", "Q", "S"])
        guard received.count == 4 else { return XCTFail("nothing more to check") }
        guard case .telemetry(let sample) = received[1] else {
            return XCTFail("expected telemetry second")
        }
        XCTAssertEqual(sample.newestFrameSequence, 41)
        XCTAssertEqual(sample.centerFrequencyHz, 906_875_000)
        guard case .unknown(let kind, _) = received[2] else {
            return XCTFail("expected the unknown kind to survive undecoded")
        }
        XCTAssertEqual(kind, "Q")
        // The banner produced nothing; the clipped print was reported, not
        // silently dropped.
        XCTAssertEqual(malformed, ["T"])
    }

    func testCommandsOnlyReachTheCableOnceTheLinkIsUp() throws {
        let deck = try XCTUnwrap(FakeDeck(), "could not allocate a pty")
        defer { deck.shutDown() }

        let link = LSKSerialLink(timing: fastTiming)
        // Nothing answers, so the link never identifies.
        try link.send(.sweepStart)

        let settled = expectation(description: "the write queue drained")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { settled.fulfill() }
        wait(for: [settled], timeout: 3)
        XCTAssertTrue(deck.linesReceived.isEmpty)
    }

    func testACommandTheDeckWouldSilentlyDropNeverLeaves() throws {
        let link = LSKSerialLink(timing: fastTiming)
        XCTAssertThrowsError(try link.send(.broadcastText(String(repeating: "x", count: 300))))
    }

    func testSweepStartAndGoodbyeReachTheDeck() throws {
        let deck = try XCTUnwrap(FakeDeck(), "could not allocate a pty")
        defer { deck.shutDown() }

        let link = LSKSerialLink(timing: fastTiming)
        deck.onLine = { line in if line == "LSK HELLO" { deck.say(self.identityLine) } }

        let linked = expectation(description: "linked")
        link.$state
            .receive(on: DispatchQueue.main)
            .sink { if $0.isLinked { linked.fulfill() } }
            .store(in: &cancellables)
        link.connect(to: deck.slavePath)
        wait(for: [linked], timeout: 8)

        let sawSweepCommand = expectation(description: "the deck was asked to sweep")
        let sawGoodbye = expectation(description: "the deck was told the link is closing")
        deck.onLine = { line in
            if line == "LSK SWEEP start" { sawSweepCommand.fulfill() }
            if line == "LSK BYE" { sawGoodbye.fulfill() }
        }
        try link.send(.sweepStart)
        wait(for: [sawSweepCommand], timeout: 5)

        // Without the parting word the deck keeps printing to a port nobody
        // reads.
        link.disconnect()
        wait(for: [sawGoodbye], timeout: 5)
    }

    func testAPortThatAnswersAsSomethingElseIsRefusedRatherThanLinked() throws {
        let deck = try XCTUnwrap(FakeDeck(), "could not allocate a pty")
        defer { deck.shutDown() }

        let link = LSKSerialLink(timing: fastTiming)
        deck.onLine = { line in
            guard line == "LSK HELLO" else { return }
            deck.say(#"LSK ID {"app":"other-board","fw":"1.0","board":"x","node":"!1"}"#)
        }

        let failed = expectation(description: "the link says which board answered")
        link.$state
            .receive(on: DispatchQueue.main)
            .sink { state in
                if case .failed(let reason) = state, reason.contains("other-board") {
                    failed.fulfill()
                }
            }
            .store(in: &cancellables)

        link.connect(to: deck.slavePath)
        wait(for: [failed], timeout: 8)
        XCTAssertFalse(link.state.isLinked)
    }

    func testAPortThatNeverAnswersEndsInAnExplanationRatherThanASpinner() throws {
        let deck = try XCTUnwrap(FakeDeck(), "could not allocate a pty")
        defer { deck.shutDown() }

        // maximumAttempts 2, identifyTimeout 3 s, reenumerate 0.2 s.
        let link = LSKSerialLink(timing: fastTiming)
        let failed = expectation(description: "the link gives up and says why")
        link.$state
            .receive(on: DispatchQueue.main)
            .sink { state in
                if case .failed(let reason) = state, reason.contains("never answered") {
                    failed.fulfill()
                }
            }
            .store(in: &cancellables)

        link.connect(to: deck.slavePath)
        wait(for: [failed], timeout: 20)
        // It asked more than once before giving up, which is the whole point of
        // the retry: the first open reboots the board.
        XCTAssertGreaterThan(deck.linesReceived.filter { $0 == "LSK HELLO" }.count, 1)
    }

    func testOpeningAPortThatIsNotThereFailsWithTheSystemsOwnReason() {
        let link = LSKSerialLink(timing: fastTiming)
        let failed = expectation(description: "a missing port is explained")
        link.$state
            .receive(on: DispatchQueue.main)
            .sink { state in
                if case .failed(let reason) = state, reason.contains("would not open") {
                    failed.fulfill()
                }
            }
            .store(in: &cancellables)
        link.connect(to: "/dev/cu.no-such-device-here")
        wait(for: [failed], timeout: 5)
    }

    func testScanningPortsOnThisMachineNeverInventsOne() {
        // Whatever is plugged in, every result must be a callout device and the
        // ranking must be total.
        let ports = LSKSerialLink.scanPorts()
        for port in ports {
            XCTAssertTrue(port.path.hasPrefix("/dev/cu."), "\(port.path) is not a callout device")
        }
        XCTAssertEqual(ports.map(\.path), LSKSerialPort.ranked(ports).map(\.path))
    }
}

#endif
