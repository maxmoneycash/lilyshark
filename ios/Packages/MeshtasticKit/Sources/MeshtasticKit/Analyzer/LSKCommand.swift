//
//  LSKCommand.swift
//  MeshtasticKit
//
//  The host-to-deck half of the analyzer link.
//

import Foundation

/// A command a host can write down the analyzer link.
///
/// Every case corresponds to a branch of `handle_analyzer_link_command` in
/// `src/sim_main.cpp` or of a handler it calls. Use `encoded()` rather than
/// `line` when the values came from anywhere but a literal: the deck's line
/// buffer is finite and it discards an over-long command **silently**, so a
/// caller that never checks gets no error and no effect.
public enum LSKCommand: Equatable, Sendable {
    /// Open the link. The deck answers `LSK ID` and starts streaming.
    case hello
    /// Close the link. The deck stops streaming and logs the parting.
    case goodbye
    /// Start or stop the SX1262 sweeping the band.
    case sweepStart
    case sweepStop
    /// Meshtastic text to the broadcast address.
    case broadcastText(String)
    /// Meshtastic text to one node.
    case directMessage(node: UInt32, text: String)
    /// Ask the deck to transmit its own position / node info.
    case sendPosition
    case sendNodeInfo
    /// A MeshCore advert. `flood` costs the whole mesh airtime, which is why
    /// the deck never sends that form on its own.
    case meshcoreAdvert(flood: Bool)
    /// A frame some other radio heard, relayed in over the internet. The deck
    /// ingests it marked net-relayed and never retransmits it on RF.
    case injectFrame(Data)
    /// A node position learned from the internet rather than heard on the air.
    ///
    /// **The current firmware ignores this line.**
    /// `handle_analyzer_link_command` routes to `handle_mesh_tx_command` only
    /// on the `"LSK TX "` prefix (`src/sim_main.cpp:16174`), and that
    /// function's `"LSK NODE "` branch (`src/sim_main.cpp:15880`) is therefore
    /// unreachable: a `LSK NODE` line falls off the end of the dispatcher's
    /// if/else chain with no reply and no effect. The builder is here so the
    /// app already speaks the grammar the firmware means to accept, and
    /// `expectedReply` is `.none` so no caller waits for an answer that is not
    /// coming. See `LSK.md`.
    case rumourNode(id: UInt32, latitudeE7: Int32, longitudeE7: Int32, label: String)

    /// What the deck sends back.
    public enum ExpectedReply: Equatable, Sendable {
        /// `LSK ID`.
        case identity
        /// `LSK OK` or `LSK ERR`.
        case okOrError
        /// Nothing at all. A caller must not block on a reply.
        case none
    }

    public var expectedReply: ExpectedReply {
        switch self {
        case .hello: return .identity
        case .goodbye: return .none
        // Unreachable in the firmware dispatcher — see the case's own note.
        case .rumourNode: return .none
        default: return .okOrError
        }
    }

    /// The deck reads a command into `char analyzer_link_line[240]`
    /// (`src/sim_main.cpp:397`) and only stores a byte while
    /// `length + 1 < 240`, so 239 characters is the longest line it can hold.
    /// A longer one resets the buffer mid-line: the command is lost and its
    /// tail is then parsed as a line of its own.
    public static let deckLineLimit = 239

    /// The line as the firmware's `strcmp` / `strncmp` branches expect it,
    /// without its terminator. Unvalidated — see `encoded()`.
    public var line: String {
        switch self {
        case .hello:
            return "LSK HELLO"
        case .goodbye:
            return "LSK BYE"
        case .sweepStart:
            return "LSK SWEEP start"
        case .sweepStop:
            return "LSK SWEEP stop"
        case .broadcastText(let text):
            return "LSK TX meshtastic text \(text)"
        case .directMessage(let node, let text):
            return "LSK TX meshtastic dm \(Self.hex8(node)) \(text)"
        case .sendPosition:
            return "LSK TX meshtastic position"
        case .sendNodeInfo:
            return "LSK TX meshtastic nodeinfo"
        case .meshcoreAdvert(let flood):
            return flood ? "LSK TX meshcore advert flood" : "LSK TX meshcore advert"
        case .injectFrame(let bytes):
            return "LSK INJ \(Self.hex(bytes))"
        case .rumourNode(let id, let lat, let lon, let label):
            return "LSK NODE \(Self.hex8(id)) \(lat) \(lon) \(label)"
        }
    }

    /// The line plus its terminator, after checking everything the deck checks
    /// and the one thing it does not report.
    ///
    /// The deck's own refusals come back as `LSK ERR {"reason":…}`, but an
    /// over-long line produces no error at all, and neither does a `LSK NODE`.
    /// Validating here is what turns those into something a caller can show.
    public func encoded() throws -> String {
        try validate()
        let text = line
        guard text.utf8.count <= Self.deckLineLimit else {
            throw LSKCommandError.tooLongForDeck(
                characters: text.utf8.count, limit: Self.deckLineLimit
            )
        }
        return text + "\n"
    }

    private func validate() throws {
        switch self {
        case .broadcastText(let text):
            try Self.validateFreeText(text)
        case .directMessage(let node, let text):
            // The firmware parses the destination as up to eight hex digits
            // terminated by a space and refuses an empty remainder, so a
            // whitespace-only message is a bad-tx on the deck.
            guard node != 0 else { throw LSKCommandError.invalidNodeNumber(node) }
            try Self.validateFreeText(text)
        case .injectFrame(let bytes):
            guard !bytes.isEmpty else { throw LSKCommandError.emptyFrame }
            // kMaxFrameBytes in include/lilyshark/core/raw_frame.h.
            guard bytes.count <= 255 else {
                throw LSKCommandError.frameTooLong(bytes: bytes.count, limit: 255)
            }
        case .rumourNode(let id, _, _, let label):
            // handle_mesh_tx_command refuses 0 and 0xffffffff outright, and
            // sscanf reads the label with %8s into a nine-byte buffer, so a
            // longer label is truncated and one containing a space is cut at
            // the space.
            guard id != 0, id != 0xffff_ffff else {
                throw LSKCommandError.invalidNodeNumber(id)
            }
            guard !label.isEmpty, label.utf8.count <= 8,
                  !label.contains(where: { $0 == " " || $0 == "\t" })
            else { throw LSKCommandError.invalidNodeLabel(label) }
        default:
            break
        }
    }

    /// A newline inside a payload would end the command early and turn its tail
    /// into a second, garbage command; a NUL would end the deck's C string.
    private static func validateFreeText(_ text: String) throws {
        guard !text.isEmpty else { throw LSKCommandError.emptyText }
        guard !text.unicodeScalars.contains(where: { $0.value < 0x20 }) else {
            throw LSKCommandError.controlCharacterInText
        }
    }

    private static func hex8(_ value: UInt32) -> String {
        String(format: "%08x", value)
    }

    private static func hex(_ bytes: Data) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }
}

/// Why a command cannot be put on the wire as asked.
public enum LSKCommandError: Error, Equatable, Sendable, CustomStringConvertible {
    case emptyText
    case controlCharacterInText
    case emptyFrame
    case frameTooLong(bytes: Int, limit: Int)
    case invalidNodeNumber(UInt32)
    case invalidNodeLabel(String)
    case tooLongForDeck(characters: Int, limit: Int)

    public var description: String {
        switch self {
        case .emptyText:
            return "there is no message to send"
        case .controlCharacterInText:
            return "a message cannot contain a newline or other control character — "
                + "the deck reads one command per line"
        case .emptyFrame:
            return "there are no bytes to inject"
        case .frameTooLong(let bytes, let limit):
            return "\(bytes)-byte frame is past the \(limit)-byte radio frame limit"
        case .invalidNodeNumber(let node):
            return "\(String(format: "!%08x", node)) is not a node this deck will accept"
        case .invalidNodeLabel(let label):
            return "\"\(label)\" is not a usable label — up to eight characters, no spaces"
        case .tooLongForDeck(let characters, let limit):
            return "\(characters) characters is past the deck's \(limit)-character line "
                + "buffer, and it discards a longer line without saying so"
        }
    }
}
