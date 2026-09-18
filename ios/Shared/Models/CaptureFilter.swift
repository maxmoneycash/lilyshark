import Foundation

struct CaptureFilter: Equatable, Sendable {
    var profile = "All"
    var origin = "All"
    var crc = "All"
    var direction = "All"
    var truncatedOnly = false
    var query = ""

    /// Prepare a query once per filter change, rather than formatting every
    /// captured byte as text on each pass through a 100,000-frame capture.
    struct Matcher {
        let filter: CaptureFilter
        let sequenceQuery: String
        let payloadQuery: Data?

        init(_ filter: CaptureFilter) {
            self.filter = filter
            sequenceQuery = filter.query.trimmingCharacters(in: .whitespacesAndNewlines)
            let hex = Array(sequenceQuery.filter { !$0.isWhitespace }.utf8)
            func nibble(_ byte: UInt8) -> UInt8? {
                switch byte {
                case 48...57: return byte - 48
                case 65...70: return byte - 55
                case 97...102: return byte - 87
                default: return nil
                }
            }
            var bytes = Data()
            if !hex.isEmpty && hex.count.isMultiple(of: 2) {
                for index in stride(from: 0, to: hex.count, by: 2) {
                    guard let high = nibble(hex[index]), let low = nibble(hex[index + 1]) else {
                        payloadQuery = nil
                        return
                    }
                    bytes.append(high << 4 | low)
                }
            }
            payloadQuery = bytes.isEmpty ? nil : bytes
        }

        func matches(_ frame: LSCapParser.Frame) -> Bool {
            guard filter.profile == "All" || frame.protocolHint == filter.profile,
                  filter.origin == "All" || frame.originLabel == filter.origin,
                  filter.crc == "All" || frame.crc.rawValue == filter.crc,
                  filter.direction == "All" || frame.direction.rawValue == filter.direction,
                  !filter.truncatedOnly || frame.truncated else { return false }
            if sequenceQuery.isEmpty || String(frame.sequence).contains(sequenceQuery) { return true }
            guard let payloadQuery else { return false }
            return frame.bytes.range(of: payloadQuery) != nil
        }
    }

}

enum CaptureExport {
    /// Copies complete original records, including unknown extensions. Never
    /// serializes parsed defaults back over metadata the radio did not record.
    static func lscap(_ capture: LSCapParser.Capture) throws -> Data {
        var data = capture.headerData
        for frame in capture.frames {
            try Task.checkCancellation()
            data.append(frame.recordData)
        }
        return data
    }

    static func csv(_ capture: LSCapParser.Capture) throws -> Data {
        var data = Data("sequence,timestamp_us,profile,origin,synthetic,direction,crc,captured_bytes,original_bytes,frequency_hz,rssi_dbm,snr_db,payload_hex\r\n".utf8)
        for frame in capture.frames {
            try Task.checkCancellation()
            let fields = [String(frame.sequence), frame.hasField(0) ? String(frame.timestampUs) : "",
                frame.protocolHint, frame.originLabel, String(frame.synthetic), frame.direction.rawValue,
                frame.crc.rawValue, String(frame.capturedLength), String(frame.originalLength),
                frame.hasField(1) ? String(frame.centerFrequencyHz) : "",
                frame.hasField(5) ? String(frame.rssiDbm) : "",
                frame.hasField(6) ? String(frame.snrDb) : "",
                // Prefix prevents spreadsheet number coercion from losing leading zeros.
                "0x" + frame.bytes.map { String(format: "%02x", $0) }.joined()]
            data.append(Data((fields.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }.joined(separator: ",") + "\r\n").utf8))
        }
        return data
    }
}
