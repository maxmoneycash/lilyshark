import Foundation

@main
struct NativeCaptureReader {
    static func main() {
        do { try run() }
        catch {
            fputs(error.localizedDescription + "\n", stderr)
            exit(1)
        }
    }

    private static func run() throws {
        if CommandLine.arguments.contains("--spectrum-self-test") {
            var history = SpectrumHistory()
            func sweep(_ lo: Double, _ hi: Double, _ db: [Double]) -> SpectrumSweep {
                SpectrumSweep(f0Hz: lo, f1Hz: hi, db: db, atMs: 1)
            }
            history.append(sweep(902, 928, [-140, -90]))
            history.append(sweep(902, 928, [-145, -80]))
            precondition(history.peakDb == [-140, -80])
            for _ in 0..<200 { history.append(sweep(902, 928, [-145, -100])) }
            precondition(history.sweeps.count == SpectrumHistory.limit && history.peakDb == [-140, -80])
            history.append(sweep(868, 870, [-130, -120]))
            precondition(history.sweeps.count == 1 && history.peakDb == [-130, -120])
            history.append(sweep(868, 870, [-100]))
            precondition(history.sweeps.count == 1 && history.peakDb == [-100])
            history.append(sweep(870, 868, [-90]))
            history.append(sweep(868, 870, [.nan]))
            precondition(history.sweeps.count == 1)
            history.clear()
            precondition(history.sweeps.isEmpty && history.peakDb.isEmpty)
            print("{}")
            return
        }
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        if CommandLine.arguments.contains("--lxmf-stored") {
            // Exercise MessagePack bounds beyond a radio's 255-byte limit.
            // Stored LXMF includes the destination omitted on the air.
            let bytes = try Data(contentsOf: url)
            let fields = CaptureLXMF.fields(in: Array(bytes.dropFirst(16)), offset: 0)
            let json = try JSONSerialization.data(withJSONObject: ["fields": serializeFields(fields ?? [])], options: [.sortedKeys])
            print(String(decoding: json, as: UTF8.self))
            return
        }
        var analysis: CaptureAnalysis
        if CommandLine.arguments.contains("--record-lines") {
            var recorder = LSKCaptureRecorder()
            for line in try String(contentsOf: url, encoding: .utf8).split(separator: "\n") {
                if case .frame(let frame) = LSKDecoder.line(String(line)) { _ = recorder.append(frame) }
            }
            analysis = try CaptureAnalysis(capture: LSCapParser.parse(recorder.snapshot()))
        } else if CommandLine.arguments.contains("--slice") {
            let prefixed = Data([0]) + (try Data(contentsOf: url))
            analysis = try CaptureAnalysis(capture: LSCapParser.parse(prefixed.dropFirst()))
        } else {
            analysis = try CaptureAnalysis.load(url)
        }
        func option(_ flag: String) -> String? {
            guard let index = CommandLine.arguments.firstIndex(of: flag), index + 1 < CommandLine.arguments.count else { return nil }
            return CommandLine.arguments[index + 1]
        }
        let filter = CaptureFilter(profile: option("--profile") ?? "All", origin: option("--origin") ?? "All",
            crc: option("--crc") ?? "All", direction: option("--direction") ?? "All",
            truncatedOnly: CommandLine.arguments.contains("--truncated-only"), query: option("--query") ?? "")
        analysis = try analysis.filtered(by: filter)
        let capture = analysis.capture
        if let path = option("--export") { try CaptureExport.lscap(capture).write(to: URL(fileURLWithPath: path)) }
        if let path = option("--csv") { try CaptureExport.csv(capture).write(to: URL(fileURLWithPath: path)) }
        let frames: [[String: Any]] = capture.frames.map {
            let decoded = CaptureDissection(frame: $0)
            return ["id": $0.id, "sequence": String($0.sequence), "timestamp": String($0.timestampUs),
             "rssi": $0.rssiDbm, "snr": $0.snrDb, "frequencyError": $0.frequencyErrorHz,
             "status": $0.radioStatus, "txPower": $0.txPowerDbm, "synthetic": $0.synthetic,
             "protocol": $0.protocolHint, "time": CaptureAnalysis.timeLabel($0, originUs: analysis.originUs),
             "payload": $0.bytes.map { String(format: "%02x", $0) }.joined(), "origin": $0.originLabel,
             "problem": decoded.problem ?? "", "summary": decoded.summary,
             "fields": serializeFields(decoded.fields)]
        }
        let result: [String: Any] = ["frames": frames, "trailing": capture.trailingBytes,
            "recovery": capture.recoveryMessage ?? "", "untimed": analysis.untimedCount,
            "synthetic": analysis.syntheticCount,
            "points": analysis.points.map { ["id": $0.id, "seconds": $0.seconds, "count": $0.count] }]
        let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        print(String(decoding: json, as: UTF8.self))
    }

    private static func serializeFields(_ fields: [CaptureDissection.Field]) -> [[String: Any]] {
        fields.map { ["name": $0.name, "value": $0.value, "offset": $0.bytes.lowerBound, "length": $0.bytes.count] }
    }
}
