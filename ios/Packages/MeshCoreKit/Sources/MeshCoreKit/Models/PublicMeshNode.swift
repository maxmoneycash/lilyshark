import Foundation

/// A published directory record, not evidence that the user's radio heard it.
public struct PublicMeshNode: Codable, Identifiable, Sendable, Equatable {
    public var id: String { publicKey }
    public let name: String
    public let latitude: Double
    public let longitude: Double
    public let type: Int
    public let publicKey: String
    public let lastAdvert: String
    public let radioFreq: Double
    public let radioBW: Double
    public let radioSF: Int
    public let radioCR: Int
    public let updatedAt: String
    public let source: String

    public var typeName: String {
        switch type {
        case 1: "Contact"
        case 2: "Repeater"
        case 3: "Room"
        case 4: "Sensor"
        default: "Node"
        }
    }

    public var sourceDescription: String {
        switch source {
        case "uploader": "Automatic public upload"
        case "app": "App-submitted public record"
        case "web": "Manually submitted public record"
        default: "Public directory record"
        }
    }

    public var advertisementDate: Date? { Self.date(lastAdvert) }
    public var updateDate: Date? { Self.date(updatedAt) }

    private static func date(_ value: String) -> Date? {
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = format.date(from: value) { return date }
        format.formatOptions = [.withInternetDateTime]
        return format.date(from: value)
    }

    public init(name: String, latitude: Double, longitude: Double, type: Int,
                publicKey: String, lastAdvert: String, radioFreq: Double, radioBW: Double,
                radioSF: Int, radioCR: Int, updatedAt: String = "", source: String = "") {
        self.name = name; self.latitude = latitude; self.longitude = longitude
        self.type = type; self.publicKey = publicKey; self.lastAdvert = lastAdvert
        self.radioFreq = radioFreq; self.radioBW = radioBW; self.radioSF = radioSF; self.radioCR = radioCR
        self.updatedAt = updatedAt; self.source = source
    }

    /// Validates wire data before it can become a map annotation or disk cache.
    public static func decodeDirectory(_ data: Data) throws -> [Self] {
        guard let records = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw CocoaError(.coderReadCorrupt)
        }
        var unique: [String: Self] = [:]
        for record in records {
            guard let latitude = record["adv_lat"] as? Double,
                  let longitude = record["adv_lon"] as? Double,
                  latitude.isFinite, longitude.isFinite,
                  (-90...90).contains(latitude), (-180...180).contains(longitude),
                  latitude != 0 || longitude != 0,
                  let rawKey = record["public_key"] as? String else { continue }
            let key = rawKey.lowercased()
            guard key.count == 64, key.allSatisfy({ "0123456789abcdef".contains($0) }) else { continue }
            let parameters = record["params"] as? [String: Any] ?? [:]
            let name = (record["adv_name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let node = Self(name: name.isEmpty ? String(key.prefix(12)) : name,
                latitude: latitude, longitude: longitude, type: record["type"] as? Int ?? 0,
                publicKey: key, lastAdvert: record["last_advert"] as? String ?? "",
                radioFreq: parameters["freq"] as? Double ?? 0, radioBW: parameters["bw"] as? Double ?? 0,
                radioSF: parameters["sf"] as? Int ?? 0, radioCR: parameters["cr"] as? Int ?? 0,
                updatedAt: record["updated_date"] as? String ?? "", source: record["source"] as? String ?? "")
            if let previous = unique[key], (previous.updateDate ?? .distantPast) > (node.updateDate ?? .distantPast) { continue }
            unique[key] = node
        }
        // An invalid non-empty feed must not erase a previously saved directory.
        guard records.isEmpty || !unique.isEmpty else { throw CocoaError(.coderReadCorrupt) }
        return unique.values.sorted { $0.publicKey < $1.publicKey }
    }
}
