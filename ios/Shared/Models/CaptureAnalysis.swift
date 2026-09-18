import Foundation

/// Prepared off the main actor so rendering a chart never rescans a large capture.
struct CaptureAnalysis: Sendable {
    struct Point: Identifiable, Sendable {
        let bucket: Int
        let seconds: Double
        let source: String
        let count: Int
        var id: String { "\(bucket):\(source)" }
    }

    let capture: LSCapParser.Capture
    let originUs: UInt64?
    let points: [Point]
    let syntheticCount: Int
    let untimedCount: Int

    init(capture: LSCapParser.Capture, originUs: UInt64? = nil) {
        self.capture = capture
        let timed = capture.frames.filter { $0.hasField(0) }
        self.originUs = originUs ?? timed.map(\.timestampUs).min()
        untimedCount = capture.frames.count - timed.count
        syntheticCount = capture.frames.filter(\.synthetic).count
        guard let origin = self.originUs, let last = timed.map(\.timestampUs).max() else {
            points = []
            return
        }
        let width = max(Double(last - origin) / 60, 500_000)
        var bins: [Int: [String: Int]] = [:]
        for frame in timed {
            let bucket = min(59, Int(Double(frame.timestampUs - origin) / width))
            let source = frame.originLabel
            bins[bucket, default: [:]][source, default: 0] += 1
        }
        points = bins.keys.sorted().flatMap { bucket in
            bins[bucket]!.keys.sorted().map { source in
                Point(bucket: bucket, seconds: Double(bucket) * width / 1_000_000, source: source, count: bins[bucket]![source]!)
            }
        }
    }

    func filtered(by filter: CaptureFilter) throws -> CaptureAnalysis {
        try Task.checkCancellation()
        if filter == CaptureFilter() { return self }
        let matcher = CaptureFilter.Matcher(filter)
        let frames = try capture.frames.filter { frame in
            try Task.checkCancellation()
            return matcher.matches(frame)
        }
        return CaptureAnalysis(capture: .init(header: capture.header, frames: frames,
            trailingBytes: capture.trailingBytes, recoveryMessage: capture.recoveryMessage,
            headerData: capture.headerData), originUs: originUs)
    }

    static func timeLabel(_ frame: LSCapParser.Frame, originUs: UInt64?) -> String {
        guard frame.hasField(0), let originUs, frame.timestampUs >= originUs else { return "Time not recorded" }
        return String(format: "+%.3f s", Double(frame.timestampUs - originUs) / 1_000_000)
    }

    static func load(_ url: URL) throws -> CaptureAnalysis {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var data = Data()
        while true {
            try Task.checkCancellation()
            let remaining = LSCapParser.maximumFileBytes + 1 - data.count
            let chunk = try handle.read(upToCount: min(65_536, remaining)) ?? Data()
            if chunk.isEmpty { break }
            data.append(chunk)
            guard data.count <= LSCapParser.maximumFileBytes else { throw LSCapParser.ParseError.limitExceeded }
        }
        return try CaptureAnalysis(capture: LSCapParser.parse(data))
    }
}
