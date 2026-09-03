//
//  RadioProfileStore.swift
//  PommeCore
//
//  Saves and restores radio configuration profiles to iCloud KVS.
//  Max 10 profiles, sorted newest-first.
//
//  Created by Michael P. Bedworth on 04/27/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import Observation

@MainActor
@Observable
class RadioProfileStore {
    private(set) var profiles: [RadioProfile] = []

    private let kvsKey = "radioProfiles"

    init() {
        profiles = NSUbiquitousKeyValueStore.default.loadCodable([RadioProfile].self, forKey: kvsKey) ?? []
    }

    func save(_ profile: RadioProfile) {
        if let index = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[index] = profile
        } else {
            profiles.insert(profile, at: 0)
            if profiles.count > 10 { profiles.removeLast() }
        }
        persist()
    }

    func delete(_ profile: RadioProfile) {
        profiles.removeAll { $0.id == profile.id }
        persist()
    }

    func rename(_ profile: RadioProfile, to newName: String) {
        guard let index = profiles.firstIndex(where: { $0.id == profile.id }) else { return }
        profiles[index].name = newName
        persist()
    }

    private func persist() {
        NSUbiquitousKeyValueStore.default.saveCodable(profiles, forKey: kvsKey)
    }
}
