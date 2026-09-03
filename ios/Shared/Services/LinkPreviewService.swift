//
//  LinkPreviewService.swift
//  PommeCore
//
//  Fetches OpenGraph metadata from URLs for inline link previews.
//  Caches results in memory to avoid redundant fetches.
//
//  Created by Michael P. Bedworth on 04/07/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import os.log

actor LinkPreviewService {
    static let shared = LinkPreviewService()

    private static let logger = Logger(subsystem: "com.pommecore", category: "LinkPreview")

    struct LinkMetadata: Sendable {
        let url: URL
        let title: String?
        let description: String?
        let siteName: String?
        let imageURL: URL?
    }

    private var cache: [URL: LinkMetadata] = [:]
    private var pending: Set<URL> = []

    /// Fetch OpenGraph metadata for a URL. Returns cached result if available.
    func fetchMetadata(for url: URL) async -> LinkMetadata? {
        if let cached = cache[url] { return cached }
        guard !pending.contains(url) else { return nil }

        pending.insert(url)
        defer { pending.remove(url) }

        do {
            var request = URLRequest(url: url, timeoutInterval: 5)
            request.setValue("PommeCore/1.0", forHTTPHeaderField: "User-Agent")

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200,
                  let html = String(data: data.prefix(32_000), encoding: .utf8) else {
                return nil
            }

            let metadata = parseOpenGraph(html: html, url: url)
            if metadata.title != nil {
                cache[url] = metadata
            }
            return metadata
        } catch {
            Self.logger.debug("Failed to fetch link preview for \(url.absoluteString): \(error.localizedDescription)")
            return nil
        }
    }

    func clearCache() {
        cache.removeAll()
    }

    // MARK: - OpenGraph Parser

    private func parseOpenGraph(html: String, url: URL) -> LinkMetadata {
        let title = extractMeta(property: "og:title", from: html)
            ?? extractTag("title", from: html)
        let description = extractMeta(property: "og:description", from: html)
            ?? extractMeta(property: "description", from: html)
        let siteName = extractMeta(property: "og:site_name", from: html)
            ?? url.host
        let imageString = extractMeta(property: "og:image", from: html)
        let imageURL: URL? = imageString.flatMap { str in
            if str.hasPrefix("http") { return URL(string: str) }
            // Relative URL
            return URL(string: str, relativeTo: url)
        }

        return LinkMetadata(
            url: url,
            title: title,
            description: description,
            siteName: siteName,
            imageURL: imageURL
        )
    }

    private func extractMeta(property: String, from html: String) -> String? {
        // Match both property= and name= attributes
        let patterns = [
            "meta[^>]*(?:property|name)=[\"']\(NSRegularExpression.escapedPattern(for: property))[\"'][^>]*content=[\"']([^\"']*)[\"']",
            "meta[^>]*content=[\"']([^\"']*)[\"'][^>]*(?:property|name)=[\"']\(NSRegularExpression.escapedPattern(for: property))[\"']"
        ]
        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
               let match = regex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)),
               let range = Range(match.range(at: 1), in: html) {
                let value = String(html[range])
                    .replacingOccurrences(of: "&amp;", with: "&")
                    .replacingOccurrences(of: "&lt;", with: "<")
                    .replacingOccurrences(of: "&gt;", with: ">")
                    .replacingOccurrences(of: "&#39;", with: "'")
                    .replacingOccurrences(of: "&quot;", with: "\"")
                return value.isEmpty ? nil : value
            }
        }
        return nil
    }

    private func extractTag(_ tag: String, from html: String) -> String? {
        let pattern = "<\(tag)[^>]*>([^<]*)</\(tag)>"
        if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
           let match = regex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)),
           let range = Range(match.range(at: 1), in: html) {
            let value = String(html[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : value
        }
        return nil
    }
}
