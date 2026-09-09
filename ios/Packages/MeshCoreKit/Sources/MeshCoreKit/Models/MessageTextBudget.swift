import Foundation

/// Counts the encoded message, including any reply prefix, before radio framing.
public struct MessageTextBudget: Equatable, Sendable {
    public static let meshCoreLimit = 160
    // Matches the app's conservative Meshtastic text budget on the web.
    public static let meshtasticLimit = 200

    public let text: String
    public let limit: Int
    public var byteCount: Int { text.utf8.count }
    public var remaining: Int { limit - byteCount }
    public var canSend: Bool { !text.isEmpty && remaining >= 0 }

    public init(_ text: String, limit: Int = Self.meshCoreLimit) {
        self.text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        self.limit = limit
    }

    /// A defensive framing fallback for non-composer callers. Never emits part
    /// of a Unicode character. The composer and store reject over-budget text.
    public static func prefix(_ text: String, maxBytes: Int) -> String {
        var end = text.startIndex
        var byteCount = 0
        for character in text {
            let size = String(character).utf8.count
            guard byteCount + size <= maxBytes else { break }
            byteCount += size
            end = text.index(after: end)
        }
        return String(text[..<end])
    }
}
