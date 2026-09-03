//
//  WidgetState.swift
//  PommeCore
//
//  Shared between the main iOS app (writes) and the widget extension (reads)
//  via a shared App Group UserDefaults container.
//

import Foundation

let widgetAppGroupID = "group.com.mbedworth.meshcore"
private let widgetStateKey = "widgetState"

struct WidgetState: Codable {
    var isConnected: Bool = false
    var deviceName: String = ""
    var batteryPct: Int = -1        // -1 = unknown
    var unreadCount: Int = 0
    var unreadDMCount: Int = 0
    var unreadChannelCount: Int = 0
    var activeZoneCount: Int = 0
    var alertZoneName: String? = nil
    var lastMessageSender: String? = nil
    var lastMessagePreview: String? = nil
    var lastMessageDate: Date? = nil

    static func load() -> WidgetState {
        guard let defaults = UserDefaults(suiteName: widgetAppGroupID),
              let data = defaults.data(forKey: widgetStateKey),
              let state = try? JSONDecoder().decode(WidgetState.self, from: data) else {
            return WidgetState()
        }
        return state
    }

    func save() {
        guard let defaults = UserDefaults(suiteName: widgetAppGroupID),
              let data = try? JSONEncoder().encode(self) else { return }
        defaults.set(data, forKey: widgetStateKey)
    }
}

extension WidgetState {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        isConnected = try c.decodeIfPresent(Bool.self, forKey: .isConnected) ?? false
        deviceName = try c.decodeIfPresent(String.self, forKey: .deviceName) ?? ""
        batteryPct = try c.decodeIfPresent(Int.self, forKey: .batteryPct) ?? -1
        unreadCount = try c.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
        unreadDMCount = try c.decodeIfPresent(Int.self, forKey: .unreadDMCount) ?? 0
        unreadChannelCount = try c.decodeIfPresent(Int.self, forKey: .unreadChannelCount) ?? 0
        activeZoneCount = try c.decodeIfPresent(Int.self, forKey: .activeZoneCount) ?? 0
        alertZoneName = try c.decodeIfPresent(String.self, forKey: .alertZoneName)
        lastMessageSender = try c.decodeIfPresent(String.self, forKey: .lastMessageSender)
        lastMessagePreview = try c.decodeIfPresent(String.self, forKey: .lastMessagePreview)
        lastMessageDate = try c.decodeIfPresent(Date.self, forKey: .lastMessageDate)
    }
}
