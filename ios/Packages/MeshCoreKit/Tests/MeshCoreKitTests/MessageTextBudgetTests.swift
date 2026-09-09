import XCTest
@testable import MeshCoreKit

final class MessageTextBudgetTests: XCTestCase {
    func testASCIIAndWhitespace() {
        XCTAssertFalse(MessageTextBudget(" \n ").canSend)
        XCTAssertTrue(MessageTextBudget(String(repeating: "a", count: 160)).canSend)
        XCTAssertFalse(MessageTextBudget(String(repeating: "a", count: 161)).canSend)
        XCTAssertEqual(MessageTextBudget("  hello \n").text, "hello")
    }

    func testEncodedCharactersAndQuoteOverhead() {
        XCTAssertTrue(MessageTextBudget(String(repeating: "é", count: 80)).canSend)
        XCTAssertFalse(MessageTextBudget(String(repeating: "é", count: 81)).canSend)
        let reply = String(repeating: "a", count: 150)
        XCTAssertTrue(MessageTextBudget(reply).canSend)
        XCTAssertFalse(MessageTextBudget("@[Alex]\n>Previous..\n" + reply).canSend)
        XCTAssertTrue(MessageTextBudget(String(repeating: "a", count: 200), limit: 200).canSend)
    }

    func testFramesNeverSplitUnicode() {
        let original = String(repeating: "a", count: 159) + "é"
        let direct = MeshCoreProtocol.buildSendTextMessage(text: original, recipientKeyHash: Data(repeating: 1, count: 6))
        XCTAssertEqual(String(data: direct.dropFirst(13), encoding: .utf8), String(repeating: "a", count: 159))
        let channel = MeshCoreProtocol.buildSendChannelMessage(text: original)
        XCTAssertEqual(String(data: channel.dropFirst(7), encoding: .utf8), String(repeating: "a", count: 159))
        XCTAssertEqual(MessageTextBudget.prefix("e\u{301}x", maxBytes: 2), "")
        XCTAssertEqual(MessageTextBudget.prefix("e\u{301}x", maxBytes: 3), "e\u{301}")
    }
}
