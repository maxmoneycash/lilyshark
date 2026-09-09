#if !os(watchOS)
import Foundation
import CryptoKit
import MeshCoreKit

/// Caches the shared coverage feed or a personal authorized feed.
@MainActor @Observable
final class CommunityCoverageStore {
    private(set) var report: MeshMapperCoverage?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var checkedAt: Date?
    private(set) var hasKey = false
    var filter = MeshMapperFilter()
    private var apiKey = ""
    private var etag: String?
    private var blockedUntil: Date?
    private static let credentialID = Data("meshmapper-coverage".utf8)
    private static let minimumInterval: TimeInterval = 15 * 60
    // Provider URLs contain credentials: never let URLCache persist those URLs.
    private static let privateSession = URLSession(configuration: .ephemeral)

    private struct Cache: Codable {
        let report: MeshMapperCoverage?
        let checkedAt: Date
        let etag: String?
        let blockedUntil: Date?
    }

    init() {
        apiKey = KeychainManager.getPassword(forDevice: Self.credentialID, type: "coverage-api") ?? ""
        hasKey = !apiKey.isEmpty
        restoreCache()
    }

    var filteredCells: [MeshMapperCell] { report?.validCells.filter(filter.includes) ?? [] }
    var nextRefresh: Date? {
        guard let checkedAt else { return blockedUntil }
        return max(checkedAt.addingTimeInterval(Self.minimumInterval), blockedUntil ?? .distantPast)
    }

    func saveKey(_ value: String) -> Bool {
        guard !isLoading else { return false }
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let saved = key.isEmpty
            ? KeychainManager.deletePassword(forDevice: Self.credentialID, type: "coverage-api")
            : KeychainManager.savePassword(key, forDevice: Self.credentialID, type: "coverage-api")
        guard saved else {
            errorMessage = "The coverage key could not be saved securely. Try again."
            return false
        }
        apiKey = key
        hasKey = !key.isEmpty
        report = nil
        checkedAt = nil
        etag = nil
        blockedUntil = nil
        errorMessage = nil
        restoreCache()
        return true
    }

    func refresh() async {
        guard !isLoading else { return }
        guard nextRefresh.map({ $0 <= Date() }) ?? true else { return }
        isLoading = true
        defer { isLoading = false }
        // The key stays in Keychain and the HTTPS request. Never log this URL.
        var components = URLComponents(string: hasKey ? "https://meshmapper.net/coverage.php" : "https://lilyshark.com/api/community-coverage")!
        if hasKey { components.queryItems = [URLQueryItem(name: "key", value: apiKey), URLQueryItem(name: "include", value: "repeaters")] }
        guard let url = components.url else { return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        if let etag, report != nil { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        // A request may spend provider quota even when its response is lost.
        // Persist the attempt before starting it so timeouts/restarts cannot
        // immediately retry a personal feed and exhaust its daily allowance.
        checkedAt = Date()
        persistCache()
        do {
            let session = hasKey ? Self.privateSession : URLSession.shared
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            checkedAt = Date()
            blockedUntil = nil
            defer { persistCache() }
            switch http.statusCode {
            case 200:
                let decoded = try await Task.detached(priority: .userInitiated) {
                    try MeshMapperCoverage.decode(data)
                }.value
                try Task.checkCancellation()
                report = decoded
                etag = http.value(forHTTPHeaderField: "ETag")
            case 304 where report != nil: break
            case 404, 503:
                errorMessage = hasKey ? "The coverage service is unavailable. Saved observations remain available." : "Community coverage is not connected yet. Repeater positions remain available."
                return
            case 401, 403:
                errorMessage = hasKey
                    ? "The coverage service rejected this key. Check its region and access with the issuer."
                    : "Community coverage is temporarily unavailable. Any saved observations remain available."
                return
            case 429:
                errorMessage = "The coverage service’s daily request limit has been reached. Your saved coverage is still available."
                let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                let delay = MeshMapperRefreshPolicy.retryDelay(resetsInHours: body?["resets_in_hours"] as? Double, retryAfter: http.value(forHTTPHeaderField: "Retry-After"))
                blockedUntil = Date().addingTimeInterval(delay)
                return
            default: throw URLError(.badServerResponse)
            }
            checkedAt = Date()
            errorMessage = nil
        } catch {
            guard !(error is CancellationError), (error as? URLError)?.code != .cancelled else { return }
            errorMessage = "Coverage could not be refreshed. Check your connection and try again."
        }
    }

    private var cacheURL: URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lilyshark/Coverage", isDirectory: true)
        let digest = SHA256.hash(data: Data(apiKey.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent("\(digest).json")
    }

    private func restoreCache() {
        guard let data = try? Data(contentsOf: cacheURL),
              let cache = try? JSONDecoder().decode(Cache.self, from: data) else { return }
        report = cache.report
        checkedAt = cache.checkedAt
        etag = cache.etag
        blockedUntil = cache.blockedUntil
    }

    private func persistCache() {
        guard let checkedAt else { return }
        do {
            try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(Cache(report: report, checkedAt: checkedAt, etag: etag, blockedUntil: blockedUntil))
            try data.write(to: cacheURL, options: .atomic)
        } catch {
            errorMessage = "The offline coverage cache could not be saved."
        }
    }
}
#endif
