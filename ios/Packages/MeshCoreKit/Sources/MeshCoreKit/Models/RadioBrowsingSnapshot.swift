import Foundation

/// Last radio-reported data for offline browsing. This never establishes a connection.
public struct RadioBrowsingSnapshot: Codable, Sendable {
    public enum Transport: String, Codable, Sendable { case meshCore, meshtastic }
    public struct Position: Codable, Sendable, Equatable {
        public let latitude: Double
        public let longitude: Double
        public var viaMQTT: Bool?
        public init(latitude: Double, longitude: Double, viaMQTT: Bool? = nil) {
            self.latitude = latitude; self.longitude = longitude; self.viaMQTT = viaMQTT
        }
    }
    public struct Observation: Codable, Sendable, Equatable {
        public enum Source: String, Codable, Sendable { case deckRecord, packet }
        public let source: Source
        public let snr: Float?
        public let rssi: Int32?
        public let hops: UInt32?
        public let lastHeard: UInt32?
        public let viaMQTT: Bool?
        public init(source: Source, snr: Float?, rssi: Int32?, hops: UInt32?, lastHeard: UInt32?, viaMQTT: Bool?) {
            self.source = source; self.snr = snr; self.rssi = rssi
            self.hops = hops; self.lastHeard = lastHeard; self.viaMQTT = viaMQTT
        }
    }
    public let publicKey: String
    public let name: String
    public let transport: Transport
    public let savedAt: Date
    public let contacts: [Contact]
    public let channels: [MeshChannel]
    public let positions: [Data: Position]
    public let observations: [Data: Observation]

    public var storagePrefix: String { String(publicKey.prefix(12)) }
    public var hasValidIdentity: Bool {
        Self.isValidIdentity(publicKey, transport: transport)
    }
    public static func isValidIdentity(_ key: String, transport: Transport) -> Bool {
        key.count == (transport == .meshCore ? 64 : 8)
            && key.allSatisfy { "0123456789abcdef".contains($0) }
            && key.contains { $0 != "0" }
    }
    public init(publicKey: String, name: String, transport: Transport, savedAt: Date = Date(),
                contacts: [Contact], channels: [MeshChannel], positions: [Data: Position],
                observations: [Data: Observation]) {
        self.publicKey = publicKey; self.name = name; self.transport = transport; self.savedAt = savedAt
        self.contacts = contacts
        // Channel keys remain in their existing per-radio Keychain storage.
        self.channels = channels.map { MeshChannel(index: $0.index, name: $0.name, flags: $0.flags) }
        self.positions = positions; self.observations = observations
    }
}
