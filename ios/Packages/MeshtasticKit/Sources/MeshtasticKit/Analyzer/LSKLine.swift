//
//  LSKLine.swift
//  MeshtasticKit
//
//  The Lilyshark analyzer link, host side: reading what a T-Deck prints over
//  USB CDC.
//

import Foundation

/// One decoded line of the deck's analyzer link.
///
/// The deck streams newline-delimited plain text over USB CDC once a host has
/// sent `LSK HELLO`. Every line is `LSK <kind> <json-object>`; the kinds are
/// pinned to firmware call sites in `LSK.md` next to this file, and each case
/// below names the function that prints it.
///
/// Nothing here touches a serial port, so all of it runs under `swift test`
/// with no radio in the room — which is the whole reason the codec is a
/// separate type from the transport.
public enum LSKLine: Equatable, Sendable {
    /// `LSK ID` — the answer to `LSK HELLO`, and the only proof that the thing
    /// on the other end of the cable is a deck rather than a modem.
    case identity(LSKIdentity)
    /// `LSK T` — hardware and radio state, roughly every two seconds.
    case telemetry(LSKTelemetry)
    /// `LSK F` — one frame the deck's decoder accepted.
    case frame(LSKHeardFrame)
    /// `LSK S` — one completed spectrum pass across the band.
    case sweep(LSKSweep)
    /// `LSK P` — a Shelby pointer decoded off the air, with full coordinates.
    case pointer(LSKPointer)
    /// `LSK OK` — a command was carried out.
    case ok(LSKAck)
    /// `LSK ERR` — a command was refused, or a transmit failed.
    case error(LSKFault)
    /// A kind this build has never heard of, kept verbatim.
    ///
    /// Firmware ships ahead of apps. A deck newer than this app will print
    /// kinds that are not in the switch below, and the honest thing to do with
    /// one is hand it back undecoded rather than guess at a shape for it.
    case unknown(kind: String, body: String)

    /// The single letter (or word) between `LSK ` and the body.
    public var kindTag: String {
        switch self {
        case .identity: return "ID"
        case .telemetry: return "T"
        case .frame: return "F"
        case .sweep: return "S"
        case .pointer: return "P"
        case .ok: return "OK"
        case .error: return "ERR"
        case .unknown(let kind, _): return kind
        }
    }
}

// MARK: - Stream values

/// `LSK ID {"app":…,"fw":…,"board":…,"node":…}`.
///
/// Printed by `handle_analyzer_link_command` in `src/sim_main.cpp` on every
/// `LSK HELLO`, not only the first, so a host may re-ask at any time.
public struct LSKIdentity: Equatable, Sendable {
    public let app: String
    public let firmwareVersion: String
    public let board: String
    /// Exactly as printed: `!` followed by eight lowercase hex digits.
    public let nodeID: String
    /// The same node number as an integer, when `nodeID` had that shape.
    public let nodeNum: UInt32?

    /// False for anything that answered on the port but is not this firmware.
    /// A host that skips this check will happily "link" to another dev board.
    public var isLilyshark: Bool { app == "lilyshark" }

    public init(app: String, firmwareVersion: String, board: String, nodeID: String) {
        self.app = app
        self.firmwareVersion = firmwareVersion
        self.board = board
        self.nodeID = nodeID
        self.nodeNum = LSKIdentity.parseNodeNum(nodeID)
    }

    private static func parseNodeNum(_ nodeID: String) -> UInt32? {
        guard nodeID.hasPrefix("!") else { return nil }
        return UInt32(nodeID.dropFirst(), radix: 16)
    }
}

/// `LSK T` — the deck's own status, printed from `loop()` in `src/sim_main.cpp`
/// every 2000 ms while the link is up.
public struct LSKTelemetry: Equatable, Sendable {
    /// Human labels the deck also shows on its own status bar.
    public let batteryLabel: String
    public let gpsLabel: String
    public let profileName: String
    /// The sequence number of the newest frame in the deck's capture ring —
    /// *not* a count, despite the wire name being `frames`. Zero means the
    /// deck has heard nothing since boot. The count of frames the radio
    /// accepted is `receivedFrames`.
    public let newestFrameSequence: UInt32
    /// Of that newest frame, in tenths of a dB. Zero when there is no frame.
    public let rssiDBmX10: Int
    public let snrDBX10: Int
    /// True while the deck is generating traffic instead of listening. Frames
    /// arriving on a simulating deck were never on the air.
    public let simulated: Bool
    /// Present only while the GPS has a fix; the deck omits both otherwise.
    public let latitude: Double?
    public let longitude: Double?
    public let batteryMillivolts: UInt32?
    public let batteryPercent: UInt32?
    public let satellites: UInt32?
    public let centerFrequencyHz: UInt32?
    public let spreadingFactor: UInt32?
    public let bandwidthHz: UInt32?
    /// Frames the radio accepted since boot, and CRC failures alongside them.
    public let receivedFrames: UInt32?
    public let crcErrors: UInt32?

    public var hasFix: Bool { latitude != nil && longitude != nil }
}

/// Where a frame on this link actually came from.
///
/// Provenance is a safety property of this codebase: a frame relayed in over
/// the internet must never be presented as one this radio heard. The deck
/// carries the distinction in the raw record's metadata flags, so the app can
/// keep it — but only when the raw record is there at all.
public enum LSKFrameOrigin: String, Equatable, Sendable, CaseIterable {
    /// Received by this deck's own SX1262.
    case air
    /// Generated by the deck's simulate mode. Never on any air.
    case synthetic
    /// Heard by some other radio and injected here with `LSK INJ`. The deck
    /// never retransmits one; neither may a host present it as locally heard.
    case net
    /// The line carried no raw record, so the deck did not say. Firmware older
    /// than the capture link only distinguishes synthetic from everything
    /// else, which leaves net-relayed and over-the-air indistinguishable.
    /// Treat this as "not provably heard here" — never as `.air`.
    case unstated
}

/// `LSK F` — one decoded frame, printed by `emit_analyzer_heard_frame` in
/// `src/sim_main.cpp`.
public struct LSKHeardFrame: Equatable, Sendable {
    public let source: UInt32
    public let destination: UInt32
    /// `protocolName()` from `include/lilyshark/core/protocol.h`: one of
    /// Meshtastic, MeshCore, Reticulum, Custom, Unknown.
    public let protocolLabel: String
    public let applicationPort: UInt32
    /// `hop_start - hop_limit`. Nil when the frame carried no hop_start, which
    /// the deck signals by printing -1.
    public let hops: Int?
    public let rssiDBmX10: Int
    public let snrDBX10: Int
    /// The deck's own one-word packet label from `packetKindLabel`
    /// (`src/ui/packet_presentation.cpp`) — "TEXT", "BAD", "UNSUP" and so on.
    public let kindLabel: String
    /// Redundant with `origin == .synthetic`; the deck prints both.
    public let simulated: Bool
    /// Decoded payload fields, and only ever from a payload the *default*
    /// channel key opened. The firmware refuses to put an operator-key decode
    /// on this link, because the line has no field saying which key opened it
    /// and the host would show borrowed plaintext as though it were public.
    public let latitude: Double?
    public let longitude: Double?
    public let longName: String?
    public let shortName: String?
    public let text: String?
    /// Everything a faithful `.lscap` record needs. Nil on firmware older than
    /// the capture link, and nil when the record on the wire was not complete
    /// or its hex was not whole bytes.
    public let raw: LSKRawFrame?

    /// The strongest provenance claim this line supports. See `LSKFrameOrigin`.
    public var origin: LSKFrameOrigin {
        if let raw { return raw.origin }
        return simulated ? .synthetic : .unstated
    }
}

/// The `.lscap` record fields the deck puts on the wire beside the decode.
public struct LSKRawFrame: Equatable, Sendable {
    public let sequence: UInt32
    public let timestampMicroseconds: UInt64
    public let presentFields: UInt32
    public let centerFrequencyHz: UInt32
    public let bandwidthHz: UInt32
    public let bitRateBps: UInt32
    public let frequencyDeviationHz: UInt32
    public let airtimeMicroseconds: UInt32
    public let frequencyErrorHz: Int32
    public let preambleSymbols: UInt32
    public let syncWord: UInt32
    public let profileID: UInt32
    public let radioStatus: Int32
    public let txPowerDBm: Int32
    public let spreadingFactor: UInt32
    public let codingRateDenominator: UInt32
    public let channelIndex: UInt32
    public let radioIndex: UInt32
    public let modulation: UInt32
    public let direction: UInt32
    public let crcStatus: UInt32
    /// Bit 0 implicit header, bit 1 inverted IQ, bit 2 synthetic, bit 3 net.
    public let metadataFlags: UInt32
    /// Length on the air. Larger than `bytes.count` when the deck's capture
    /// buffer clipped the frame.
    public let originalLength: UInt32
    public let bytes: Data

    public var implicitHeader: Bool { metadataFlags & 0x1 != 0 }
    public var invertedIQ: Bool { metadataFlags & 0x2 != 0 }

    /// Net beats synthetic: the deck sets one origin, and reading them in this
    /// order means a future flag combination can never downgrade a net-relayed
    /// frame into something that looks locally heard.
    public var origin: LSKFrameOrigin {
        if metadataFlags & 0x8 != 0 { return .net }
        if metadataFlags & 0x4 != 0 { return .synthetic }
        return .air
    }

    public var isTruncated: Bool { originalLength > UInt32(bytes.count) }
}

/// `LSK S` — one completed sweep pass, printed by `emit_analyzer_sweep_result`
/// in `src/sim_main.cpp`.
public struct LSKSweep: Equatable, Sendable {
    /// Outer edges of the reported bins, not bin centres: the firmware pushes
    /// each end half a step outward precisely so a reader placing bin *i* at
    /// `startHz + (i + 0.5) * span / bins` lands on the frequency the SX1262
    /// was tuned to.
    public let startHz: UInt32
    public let endHz: UInt32
    /// Strongest occupied power bin per frequency point, in whole dBm. A point
    /// the scanner never filled reports the catch-all floor bin.
    public let powerDBm: [Int]

    public var binCount: Int { powerDBm.count }

    /// Centre frequency of bin `index`, matching the firmware's own arithmetic.
    public func binCenterHz(_ index: Int) -> Double {
        let span = Double(endHz) - Double(startHz)
        return Double(startHz) + (Double(index) + 0.5) * span / Double(powerDBm.count)
    }
}

/// `LSK P` — a Shelby pointer, printed from the frame-ingest path in
/// `src/sim_main.cpp` when `decode_frame_shelby_pointer` succeeds.
public struct LSKPointer: Equatable, Sendable {
    public let sizeBytes: UInt32
    public let expiresAtUnix: UInt32
    /// Exactly as printed: `0x` followed by 64 lowercase hex digits (32 bytes).
    public let owner: String
    public let commitment: String
}

/// `LSK OK` — a command took effect. Which fields are set depends on the
/// command; see `LSK.md`.
public struct LSKAck: Equatable, Sendable {
    public let kind: String?
    public let protocolLabel: String?
    /// "started" or "stopped", on a sweep acknowledgement.
    public let state: String?
    /// "flood" or "zero-hop", on a MeshCore advert acknowledgement.
    public let reach: String?
}

/// `LSK ERR` — a command was refused.
public struct LSKFault: Equatable, Sendable {
    /// Machine-readable cause, e.g. "bad-tx", "sweep-already-running".
    ///
    /// Nil is normal, not a parse failure: a transmit that the radio refused
    /// answers `LSK ERR {"proto":…,"kind":…}` with no reason at all, because
    /// the firmware prints the same body for OK and ERR and only swaps the
    /// word.
    public let reason: String?
    public let protocolLabel: String?
    public let kind: String?
}

// MARK: - Decoding

/// What one newline-stripped line from the cable turned out to be.
public enum LSKDecodeResult: Equatable, Sendable {
    /// Not analyzer traffic. The deck also prints boot banners and log lines
    /// on the same port, and a half-open USB CDC stream delivers framing noise;
    /// both land here and both are normal.
    case notAnalyzerTraffic
    /// A line this decoder understood, or a kind it deliberately passed through.
    case line(LSKLine)
    /// `LSK <kind> …` for a kind we do know, whose body was not a usable JSON
    /// object for that kind. A reset mid-print truncates a line exactly like
    /// this, so it is a routine event and not a reason to drop the link.
    case malformed(kind: String)
}

public enum LSKDecoder {
    /// Kinds this build models. Anything else is handed back as
    /// `LSKLine.unknown` without being judged against a grammar we do not have.
    public static let knownKinds: Set<String> = ["ID", "T", "F", "S", "P", "OK", "ERR"]

    /// Decode one line with the terminator already stripped.
    ///
    /// Pure and total: every input produces a result, and no input throws.
    public static func decode(_ line: String) -> LSKDecodeResult {
        guard line.hasPrefix("LSK ") else { return .notAnalyzerTraffic }
        let afterPrefix = line.index(line.startIndex, offsetBy: 4)
        guard let space = line[afterPrefix...].firstIndex(of: " ") else {
            // "LSK HELLO" and "LSK BYE" are host-to-deck commands with no body.
            // A deck never prints them, so seeing one means the port is echoing
            // us back — worth reporting as not-traffic rather than as a kind.
            return .notAnalyzerTraffic
        }
        let kind = String(line[afterPrefix..<space])
        guard !kind.isEmpty else { return .notAnalyzerTraffic }
        let body = String(line[line.index(after: space)...])

        guard knownKinds.contains(kind) else {
            return .line(.unknown(kind: kind, body: body))
        }
        guard let object = jsonObject(body) else { return .malformed(kind: kind) }

        switch kind {
        case "ID": return decodeIdentity(object)
        case "T": return decodeTelemetry(object)
        case "F": return decodeFrame(object)
        case "S": return decodeSweep(object)
        case "P": return decodePointer(object)
        case "OK":
            return .line(.ok(LSKAck(
                kind: string(object["kind"]),
                protocolLabel: string(object["proto"]),
                state: string(object["state"]),
                reach: string(object["reach"])
            )))
        case "ERR":
            return .line(.error(LSKFault(
                reason: string(object["reason"]),
                protocolLabel: string(object["proto"]),
                kind: string(object["kind"])
            )))
        default:
            return .malformed(kind: kind)
        }
    }

    /// Convenience for callers that only want the decoded value.
    public static func line(_ text: String) -> LSKLine? {
        if case .line(let value) = decode(text) { return value }
        return nil
    }

    // MARK: Per-kind decoding

    private static func decodeIdentity(_ o: [String: Any]) -> LSKDecodeResult {
        // Every field is required. A body that parsed as JSON but named no
        // firmware is not an identity, and treating it as one would let an
        // unrelated board pass the handshake with an empty version string.
        guard let app = string(o["app"]),
              let fw = string(o["fw"]),
              let board = string(o["board"]),
              let node = string(o["node"])
        else { return .malformed(kind: "ID") }
        return .line(.identity(LSKIdentity(
            app: app, firmwareVersion: fw, board: board, nodeID: node
        )))
    }

    private static func decodeTelemetry(_ o: [String: Any]) -> LSKDecodeResult {
        guard let bat = string(o["bat"]),
              let gps = string(o["gps"]),
              let profile = string(o["profile"]),
              let frames = uint32(o["frames"]),
              let rssi = int(o["rssi_x10"]),
              let snr = int(o["snr_x10"])
        else { return .malformed(kind: "T") }
        // Latitude without longitude is half a fix, and half a fix on a map is
        // a pin in the Gulf of Guinea. Both or neither.
        let lat = double(o["lat"])
        let lon = double(o["lon"])
        let haveFix = lat != nil && lon != nil
        return .line(.telemetry(LSKTelemetry(
            batteryLabel: bat,
            gpsLabel: gps,
            profileName: profile,
            newestFrameSequence: frames,
            rssiDBmX10: rssi,
            snrDBX10: snr,
            simulated: bool(o["sim"]),
            latitude: haveFix ? lat : nil,
            longitude: haveFix ? lon : nil,
            batteryMillivolts: uint32(o["mv"]),
            batteryPercent: uint32(o["pct"]),
            satellites: uint32(o["sat"]),
            centerFrequencyHz: uint32(o["freq_hz"]),
            spreadingFactor: uint32(o["sf"]),
            bandwidthHz: uint32(o["bw_hz"]),
            receivedFrames: uint32(o["rx"]),
            crcErrors: uint32(o["crc"])
        )))
    }

    private static func decodeFrame(_ o: [String: Any]) -> LSKDecodeResult {
        guard let src = uint32(o["src"]),
              let dst = uint32(o["dst"]),
              let proto = string(o["proto"]),
              let port = uint32(o["port"]),
              let rssi = int(o["rssi_x10"]),
              let snr = int(o["snr_x10"]),
              let kindLabel = string(o["kind"])
        else { return .malformed(kind: "F") }
        // The deck prints -1 for "the frame carried no hop_start", which is a
        // sentinel and not a hop count.
        var hops = int(o["hops"])
        if let value = hops, value < 0 { hops = nil }
        let lat = double(o["lat"])
        let lon = double(o["lon"])
        let haveFix = lat != nil && lon != nil
        return .line(.frame(LSKHeardFrame(
            source: src,
            destination: dst,
            protocolLabel: proto,
            applicationPort: port,
            hops: hops,
            rssiDBmX10: rssi,
            snrDBX10: snr,
            kindLabel: kindLabel,
            simulated: bool(o["sim"]),
            latitude: haveFix ? lat : nil,
            longitude: haveFix ? lon : nil,
            longName: nonEmpty(string(o["name"])),
            shortName: nonEmpty(string(o["short"])),
            text: nonEmpty(string(o["text"])),
            raw: decodeRawFrame(o)
        )))
    }

    /// Nil unless the whole record is there and the hex is whole bytes.
    ///
    /// A partial record would produce a `.lscap` capture that looks complete
    /// and is not, so a half-record is discarded rather than padded. The decode
    /// above still lists the frame — nothing is hidden, it simply does not earn
    /// a capture record it cannot fill.
    private static func decodeRawFrame(_ o: [String: Any]) -> LSKRawFrame? {
        guard let hex = string(o["hex"]),
              let sequence = uint32(o["seq"]),
              let bytes = bytesFromHex(hex)
        else { return nil }
        let u = { (key: String) -> UInt32 in uint32(o[key]) ?? 0 }
        let i = { (key: String) -> Int32 in int32(o[key]) ?? 0 }
        return LSKRawFrame(
            sequence: sequence,
            timestampMicroseconds: uint64(o["ts"]) ?? 0,
            presentFields: u("pf"),
            centerFrequencyHz: u("freq"),
            bandwidthHz: u("bw"),
            bitRateBps: u("br"),
            frequencyDeviationHz: u("fdev"),
            airtimeMicroseconds: u("air"),
            frequencyErrorHz: i("ferr"),
            preambleSymbols: u("pre"),
            syncWord: u("sync"),
            profileID: u("prof"),
            radioStatus: i("rstat"),
            txPowerDBm: i("txp"),
            spreadingFactor: u("sf"),
            codingRateDenominator: u("cr"),
            channelIndex: u("ch"),
            radioIndex: u("ridx"),
            modulation: u("mod"),
            direction: u("dir"),
            crcStatus: u("crc"),
            metadataFlags: u("mflags"),
            originalLength: u("olen"),
            bytes: bytes
        )
    }

    private static func decodeSweep(_ o: [String: Any]) -> LSKDecodeResult {
        guard let f0 = uint32(o["f0"]),
              let f1 = uint32(o["f1"]), f1 > f0,
              let bins = int(o["bins"]),
              let raw = o["db"] as? [Any], !raw.isEmpty,
              // The declared bin count must match the array. A line clipped
              // mid-array parses as JSON often enough, and plotting the
              // surviving half stretched across the whole band would look like
              // a real measurement of a band nothing was measured on.
              bins == raw.count
        else { return .malformed(kind: "S") }
        var power: [Int] = []
        power.reserveCapacity(raw.count)
        for element in raw {
            guard let value = int(element) else { return .malformed(kind: "S") }
            power.append(value)
        }
        return .line(.sweep(LSKSweep(startHz: f0, endHz: f1, powerDBm: power)))
    }

    private static func decodePointer(_ o: [String: Any]) -> LSKDecodeResult {
        guard let size = uint32(o["size"]),
              let expires = uint32(o["expires"]),
              let owner = string(o["owner"]),
              let commit = string(o["commit"])
        else { return .malformed(kind: "P") }
        return .line(.pointer(LSKPointer(
            sizeBytes: size, expiresAtUnix: expires, owner: owner, commitment: commit
        )))
    }

    // MARK: Primitives

    private static func jsonObject(_ body: String) -> [String: Any]? {
        guard let data = body.data(using: .utf8),
              let any = try? JSONSerialization.jsonObject(with: data),
              let object = any as? [String: Any]
        else { return nil }
        return object
    }

    /// Strict: an odd number of digits, or a non-hex digit, means the line was
    /// clipped or corrupted, and half a frame is worse than no frame.
    private static func bytesFromHex(_ hex: String) -> Data? {
        guard hex.count % 2 == 0 else { return nil }
        var bytes = Data(capacity: hex.count / 2)
        var high: UInt8?
        for character in hex.unicodeScalars {
            guard let value = character.lskHexDigitValue else { return nil }
            let nibble = UInt8(value)
            if let first = high {
                bytes.append((first << 4) | nibble)
                high = nil
            } else {
                high = nibble
            }
        }
        return bytes
    }

    private static func string(_ any: Any?) -> String? { any as? String }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespaces), !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private static func bool(_ any: Any?) -> Bool { (any as? Bool) ?? false }

    private static func number(_ any: Any?) -> NSNumber? {
        // Bool bridges to NSNumber too, so this is only ever asked about fields
        // the firmware prints as numbers.
        any as? NSNumber
    }

    private static func int(_ any: Any?) -> Int? { number(any)?.intValue }

    /// Nil for a non-finite value: the firmware prints coordinates with %.6f,
    /// which yields "nan" or "inf" for an unset double, and JSON has no
    /// literal for either — but a future field might arrive as one, and a NaN
    /// latitude silently becomes a pin nowhere.
    private static func double(_ any: Any?) -> Double? {
        guard let value = number(any)?.doubleValue, value.isFinite else { return nil }
        return value
    }

    private static func int32(_ any: Any?) -> Int32? { number(any)?.int32Value }
    private static func uint32(_ any: Any?) -> UInt32? {
        guard let value = number(any)?.int64Value, value >= 0, value <= Int64(UInt32.max)
        else { return nil }
        return UInt32(value)
    }

    private static func uint64(_ any: Any?) -> UInt64? {
        guard let value = number(any)?.int64Value, value >= 0 else { return nil }
        return UInt64(value)
    }
}

private extension Unicode.Scalar {
    var lskHexDigitValue: Int? {
        switch value {
        case 0x30...0x39: return Int(value - 0x30)
        case 0x61...0x66: return Int(value - 0x61) + 10
        case 0x41...0x46: return Int(value - 0x41) + 10
        default: return nil
        }
    }
}

// MARK: - Line assembly

/// Turns the byte chunks a serial read returns into whole lines.
///
/// A `read()` on USB CDC hands back whatever happened to be in the buffer: a
/// line and a half, three lines, six bytes, the tail of a line printed before
/// the host opened the port. None of those boundaries mean anything, so the
/// stream is reassembled here and only complete lines leave.
public struct LSKLineAssembler: Sendable {
    /// A full `LSK F` line with a 255-byte frame is about 800 characters —
    /// `kMaxFrameBytes` is 255 in `include/lilyshark/core/raw_frame.h`, so the
    /// hex alone is 510. Eight kilobytes leaves an order of magnitude of room
    /// and still bounds the memory a garbage stream can make us hold.
    public static let defaultLineLimit = 8192

    public let lineLimit: Int
    private var pending: [UInt8] = []
    /// True while bytes are being thrown away because a line ran past the
    /// limit; cleared at the next terminator.
    private var discarding = false
    /// How many over-long lines have been dropped. A non-zero value on a real
    /// deck means the stream is not what this codec expects, which is worth
    /// showing rather than hiding.
    public private(set) var oversizeLinesDropped = 0

    public init(lineLimit: Int = LSKLineAssembler.defaultLineLimit) {
        self.lineLimit = max(1, lineLimit)
    }

    /// Feed one read's worth of bytes; get back the lines that completed.
    public mutating func append(_ chunk: Data) -> [String] {
        append(bytes: chunk)
    }

    public mutating func append<Bytes: Sequence>(bytes: Bytes) -> [String]
    where Bytes.Element == UInt8 {
        var lines: [String] = []
        for byte in bytes {
            // The firmware prints "\n" from printf and "\r\n" from println, so
            // both terminators appear on the same link.
            if byte == 0x0A || byte == 0x0D {
                if discarding {
                    discarding = false
                    continue
                }
                if let line = flush() { lines.append(line) }
                continue
            }
            if discarding { continue }
            if pending.count >= lineLimit {
                pending.removeAll(keepingCapacity: true)
                discarding = true
                oversizeLinesDropped += 1
                continue
            }
            pending.append(byte)
        }
        return lines
    }

    /// Bytes held back waiting for a terminator. Non-zero between reads is the
    /// normal case, not an error.
    public var pendingByteCount: Int { pending.count }

    /// Drop anything half-received. Call on reconnect: the tail of a line from
    /// before the port closed must not be glued to the head of one after.
    public mutating func reset() {
        pending.removeAll(keepingCapacity: true)
        discarding = false
    }

    private mutating func flush() -> String? {
        guard !pending.isEmpty else { return nil }
        // Decoding with replacement rather than failing: the deck truncates
        // node names at a fixed byte count, so a multi-byte name can arrive cut
        // mid-sequence. That is one bad character in one field, and it must not
        // cost the whole line — still less the link.
        let text = String(decoding: pending, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        pending.removeAll(keepingCapacity: true)
        return text.isEmpty ? nil : text
    }
}
