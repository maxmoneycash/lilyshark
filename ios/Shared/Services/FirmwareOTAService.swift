//
//  FirmwareOTAService.swift
//  PommeCore
//
//  State machine for ESP32 WiFi OTA firmware updates.
//  Flow: fetch assets → select binary → download → wait for OTA WiFi → upload → done.
//
//  Created by Michael P. Bedworth on 04/19/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

import Foundation
import CryptoKit
#if os(macOS) || targetEnvironment(macCatalyst)
import Network
#endif

// MARK: - OTAAsset

struct OTAAsset: Identifiable, Sendable {
    let id = UUID()
    let name: String
    let downloadURL: String
    let sizeBytes: Int

    var boardName: String {
        let delimiters = ["_companion_radio", "_repeater", "_room_server"]
        for delimiter in delimiters {
            if let range = name.range(of: delimiter) {
                return String(name[name.startIndex..<range.lowerBound])
            }
        }
        return name
    }

    var isBLE: Bool { name.contains("_companion_radio_ble") }
    var isMerged: Bool { name.hasSuffix("-merged.bin") }
    /// ZIP = nRF52 device → Nordic DFU flow. BIN = ESP32 device → WiFi OTA flow.
    var isZip: Bool { name.hasSuffix(".zip") }

    var displayName: String {
        boardName.replacingOccurrences(of: "_", with: " ")
    }

    /// Firmware version string extracted from the asset filename (e.g. "v1.15.0-dee3e26").
    var version: String? {
        var base = name
        if let dot = base.lastIndex(of: ".") { base = String(base[base.startIndex..<dot]) }
        // Find the last "_v" — this is the firmware version suffix, not a board revision
        if let range = base.range(of: "_v", options: .backwards) {
            return "v" + String(base[range.upperBound...])
        }
        return nil
    }

    var sizeFormatted: String {
        let kb = Double(sizeBytes) / 1024
        return kb < 1024 ? String(format: "%.0f KB", kb) : String(format: "%.1f MB", kb / 1024)
    }
}

// MARK: - FirmwareOTAService

@MainActor @Observable
final class FirmwareOTAService {

    enum FirmwareType {
        case companion, repeater, room

        var tagPrefix: String {
            switch self {
            case .companion: return "companion-v"
            case .repeater: return "repeater-v"
            case .room: return "room-server-v"
            }
        }

        /// Substring that must appear in asset filenames for this firmware type.
        var assetFragment: String {
            switch self {
            case .companion: return "companion_radio"
            case .repeater: return "_repeater"
            case .room: return "_room_server"
            }
        }

        var displayName: String {
            switch self {
            case .companion: return "Companion Radio"
            case .repeater: return "Repeater"
            case .room: return "Room Server"
            }
        }
    }

    enum Step {
        case ready
        case fetchingAssets
        case selectingFirmware(assets: [OTAAsset], suggested: OTAAsset?)
        case downloading(progress: Double, asset: OTAAsset)
        case activateOTA(firmwareData: Data, asset: OTAAsset)
        case detectingRadio(firmwareData: Data, asset: OTAAsset)
        case uploading(progress: Double, asset: OTAAsset)
        /// nRF52 path: radio is in DFU mode, user installs firmware via nRF DFU app.
        case dfuHandoff(zipData: Data, asset: OTAAsset)
        case done(asset: OTAAsset)
        case failed(String, canRetry: Bool)
    }

    var step: Step = .ready
    private var isCancelled = false

    static let otaSSID = "MeshCore-OTA"
    private static let otaHost = "http://192.168.4.1"
    private static let releasesURL = "https://api.github.com/repos/meshcore-dev/MeshCore/releases"

    // MARK: - WiFi Probe (macOS)

    #if os(macOS) || targetEnvironment(macCatalyst)
    /// TCP probe to 192.168.4.1:80 forced through the WiFi interface.
    /// On macOS with Ethernet + WiFi active, URLSession follows the routing table and
    /// may use Ethernet (where there is no route to 192.168.4.0/24). NWConnection with
    /// requiredInterfaceType = .wifi bypasses that and goes directly over WiFi.
    private nonisolated static func probeOTAHostViaWiFi() async -> Bool {
        final class Gate: @unchecked Sendable { var fired = false }
        return await withCheckedContinuation { continuation in
            let gate = Gate()
            let params = NWParameters.tcp
            params.requiredInterfaceType = .wifi
            let conn = NWConnection(host: "192.168.4.1", port: 80, using: params)
            let q = DispatchQueue(label: "ota.wifi.probe", qos: .utility)
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    guard !gate.fired else { return }
                    gate.fired = true
                    conn.cancel()
                    continuation.resume(returning: true)
                case .failed:
                    guard !gate.fired else { return }
                    gate.fired = true
                    continuation.resume(returning: false)
                default: break
                }
            }
            conn.start(queue: q)
            q.asyncAfter(deadline: .now() + 3) {
                guard !gate.fired else { return }
                gate.fired = true
                conn.cancel()
                continuation.resume(returning: false)
            }
        }
    }
    #endif

    // MARK: - WiFi Upload (macOS)

    #if os(macOS) || targetEnvironment(macCatalyst)
    /// Uploads firmware via NWConnection forced through WiFi with chunked progress.
    /// URLSession on macOS hands the entire body to the TCP send buffer at once and
    /// reports 100% immediately; NWConnection with 8 KB sequential chunks fires a
    /// completion per chunk, giving progress that tracks actual transfer rate.
    private func uploadFirmwareViaWiFi(_ data: Data, asset: OTAAsset) async throws {
        let md5 = Insecure.MD5.hash(data: data).map { String(format: "%02hhx", $0) }.joined()
        let boundary = "MeshCoreOTA\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var body = Data()
        body += "--\(boundary)\r\n".utf8Data
        body += "Content-Disposition: form-data; name=\"MD5\"\r\n\r\n".utf8Data
        body += md5.utf8Data
        body += "\r\n".utf8Data
        body += "--\(boundary)\r\n".utf8Data
        body += "Content-Disposition: form-data; name=\"firmware\"; filename=\"firmware.bin\"\r\n".utf8Data
        body += "Content-Type: application/octet-stream\r\n\r\n".utf8Data
        body += data
        body += "\r\n--\(boundary)--\r\n".utf8Data

        let headerData = Data("POST /update HTTP/1.1\r\nHost: 192.168.4.1\r\nContent-Type: multipart/form-data; boundary=\(boundary)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)

        let params = NWParameters.tcp
        params.requiredInterfaceType = .wifi
        let conn = NWConnection(host: "192.168.4.1", port: 80, using: params)
        let q = DispatchQueue(label: "ota.upload.mac", qos: .userInitiated)

        // Wait for TCP connection
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            final class Gate: @unchecked Sendable { var fired = false }
            let gate = Gate()
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    guard !gate.fired else { return }
                    gate.fired = true
                    cont.resume()
                case .failed(let err):
                    guard !gate.fired else { return }
                    gate.fired = true
                    cont.resume(throwing: err)
                default: break
                }
            }
            conn.start(queue: q)
        }

        // Send HTTP headers
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            conn.send(content: headerData, completion: .contentProcessed { err in
                if let err { cont.resume(throwing: err) } else { cont.resume() }
            })
        }

        // Send body in 8 KB chunks — each completion fires when the chunk leaves the app,
        // yielding ~128 progress ticks for a 1 MB firmware rather than one instant jump.
        let chunkSize = 8192
        var offset = 0
        let total = body.count
        while offset < total {
            guard !isCancelled else { conn.cancel(); throw OTAError.cancelled }
            let end = min(offset + chunkSize, total)
            let chunk = Data(body[offset..<end])
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                conn.send(content: chunk, completion: .contentProcessed { err in
                    if let err { cont.resume(throwing: err) } else { cont.resume() }
                })
            }
            offset = end
            step = .uploading(progress: Double(offset) / Double(total), asset: asset)
        }

        // Wait for ESP32 to respond or drop the connection (reboot after successful flash).
        // Guard with a gate + 15s timeout: when the ESP32 reboots it may drop WiFi without
        // sending a TCP FIN, and NWConnection on macOS can miss the close event entirely.
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            final class Gate: @unchecked Sendable { var fired = false }
            let gate = Gate()
            func recv() {
                conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { _, _, isComplete, error in
                    if isComplete || error != nil {
                        guard !gate.fired else { return }
                        gate.fired = true
                        cont.resume()
                    } else {
                        recv()
                    }
                }
            }
            recv()
            q.asyncAfter(deadline: .now() + 15) {
                guard !gate.fired else { return }
                gate.fired = true
                cont.resume()
            }
        }
        conn.cancel()
    }
    #endif

    // MARK: - Public API

    func start(manufacturer: String, firmwareType: FirmwareType = .companion) async {
        isCancelled = false
        step = .fetchingAssets
        do {
            let assets = try await fetchAssets(firmwareType: firmwareType)

            let displayAssets: [OTAAsset]
            if firmwareType == .companion {
                // Prefer BLE builds for companion radios; fall back to all if none
                let bleAssets = assets.filter(\.isBLE)
                displayAssets = bleAssets.isEmpty ? assets : bleAssets
            } else {
                displayAssets = assets
            }

            let lowerMfr = manufacturer.lowercased()
            let suggested = displayAssets.first {
                let board = $0.boardName.lowercased()
                return !lowerMfr.isEmpty && (lowerMfr.contains(board) || board.contains(lowerMfr))
            }

            step = .selectingFirmware(assets: displayAssets, suggested: suggested)
        } catch {
            guard !isCancelled else { return }
            step = .failed(error.localizedDescription, canRetry: true)
        }
    }

    func selectAsset(_ asset: OTAAsset) async {
        step = .downloading(progress: 0, asset: asset)
        do {
            let data = try await downloadBinary(asset)
            guard !isCancelled else { return }
            step = .activateOTA(firmwareData: data, asset: asset)
        } catch {
            guard !isCancelled else { return }
            step = .failed(error.localizedDescription, canRetry: true)
        }
    }

    func beginDetection(firmwareData: Data, asset: OTAAsset) {
        if asset.isZip {
            // nRF52: radio is now in Nordic DFU mode — hand off to nRF DFU app
            step = .dfuHandoff(zipData: firmwareData, asset: asset)
        } else {
            // ESP32: poll for WiFi hotspot then upload via HTTP
            step = .detectingRadio(firmwareData: firmwareData, asset: asset)
            Task { await detectAndUpload(firmwareData: firmwareData, asset: asset) }
        }
    }

    func cancel() {
        isCancelled = true
        step = .ready
    }

    func reset() {
        isCancelled = false
        step = .ready
    }

    // MARK: - GitHub Asset Fetch

    private func fetchAssets(firmwareType: FirmwareType) async throws -> [OTAAsset] {
        guard let url = URL(string: Self.releasesURL) else { throw OTAError.invalidURL }
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw OTAError.networkError("GitHub API unavailable — check internet connection")
        }
        guard let releases = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw OTAError.parseError
        }
        guard let release = releases.first(where: {
            ($0["tag_name"] as? String)?.hasPrefix(firmwareType.tagPrefix) == true
        }) else {
            throw OTAError.networkError("No \(firmwareType.displayName) release found on GitHub")
        }
        guard let assets = release["assets"] as? [[String: Any]] else {
            throw OTAError.parseError
        }

        return assets.compactMap { item -> OTAAsset? in
            guard let name = item["name"] as? String,
                  name.contains(firmwareType.assetFragment),
                  !name.contains("-merged"),
                  name.hasSuffix(".bin") || name.hasSuffix(".zip"),
                  let url = item["browser_download_url"] as? String,
                  let size = item["size"] as? Int else { return nil }
            return OTAAsset(name: name, downloadURL: url, sizeBytes: size)
        }
    }

    // MARK: - Binary Download

    private func downloadBinary(_ asset: OTAAsset) async throws -> Data {
        guard let url = URL(string: asset.downloadURL) else { throw OTAError.invalidURL }

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForResource = 120
        let session = URLSession(configuration: config)

        let (asyncBytes, response) = try await session.bytes(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw OTAError.networkError("Download failed — check internet connection")
        }

        // GitHub uses chunked encoding — expectedContentLength is often -1.
        // Fall back to the known asset size for progress reporting.
        // GitHub uses chunked encoding — expectedContentLength is often -1.
        // Fall back to the known asset size for progress reporting.
        let contentLength = Int(response.expectedContentLength)
        let total = contentLength > 0 ? contentLength : asset.sizeBytes
        var received = Data()
        received.reserveCapacity(max(total, asset.sizeBytes))

        var lastReportedPct = 0.0
        for try await byte in asyncBytes {
            guard !isCancelled else { throw OTAError.cancelled }
            received.append(byte)
            if total > 0 {
                let pct = min(Double(received.count) / Double(total), 1.0)
                // Throttle UI updates to every 0.5% — firing on every byte causes
                // 1.2M SwiftUI state mutations and brings the download to a crawl.
                if pct - lastReportedPct >= 0.005 {
                    lastReportedPct = pct
                    if case .downloading(_, let a) = step {
                        step = .downloading(progress: pct, asset: a)
                    }
                }
            }
        }

        guard !received.isEmpty else { throw OTAError.networkError("Downloaded file is empty") }
        return received
    }

    // MARK: - OTA Detection + Upload

    private func detectAndUpload(firmwareData: Data, asset: OTAAsset) async {
        guard let pollURL = URL(string: "\(Self.otaHost)/update") else { return }

        let pollConfig = URLSessionConfiguration.default
        pollConfig.timeoutIntervalForRequest = 3
        pollConfig.timeoutIntervalForResource = 5
        pollConfig.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let pollSession = URLSession(configuration: pollConfig)

        let maxAttempts = 90   // 90 × ~3s = ~4.5 minutes
        var attempts = 0

        while attempts < maxAttempts && !isCancelled {
            // On macOS with Ethernet + WiFi active, URLSession may route 192.168.4.1 via
            // Ethernet (no route there). Use NWConnection with requiredInterfaceType = .wifi
            // to force the probe through WiFi. On iOS, URLSession is fine.
            let isReachable: Bool
            #if os(macOS) || targetEnvironment(macCatalyst)
            isReachable = await Self.probeOTAHostViaWiFi()
            #else
            isReachable = await { () -> Bool in
                do {
                    let (_, response) = try await pollSession.data(from: pollURL)
                    return (response as? HTTPURLResponse)?.statusCode != nil
                } catch { return false }
            }()
            #endif

            if isReachable {
                // Radio is reachable — upload
                step = .uploading(progress: 0, asset: asset)
                do {
                    #if os(macOS) || targetEnvironment(macCatalyst)
                    try await uploadFirmwareViaWiFi(firmwareData, asset: asset)
                    #else
                    try await uploadFirmware(firmwareData, asset: asset)
                    #endif
                    step = .done(asset: asset)
                } catch {
                    guard !isCancelled else { return }
                    step = .failed(error.localizedDescription, canRetry: true)
                }
                return
            }
            attempts += 1
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }

        guard !isCancelled else { return }
        step = .failed(
            "Timed out waiting for radio. Make sure you're connected to '\(Self.otaSSID)' WiFi and that your radio is in OTA mode.",
            canRetry: false
        )
    }

    private func uploadFirmware(_ data: Data, asset: OTAAsset) async throws {
        guard let url = URL(string: "\(Self.otaHost)/update") else { throw OTAError.invalidURL }

        // AsyncElegantOTA requires an MD5 form field before the firmware file.
        // Without it the ESP32 immediately returns 400 "MD5 parameter missing".
        let md5Hex = Insecure.MD5.hash(data: data)
            .map { String(format: "%02hhx", $0) }.joined()

        let boundary = "MeshCoreOTA\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var body = Data()
        // MD5 field must come first so the upload handler can find it on chunk 0
        body += "--\(boundary)\r\n".utf8Data
        body += "Content-Disposition: form-data; name=\"MD5\"\r\n\r\n".utf8Data
        body += md5Hex.utf8Data
        body += "\r\n".utf8Data
        body += "--\(boundary)\r\n".utf8Data
        body += "Content-Disposition: form-data; name=\"firmware\"; filename=\"firmware.bin\"\r\n".utf8Data
        body += "Content-Type: application/octet-stream\r\n\r\n".utf8Data
        body += data
        body += "\r\n--\(boundary)--\r\n".utf8Data

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("\(body.count)", forHTTPHeaderField: "Content-Length")
        request.httpBody = body

        let delegate = UploadProgressDelegate { [weak self] progress in
            guard let self else { return }
            self.step = .uploading(progress: progress, asset: asset)
        }

        // 30s idle timeout per segment; 10 min total — ESP32 AP is slow
        // timeoutInterval on URLRequest is unreliable for large body uploads on macOS;
        // set it on the configuration instead.
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 600
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw OTAError.uploadFailed(0)
            }
            // AsyncElegantOTA returns 200 on success; it may also redirect
            guard http.statusCode < 400 else {
                throw OTAError.uploadFailed(http.statusCode)
            }
        } catch _ as URLError where delegate.allBytesUploaded {
            // ESP32 drops the TCP connection without an HTTP response in two cases:
            // (1) successful flash + immediate reboot, or (2) upload rejection.
            // On macOS the TCP send buffer can hold the entire ~1MB body, so
            // allBytesUploaded fires immediately regardless of what the ESP32 did.
            // Wait briefly, then probe to distinguish reboot (success) from rejection.
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard await isESP32Offline() else {
                throw OTAError.networkError("Upload rejected — device did not reboot. Verify you selected the correct firmware for your hardware.")
            }
        }
    }

    private func isESP32Offline() async -> Bool {
        guard let url = URL(string: "\(Self.otaHost)/update") else { return false }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 3
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let session = URLSession(configuration: config)
        do {
            _ = try await session.data(from: url)
            return false  // still reachable = ESP32 is running = OTA was rejected
        } catch {
            return true   // unreachable = ESP32 is rebooting = OTA succeeded
        }
    }

    // MARK: - Errors

    enum OTAError: LocalizedError {
        case invalidURL
        case networkError(String)
        case parseError
        case cancelled
        case uploadFailed(Int)

        var errorDescription: String? {
            switch self {
            case .invalidURL: return "Invalid URL"
            case .networkError(let m): return m
            case .parseError: return "Could not parse release information from GitHub"
            case .cancelled: return "Cancelled"
            case .uploadFailed(let c): return c == 0 ? "No response from radio" : "Upload failed (HTTP \(c))"
            }
        }
    }
}

// MARK: - Upload progress delegate

private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onProgress: (Double) -> Void
    /// True once all upload bytes have been sent to the ESP32.
    private(set) var allBytesUploaded = false

    init(onProgress: @escaping (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64,
                    totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        let progress = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
        if totalBytesSent >= totalBytesExpectedToSend { allBytesUploaded = true }
        DispatchQueue.main.async { self.onProgress(progress) }
    }
}

// MARK: - Data helper

private extension String {
    var utf8Data: Data { Data(utf8) }
}

private func += (lhs: inout Data, rhs: Data) { lhs.append(rhs) }
