//
//  LSKCommandTests.swift
//  MeshtasticKitTests
//
//  The host-to-deck half. Each expected string is the literal the firmware's
//  strcmp / strncmp branch in src/sim_main.cpp compares against, so a typo here
//  is a test failure rather than a command the deck silently ignores.
//

import Foundation
import XCTest
@testable import MeshtasticKit

final class LSKCommandTests: XCTestCase {

    func testHandshakeAndPartingMatchTheFirmwaresExactStrcmp() {
        // handle_analyzer_link_command compares these with strcmp, so any extra
        // character at all means the deck does nothing.
        XCTAssertEqual(LSKCommand.hello.line, "LSK HELLO")
        XCTAssertEqual(LSKCommand.goodbye.line, "LSK BYE")
        XCTAssertEqual(LSKCommand.hello.expectedReply, .identity)
        XCTAssertEqual(LSKCommand.goodbye.expectedReply, .none)
    }

    func testSweepCommandsMatchHandleSweepLinkCommand() {
        XCTAssertEqual(LSKCommand.sweepStart.line, "LSK SWEEP start")
        XCTAssertEqual(LSKCommand.sweepStop.line, "LSK SWEEP stop")
        XCTAssertEqual(LSKCommand.sweepStart.expectedReply, .okOrError)
    }

    func testTransmitCommandsMatchHandleMeshTxCommand() {
        XCTAssertEqual(
            LSKCommand.broadcastText("radio check").line,
            "LSK TX meshtastic text radio check"
        )
        XCTAssertEqual(LSKCommand.sendPosition.line, "LSK TX meshtastic position")
        XCTAssertEqual(LSKCommand.sendNodeInfo.line, "LSK TX meshtastic nodeinfo")
        XCTAssertEqual(LSKCommand.meshcoreAdvert(flood: false).line, "LSK TX meshcore advert")
        XCTAssertEqual(LSKCommand.meshcoreAdvert(flood: true).line, "LSK TX meshcore advert flood")
    }

    func testDirectMessagePadsTheNodeNumberToTheEightHexDigitsTheParserReads() {
        // The firmware reads at most eight hex digits and refuses a ninth, so
        // the padding is not cosmetic.
        XCTAssertEqual(
            LSKCommand.directMessage(node: 0x0000_00ff, text: "hi").line,
            "LSK TX meshtastic dm 000000ff hi"
        )
        XCTAssertEqual(
            LSKCommand.directMessage(node: 0xa1b2_c3d4, text: "hi").line,
            "LSK TX meshtastic dm a1b2c3d4 hi"
        )
    }

    func testInjectIsLowercaseHexWithNoSeparators() {
        XCTAssertEqual(
            LSKCommand.injectFrame(Data([0x0a, 0xff, 0x00, 0x10])).line,
            "LSK INJ 0aff0010"
        )
    }

    // MARK: - What the deck refuses, refused here first

    func testEmptyOrControlCharacterTextIsRefusedBeforeItReachesTheCable() {
        // A newline inside a message would end the command early and turn its
        // tail into a second, garbage command.
        XCTAssertThrowsError(try LSKCommand.broadcastText("").encoded()) { error in
            XCTAssertEqual(error as? LSKCommandError, .emptyText)
        }
        XCTAssertThrowsError(try LSKCommand.broadcastText("a\nb").encoded()) { error in
            XCTAssertEqual(error as? LSKCommandError, .controlCharacterInText)
        }
        XCTAssertThrowsError(
            try LSKCommand.directMessage(node: 1, text: "a\rb").encoded()
        ) { error in
            XCTAssertEqual(error as? LSKCommandError, .controlCharacterInText)
        }
    }

    func testInjectingNothingOrMoreThanARadioFrameIsRefused() {
        XCTAssertThrowsError(try LSKCommand.injectFrame(Data()).encoded()) { error in
            XCTAssertEqual(error as? LSKCommandError, .emptyFrame)
        }
        let tooBig = Data(repeating: 0, count: 256)
        XCTAssertThrowsError(try LSKCommand.injectFrame(tooBig).encoded()) { error in
            XCTAssertEqual(error as? LSKCommandError, .frameTooLong(bytes: 256, limit: 255))
        }
    }

    func testAnInjectPastTheDecksLineBufferIsRefusedRatherThanSilentlyDropped() {
        // "LSK INJ " is 8 characters and the deck's line buffer holds 239, so
        // 115 bytes is the largest frame that can be injected at all. The
        // firmware does not report the overflow: it resets the buffer mid-line
        // and parses the tail as a new command.
        XCTAssertNoThrow(try LSKCommand.injectFrame(Data(repeating: 0xAB, count: 115)).encoded())
        XCTAssertThrowsError(
            try LSKCommand.injectFrame(Data(repeating: 0xAB, count: 116)).encoded()
        ) { error in
            XCTAssertEqual(
                error as? LSKCommandError,
                .tooLongForDeck(characters: 8 + 232, limit: 239)
            )
        }
    }

    func testAMessagePastTheDecksLineBufferIsRefused() {
        // "LSK TX meshtastic text " is 23 characters.
        let longest = String(repeating: "x", count: 239 - 23)
        XCTAssertNoThrow(try LSKCommand.broadcastText(longest).encoded())
        XCTAssertThrowsError(try LSKCommand.broadcastText(longest + "x").encoded())
    }

    func testTheLimitIsCountedInBytesNotCharacters() {
        // The deck's buffer is 240 bytes of C string; an emoji is four of them.
        let emoji = String(repeating: "\u{1F4E1}", count: 60)  // 240 UTF-8 bytes
        XCTAssertEqual(emoji.count, 60)
        XCTAssertThrowsError(try LSKCommand.broadcastText(emoji).encoded())
    }

    func testEncodedLineEndsInTheTerminatorTheDecksLoopWaitsFor() {
        XCTAssertEqual(try LSKCommand.sweepStart.encoded(), "LSK SWEEP start\n")
    }

    // MARK: - Node rumours

    func testRumourNodeMatchesTheGrammarHandleMeshTxCommandParses() {
        // sscanf(line + 9, "%8lx %ld %ld %8s").
        XCTAssertEqual(
            LSKCommand.rumourNode(
                id: 0xa1b2_c3d4, latitudeE7: 379_110_000, longitudeE7: -1_220_180_000,
                label: "BAY"
            ).line,
            "LSK NODE a1b2c3d4 379110000 -1220180000 BAY"
        )
    }

    func testRumourNodeExpectsNoReplyBecauseTheFirmwareNeverRoutesIt() {
        // handle_analyzer_link_command dispatches to handle_mesh_tx_command only
        // on the "LSK TX " prefix, so that function's "LSK NODE " branch is
        // unreachable and the line has no effect and no answer. A caller that
        // waited for LSK OK here would wait forever.
        XCTAssertEqual(
            LSKCommand.rumourNode(id: 1, latitudeE7: 0, longitudeE7: 0, label: "A").expectedReply,
            LSKCommand.ExpectedReply.none
        )
    }

    func testRumourNodeRefusesTheIdsAndLabelsTheFirmwareRefuses() {
        XCTAssertThrowsError(
            try LSKCommand.rumourNode(id: 0, latitudeE7: 0, longitudeE7: 0, label: "A").encoded()
        )
        XCTAssertThrowsError(
            try LSKCommand.rumourNode(
                id: 0xffff_ffff, latitudeE7: 0, longitudeE7: 0, label: "A"
            ).encoded()
        )
        // %8s stops at whitespace, so a label with a space arrives cut.
        XCTAssertThrowsError(
            try LSKCommand.rumourNode(id: 1, latitudeE7: 0, longitudeE7: 0, label: "BAY AREA")
                .encoded()
        ) { error in
            XCTAssertEqual(error as? LSKCommandError, .invalidNodeLabel("BAY AREA"))
        }
        // %8s into char[9] truncates a ninth character.
        XCTAssertThrowsError(
            try LSKCommand.rumourNode(id: 1, latitudeE7: 0, longitudeE7: 0, label: "NINECHARS")
                .encoded()
        )
        XCTAssertNoThrow(
            try LSKCommand.rumourNode(id: 1, latitudeE7: 0, longitudeE7: 0, label: "EIGHTCHR")
                .encoded()
        )
    }

    func testErrorsReadAsSomethingAnOperatorCanActOn() {
        XCTAssertEqual(
            LSKCommandError.tooLongForDeck(characters: 300, limit: 239).description,
            "300 characters is past the deck's 239-character line buffer, and it discards a "
            + "longer line without saying so"
        )
    }
}
