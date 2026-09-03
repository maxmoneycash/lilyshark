//
//  RegionalPresetService.swift
//  PommeCore
//
//  Fetches community-contributed regional presets from the open-source repo once
//  per 24 hours. Falls back to cached data when offline. Validates every entry
//  before surfacing it in the preset picker.
//
//  Update rawURL when the GitHub repo is published.
//

import Foundation
import MeshCoreKit

@MainActor @Observable
final class RegionalPresetService {
    var presets: [RadioPreset] = []
    var isFetching = false

    // Update this URL when the repo is published:
    private static let rawURL = "https://raw.githubusercontent.com/mbedworth/PommeCore/main/Resources/regional_presets.json"
    private static let cacheDataKey = "communityPresetsData"
    private static let cacheTimestampKey = "communityPresetsTimestamp"
    private static let cacheDuration: TimeInterval = 86_400 // 24 hours

    func fetchIfNeeded() {
        let defaults = UserDefaults.standard
        let lastFetch = defaults.double(forKey: Self.cacheTimestampKey)

        if Date().timeIntervalSince1970 - lastFetch < Self.cacheDuration,
           let cached = defaults.data(forKey: Self.cacheDataKey) {
            load(from: cached)
            return
        }

        fetch()
    }

    // MARK: - Private

    private func load(from data: Data) {
        let decoder = JSONDecoder()
        guard let manifest = try? decoder.decode(CommunityPresetManifest.self, from: data) else { return }
        presets = manifest.presets.filter(\.isValid).map(\.asRadioPreset)
        DebugLogger.shared.log("COMMUNITY PRESETS: loaded \(presets.count) presets", level: .info)
    }

    private func fetch() {
        guard !isFetching, let url = URL(string: Self.rawURL) else { return }
        isFetching = true

        Task {
            defer { isFetching = false }
            do {
                var request = URLRequest(url: url)
                request.timeoutInterval = 15
                let (data, response) = try await URLSession.shared.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    DebugLogger.shared.log("COMMUNITY PRESETS: non-200 response", level: .warning)
                    return
                }

                load(from: data)

                let defaults = UserDefaults.standard
                defaults.set(data, forKey: Self.cacheDataKey)
                defaults.set(Date().timeIntervalSince1970, forKey: Self.cacheTimestampKey)
            } catch {
                DebugLogger.shared.log("COMMUNITY PRESETS: fetch error — \(error.localizedDescription)", level: .warning)
            }
        }
    }
}
