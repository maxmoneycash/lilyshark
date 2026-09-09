import Foundation

/// The documented, authorized MeshMapper Coverage API, schema v2.
/// https://wiki.meshmapper.net/coverage-api/
public struct MeshMapperCoverage: Codable, Sendable {
    public let success: Bool
    public let region: String
    public let regionName: String
    public let generatedAt: Double
    public let dataAgeSeconds: Double?
    public let pointCount: Int?
    public let gridSquares: [MeshMapperCell]
    public let repeaters: [MeshMapperRepeater]?

    enum CodingKeys: String, CodingKey {
        case success, region, repeaters
        case regionName = "region_name", generatedAt = "generated_at"
        case dataAgeSeconds = "data_age_seconds", pointCount = "point_count"
        case gridSquares = "grid_squares"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        success = try values.decode(Bool.self, forKey: .success)
        region = try values.decode(String.self, forKey: .region)
        regionName = try values.decode(String.self, forKey: .regionName)
        generatedAt = try values.decode(Double.self, forKey: .generatedAt)
        dataAgeSeconds = try values.decodeIfPresent(Double.self, forKey: .dataAgeSeconds)
        pointCount = try values.decodeIfPresent(Int.self, forKey: .pointCount)
        // Regional feeds may overlap. Preserve the first record for an exact
        // identity, including when restoring a previously saved snapshot.
        var cells = Set<String>()
        gridSquares = try values.decode([MeshMapperCell].self, forKey: .gridSquares)
            .filter { cells.insert($0.id).inserted }
        var nodes = Set<String>()
        repeaters = try values.decodeIfPresent([MeshMapperRepeater].self, forKey: .repeaters)?
            .filter { nodes.insert($0.id).inserted }
    }

    public var validCells: [MeshMapperCell] { gridSquares.filter { $0.bounds.isValid } }
    public var locatedRepeaters: [MeshMapperRepeater] {
        (repeaters ?? []).filter { $0.hasPosition }
    }

    public static func decode(_ data: Data) throws -> Self {
        let report = try JSONDecoder().decode(Self.self, from: data)
        guard report.success else { throw URLError(.badServerResponse) }
        return report
    }
}

public enum MeshMapperCoverageType: String, CaseIterable, Identifiable, Sendable {
    case bidirectional = "BIDIR", discovery = "DISC", transmit = "TX"
    case receive = "RX", dead = "DEAD", drop = "DROP"
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .bidirectional: "Two-way"
        case .discovery: "Discovery"
        case .transmit: "Transmit"
        case .receive: "Receive"
        case .dead: "Dead end"
        case .drop: "Dropped"
        }
    }
    public var explanation: String {
        switch self {
        case .bidirectional: "A repeater received the transmission and the sender heard its repeat."
        case .discovery: "A discovery or trace request received a reply."
        case .transmit: "The transmission reached the mesh, but the sender heard no repeat."
        case .receive: "Traffic was heard here. A return path has not been established."
        case .dead: "A repeater heard the transmission, but it did not reach the wider mesh."
        case .drop: "No repeat or successful route was observed."
        }
    }
}

public struct MeshMapperBounds: Codable, Sendable {
    public let south: Double
    public let west: Double
    public let north: Double
    public let east: Double
    public var isValid: Bool {
        south.isFinite && north.isFinite && west.isFinite && east.isFinite &&
        (-90...90).contains(south) && (-90...90).contains(north) &&
        (-180...180).contains(west) && (-180...180).contains(east) &&
        south < north && west < east
    }
    public var latitude: Double { (south + north) / 2 }
    public var longitude: Double { (west + east) / 2 }
    public func contains(latitude: Double, longitude: Double) -> Bool {
        isValid && (south...north).contains(latitude) && (west...east).contains(longitude)
    }
}

public struct MeshMapperCell: Codable, Identifiable, Sendable {
    public let gridID: String
    public let bounds: MeshMapperBounds
    /// Keep the raw value so future coverage types do not break the feed.
    public let coverageType: String
    public let fillColor: String
    public let borderColor: String
    public let snr: Double?
    public let timestamp: Double?
    public let count: Int?
    public let snrMin: Double?
    public let snrMax: Double?
    public let statusMask: Int?
    public let firstSeen: Double?
    public let noise: Double?
    public let effective: Double?
    public var id: String { gridID }
    public var type: MeshMapperCoverageType? { MeshMapperCoverageType(rawValue: coverageType) }

    enum CodingKeys: String, CodingKey {
        case bounds, snr, timestamp, count, noise, effective
        case gridID = "grid_id", coverageType = "coverage_type"
        case fillColor = "fill_color", borderColor = "border_color"
        case snrMin = "snr_min", snrMax = "snr_max", statusMask = "status_mask", firstSeen = "first_seen"
    }
}

public struct MeshMapperRepeater: Codable, Identifiable, Sendable {
    public let hex: String
    public let name: String?
    public let lat: Double?
    public let lon: Double?
    public let lastHeard: Double?
    public let enabled: Int
    public let advertBytes: Int?
    /// A prefix alone is not an identity: collisions and moved repeaters exist.
    public var id: String { "\(hex.uppercased()):\(lat.map { String($0) } ?? "?"):\(lon.map { String($0) } ?? "?")" }
    public var hasPosition: Bool {
        guard let lat, let lon else { return false }
        return lat.isFinite && lon.isFinite && (-90...90).contains(lat) && (-180...180).contains(lon)
    }
    public var isAmbiguous: Bool { enabled == 2 }
    enum CodingKeys: String, CodingKey {
        case hex, name, lat, lon, enabled
        case lastHeard = "last_heard", advertBytes = "advert_bytes"
    }
}

public struct MeshMapperFilter: Sendable {
    public var types: Set<MeshMapperCoverageType> = Set(MeshMapperCoverageType.allCases)
    public var minimumSNR: Double?
    public var since: Date?
    public init() {}
    public func includes(_ cell: MeshMapperCell) -> Bool {
        guard cell.bounds.isValid else { return false }
        if let type = cell.type {
            guard types.contains(type) else { return false }
        } else if types.count != MeshMapperCoverageType.allCases.count { return false }
        if let minimumSNR {
            guard let snr = cell.snr, snr >= minimumSNR else { return false }
        }
        if let since {
            guard let timestamp = cell.timestamp, timestamp >= since.timeIntervalSince1970 else { return false }
        }
        return true
    }
}

public enum MeshMapperRefreshPolicy {
    public static func retryDelay(resetsInHours: Double?, retryAfter: String?, now: Date = Date()) -> TimeInterval {
        var delay: TimeInterval = 900
        if let hours = resetsInHours, hours.isFinite { delay = max(delay, hours * 3600) }
        if let retryAfter {
            if let seconds = Double(retryAfter), seconds.isFinite { delay = max(delay, seconds) }
            else {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
                if let date = formatter.date(from: retryAfter) { delay = max(delay, date.timeIntervalSince(now)) }
            }
        }
        return delay
    }
}
