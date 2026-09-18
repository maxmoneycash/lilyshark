import Foundation

/// RF decoding, profile-gated like src/core/*_decoder.cpp.
/// This layer does not decrypt, authenticate a sender, or infer a protocol.
struct CaptureDissection: Sendable {
    struct Field: Identifiable, Sendable {
        let name: String
        let value: String
        let bytes: Range<Int>
        var id: String { "\(bytes.lowerBound):\(name)" }
    }

    var fields: [Field] = []
    var summary = "No protocol decoder selected by the recorded profile."
    var problem: String?

    init(frame: LSCapParser.Frame) {
        let bytes = [UInt8](frame.bytes)
        switch frame.protocolHint {
        case "Meshtastic": meshtastic(bytes)
        case "MeshCore": meshCore(bytes)
        case "Reticulum": reticulum(bytes, truncated: frame.truncated)
        default: break
        }
        // Match the firmware's independent pointer scan. This reports a byte
        // pattern, not decryption or verification of its enclosing protocol.
        shelbyPointer(bytes)
        if frame.truncated {
            problem = [problem, "Capture is truncated; only available fields are shown."].compactMap { $0 }.joined(separator: " ")
        }
    }

    private mutating func add(_ name: String, _ value: String, _ offset: Int, _ length: Int) {
        fields.append(Field(name: name, value: value, bytes: offset..<(offset + length)))
    }

    private func hex(_ bytes: [UInt8], _ offset: Int, _ count: Int) -> String {
        bytes[offset..<(offset + count)].map { String(format: "%02x", $0) }.joined()
    }

    private func le32(_ b: [UInt8], _ at: Int) -> UInt32 {
        (0..<4).reduce(0) { $0 | (UInt32(b[at + $1]) << ($1 * 8)) }
    }

    private mutating func meshtastic(_ b: [UInt8]) {
        summary = "Meshtastic radio header. Payload is opaque; encryption and sender identity are not verified."
        guard b.count >= 16 else { problem = "Meshtastic needs a 16-byte radio header."; return }
        let destination = le32(b, 0), source = le32(b, 4), hopStart = b[12] >> 5
        add("Destination", destination == .max ? "Broadcast" : String(format: "!%08x", destination), 0, 4)
        add("Source", String(format: "!%08x", source), 4, 4)
        add("Packet ID", String(format: "0x%08x", le32(b, 8)), 8, 4)
        add("Hop limit", String(b[12] & 7), 12, 1)
        add("Hop start", String(hopStart), 12, 1)
        add("Acknowledgement requested", b[12] & 8 != 0 ? "Yes" : "No", 12, 1)
        add("Via MQTT flag", b[12] & 16 != 0 ? "Set" : "Not set", 12, 1)
        add("Channel hash", "0x" + hex(b, 13, 1), 13, 1)
        if hopStart != 0 {
            add("Next hop", "0x" + hex(b, 14, 1), 14, 1)
            add("Relay node", "0x" + hex(b, 15, 1), 15, 1)
        }
        add("Opaque payload", "\(b.count - 16) bytes", 16, b.count - 16)
        if source == 0 { problem = "Zero is not a valid Meshtastic sender." }
    }

    private mutating func meshCore(_ b: [UInt8]) {
        summary = "MeshCore header and routing fields. Message content is not decrypted."
        guard let header = b.first else { problem = "MeshCore needs a header byte."; return }
        let route = Int(header & 3), type = Int((header >> 2) & 15), version = Int(header >> 6)
        let types = ["Request", "Response", "Text message", "Acknowledgement", "Advertisement", "Group text", "Group data", "Anonymous request", "Returned path", "Trace", "Multipart", "Control", "Reserved 12", "Reserved 13", "Reserved 14", "Raw custom"]
        add("Route", ["Transport flood", "Flood", "Direct", "Transport direct"][route], 0, 1)
        add("Payload type", types[type], 0, 1)
        add("Payload version", String(version + 1), 0, 1)
        guard version == 0 else { summary = "This MeshCore payload version is not supported. Only the first header byte is decoded."; return }
        var cursor = 1
        if route == 0 || route == 3 {
            guard b.count >= 5 else { problem = "Transport routing needs four bytes of transport codes."; return }
            for index in 0..<2 {
                let at = 1 + index * 2
                add("Transport code \(index + 1)", String(format: "0x%04x", UInt16(b[at]) | UInt16(b[at + 1]) << 8), at, 2)
            }
            cursor = 5
        }
        guard cursor < b.count else { problem = "Missing MeshCore path-length byte."; return }
        let count = Int(b[cursor] & 63), size = Int(b[cursor] >> 6) + 1
        add("Path hash count", String(count), cursor, 1)
        add("Path hash size", "\(size) bytes", cursor, 1)
        cursor += 1
        let length = count * size
        guard size != 4, length <= 64, length <= b.count - cursor else {
            problem = "Invalid or incomplete MeshCore path."; return
        }
        for index in 0..<count {
            add("Hop hash \(index + 1)", "0x" + hex(b, cursor + index * size, size), cursor + index * size, size)
        }
        cursor += length
        let payload = b.count - cursor
        guard payload <= 184, payload > 0 || type == 15 else { problem = "Invalid MeshCore payload length."; return }
        var valid = true
        switch type {
        case 3:
            valid = payload >= 4
            if valid { add("Acknowledgement checksum", String(format: "0x%08x", le32(b, cursor)), cursor, 4) }
        case 4: valid = payload >= 100
        case 9:
            valid = payload >= 9
            if valid {
                add("Trace tag", String(format: "0x%08x", le32(b, cursor)), cursor, 4)
                add("Trace auth code", String(format: "0x%08x", le32(b, cursor + 4)), cursor + 4, 4)
                add("Trace flags", "0x" + hex(b, cursor + 8, 1), cursor + 8, 1)
            }
        case 0, 1, 2, 8: valid = payload >= 20 && (payload - 4) % 16 == 0
        case 5, 6:
            valid = payload >= 19 && (payload - 3) % 16 == 0
            if valid { add("Channel hash", "0x" + hex(b, cursor, 1), cursor, 1) }
        case 7: valid = payload >= 51 && (payload - 35) % 16 == 0
        default: break
        }
        let encrypted = [0, 1, 2, 5, 6, 7, 8].contains(type)
        add(encrypted && valid ? "Encrypted payload" : "Payload bytes", "\(payload) bytes", cursor, payload)
        if !valid { problem = "Payload length does not match the MeshCore \(types[type].lowercased()) layout." }
    }

    private mutating func reticulum(_ b: [UInt8], truncated: Bool) {
        summary = "Reticulum over RNode. The header records a hop count and at most one transport instance, not a complete route."
        guard b.count >= 2 else { problem = "Reticulum needs an RNode shim and packet header."; return }
        add("RNode shim", "0x" + hex(b, 0, 1), 0, 1)
        if b[0] & 1 != 0 {
            summary = "RNode split frame. Reassembly is required before decoding the Reticulum header."
            return
        }
        if b[1] & 128 != 0 {
            summary = "IFAC-protected packet. Header and payload remain masked without the interface key."
            add("IFAC protection", "Present", 1, 1)
            if b.count < 21 { problem = "Incomplete IFAC-protected packet." }
            return
        }
        let two = b[1] & 64 != 0, dest = two ? 19 : 3, context = dest + 16
        guard b.count > context else { problem = "Incomplete Reticulum header."; return }
        add("Header type", two ? "Two" : "One", 1, 1)
        add("Packet type", ["Data", "Announce", "Link request", "Proof"][Int(b[1] & 3)], 1, 1)
        add("Destination type", ["Single", "Group", "Plain", "Link"][Int((b[1] >> 2) & 3)], 1, 1)
        add("Transport flag", b[1] & 16 != 0 ? "Set" : "Not set", 1, 1)
        add("Context flag", b[1] & 32 != 0 ? "Set" : "Not set", 1, 1)
        add("Hops", String(b[2]), 2, 1)
        if two { add("Transport ID", hex(b, 3, 16), 3, 16) }
        add("Destination hash", hex(b, dest, 16), dest, 16)
        add("Context", "0x" + hex(b, context, 1), context, 1)
        add("Payload bytes", "\(b.count - context - 1) bytes", context + 1, b.count - context - 1)
        guard b[2] < 128 else { problem = "Reticulum hop count must be below 128."; return }
        let packet = b[1] & 3, destination = (b[1] >> 2) & 3, payload = context + 1
        if packet == 1 {
            let fixedLength = 148 + (b[1] & 32 != 0 ? 32 : 0)
            guard destination == 0, !truncated, b.count - payload >= fixedLength,
                  b.count - payload - fixedLength <= 87 else {
                summary += " Announce fields are unavailable: the destination, length, or capture completeness does not match the announce layout."
                return
            }
            reticulumAnnounce(b, offset: payload)
        } else if !truncated, packet == 0, destination == 2, b[context] == 0,
                  let messageFields = CaptureLXMF.fields(in: b, offset: payload) {
            summary += " LXMF structure read from cleartext; signature and stamp are not verified."
            fields.append(contentsOf: messageFields)
        } else {
            let clear = packet == 2 || destination == 2 ||
                (packet == 3 && (b[context] == 5 || destination == 3)) ||
                [1, 8, 250].contains(b[context])
            summary += clear ? " Payload content is not decoded." : " Payload is encrypted; the destination key is not held."
        }
    }

    private mutating func reticulumAnnounce(_ b: [UInt8], offset: Int) {
        summary += " Announce fields are present; identity, signature, and destination derivation are not verified."
        add("Announce public key", "64 bytes present · key not verified", offset, 64)
        add("Announce name hash", hex(b, offset + 64, 10), offset + 64, 10)
        add("Announce random hash", hex(b, offset + 74, 10), offset + 74, 10)
        var cursor = offset + 84
        if b[1] & 32 != 0 {
            add("Announce ratchet", "32 bytes present · key not verified", cursor, 32)
            cursor += 32
        }
        add("Announce signature", "64 bytes present · signature not verified", cursor, 64)
        cursor += 64
        let tail = b[cursor...]
        if !tail.isEmpty {
            let preview = tail.allSatisfy { $0 >= 32 && $0 < 127 }
                ? " · " + String(decoding: tail.prefix(48), as: UTF8.self) + (tail.count > 48 ? "…" : "") : ""
            add("Announce application data", "\(tail.count) bytes · contents not interpreted\(preview)", cursor, tail.count)
        }
    }

    private mutating func shelbyPointer(_ b: [UInt8]) {
        guard b.count >= 82 else { return }
        for offset in 0...(b.count - 82) {
            guard b[offset] == 0x53, b[offset + 1] == 0x48, b[offset + 2] == 0x4c,
                  b[offset + 3] == 0x42, b[offset + 4] == 1 else { continue }
            let flags = b[offset + 5]
            let index = Int(b[offset + 78]) | Int(b[offset + 79]) << 8
            let count = Int(b[offset + 80]) | Int(b[offset + 81]) << 8
            guard count > 0, index < count, (flags & 2 != 0) == (count > 1) else { continue }
            add("Shelby pointer", "82-byte structure found in raw bytes · blob, owner, and enclosing payload not verified", offset, 82)
            add("Pointer version", "1", offset + 4, 1)
            add("Pointer flags", "0x" + hex(b, offset + 5, 1), offset + 5, 1)
            add("Blob encrypted", flags & 1 != 0 ? "Yes" : "No", offset + 5, 1)
            add("Capture blob flag", flags & 4 != 0 ? "Set" : "Not set", offset + 5, 1)
            add("Blob commitment", "0x" + hex(b, offset + 6, 32), offset + 6, 32)
            add("Owner account", "0x" + hex(b, offset + 38, 32), offset + 38, 32)
            add("Blob size", "\(le32(b, offset + 70)) bytes", offset + 70, 4)
            add("Blob expiry", "\(le32(b, offset + 74)) seconds since Unix epoch", offset + 74, 4)
            add("Chunk index", "\(index) (zero-based)", offset + 78, 2)
            add("Chunk count", String(count), offset + 80, 2)
            return
        }
    }
}
