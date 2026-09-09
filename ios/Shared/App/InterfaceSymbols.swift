import Foundation
import MeshCoreKit

/// The saved values remain compatible with existing groups. Only their visual
/// presentation changes: system symbols replace the old emoji picker and badges.
enum GroupIcon: String, CaseIterable, Identifiable {
    case radio = "📡", home = "🏠", mountain = "🏔️", forest = "🌲", city = "🏙️"
    case camp = "⛺", car = "🚗", tools = "🛠️", lock = "🔒", star = "⭐"
    case fire = "🔥", chat = "💬", location = "📍", water = "🌊", target = "🎯"

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .radio: "antenna.radiowaves.left.and.right"
        case .home: "house"
        case .mountain: "mountain.2"
        case .forest: "tree"
        case .city: "building.2"
        case .camp: "tent"
        case .car: "car"
        case .tools: "wrench.and.screwdriver"
        case .lock: "lock"
        case .star: "star"
        case .fire: "flame"
        case .chat: "bubble.left.and.bubble.right"
        case .location: "mappin"
        case .water: "water.waves"
        case .target: "scope"
        }
    }

    var label: String {
        switch self {
        case .radio: "Radio"
        case .home: "Home"
        case .mountain: "Mountain"
        case .forest: "Forest"
        case .city: "City"
        case .camp: "Camp"
        case .car: "Car"
        case .tools: "Tools"
        case .lock: "Private"
        case .star: "Star"
        case .fire: "Fire"
        case .chat: "Chat"
        case .location: "Location"
        case .water: "Water"
        case .target: "Target"
        }
    }

    static func symbolName(for savedValue: String) -> String {
        GroupIcon(rawValue: savedValue)?.symbolName ?? "folder"
    }
}

/// MeshCore's reaction payload values are preserved on the wire and in storage.
/// Controls and badges use these words and SF Symbols instead of rendering them.
enum MessageReaction: String, CaseIterable, Identifiable {
    case like = "👍", love = "❤️", laugh = "😂", surprised = "😮", sad = "😢", thanks = "🙏"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .like: "Like"
        case .love: "Love"
        case .laugh: "Laugh"
        case .surprised: "Surprised"
        case .sad: "Sad"
        case .thanks: "Thanks"
        }
    }

    var symbolName: String {
        switch self {
        case .like: "hand.thumbsup"
        case .love: "heart"
        case .laugh: "face.smiling"
        case .surprised: "exclamationmark.bubble"
        case .sad: "cloud.rain"
        case .thanks: "hands.clap"
        }
    }

    static func reaction(for savedValue: String) -> MessageReaction? {
        allCases.first {
            $0.rawValue.replacingOccurrences(of: "\u{FE0F}", with: "")
                == savedValue.replacingOccurrences(of: "\u{FE0F}", with: "")
        }
    }

    static func label(for savedValue: String) -> String {
        reaction(for: savedValue)?.label ?? "Reaction"
    }

    static func symbolName(for savedValue: String) -> String {
        reaction(for: savedValue)?.symbolName ?? "bubble.left"
    }
}


extension Message {
    /// Display protocol-generated reaction commands as words. Ordinary message
    /// text and the interoperable payload remain unchanged.
    var interfaceText: String {
        let parts = text.split(separator: "\n", omittingEmptySubsequences: false)
        let alphabet = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
        guard parts.count == 2, parts[1].count == 8,
              parts[1].allSatisfy({ alphabet.contains($0) }) else { return text }
        for reaction in MessageReaction.allCases where parts[0].hasPrefix(reaction.rawValue) {
            let recipient = parts[0].dropFirst(reaction.rawValue.count)
            if recipient.isEmpty || (recipient.hasPrefix("@[") && recipient.hasSuffix("]")) {
                return "Reaction: \(reaction.label)"
            }
        }
        return text
    }
}
