import Foundation

/// Clear opportunistic LXMF: source hash + signature + MessagePack array.
/// The destination is carried by the enclosing Reticulum header. The vectors
/// in test/lxmf/fixtures.h pin this layout against the reference stack.
enum CaptureLXMF {
    static func fields(in bytes: [UInt8], offset: Int) -> [CaptureDissection.Field]? {
        guard offset >= 0, offset <= bytes.count, bytes.count - offset > 80 else { return nil }
        do {
            var reader = Reader(bytes: bytes, offset: offset + 80)
            let arrayStart = reader.offset
            let count = try reader.arrayHeader()
            guard count == 4 || count == 5 else { return nil }
            let arrayRange = arrayStart..<reader.offset
            let timestamp = try reader.read()
            guard timestamp.kind == .none || (timestamp.kind == .number && timestamp.number?.isFinite == true) else { return nil }
            let title = try reader.read(), content = try reader.read(), fields = try reader.read()
            guard [.none, .bytes].contains(title.kind), [.none, .bytes].contains(content.kind),
                  [.none, .map].contains(fields.kind) else { return nil }
            let stamp = count == 5 ? try reader.read() : nil
            if let stamp, ![.none, .bytes].contains(stamp.kind) { return nil }
            guard reader.offset == bytes.count else { return nil }

            func row(_ name: String, _ value: String, _ range: Range<Int>) -> CaptureDissection.Field {
                CaptureDissection.Field(name: name, value: value, bytes: range)
            }
            var rows = [
                row("LXMF source hash", bytes[offset..<(offset + 16)].map { String(format: "%02x", $0) }.joined(), offset..<(offset + 16)),
                row("LXMF signature", "64 bytes present · signature not verified", (offset + 16)..<(offset + 80)),
                row("LXMF array", "\(count) elements · timestamp, title, content, fields" + (stamp == nil ? "" : ", stamp"), arrayRange),
                row("LXMF timestamp", timestamp.number.map { "\($0) seconds since Unix epoch" } ?? "Not included (nil)", timestamp.range),
                row("LXMF title", text(title, in: bytes, limit: 64), title.range),
                row("LXMF content", text(content, in: bytes, limit: 192), content.range),
                row("LXMF fields", fields.count.map { "\($0) entries · contents not interpreted" } ?? "Not included (nil)", fields.range)
            ]
            if let stamp {
                rows.append(row("LXMF stamp", stamp.body.map { "\($0.count) bytes present · stamp not verified" } ?? "Not included (nil)", stamp.range))
            }
            return rows
        } catch { return nil }
    }

    private static func text(_ value: Value, in bytes: [UInt8], limit: Int) -> String {
        guard let body = value.body else { return "Not included (nil)" }
        guard !body.isEmpty else { return "Empty (0 bytes)" }
        var end = body.lowerBound + min(limit, body.count)
        if end < body.upperBound {
            // Do not introduce a replacement character by cutting valid UTF-8.
            var start = end - 1
            while start > body.lowerBound && bytes[start] & 0xc0 == 0x80 { start -= 1 }
            let lead = bytes[start]
            let width = lead >= 0xf0 && lead <= 0xf4 ? 4 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xc2 && lead <= 0xdf ? 2 : 1
            if start + width > end { end = start }
        }
        let decoded = String(decoding: bytes[body.lowerBound..<end], as: UTF8.self)
        var preview = ""
        for scalar in decoded.unicodeScalars {
            switch scalar.value {
            case 9, 10, 13: preview.append(" ")
            case 0...31, 127...159: preview.append("·")
            default: preview.unicodeScalars.append(scalar)
            }
        }
        return "\"\(preview)\" · \(body.count) bytes" + (body.count > limit ? " · preview truncated" : "")
    }

    private struct Value {
        enum Kind { case none, number, bytes, array, map, boolean }
        let kind: Kind
        let range: Range<Int>
        var body: Range<Int>?
        var count: Int?
        var number: Double?
    }

    /// Lengths are checked before advancing; containers are walked without
    /// building objects. Every item consumes a byte and nesting stops at 16.
    private struct Reader {
        enum Invalid: Error { case messagePack }
        let bytes: [UInt8]
        var offset: Int

        mutating func take(_ count: Int) throws -> Range<Int> {
            guard count >= 0, count <= bytes.count - offset else { throw Invalid.messagePack }
            let range = offset..<(offset + count)
            offset += count
            return range
        }

        mutating func uint(_ width: Int) throws -> UInt64 {
            let range = try take(width)
            return bytes[range].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        }

        mutating func arrayHeader() throws -> Int {
            let tag = try uint(1)
            if tag & 0xf0 == 0x90 { return Int(tag & 15) }
            if tag == 0xdc || tag == 0xdd { return Int(try uint(tag == 0xdc ? 2 : 4)) }
            throw Invalid.messagePack
        }

        mutating func read(depth: Int = 0) throws -> Value {
            guard depth <= 16 else { throw Invalid.messagePack }
            let start = offset, tag = try uint(1)
            var kind: Value.Kind
            var body: Range<Int>?
            var count: Int?
            var number: Double?
            switch tag {
            case 0...127: kind = .number; number = Double(tag)
            case 224...255: kind = .number; number = Double(Int(tag) - 256)
            case 0xc0: kind = .none
            case 0xc2, 0xc3: kind = .boolean
            case 0xa0...0xbf, 0xc4...0xc6, 0xd9...0xdb:
                kind = .bytes
                let length: Int
                if tag & 0xe0 == 0xa0 { length = Int(tag & 31) }
                else { length = Int(try uint(tag == 0xc4 || tag == 0xd9 ? 1 : tag == 0xc5 || tag == 0xda ? 2 : 4)) }
                body = try take(length)
            case 0xca...0xd3:
                kind = .number
                let width = [4, 8, 1, 2, 4, 8, 1, 2, 4, 8][Int(tag - 0xca)]
                let bits = try uint(width)
                if tag == 0xca { number = Double(Float(bitPattern: UInt32(bits))) }
                else if tag == 0xcb { number = Double(bitPattern: bits) }
                else if tag >= 0xd0 {
                    let shift = 64 - width * 8
                    let signed = Int64(bitPattern: bits << shift) >> shift
                    if signed >= -9_007_199_254_740_991 && signed <= 9_007_199_254_740_991 { number = Double(signed) }
                } else if bits <= 9_007_199_254_740_991 { number = Double(bits) }
            case 0x90...0x9f: kind = .array; count = Int(tag & 15)
            case 0x80...0x8f: kind = .map; count = Int(tag & 15)
            case 0xdc, 0xdd: kind = .array; count = Int(try uint(tag == 0xdc ? 2 : 4))
            case 0xde, 0xdf: kind = .map; count = Int(try uint(tag == 0xde ? 2 : 4))
            default: throw Invalid.messagePack
            }
            if let count {
                let multiplier = kind == .map ? 2 : 1
                guard count <= (bytes.count - offset) / multiplier else { throw Invalid.messagePack }
                for _ in 0..<(count * multiplier) { _ = try read(depth: depth + 1) }
            }
            return Value(kind: kind, range: start..<offset, body: body, count: count, number: number)
        }
    }
}
