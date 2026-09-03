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

// MARK: - InternetMapNode

/// A node fetched from the MeshCore internet map (map.meshcore.dev).
struct InternetMapNode: Identifiable, Sendable {
    /// Stable identity derived from public key (falls back to coordinates + name).
    var id: String { publicKey.isEmpty ? "\(latitude),\(longitude),\(name)" : publicKey }
    let name: String
    let latitude: Double
    let longitude: Double
    /// Node type matching MeshCore contact types: 1=chat, 2=repeater, 3=room, 4=sensor.
    let type: Int
    let publicKey: String
    let lastAdvert: String
    let radioFreq: Double
    let radioBW: Double
    let radioSF: Int
    let radioCR: Int

    /// Human-readable node type label.
    var typeName: String {
        switch type {
        case 1: return "Chat"
        case 2: return "Repeater"
        case 3: return "Room"
        case 4: return "Sensor"
        default: return "Unknown"
        }
    }
}

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
@MainActor
final class MeshMapService {

    static let shared = MeshMapService()

    private static let uploadURL = URL(string: "https://map.meshcore.dev/api/v1/uploader/node")!
    private static let nodesURL  = URL(string: "https://map.meshcore.dev/api/v1/nodes?binary=0&short=0")!

    private(set) var nodes: [InternetMapNode] = []
    private var lastFetch: Date = .distantPast
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
        guard Date().timeIntervalSince(lastFetch) > fetchInterval else { return }
        await fetch()
    }

    /// Force-refresh the internet node list from map.meshcore.dev.
    func fetch() async {
        do {
            let (data, _) = try await URLSession.shared.data(from: Self.nodesURL)
            let decoded = Self.decodeJSONNodes(from: data)
            nodes = decoded
            lastFetch = Date()
            DebugLogger.shared.log("MAP FETCH: \(decoded.count) internet nodes", level: .info)
        } catch {
            DebugLogger.shared.log("MAP FETCH: \(error.localizedDescription)", level: .error)
        }
    }

    /// Decode JSON array of node objects from the map API.
    private static func decodeJSONNodes(from data: Data) -> [InternetMapNode] {
        guard let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        return array.compactMap { dict -> InternetMapNode? in
            guard let lat = dict["adv_lat"] as? Double,
                  let lon = dict["adv_lon"] as? Double,
                  lat != 0 || lon != 0,
                  abs(lat) <= 90, abs(lon) <= 180 else { return nil }
            let name = dict["adv_name"] as? String ?? "Unknown"
            let type = dict["type"] as? Int ?? 0
            let publicKey = dict["public_key"] as? String ?? ""
            let lastAdvert = dict["last_advert"] as? String ?? ""
            let params = dict["params"] as? [String: Any] ?? [:]
            return InternetMapNode(
                name: name, latitude: lat, longitude: lon, type: type,
                publicKey: publicKey, lastAdvert: lastAdvert,
                radioFreq: params["freq"] as? Double ?? 0,
                radioBW: params["bw"] as? Double ?? 0,
                radioSF: params["sf"] as? Int ?? 0,
                radioCR: params["cr"] as? Int ?? 0
            )
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
struct MeshMapView: View {
    @Environment(ContactStore.self) private var contactStore
    @Environment(NavigationStore.self) private var navigationStore
    @Environment(RFMonitorStore.self) private var rfStore
    @Environment(MessageStoreManager.self) private var messageStoreManager
    @StateObject private var locationManager = LocationManager()
    @State private var cameraPosition: MapCameraPosition = .automatic
    /// Mirrors the camera's current region. Set explicitly when we move the camera
    /// programmatically so nodes appear without waiting for onMapCameraChange to fire.
    @State private var visibleRegion: MKCoordinateRegion? = nil
    /// True once we've applied the initial 500-mile camera jump; avoids re-jumping on pans.
    @State private var hasSetInitialCamera = false
    /// The selected cluster for the detail sheet/popover.
    @State private var selectedCluster: NodeCluster? = nil
    private enum MapOverlay { case none, linkQuality, coverage }
    /// Which overlay (if any) is active on the map.
    @State private var mapOverlay: MapOverlay = .none
    @State private var showCoverageInfo = false
    /// Internet map nodes fetched from map.meshcore.dev.
    @State private var internetMapNodes: [InternetMapNode] = []
    @State private var isLoadingInternetNodes = false

    // ~500 miles as degrees of latitude (1° ≈ 69 mi → 500 mi ÷ 69 ≈ 7.25°)
    private static let initialSpanDegrees = 7.25

    /// Grid cell size in degrees for clustering. Adapts to zoom level.
    /// At wide zoom (large span) cells are big → heavy clustering.
    /// At close zoom (small span) cells are small → individual nodes.
    private static let clusterThreshold: Double = 0.15

    private var mappableContacts: [Contact] {
        contactStore.contacts.filter { $0.latitude != 0 || $0.longitude != 0 }
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
        let db = Int(snr)
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
        guard let region = visibleRegion else { return [] }
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
            Map(position: $cameraPosition) {
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

                // Local mesh contacts — custom annotations with tap-to-navigate
                ForEach(mappableContacts) { contact in
                    Annotation(contactStore.displayName(for: contact),
                               coordinate: CLLocationCoordinate2D(
                                   latitude: contact.latitude,
                                   longitude: contact.longitude
                               )) {
                        Button {
                            navigationStore.sidebarSelection = .contact(contact.publicKeyPrefix)
                        } label: {
                            VStack(spacing: 2) {
                                Image(systemName: contactTypeIcon(contact))
                                    .foregroundStyle(contactTypeColor(contact))
                                    .font(.title2)
                                    .padding(6)
                                    .background(Circle().fill(.background))
                                    .shadow(radius: 2)
                                Text(contactStore.displayName(for: contact))
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.textPrimary)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                // Internet map nodes — clustered annotations
                ForEach(clusteredNodes) { cluster in
                    Annotation("", coordinate: cluster.coordinate) {
                        if cluster.isSingle {
                            // Single node — show individual marker
                            Button {
                                selectedCluster = cluster
                            } label: {
                                VStack(spacing: 2) {
                                    Image(systemName: Self.internetNodeIcon(type: cluster.nodes[0].type))
                                        .foregroundStyle(.white)
                                        .font(.caption)
                                        .frame(width: 28, height: 28)
                                        .background(Circle().fill(Color.teal))
                                        .shadow(radius: 2)
                                    Text(cluster.nodes[0].name)
                                        .font(.system(size: 9))
                                        .foregroundStyle(MeshTheme.textSecondary)
                                        .lineLimit(1)
                                        .frame(maxWidth: 80)
                                }
                            }
                            .buttonStyle(.plain)
                        } else {
                            // Cluster — show count bubble
                            Button {
                                selectedCluster = cluster
                            } label: {
                                ZStack {
                                    Circle()
                                        .fill(Color.teal.opacity(0.85))
                                        .frame(width: clusterSize(cluster.count),
                                               height: clusterSize(cluster.count))
                                        .overlay(
                                            Circle()
                                                .strokeBorder(Color.white, lineWidth: 2)
                                        )
                                        .shadow(radius: 3)
                                    Text(clusterLabel(cluster.count))
                                        .font(.system(size: clusterFontSize(cluster.count), weight: .bold))
                                        .foregroundStyle(.white)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                // Coverage heat map — GPS-tagged RSSI points from RF monitor
                if mapOverlay == .coverage {
                    ForEach(visibleCoveragePoints) { point in
                        MapCircle(
                            center: CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude),
                            radius: 60
                        )
                        .foregroundStyle(coverageColor(rssi: point.rssi).opacity(0.35))
                        .stroke(coverageColor(rssi: point.rssi).opacity(0.6), lineWidth: 1)
                    }
                }

                // Link quality lines — SNR-colored from device to each contact with message history
                if mapOverlay == .linkQuality, let deviceCoord = locationManager.currentLocation?.coordinate {
                    ForEach(linkQualityEntries, id: \.contact.id) { entry in
                        MapPolyline(coordinates: [
                            deviceCoord,
                            CLLocationCoordinate2D(latitude: entry.contact.latitude, longitude: entry.contact.longitude)
                        ])
                        .stroke(snrColor(entry.snr).opacity(0.8), lineWidth: 3)
                    }
                }

                UserAnnotation()
            }
            .onMapCameraChange(frequency: .onEnd) { context in
                DispatchQueue.main.async {
                    visibleRegion = context.region
                }
            }
            .mapControls {
                MapUserLocationButton()
                MapCompass()
                MapScaleView()
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
                    } else if !internetMapNodes.isEmpty {
                        HStack(spacing: 8) {
                            HStack(spacing: 4) {
                                Circle().fill(MeshTheme.accent).frame(width: 8, height: 8)
                                Text("Local mesh")
                                    .font(.caption2)
                                    .foregroundStyle(MeshTheme.textSecondary)
                            }
                            HStack(spacing: 4) {
                                Circle().fill(Color.teal.opacity(0.85)).frame(width: 8, height: 8)
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
                .padding(.top, 8)

                Spacer()

                if locationManager.authorizationStatus == .denied ||
                   locationManager.authorizationStatus == .restricted {
                    Text("Location access denied. Enable in Settings → Privacy → Location Services.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(8)
                        .background(.thinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .padding()
                }
                if mappableContacts.isEmpty && internetMapNodes.isEmpty && !isLoadingInternetNodes {
                    VStack(spacing: 4) {
                        Text("No contacts with location data")
                            .font(.caption)
                            .foregroundStyle(MeshTheme.textSecondary)
                        Text("\(contactStore.contacts.count) contacts total, \(mappableContacts.count) with coordinates")
                            .font(.caption2)
                            .foregroundStyle(MeshTheme.textSecondary)
                    }
                    .padding(8)
                    .background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding(.bottom)
                }

                // Cycling overlay button — bottom-trailing, clear of MapKit's top-right controls
                HStack {
                    Spacer()
                    Button {
                        switch mapOverlay {
                        case .none:
                            mapOverlay = .linkQuality
                        case .linkQuality:
                            if rfStore.coveragePoints.isEmpty {
                                showCoverageInfo = true
                            } else {
                                mapOverlay = .coverage
                            }
                        case .coverage:
                            mapOverlay = .none
                        }
                    } label: {
                        Image(systemName: overlayButtonIcon)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(mapOverlay == .none ? MeshTheme.textSecondary : MeshTheme.accent)
                            .frame(width: 32, height: 32)
                            .background(.thinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .alert("Coverage Heat Map", isPresented: $showCoverageInfo) {
                        Button("Got It", role: .cancel) {}
                    } message: {
                        Text("Signal strength data is collected automatically while the RF Monitor is open and you're moving. Every received packet is GPS-tagged and plotted here as a colour-coded heat map.\n\nOpen the RF Monitor tab and move around with your radio to start building coverage data.")
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
            }
        }
        .navigationTitle("Map")
        .task {
            // Defer past the current view-update pass to avoid
            // "Publishing changes from within view updates" warnings.
            try? await Task.sleep(nanoseconds: 1)
            locationManager.requestPermission()
            await fetchInternetMapNodes()
        }
        .onChange(of: locationManager.currentLocation) { _, location in
            guard let location, !hasSetInitialCamera else { return }
            hasSetInitialCamera = true
            let region = MKCoordinateRegion(
                center: location.coordinate,
                span: MKCoordinateSpan(
                    latitudeDelta: Self.initialSpanDegrees,
                    longitudeDelta: Self.initialSpanDegrees
                )
            )
            DispatchQueue.main.async {
                cameraPosition = .region(region)
                visibleRegion = region
            }
        }
        .onChange(of: internetMapNodes.count) {
            guard !internetMapNodes.isEmpty, visibleRegion == nil,
                  let loc = locationManager.currentLocation else { return }
            let region = MKCoordinateRegion(
                center: loc.coordinate,
                span: MKCoordinateSpan(
                    latitudeDelta: Self.initialSpanDegrees,
                    longitudeDelta: Self.initialSpanDegrees
                )
            )
            visibleRegion = region
        }
        .sheet(item: $selectedCluster) { cluster in
            ClusterDetailView(cluster: cluster)
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

    private func clusterFontSize(_ count: Int) -> CGFloat {
        switch count {
        case 1...9:    return 13
        case 10...99:  return 12
        case 100...999: return 11
        default:       return 10
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

    private func fetchInternetMapNodes() async {
        guard !isLoadingInternetNodes else { return }
        isLoadingInternetNodes = true
        await MeshMapService.shared.fetchIfNeeded()
        internetMapNodes = MeshMapService.shared.nodes
        isLoadingInternetNodes = false
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
                Image(systemName: MeshMapView.internetNodeIcon(type: node.type))
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
