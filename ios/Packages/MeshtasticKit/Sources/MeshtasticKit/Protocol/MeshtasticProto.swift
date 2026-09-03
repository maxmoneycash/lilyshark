//
//  MeshtasticProto.swift
//  MeshtasticKit
//
//  The Meshtastic client protobuf conversation, phone side.
//

import Foundation

/// The wire format a Lilyshark T-Deck already answers over BLE.
///
/// After connecting, the phone writes `ToRadio{want_config_id: nonce}` and then
/// reads `FromRadio` until `config_complete_id` echoes that nonce; what arrives
/// in between is everything the app will ever show about the device. Afterwards
/// the two ends simply trade packets.
///
/// Field numbers come from meshtastic/protobufs master (mesh.proto,
/// deviceonly.proto), and every byte here is pinned by vectors that the
/// firmware's `test/meshtastic_api` and the web client's `meshtasticProto.test`
/// pin as well. The three implementations cannot drift apart without one of the
/// three suites going red, which is the point of hand-rolling a third copy
/// rather than depending on a generated one.
///
/// Pure functions over `Data`: nothing here touches CoreBluetooth, so all of it
/// runs under `swift test` with no radio in the room.
public enum MeshtasticProto {
    /// The address every node listens on.
    public static let broadcast: UInt32 = 0xffff_ffff

    private static let portText: UInt64 = 1
    private static let portPosition: UInt64 = 3
    private static let portRouting: UInt64 = 5

    // MARK: - ToRadio (phone -> deck)

    /// `ToRadio{want_config_id}`, the message that starts the config dump.
    public static func encodeWantConfig(nonce: UInt32) -> Data {
        var writer = ProtoWriter()
        // Written even when the nonce is zero. Everywhere else a zero field is
        // omitted, but the deck echoes this one back to mark the dump finished,
        // and a phone that omitted it would wait forever for an echo of nothing.
        writer.tag(3, ProtoWriter.wireVarint)
        writer.varint(nonce)
        return Data(writer.bytes)
    }

    /// `ToRadio{packet}` carrying a text message for the mesh.
    ///
    /// Pass `broadcast` as `to` for a channel message, or a node number for a
    /// direct message. With `wantAck` set the deck answers with a Routing
    /// result naming `packetID`, which is how the app learns the message left.
    public static func encodeTextPacket(
        to: UInt32,
        channel: UInt32,
        packetID: UInt32,
        text: String,
        wantAck: Bool
    ) -> Data {
        var data = ProtoWriter()
        data.uint(1, UInt32(portText))
        data.bytesField(2, Array(text.utf8))

        var packet = ProtoWriter()
        packet.fixed32(2, to)
        packet.uint(3, channel)
        packet.message(4, data)
        packet.fixed32(6, packetID)
        packet.uint(10, wantAck ? 1 : 0)

        var toRadio = ProtoWriter()
        toRadio.message(1, packet)
        return Data(toRadio.bytes)
    }

    // MARK: - FromRadio (deck -> phone)

    /// One node as the deck describes it, in the config dump or on arrival.
    public struct NodeInfo: Equatable, Sendable {
        public var num: UInt32
        public var id: String
        public var longName: String
        public var shortName: String
        public var snr: Float?
        public var latitude: Double?
        public var longitude: Double?

        public init(
            num: UInt32,
            id: String,
            longName: String,
            shortName: String,
            snr: Float? = nil,
            latitude: Double? = nil,
            longitude: Double? = nil
        ) {
            self.num = num
            self.id = id
            self.longName = longName
            self.shortName = shortName
            self.snr = snr
            self.latitude = latitude
            self.longitude = longitude
        }
    }

    /// A text heard on the mesh. `rxSNR` and `rxRSSI` are absent for a message
    /// the deck itself originated, since nothing received it over the air.
    public struct TextMessage: Equatable, Sendable {
        public var from: UInt32
        public var to: UInt32
        public var packetID: UInt32
        public var channel: UInt32
        public var text: String
        public var rxSNR: Float?
        public var rxRSSI: Int32?

        public init(
            from: UInt32,
            to: UInt32,
            packetID: UInt32,
            channel: UInt32,
            text: String,
            rxSNR: Float? = nil,
            rxRSSI: Int32? = nil
        ) {
            self.from = from
            self.to = to
            self.packetID = packetID
            self.channel = channel
            self.text = text
            self.rxSNR = rxSNR
            self.rxRSSI = rxRSSI
        }
    }

    /// A position heard on the mesh, already converted out of Meshtastic's
    /// 1e-7-degree integers into degrees.
    public struct Position: Equatable, Sendable {
        public var from: UInt32
        public var latitude: Double
        public var longitude: Double

        public init(from: UInt32, latitude: Double, longitude: Double) {
            self.from = from
            self.latitude = latitude
            self.longitude = longitude
        }
    }

    /// Everything a phone acts on, and `other` for everything it does not.
    ///
    /// `other` is not a failure: the radio sends channel and config messages
    /// this client has no use for, and they still have to be read past to reach
    /// `configComplete`.
    public enum FromRadio: Equatable, Sendable {
        case myInfo(num: UInt32)
        case metadata(firmware: String)
        case nodeInfo(NodeInfo)
        case configComplete(nonce: UInt32)
        case text(TextMessage)
        case position(Position)
        case routing(requestID: UInt32, error: UInt32)
        case other
    }

    /// Parse one `FromRadio` protobuf, or `nil` if the bytes are malformed.
    ///
    /// The distinction matters on this transport: an unreadable value means the
    /// link is confused and the connection should be torn down, whereas a
    /// well-formed message this client ignores is ordinary traffic.
    public static func parseFromRadio(_ data: Data) -> FromRadio? {
        guard let fields = readFields(Array(data)) else { return nil }
        for field in fields {
            switch field.number {
            case 2:
                if let bytes = field.bytes { return parsePacket(bytes) }
            case 3:
                guard let bytes = field.bytes else { break }
                for entry in readFields(bytes) ?? []
                where entry.number == 1 && entry.wireType == ProtoWriter.wireVarint {
                    return .myInfo(num: truncate(entry.value))
                }
                return .myInfo(num: 0)
            case 4:
                if let bytes = field.bytes { return parseNodeInfo(bytes) }
            case 7:
                return .configComplete(nonce: truncate(field.value))
            case 13:
                guard let bytes = field.bytes else { break }
                for entry in readFields(bytes) ?? [] where entry.number == 1 {
                    if let firmware = entry.bytes {
                        return .metadata(firmware: string(firmware))
                    }
                }
                return .metadata(firmware: "")
            default:
                break
            }
        }
        return .other
    }

    private static func parseNodeInfo(_ bytes: [UInt8]) -> FromRadio {
        var info = NodeInfo(num: 0, id: "", longName: "", shortName: "")
        for field in readFields(bytes) ?? [] {
            switch (field.number, field.wireType) {
            case (1, ProtoWriter.wireVarint):
                info.num = truncate(field.value)
            case (2, ProtoWriter.wireLength):
                for entry in readFields(field.bytes ?? []) ?? [] {
                    guard let text = entry.bytes else { continue }
                    switch entry.number {
                    case 1: info.id = string(text)
                    case 2: info.longName = string(text)
                    case 3: info.shortName = string(text)
                    default: break
                    }
                }
            case (3, ProtoWriter.wireLength):
                for entry in readFields(field.bytes ?? []) ?? [] {
                    guard entry.wireType == ProtoWriter.wireFixed32 else { continue }
                    if entry.number == 1 { info.latitude = degrees(entry.value) }
                    if entry.number == 2 { info.longitude = degrees(entry.value) }
                }
            case (4, ProtoWriter.wireFixed32):
                info.snr = Float(bitPattern: truncate(field.value))
            default:
                break
            }
        }
        return .nodeInfo(info)
    }

    private static func parsePacket(_ bytes: [UInt8]) -> FromRadio {
        var from: UInt32 = 0
        var to: UInt32 = 0
        var packetID: UInt32 = 0
        var channel: UInt32 = 0
        var rxSNR: Float?
        var rxRSSI: Int32?
        var decoded: [UInt8]?
        for field in readFields(bytes) ?? [] {
            switch (field.number, field.wireType) {
            case (1, ProtoWriter.wireFixed32): from = truncate(field.value)
            case (2, ProtoWriter.wireFixed32): to = truncate(field.value)
            case (3, ProtoWriter.wireVarint): channel = truncate(field.value)
            case (4, ProtoWriter.wireLength): decoded = field.bytes
            case (6, ProtoWriter.wireFixed32): packetID = truncate(field.value)
            case (8, ProtoWriter.wireFixed32): rxSNR = Float(bitPattern: truncate(field.value))
            case (12, ProtoWriter.wireVarint):
                // rx_rssi is a protobuf int32, so a negative one arrives as a
                // ten-byte varint sign-extended to 64 bits -- which is exactly
                // what the firmware's field_int32 writes. Reading the low 32
                // bits back as signed recovers it, and also handles the
                // truncated five-byte form other implementations emit.
                rxRSSI = Int32(truncatingIfNeeded: field.value)
            default:
                break
            }
        }

        guard let decoded else { return .other }
        var portnum: UInt64 = 0
        var payload: [UInt8] = []
        var requestID: UInt32 = 0
        for field in readFields(decoded) ?? [] {
            switch (field.number, field.wireType) {
            case (1, ProtoWriter.wireVarint): portnum = field.value
            case (2, ProtoWriter.wireLength): payload = field.bytes ?? []
            case (6, ProtoWriter.wireFixed32): requestID = truncate(field.value)
            default: break
            }
        }

        switch portnum {
        case portText:
            return .text(
                TextMessage(
                    from: from,
                    to: to,
                    packetID: packetID,
                    channel: channel,
                    text: string(payload),
                    rxSNR: rxSNR,
                    rxRSSI: rxRSSI
                )
            )
        case portPosition:
            var latitude = 0.0
            var longitude = 0.0
            for field in readFields(payload) ?? []
            where field.wireType == ProtoWriter.wireFixed32 {
                if field.number == 1 { latitude = degrees(field.value) }
                if field.number == 2 { longitude = degrees(field.value) }
            }
            return .position(Position(from: from, latitude: latitude, longitude: longitude))
        case portRouting:
            var error: UInt32 = 0
            for field in readFields(payload) ?? []
            where field.number == 3 && field.wireType == ProtoWriter.wireVarint {
                error = truncate(field.value)
            }
            return .routing(requestID: requestID, error: error)
        default:
            return .other
        }
    }

    // MARK: - Conversions

    private static func truncate(_ value: UInt64) -> UInt32 {
        UInt32(truncatingIfNeeded: value)
    }

    /// Meshtastic carries coordinates as signed 1e-7 degrees in an sfixed32.
    private static func degrees(_ bits: UInt64) -> Double {
        Double(Int32(bitPattern: truncate(bits))) / 1e7
    }

    /// Names and message bodies are UTF-8. Anything that is not becomes
    /// replacement characters rather than a parse failure, because a neighbour
    /// with a mojibake name is still a neighbour worth showing.
    private static func string(_ bytes: [UInt8]) -> String {
        String(decoding: bytes, as: UTF8.self)
    }
}

// MARK: - Writer

/// The little of protobuf this client emits, written by hand.
///
/// Only the wire types Meshtastic uses for the two messages we send are here.
/// Following the reference implementations, a zero-valued field is omitted --
/// protobuf's default -- with `encodeWantConfig` the single documented
/// exception.
private struct ProtoWriter {
    static let wireVarint = 0
    static let wireFixed32 = 5
    static let wireLength = 2

    private(set) var bytes: [UInt8] = []

    mutating func varint(_ value: UInt32) {
        var remaining = value
        repeat {
            let part = UInt8(remaining & 0x7f)
            remaining >>= 7
            bytes.append(remaining != 0 ? part | 0x80 : part)
        } while remaining != 0
    }

    mutating func tag(_ field: UInt32, _ wireType: Int) {
        varint((field << 3) | UInt32(wireType))
    }

    mutating func uint(_ field: UInt32, _ value: UInt32) {
        guard value != 0 else { return }
        tag(field, Self.wireVarint)
        varint(value)
    }

    mutating func fixed32(_ field: UInt32, _ value: UInt32) {
        guard value != 0 else { return }
        tag(field, Self.wireFixed32)
        bytes.append(UInt8(value & 0xff))
        bytes.append(UInt8((value >> 8) & 0xff))
        bytes.append(UInt8((value >> 16) & 0xff))
        bytes.append(UInt8((value >> 24) & 0xff))
    }

    mutating func bytesField(_ field: UInt32, _ value: [UInt8]) {
        guard !value.isEmpty else { return }
        tag(field, Self.wireLength)
        varint(UInt32(value.count))
        bytes.append(contentsOf: value)
    }

    mutating func message(_ field: UInt32, _ child: ProtoWriter) {
        bytesField(field, child.bytes)
    }
}

// MARK: - Reader

private struct ProtoField {
    let number: Int
    let wireType: Int
    /// Wire types 0 and 5 carry the value itself; wire type 2 carries the
    /// payload's byte count, with the payload in `bytes`.
    let value: UInt64
    let bytes: [UInt8]?
}

/// Walk one protobuf, tolerating unknown fields; `nil` on malformed bytes.
///
/// Tolerating the unknown is not laxity: the radio sends messages this client
/// has no model for, and it must read past them to reach the ones it needs. A
/// length that runs off the end of the buffer is a different matter and stops
/// the walk, which is what catches a truncated BLE read.
private func readFields(_ data: [UInt8]) -> [ProtoField]? {
    var out: [ProtoField] = []
    var at = 0

    func varint() -> UInt64? {
        var value: UInt64 = 0
        var shift: UInt64 = 0
        while shift < 64 {
            guard at < data.count else { return nil }
            let part = data[at]
            at += 1
            value |= UInt64(part & 0x7f) << shift
            if part & 0x80 == 0 { return value }
            shift += 7
        }
        return nil
    }

    while at < data.count {
        guard let key = varint() else { return nil }
        // Protobuf field numbers stop at 2^29-1. A key claiming more than that
        // is not a field we could ever match, and must not be truncated into
        // one that we would.
        let rawNumber = key >> 3
        let number = rawNumber > 0x1fff_ffff ? -1 : Int(rawNumber)
        let wireType = Int(key & 7)
        switch wireType {
        case ProtoWriter.wireVarint:
            guard let value = varint() else { return nil }
            out.append(ProtoField(number: number, wireType: wireType, value: value, bytes: nil))
        case ProtoWriter.wireFixed32:
            guard at + 4 <= data.count else { return nil }
            let value = UInt64(data[at])
                | UInt64(data[at + 1]) << 8
                | UInt64(data[at + 2]) << 16
                | UInt64(data[at + 3]) << 24
            at += 4
            out.append(ProtoField(number: number, wireType: wireType, value: value, bytes: nil))
        case 1:
            // Nothing this client reads is a fixed64, but one has to be stepped
            // over rather than refused, or an unrelated new field would look
            // like corruption.
            guard at + 8 <= data.count else { return nil }
            at += 8
        case ProtoWriter.wireLength:
            guard let length = varint(), length <= UInt64(data.count - at) else { return nil }
            let end = at + Int(length)
            out.append(
                ProtoField(
                    number: number,
                    wireType: wireType,
                    value: length,
                    bytes: Array(data[at..<end])
                )
            )
            at = end
        default:
            return nil
        }
    }
    return out
}
