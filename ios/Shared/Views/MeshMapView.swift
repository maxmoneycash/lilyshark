//
//  MeshMapView.swift
//  PommeCore
//
//  Internet mesh map integration with contact pins and map.meshcore.dev overlay.
//
//  Created by Michael P. Bedworth on 3/17/26.
//  Copyright © 2026 Michael P. Bedworth. All rights reserved.
//

#if !os(watchOS)
import SwiftUI
import MapKit
@preconcurrency import CoreLocation
import MeshCoreKit
#if canImport(MeshtasticKit)
import MeshtasticKit
#endif

// MARK: - InternetMapNode

/// A node fetched from the MeshCore internet map (map.meshcore.dev).
typealias InternetMapNode = PublicMeshNode

// MARK: - NodeCluster

/// A cluster of one or more internet map nodes grouped by geographic proximity.
struct NodeCluster: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let nodes: [InternetMapNode]
    var count: Int { nodes.count }
    var isSingle: Bool { nodes.count == 1 }

    /// Dominant node type in the cluster (for icon selection).
    var dominantType: Int {
        var counts = [Int: Int]()
        for n in nodes { counts[n.type, default: 0] += 1 }
        return counts.max(by: { $0.value < $1.value })?.key ?? 0
    }
}

// MARK: - MeshMapService

/// Handles communication with the MeshCore internet map at meshcore.dev.
///
/// **Upload:** Receives the local node's signed advert data (from CMD_EXPORT_CONTACT
/// for self) and POSTs it to the upload endpoint. The advert packet is already signed
/// by the device's Ed25519 private key; no additional signing is needed in the app.
///
/// **Fetch:** Downloads the JSON node list for display on the in-app map alongside
/// local mesh contacts.
@MainActor @Observable
final class MeshMapService {

    static let shared = MeshMapService()

    private static let uploadURL = URL(string: "https://map.meshcore.dev/api/v1/uploader/node")!
    private static let nodesURL  = URL(string: "https://map.meshcore.dev/api/v1/nodes?binary=0&short=0")!

    private(set) var nodes: [InternetMapNode] = []
    private(set) var lastFetchError: String?
    private(set) var lastFetch: Date = .distantPast
    private(set) var isLoading = false
    private var restoredCache = false
    private struct DirectoryCache: Codable, Sendable {
        let source: String
        let fetchedAt: Date
        let nodes: [PublicMeshNode]
    }
    static let sourceURL = URL(string: "https://map.meshcore.io/")!
    private static var cacheURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Lilyshark/Maps/meshcore-directory.json")
    }
    private let fetchInterval: TimeInterval = 300  // 5 minutes

    private init() {}

    // MARK: Upload

    /// Build the JSON data string for map upload. This is the string that gets signed.
    ///
    /// Radio params convert DeviceConfig units → API units:
    ///   freq: radioFrequency (kHz) ÷ 1000 → MHz
    ///   bw:   radioBandwidth (Hz) ÷ 1000 → kHz
    static func buildDataJSON(exportURL: String, freq: Double, bw: Double, sf: Int, cr: Int) -> String? {
        guard exportURL.hasPrefix("meshcore://"),
              !exportURL.dropFirst("meshcore://".count).isEmpty else { return nil }
        let body: [String: Any] = [
            "params": ["freq": freq, "bw": bw, "sf": sf, "cr": cr],
            "links": [exportURL]
        ]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return String(data: jsonData, encoding: .utf8)
    }

    /// Upload the signed node data to the internet map.
    ///
    /// The map API (map.meshcore.dev/api/v1/uploader/node) expects:
    /// ```json
    /// {
    ///   "data": "{\"params\":{...},\"links\":[...]}",
    ///   "signature": "hex_ed25519_signature",
    ///   "publicKey": "hex_ed25519_public_key"
    /// }
    /// ```
    func uploadSignedNode(dataJSON: String, signatureHex: String, publicKeyHex: String) {
        let body: [String: Any] = [
            "data": dataJSON,
            "signature": signatureHex,
            "publicKey": publicKeyHex
        ]
        Task.detached { await MeshMapService.post(body: body) }
    }

    private static func post(body: [String: Any]) async {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else {
            DebugLogger.shared.log("MAP UPLOAD: failed to serialise JSON body", level: .error)
            return
        }

        if let json = String(data: jsonData, encoding: .utf8) {
            DebugLogger.shared.log("MAP UPLOAD: POST \(uploadURL) — \(json.prefix(300))...", level: .info)
        }
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = jsonData
        request.timeoutInterval = 15
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse {
                let respBody = String(data: data, encoding: .utf8) ?? "(no body)"
                DebugLogger.shared.log("MAP UPLOAD: HTTP \(http.statusCode) — \(respBody)", level: .info)
            }
        } catch {
            DebugLogger.shared.log("MAP UPLOAD: \(error.localizedDescription)", level: .error)
        }
    }

    // MARK: Fetch

    /// Fetch internet nodes if the cached data is older than 5 minutes.
    /// Async so callers can await completion before reading `nodes`.
    func fetchIfNeeded() async {
        await restoreDirectory()
        guard Date().timeIntervalSince(lastFetch) > fetchInterval else { return }
        await fetch()
    }

    private func restoreDirectory() async {
        guard !restoredCache else { return }
        restoredCache = true
        let url = Self.cacheURL
        let cached = await Task.detached(priority: .utility) {
            guard let data = try? Data(contentsOf: url) else { return Optional<DirectoryCache>.none }
            return try? JSONDecoder().decode(DirectoryCache.self, from: data)
        }.value
        guard let cached, lastFetch == .distantPast, cached.source == Self.sourceURL.absoluteString,
              cached.fetchedAt <= Date().addingTimeInterval(300) else { return }
        nodes = cached.nodes
        lastFetch = cached.fetchedAt
    }

    /// Force-refresh the internet node list from map.meshcore.dev.
    func fetch() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            var request = URLRequest(url: Self.nodesURL)
            request.timeoutInterval = 15
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let decoded = try await Task.detached(priority: .userInitiated) {
                try PublicMeshNode.decodeDirectory(data)
            }.value
            try Task.checkCancellation()
            nodes = decoded
            lastFetch = Date()
            lastFetchError = nil
            let cache = DirectoryCache(source: Self.sourceURL.absoluteString, fetchedAt: lastFetch, nodes: decoded)
            let url = Self.cacheURL
            let saved = await Task.detached(priority: .utility) {
                do {
                    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try JSONEncoder().encode(cache).write(to: url, options: .atomic)
                    return true
                } catch { return false }
            }.value
            if !saved { lastFetchError = "The map loaded, but its offline copy could not be saved." }
            DebugLogger.shared.log("MAP FETCH: \(decoded.count) internet nodes", level: .info)
        } catch {
            guard !(error is CancellationError), (error as? URLError)?.code != .cancelled else { return }
            lastFetchError = "Internet nodes could not be refreshed."
            DebugLogger.shared.log("MAP FETCH: \(error.localizedDescription)", level: .error)
        }
    }

}

// MARK: - MeshMapMessagePackDecoder

/// Minimal MessagePack decoder for the MeshCore internet map nodes API response.
///
/// Handles all standard MessagePack types. The map API returns an array of node
/// maps with string or integer keys. Latitude and longitude may be floating-point
/// degrees or integer microdegrees; both are handled automatically.
enum MeshMapMessagePackDecoder {

    // MARK: Value type

    enum MPValue {
        case null
        case bool(Bool)
        case int(Int64)
        case uint(UInt64)
        case float(Double)
        case string(String)
        case binary(Data)
        case array([MPValue])
        case map([(MPValue, MPValue)])
    }

    // MARK: Reader

    private struct Reader {
        let data: Data
        var offset: Int = 0

        mutating func readByte() throws -> UInt8 {
            guard offset < data.count else { throw DecodeError.truncated }
            defer { offset += 1 }
            return data[offset]
        }

        mutating func readBytes(_ count: Int) throws -> Data {
            guard offset + count <= data.count else { throw DecodeError.truncated }
            defer { offset += count }
            return data[data.startIndex + offset ..< data.startIndex + offset + count]
        }

        mutating func readUInt16() throws -> UInt16 {
            let b = try readBytes(2)
            return (UInt16(b[b.startIndex]) << 8) | UInt16(b[b.startIndex + 1])
        }

        mutating func readUInt32() throws -> UInt32 {
            let b = try readBytes(4)
            return b.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        }

        mutating func readUInt64() throws -> UInt64 {
            let b = try readBytes(8)
            return b.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        }
    }

    enum DecodeError: Error {
        case truncated
        case unsupportedFormat(UInt8)
    }

    // MARK: Decode

    static func decode(data: Data) throws -> MPValue {
        var r = Reader(data: data)
        return try readValue(&r)
    }

    private static func readValue(_ r: inout Reader) throws -> MPValue {
        let byte = try r.readByte()

        switch byte {
        // Positive fixint 0x00–0x7F
        case 0x00...0x7F: return .int(Int64(byte))

        // Fixmap 0x80–0x8F
        case 0x80...0x8F: return try readMap(count: Int(byte & 0x0F), r: &r)

        // Fixarray 0x90–0x9F
        case 0x90...0x9F: return try readArray(count: Int(byte & 0x0F), r: &r)

        // Fixstr 0xA0–0xBF
        case 0xA0...0xBF:
            return .string(try readString(len: Int(byte & 0x1F), r: &r))

        case 0xC0: return .null
        case 0xC2: return .bool(false)
        case 0xC3: return .bool(true)

        // bin8, bin16, bin32
        case 0xC4: return .binary(try r.readBytes(Int(try r.readByte())))
        case 0xC5: return .binary(try r.readBytes(Int(try r.readUInt16())))
        case 0xC6: return .binary(try r.readBytes(Int(try r.readUInt32())))

        // float32, float64
        case 0xCA:
            let bits = try r.readUInt32()
            return .float(Double(Float(bitPattern: bits)))
        case 0xCB:
            let bits = try r.readUInt64()
            return .float(Double(bitPattern: bits))

        // uint8..64
        case 0xCC: return .uint(UInt64(try r.readByte()))
        case 0xCD: return .uint(UInt64(try r.readUInt16()))
        case 0xCE: return .uint(UInt64(try r.readUInt32()))
        case 0xCF: return .uint(try r.readUInt64())

        // int8..64
        case 0xD0: return .int(Int64(Int8(bitPattern: try r.readByte())))
        case 0xD1: return .int(Int64(Int16(bitPattern: try r.readUInt16())))
        case 0xD2: return .int(Int64(Int32(bitPattern: try r.readUInt32())))
        case 0xD3: return .int(Int64(bitPattern: try r.readUInt64()))

        // fixext1..16 — read and discard (e.g. MessagePack Timestamps used by map API)
        case 0xD4: _ = try r.readBytes(2);  return .null  // type(1) + data(1)
        case 0xD5: _ = try r.readBytes(3);  return .null  // type(1) + data(2)
        case 0xD6: _ = try r.readBytes(5);  return .null  // type(1) + data(4)
        case 0xD7: _ = try r.readBytes(9);  return .null  // type(1) + data(8)
        case 0xD8: _ = try r.readBytes(17); return .null  // type(1) + data(16)

        // str8, str16, str32
        case 0xD9: return .string(try readString(len: Int(try r.readByte()), r: &r))
        case 0xDA: return .string(try readString(len: Int(try r.readUInt16()), r: &r))
        case 0xDB: return .string(try readString(len: Int(try r.readUInt32()), r: &r))

        // array16, array32
        case 0xDC: return try readArray(count: Int(try r.readUInt16()), r: &r)
        case 0xDD: return try readArray(count: Int(try r.readUInt32()), r: &r)

        // map16, map32
        case 0xDE: return try readMap(count: Int(try r.readUInt16()), r: &r)
        case 0xDF: return try readMap(count: Int(try r.readUInt32()), r: &r)

        // Negative fixint 0xE0–0xFF
        case 0xE0...0xFF:
            return .int(Int64(Int8(bitPattern: byte)))

        default:
            throw DecodeError.unsupportedFormat(byte)
        }
    }

    private static func readString(len: Int, r: inout Reader) throws -> String {
        let bytes = try r.readBytes(len)
        return String(data: bytes, encoding: .utf8) ?? ""
    }

    private static func readArray(count: Int, r: inout Reader) throws -> MPValue {
        var arr = [MPValue]()
        arr.reserveCapacity(count)
        for _ in 0..<count { arr.append(try readValue(&r)) }
        return .array(arr)
    }

    private static func readMap(count: Int, r: inout Reader) throws -> MPValue {
        var pairs = [(MPValue, MPValue)]()
        pairs.reserveCapacity(count)
        for _ in 0..<count {
            let k = try readValue(&r)
            let v = try readValue(&r)
            pairs.append((k, v))
        }
        return .map(pairs)
    }

    // MARK: Node extraction

    /// Decode the top-level MessagePack array into `InternetMapNode` values.
    /// Nodes without valid lat/lon are silently skipped.
    static func decodeNodes(from data: Data) -> [InternetMapNode] {
        guard let root = try? decode(data: data),
              case .array(let arr) = root else { return [] }
        return arr.compactMap { extractNode(from: $0) }
    }

    private static func extractNode(from value: MPValue) -> InternetMapNode? {
        guard case .map(let pairs) = value else { return nil }

        // Normalise all keys to strings for uniform lookup.
        var dict = [String: MPValue]()
        for (k, v) in pairs {
            switch k {
            case .string(let s): dict[s] = v
            case .int(let i):    dict[String(i)] = v
            case .uint(let u):   dict[String(u)] = v
            default: break
            }
        }

        // Latitude — try "lat", "lt", "latitude"
        let latRaw = dict["lat"] ?? dict["lt"] ?? dict["latitude"]
        // Longitude — try "lon", "ln", "longitude"
        let lonRaw = dict["lon"] ?? dict["ln"] ?? dict["longitude"]

        guard let latRaw, let lonRaw,
              let lat = toDouble(latRaw),
              let lon = toDouble(lonRaw) else { return nil }

        // Convert microdegrees → degrees when the magnitude exceeds valid degree range.
        let finalLat = abs(lat) > 180 ? lat / 1_000_000.0 : lat
        let finalLon = abs(lon) > 180 ? lon / 1_000_000.0 : lon

        guard abs(finalLat) <= 90, abs(finalLon) <= 180,
              finalLat != 0 || finalLon != 0 else { return nil }

        let name = toString(dict["name"] ?? dict["n"] ?? dict["nm"]) ?? "Unknown"
        let type = toInt(dict["type"] ?? dict["t"]) ?? 0

        return InternetMapNode(
            name: name, latitude: finalLat, longitude: finalLon, type: type,
            publicKey: "", lastAdvert: "", radioFreq: 0, radioBW: 0, radioSF: 0, radioCR: 0
        )
    }

    private static func toDouble(_ v: MPValue) -> Double? {
        switch v {
        case .float(let d): return d
        case .int(let i):   return Double(i)
        case .uint(let u):  return Double(u)
        default:            return nil
        }
    }

    private static func toString(_ v: MPValue?) -> String? {
        guard case .string(let s) = v else { return nil }
        return s.isEmpty ? nil : s
    }

    private static func toInt(_ v: MPValue?) -> Int? {
        switch v {
        case .int(let i):  return Int(i)
        case .uint(let u): return Int(u)
        default:           return nil
        }
    }
}

// MARK: - MeshMapView

@available(iOS 17.0, macOS 14.0, *)
struct RadioMapView: View {
    var topControlsInset: CGFloat = 0
    @Namespace private var mapScope
    @Environment(ConnectionManager.self) private var connection
    @Environment(DeviceConfig.self) private var deviceConfig
    @Environment(ContactStore.self) private var contactStore
    @Environment(NavigationStore.self) private var navigationStore
    @Environment(RFMonitorStore.self) private var rfStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @StateObject private var locationManager = LocationManager()
    @State private var cameraPosition: MapCameraPosition = .automatic
    /// Mirrors the camera's current region. Set explicitly when we move the camera
    /// programmatically so nodes appear without waiting for onMapCameraChange to fire.
    @State private var visibleRegion: MKCoordinateRegion? = nil
    /// Once positioned, live updates never interrupt a user panning the map.
    @State private var hasSetInitialCamera = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// The selected cluster for the detail sheet/popover.
    @State private var selectedCluster: NodeCluster? = nil
    private enum MapOverlay { case none, linkQuality, coverage }
    /// Which overlay (if any) is active on the map.
    @State private var mapOverlay: MapOverlay = .none
    @State private var showNodes = false
    @State private var pendingMapNodeKey: Data?
    @State private var mapFocusGeneration = 0
    @State private var detailContact: Contact?
    @State private var pendingConversation: Data?
    @State private var showInternetNodes = false
    @State private var requestedPhoneLocation = false
    @State private var showLocationHelp = false
    @Environment(\.openURL) private var openURL
    /// Internet map nodes fetched from map.meshcore.dev.
    @State private var internetMapNodes: [InternetMapNode] = []
    @State private var isLoadingInternetNodes = false
    @State private var internetMapError: String?
    @State private var internetRefreshTask: Task<Void, Never>?

    private static let initialSpanDegrees = 0.35

    /// Grid cell size in degrees for clustering. Adapts to zoom level.
    /// At wide zoom (large span) cells are big → heavy clustering.
    /// At close zoom (small span) cells are small → individual nodes.
    private static let clusterThreshold: Double = 0.15

    private var radioCoordinate: CLLocationCoordinate2D? {
        RadioMapPosition.reportedCoordinate(connection: connection, config: deviceConfig, contacts: contactStore)
    }

    private func centerOnAvailablePosition() {
        guard let coordinate = radioCoordinate ?? mappableContacts.first.flatMap(reportedCoordinate) else { return }
        center(on: coordinate)
    }

    private func center(on coordinate: CLLocationCoordinate2D) {
        let region = MKCoordinateRegion(center: coordinate, span: MKCoordinateSpan(latitudeDelta: Self.initialSpanDegrees, longitudeDelta: Self.initialSpanDegrees))
        cameraPosition = .region(region)
        visibleRegion = region
        navigationStore.mapCamera = cameraPosition
        navigationStore.mapRegion = region
        hasSetInitialCamera = true
    }

    private var selectedNode: Contact? {
        mapNodes.first { $0.publicKeyPrefix == navigationStore.selectedMapNodeKey }
    }

    private func focusSelectedNode() {
        navigationStore.mapNeedsFocus = false
        guard let node = selectedNode, let coordinate = reportedCoordinate(for: node) else { return }
        center(on: coordinate)
        // Recreate only for an explicit focus request. MapKit can otherwise
        // retain the search keyboard's viewport when the requested coordinate
        // equals its previous camera binding.
        mapFocusGeneration += 1
    }

    private var mapNodes: [Contact] {
        contactStore.contacts.filter { contact in
            guard !contactStore.isBlocked(contact) else { return false }
            #if canImport(MeshtasticKit)
            if let num = MeshtasticIdentity.nodeNum(forSyntheticKey: contact.publicKey) {
                return num != UInt32(deviceConfig.publicKeyHex, radix: 16)
            }
            #endif
            return contact.publicKey.hexCompact.lowercased() != deviceConfig.publicKeyHex.lowercased()
        }
    }

    private func restoreMap() {
        let identity = deviceConfig.publicKeyHex.lowercased()
        if !identity.isEmpty, navigationStore.mapRadioIdentity != identity {
            // Keep a request made from node details; discard the previous
            // radio's camera when switching to another radio.
            if !navigationStore.mapRadioIdentity.isEmpty && !navigationStore.mapNeedsFocus {
                navigationStore.selectedMapNodeKey = nil
            }
            navigationStore.mapRadioIdentity = identity
            navigationStore.mapCamera = .automatic
            navigationStore.mapRegion = nil
        }
        cameraPosition = navigationStore.mapCamera
        visibleRegion = navigationStore.mapRegion
        hasSetInitialCamera = visibleRegion != nil
        if navigationStore.mapNeedsFocus {
            focusSelectedNode()
        } else if !hasSetInitialCamera {
            if selectedNode != nil { focusSelectedNode() }
            else { centerOnAvailablePosition() }
        }
    }

    private var mappableContacts: [Contact] {
        mapNodes.filter { reportedCoordinate(for: $0) != nil }
    }

    private func reportedCoordinate(for contact: Contact) -> CLLocationCoordinate2D? {
        guard let position = contactStore.reportedPosition(for: contact) else { return nil }
        return CLLocationCoordinate2D(latitude: position.latitude, longitude: position.longitude)
    }

    private var linkQualityEntries: [(contact: Contact, snr: Int8)] {
        var entries: [(contact: Contact, snr: Int8)] = []
        for contact in mappableContacts {
            guard let messages = messageStoreManager.messagesByContact[contact.publicKeyPrefix] else { continue }
            if let snr = messages.filter({ !$0.isOutgoing }).max(by: { $0.timestamp < $1.timestamp })?.snr {
                entries.append((contact: contact, snr: snr))
            }
        }
        return entries
    }

    private func snrColor(_ snr: Int8) -> Color {
        let db = Double(snr) / 4 // Message SNR is stored in quarter-decibels.
        if db > 0 { return .green }
        if db > -10 { return .orange }
        return .red
    }

    private var overlayButtonIcon: String {
        switch mapOverlay {
        case .none: return "antenna.radiowaves.left.and.right.circle"
        case .linkQuality: return "antenna.radiowaves.left.and.right.circle.fill"
        case .coverage: return "map.fill"
        }
    }

    /// Internet nodes clustered by geographic grid cell at the current zoom level.
    private var clusteredNodes: [NodeCluster] {
        guard showInternetNodes, let region = visibleRegion else { return [] }
        let all = internetMapNodes
        guard !all.isEmpty else { return [] }

        // Filter to visible region with padding
        let latHalf = region.span.latitudeDelta / 2
        let lonHalf = region.span.longitudeDelta / 2
        let lat = region.center.latitude
        let lon = region.center.longitude
        let visible = all.filter {
            abs($0.latitude - lat) <= latHalf && abs($0.longitude - lon) <= lonHalf
        }

        // Grid cell size proportional to the visible span
        let cellSize = max(region.span.latitudeDelta, region.span.longitudeDelta) * Self.clusterThreshold

        // Group nodes into grid cells
        var grid = [String: [InternetMapNode]]()
        for node in visible {
            let cellX = Int(floor(node.latitude / cellSize))
            let cellY = Int(floor(node.longitude / cellSize))
            let key = "\(cellX),\(cellY)"
            grid[key, default: []].append(node)
        }

        return grid.map { key, nodes in
            let avgLat = nodes.reduce(0.0) { $0 + $1.latitude } / Double(nodes.count)
            let avgLon = nodes.reduce(0.0) { $0 + $1.longitude } / Double(nodes.count)
            return NodeCluster(
                id: key,
                coordinate: CLLocationCoordinate2D(latitude: avgLat, longitude: avgLon),
                nodes: nodes
            )
        }
    }

    var body: some View {
        ZStack {
            Map(position: $cameraPosition, scope: mapScope) {
                if let radioCoordinate {
                    Annotation("My radio · reported position", coordinate: radioCoordinate) {
                        Label(deviceConfig.deviceName.isEmpty ? "My radio" : deviceConfig.deviceName, systemImage: "antenna.radiowaves.left.and.right")
                            .font(.caption.weight(.bold))
                            .padding(Design.Space.tight)
                            .background(MeshTheme.accent, in: Capsule())
                            .foregroundStyle(.white)
                            .accessibilityLabel("My radio, reported position")
                    }
                }
                // Position history trails
                ForEach(mappableContacts) { contact in
                    let trail = contactStore.positionTrail(for: contact)
                    if trail.count >= 2 {
                        MapPolyline(coordinates: trail.map {
                            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                        })
                        .stroke(contactTypeColor(contact).opacity(0.5), lineWidth: 2)
                    }
                }

                localAnnotations

                internetAnnotations

                // Coverage heat map — GPS-tagged RSSI points from RF monitor
                if mapOverlay == .coverage {
                    ForEach(visibleCoveragePoints) { point in
                        MapCircle(
                            center: CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude),
                            radius: 15
                        )
                        .foregroundStyle(coverageColor(rssi: point.rssi).opacity(0.6))
                    }
                }

                // Link quality lines — SNR-colored from device to each contact with message history
                if mapOverlay == .linkQuality, let deviceCoord = radioCoordinate {
                    ForEach(linkQualityEntries, id: \.contact.id) { entry in
                        if let coordinate = reportedCoordinate(for: entry.contact) {
                        MapPolyline(coordinates: [
                            deviceCoord,
                            coordinate
                        ])
                        .stroke(snrColor(entry.snr).opacity(0.8), lineWidth: 3)
                        }
                    }
                }

                UserAnnotation()
            }
            .id(mapFocusGeneration)
            .onMapCameraChange(frequency: .onEnd) { context in
                // A sheet's keyboard can resize the map underneath it. Those
                // layout changes must not replace the user's saved camera.
                guard !showNodes, detailContact == nil, selectedCluster == nil else { return }
                DispatchQueue.main.async {
                    visibleRegion = context.region
                    navigationStore.mapRegion = context.region
                    navigationStore.mapCamera = .camera(context.camera)
                    if cameraPosition.positionedByUser { hasSetInitialCamera = true }
                }
            }
            .mapControls { MapScaleView() }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .ignoresSafeArea(.container, edges: .top)
            .overlay(alignment: .bottomTrailing) {
                VStack(spacing: Design.Space.tight) {
                    MapCompass(scope: mapScope)
                    Button("Center on my phone", systemImage: "location") {
                        if locationManager.authorizationStatus == .denied || locationManager.authorizationStatus == .restricted {
                            showLocationHelp = true
                        } else {
                            requestedPhoneLocation = true
                            locationManager.requestPermission()
                            if let location = locationManager.currentLocation,
                               location.horizontalAccuracy >= 0, abs(location.timestamp.timeIntervalSinceNow) < 60 {
                                center(on: location.coordinate)
                                requestedPhoneLocation = false
                            }
                        }
                    }
                    .labelStyle(.iconOnly)
                    .frame(width: Design.minimumTouchTarget, height: Design.minimumTouchTarget)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Design.Radius.control))
                }
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .padding(.trailing, Design.Space.snug)
                .padding(.bottom, Design.minimumTouchTarget + Design.Space.loose)
            }

            // Overlays
            VStack {
                // Top bar: loading indicator, legend, coverage toggle
                HStack(alignment: .top) {
                    // Status / legend
                    if isLoadingInternetNodes {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.mini)
                            Text("Loading internet map…")
                                .font(.caption2)
                                .foregroundStyle(MeshTheme.textSecondary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.thinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if mapOverlay == .linkQuality {
                        HStack(spacing: 6) {
                            HStack(spacing: 3) {
                                Circle().fill(Color.green).frame(width: 8, height: 8)
                                Text("> 0 dB")
                            }
                            HStack(spacing: 3) {
                                Circle().fill(Color.orange).frame(width: 8, height: 8)
                                Text("-10–0")
                            }
                            HStack(spacing: 3) {
                                Circle().fill(Color.red).frame(width: 8, height: 8)
                                Text("< -10")
                            }
                            Text("SNR")
                        }
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.thinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if mapOverlay == .coverage {
                        HStack(spacing: 6) {
                            HStack(spacing: 3) {
                                Circle().fill(Color.green).frame(width: 8, height: 8)
                                Text("> -100")
                            }
                            HStack(spacing: 3) {
                                Circle().fill(Color.orange).frame(width: 8, height: 8)
                                Text("-100–-120")
                            }
                            HStack(spacing: 3) {
                                Circle().fill(Color.red).frame(width: 8, height: 8)
                                Text("< -120")
                            }
                            Text("dBm")
                        }
                        .font(.caption2)
                        .foregroundStyle(MeshTheme.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.thinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    } else if showInternetNodes && !internetMapNodes.isEmpty {
                        HStack(spacing: 8) {
                            HStack(spacing: 4) {
                                Circle().fill(MeshTheme.accent).frame(width: 8, height: 8)
                                Text("Local mesh")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.textSecondary)
                            }
                            HStack(spacing: 4) {
                                Circle().fill(MeshTheme.accent).frame(width: 8, height: 8)
                                Text("Internet map (\(internetMapNodes.count))")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.textSecondary)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.thinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    Spacer()
                }
                .padding(.horizontal, 8)
                .padding(.top, Design.Space.tight + topControlsInset)

                Spacer()

                if showInternetNodes, let internetMapError {
                    VStack(alignment: .leading, spacing: Design.Space.tight) {
                        Label(internetMapError, systemImage: "wifi.exclamationmark")
                            .font(.subheadline)
                        Text(internetMapNodes.isEmpty
                             ? "Contacts with reported positions are still shown."
                             : "Showing previously loaded internet nodes and local contacts.")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                        Button("Retry internet map") {
                            internetRefreshTask?.cancel()
                            internetRefreshTask = Task { await fetchInternetMapNodes(force: true) }
                        }
                        .buttonStyle(.meshSecondary)
                        .disabled(isLoadingInternetNodes)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: Design.Radius.control))
                    .padding(.horizontal)
                }

                if mappableContacts.isEmpty && (!showInternetNodes || internetMapNodes.isEmpty) && !isLoadingInternetNodes && selectedNode == nil && radioCoordinate == nil {
                    ContentUnavailableView(
                        "No shared positions to show",
                        systemImage: "mappin.slash",
                        description: Text("Positions shared by your mesh appear here. Open Nodes to find someone, including nodes without a position.")
                    )
                    .padding(8)
                    .background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding(.bottom)
                }

                HStack {
                    Button("Center on my mesh", systemImage: "scope") { centerOnAvailablePosition() }
                        .disabled(radioCoordinate == nil && mappableContacts.isEmpty)
                        .labelStyle(.iconOnly)
                        .frame(minWidth: Design.minimumTouchTarget, minHeight: Design.minimumTouchTarget)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: Design.Radius.control))
                    Button { showNodes = true } label: {
                        if dynamicTypeSize.isAccessibilitySize {
                            Image(systemName: "list.bullet").accessibilityLabel("Nodes")
                        } else {
                            Label("Nodes", systemImage: "list.bullet")
                        }
                    }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, Design.Space.snug)
                        .frame(minHeight: Design.minimumTouchTarget)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: Design.Radius.control))
                    Spacer()
                    Menu {
                        Toggle("Internet nodes", isOn: $showInternetNodes)
                        Divider()
                        Button("No signal overlay") { mapOverlay = .none }
                        Button("Received message SNR") { mapOverlay = .linkQuality }
                        Button("Local reception samples") { mapOverlay = .coverage }
                    } label: {
                        Group {
                            if dynamicTypeSize.isAccessibilitySize {
                                Image(systemName: overlayButtonIcon).accessibilityLabel("Layers")
                            } else {
                                Label(mapOverlay == .coverage ? "Local reception" : mapOverlay == .linkQuality ? "Message SNR" : "Layers", systemImage: overlayButtonIcon)
                            }
                        }
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, Design.Space.snug)
                            .frame(minHeight: Design.minimumTouchTarget)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: Design.Radius.control))
                    }
                }
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
                if mapOverlay != .none {
                    Text(mapOverlay == .coverage
                         ? "Local receive samples from RF Monitor. No return path is verified."
                         : "Lines join reported positions. They are not packet routes; SNR describes the last received hop.")
                        .font(.caption)
                        .padding(Design.Space.tight)
                        .background(.thinMaterial)
                }
            }
        }
        .ignoresSafeArea(.keyboard)
        .navigationTitle("Map")
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let node = selectedNode {
                MapNodeCard(contact: node,
                    openConversation: { navigationStore.sidebarSelection = .contact(node.publicKeyPrefix) },
                    openDetails: { detailContact = node },
                    close: { navigationStore.selectedMapNodeKey = nil })
            }
        }
        .task(id: deviceConfig.publicKeyHex) {
            await Task.yield()
            guard !Task.isCancelled else { return }
            restoreMap()
        }
        .task(id: showInternetNodes) {
            guard showInternetNodes else { return }
            await fetchInternetMapNodes()
        }
        .onDisappear { internetRefreshTask?.cancel() }
        .onChange(of: showInternetNodes) {
            if !showInternetNodes { internetRefreshTask?.cancel() }
        }
        .onChange(of: navigationStore.mapFocusRequest) { focusSelectedNode() }
        .onChange(of: mappableContacts.map(\.publicKeyPrefix)) {
            guard !hasSetInitialCamera else { return }
            centerOnAvailablePosition()
        }
        .onChange(of: radioCoordinate?.latitude) {
            guard !hasSetInitialCamera else { return }
            centerOnAvailablePosition()
        }
        .onChange(of: radioCoordinate?.longitude) {
            guard !hasSetInitialCamera else { return }
            centerOnAvailablePosition()
        }
        .onChange(of: locationManager.currentLocation) { _, location in
            guard requestedPhoneLocation, let location, location.horizontalAccuracy >= 0,
                  abs(location.timestamp.timeIntervalSinceNow) < 60 else { return }
            requestedPhoneLocation = false
            center(on: location.coordinate)
        }
        .onChange(of: locationManager.authorizationStatus) {
            if requestedPhoneLocation && (locationManager.authorizationStatus == .denied || locationManager.authorizationStatus == .restricted) {
                requestedPhoneLocation = false
                showLocationHelp = true
            }
        }
        .alert("Phone location is unavailable", isPresented: $showLocationHelp) {
            #if os(iOS)
            Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
            #endif
            Button("OK", role: .cancel) { }
        } message: {
            Text("You can browse reported node positions without phone location. To center on your phone, allow location access in Settings.")
        }
        .sheet(isPresented: $showNodes, onDismiss: {
            cameraPosition = navigationStore.mapCamera
            visibleRegion = navigationStore.mapRegion
            // Restore the native viewport even when search is cancelled or
            // the selected node has no coordinate to focus.
            mapFocusGeneration += 1
            if let key = pendingMapNodeKey {
                pendingMapNodeKey = nil
                navigationStore.selectedMapNodeKey = key
                focusSelectedNode()
            }
        }) {
            MapNodeList(nodes: mapNodes) { pendingMapNodeKey = $0.publicKeyPrefix }
        }
        .sheet(item: $detailContact, onDismiss: {
            if let key = pendingConversation {
                pendingConversation = nil
                navigationStore.sidebarSelection = .contact(key)
            }
        }) { contact in
            ContactDetailSheet(contact: contact) { pendingConversation = $0.publicKeyPrefix }
        }
        .sheet(item: $selectedCluster) { cluster in
            ClusterDetailView(cluster: cluster)
        }
    }

    @MapContentBuilder
    private var localAnnotations: some MapContent {
                // Selecting a local pin opens its summary without leaving the map.
                ForEach(mappableContacts) { contact in
                    if let coordinate = reportedCoordinate(for: contact) {
                    Annotation(contactStore.displayName(for: contact),
                               coordinate: coordinate) {
                        Button {
                            navigationStore.selectedMapNodeKey = contact.publicKeyPrefix
                        } label: {
                            Circle()
                                .fill(contactTypeColor(contact))
                                .frame(width: selectedNode?.publicKeyPrefix == contact.publicKeyPrefix ? 24 : 14, height: selectedNode?.publicKeyPrefix == contact.publicKeyPrefix ? 24 : 14)
                                .overlay(Circle().strokeBorder(MeshTheme.surface, lineWidth: 2))
                                .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                                .frame(minWidth: Design.minimumTouchTarget, minHeight: Design.minimumTouchTarget)
                                .contentShape(Circle())
                        }
                        .buttonStyle(.meshPlain)
                        .accessibilityLabel("Show \(contactStore.displayName(for: contact)) on map")
                        .accessibilityHint("Shows the reported position and node actions")
                    }
                    }
                }

    }

    @MapContentBuilder
    private var internetAnnotations: some MapContent {
        ForEach(clusteredNodes) { cluster in
            Annotation("", coordinate: cluster.coordinate) {
                Button { selectedCluster = cluster } label: {
                    CoverageRepeaterMarker(count: cluster.count, ambiguous: false, selected: selectedCluster?.id == cluster.id)
                }
                .buttonStyle(.meshPlain)
                .accessibilityLabel(cluster.isSingle ? "Internet node \(cluster.nodes[0].name)" : "\(cluster.count) internet nodes")
                .accessibilityHint("Shows details from the internet map")
            }.annotationTitles(.hidden)
        }
    }

    // MARK: - Coverage layer

    private func coverageColor(rssi: Int8) -> Color {
        let dBm = Int(rssi)
        if dBm > -100 { return .green }
        if dBm > -120 { return .orange }
        return .red
    }

    /// Coverage points filtered to the visible map region for performance.
    private var visibleCoveragePoints: [CoveragePoint] {
        guard let region = visibleRegion else { return rfStore.coveragePoints }
        let latHalf = region.span.latitudeDelta / 2 * 1.2
        let lonHalf = region.span.longitudeDelta / 2 * 1.2
        let lat = region.center.latitude
        let lon = region.center.longitude
        return rfStore.coveragePoints.filter {
            abs($0.latitude - lat) <= latHalf && abs($0.longitude - lon) <= lonHalf
        }
    }

    // MARK: - Cluster sizing

    private func clusterSize(_ count: Int) -> CGFloat {
        switch count {
        case 1...9:    return 36
        case 10...99:  return 42
        case 100...999: return 50
        default:       return 56
        }
    }

    private func clusterLabel(_ count: Int) -> String {
        if count >= 1000 {
            return "\(count / 1000)k"
        }
        return "\(count)"
    }

    // MARK: - Icons

    private func contactTypeIcon(_ contact: Contact) -> String {
        switch contact.type {
        case .chat: return "person.fill"
        case .repeater: return "antenna.radiowaves.left.and.right"
        case .room: return "building.2.fill"
        case .sensor: return "sensor.fill"
        case .unknown: return "questionmark.circle"
        }
    }

    private func contactTypeColor(_ contact: Contact) -> Color {
        switch contact.type {
        case .chat: return .blue
        case .repeater: return MeshTheme.accent
        case .room: return .purple
        case .sensor: return .orange
        case .unknown: return .gray
        }
    }

    /// SF Symbol for an internet map node based on its MeshCore node type.
    static func internetNodeIcon(type: Int) -> String {
        switch type {
        case 1: return "person.fill"
        case 2: return "antenna.radiowaves.left.and.right"
        case 3: return "building.2.fill"
        case 4: return "sensor.fill"
        default: return "globe"
        }
    }

    // MARK: - Internet Map

    private func fetchInternetMapNodes(force: Bool = false) async {
        guard !isLoadingInternetNodes else { return }
        isLoadingInternetNodes = true
        defer { isLoadingInternetNodes = false }
        if force {
            await MeshMapService.shared.fetch()
        } else {
            await MeshMapService.shared.fetchIfNeeded()
        }
        guard !Task.isCancelled else { return }
        internetMapNodes = MeshMapService.shared.nodes
        internetMapError = MeshMapService.shared.lastFetchError
    }
}

// MARK: - ClusterDetailView

/// Shows details for a tapped cluster or single internet map node.
@available(iOS 17.0, macOS 14.0, *)
struct ClusterDetailView: View {
    let cluster: NodeCluster
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if cluster.isSingle {
                    nodeDetailSection(cluster.nodes[0])
                } else {
                    Section {
                        Text("\(cluster.count) nodes in this area")
                            .font(.subheadline)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    ForEach(cluster.nodes.sorted(by: { $0.name < $1.name })) { node in
                        nodeRow(node)
                    }
                }
            }
            .navigationTitle(cluster.isSingle ? cluster.nodes[0].name : "\(cluster.count) Nodes")
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 360, minHeight: 400)
        #endif
    }

    @ViewBuilder
    private func nodeDetailSection(_ node: InternetMapNode) -> some View {
        Section("Node Info") {
            detailRow("Name", node.name)
            detailRow("Type", node.typeName)
            detailRow("Location", String(format: "%.5f, %.5f", node.latitude, node.longitude))
            if !node.lastAdvert.isEmpty {
                detailRow("Last Advert", formatDate(node.lastAdvert))
            }
        }
        Section("Radio Parameters") {
            if node.radioFreq > 0 {
                detailRow("Frequency", String(format: "%.3f MHz", node.radioFreq))
            }
            if node.radioBW > 0 {
                detailRow("Bandwidth", String(format: "%.1f kHz", node.radioBW))
            }
            if node.radioSF > 0 {
                detailRow("Spreading Factor", "\(node.radioSF)")
            }
            if node.radioCR > 0 {
                detailRow("Coding Rate", "\(node.radioCR)")
            }
        }
        if !node.publicKey.isEmpty {
            Section("Public Key") {
                Text(node.publicKey)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(MeshTheme.textSecondary)
                    .textSelection(.enabled)
            }
        }
    }

    @ViewBuilder
    private func nodeRow(_ node: InternetMapNode) -> some View {
        NavigationLink {
            List {
                nodeDetailSection(node)
            }
            .navigationTitle(node.name)
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        } label: {
            HStack(spacing: 10) {
                Image(systemName: RadioMapView.internetNodeIcon(type: node.type))
                    .foregroundStyle(.teal)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.name)
                        .font(.subheadline)
                    Text(node.typeName)
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
                Spacer()
                if node.radioFreq > 0 {
                    Text(String(format: "%.1f", node.radioFreq))
                        .font(.caption)
                        .foregroundStyle(MeshTheme.textSecondary)
                }
            }
        }
    }

    private func detailRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(MeshTheme.textSecondary)
            Spacer()
            Text(value)
                .multilineTextAlignment(.trailing)
        }
    }

    private func formatDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - LocationManager

@MainActor
class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    @Published var authorizationStatus: CLAuthorizationStatus = .notDetermined
    @Published var currentLocation: CLLocation? = nil

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestPermission() {
        switch manager.authorizationStatus {
        case .notDetermined:
            #if os(macOS)
            manager.requestAlwaysAuthorization()
            #else
            manager.requestWhenInUseAuthorization()
            #endif
        default:
            if isAuthorized(manager.authorizationStatus) {
                manager.requestLocation()
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        DispatchQueue.main.async { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.authorizationStatus = status
                if self.isAuthorized(status) {
                    manager.requestLocation()
                }
            }
        }
    }

    private func isAuthorized(_ status: CLAuthorizationStatus) -> Bool {
        #if os(macOS)
        return status == .authorized || status == .authorizedAlways
        #else
        return status == .authorizedWhenInUse || status == .authorizedAlways
        #endif
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        DispatchQueue.main.async { [weak self] in
            Task { @MainActor [weak self] in
                self?.currentLocation = loc
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // requestLocation() failure is non-fatal — map still works without location
    }
}
#endif
