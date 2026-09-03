//
//  FirmwareUpdateChecker.swift
//  PommeCore
//
//  Checks GitHub for newer MeshCore firmware releases (cached once per day).
//
//  Created by Michael P. Bedworth on 04/07/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import MeshCoreKit

@MainActor @Observable
final class FirmwareUpdateChecker {
    var latestVersion: String?
    var isUpdateAvailable = false
    var isChecking = false
    var lastError: String?

    private static let releaseURL = "https://api.github.com/repos/meshcore-dev/MeshCore/releases/latest"
    private static let cacheKey = "firmwareLatestVersion"
    private static let cacheTimestampKey = "firmwareCheckTimestamp"
    private static let cacheDuration: TimeInterval = 86400 // 24 hours

    /// Check for updates, using cache if less than 24 hours old.
    func checkIfNeeded(currentVersion: String) {
        guard !currentVersion.isEmpty else { return }

        let defaults = UserDefaults.standard
        let lastCheck = defaults.double(forKey: Self.cacheTimestampKey)
        if Date().timeIntervalSince1970 - lastCheck < Self.cacheDuration,
           let cached = defaults.string(forKey: Self.cacheKey) {
            let cleanCached = Self.extractVersion(cached)
            let cleanCurrent = Self.extractVersion(currentVersion)
            latestVersion = cleanCached
            isUpdateAvailable = Self.isNewer(cleanCached, than: cleanCurrent)
            return
        }

        fetchLatest(currentVersion: currentVersion)
    }

    /// Force a fresh check (ignores cache).
    func forceCheck(currentVersion: String) {
        fetchLatest(currentVersion: currentVersion)
    }

    private func fetchLatest(currentVersion: String) {
        guard !isChecking else { return }
        isChecking = true
        lastError = nil

        Task {
            defer { isChecking = false }
            do {
                guard let url = URL(string: Self.releaseURL) else { return }
                var request = URLRequest(url: url)
                request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
                request.timeoutInterval = 15

                let (data, response) = try await URLSession.shared.data(for: request)
                guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                    lastError = "GitHub API returned non-200"
                    return
                }

                guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let tagName = json["tag_name"] as? String else {
                    lastError = "Could not parse release info"
                    return
                }

                let cleanLatest = Self.extractVersion(tagName)
                let cleanCurrent = Self.extractVersion(currentVersion)
                latestVersion = cleanLatest
                isUpdateAvailable = Self.isNewer(cleanLatest, than: cleanCurrent)

                // Cache the raw tag name
                let defaults = UserDefaults.standard
                defaults.set(tagName, forKey: Self.cacheKey)
                defaults.set(Date().timeIntervalSince1970, forKey: Self.cacheTimestampKey)

                DebugLogger.shared.log("FIRMWARE CHECK: latest=\(cleanLatest) current=\(cleanCurrent) update=\(isUpdateAvailable)", level: .info)
            } catch {
                lastError = error.localizedDescription
                DebugLogger.shared.log("FIRMWARE CHECK: error — \(error.localizedDescription)", level: .warning)
            }
        }
    }

    /// Extract clean version string like "1.14.1" from tags like "vcompanion-v1.14.1"
    /// or device strings like "v1.14.1-467959c".
    static func extractVersion(_ input: String) -> String {
        // Find pattern: digits.digits.digits (optional more .digits)
        let pattern = #"(\d+\.\d+\.\d+)"#
        guard let range = input.range(of: pattern, options: .regularExpression) else {
            return input
        }
        return String(input[range])
    }

    /// Compare semantic versions. Returns true if `latest` is newer than `current`.
    private static func isNewer(_ latest: String, than current: String) -> Bool {
        let latestParts = latest.split(separator: ".").compactMap { Int($0) }
        let currentParts = current.split(separator: ".").compactMap { Int($0) }
        for i in 0..<max(latestParts.count, currentParts.count) {
            let l = i < latestParts.count ? latestParts[i] : 0
            let c = i < currentParts.count ? currentParts[i] : 0
            if l > c { return true }
            if l < c { return false }
        }
        return false
    }
}
