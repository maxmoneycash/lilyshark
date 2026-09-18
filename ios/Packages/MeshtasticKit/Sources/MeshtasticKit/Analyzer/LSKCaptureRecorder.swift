import Foundation

/// A bounded recording of complete LSK frame records in the firmware's .lscap
/// 1.1 format. This does not transmit, decrypt, or infer missing RF metadata.
public struct LSKCaptureRecorder: Sendable {
    public static let maximumFrames = 100_000
    public static let maximumBytes = 32 * 1024 * 1024

    public enum AppendResult: Equatable, Sendable {
        case recorded
        case incompleteRecord
        case limitReached
    }

    public private(set) var frameCount = 0
    public private(set) var skippedCount = 0
    public private(set) var syntheticCount = 0
    public private(set) var networkCount = 0
    private var data: Data
    private let frameLimit: Int
    private let byteLimit: Int

    public init(frameLimit: Int = maximumFrames, byteLimit: Int = maximumBytes) {
        self.frameLimit = min(Self.maximumFrames, max(0, frameLimit))
        self.byteLimit = min(Self.maximumBytes, max(24, byteLimit))
        data = Data([0x4c, 0x53, 0x43, 0x50, 1, 0, 1, 0, 24, 0, 80, 0,
                     0, 0, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0])
    }

    public var byteCount: Int { data.count }

    public mutating func noteMalformedFrame() { skippedCount += 1 }

    public mutating func append(_ frame: LSKHeardFrame) -> AppendResult {
        guard let raw = frame.raw else {
            skippedCount += 1
            return .incompleteRecord
        }
        guard frameCount < frameLimit, data.count + 80 + raw.bytes.count <= byteLimit else {
            return .limitReached
        }
        // The decoder validates complete records and exact integer widths.
        var header = Data(repeating: 0, count: 80)
        func put<T: FixedWidthInteger>(_ value: T, at offset: Int) {
            for index in 0..<MemoryLayout<T>.size {
                header[offset + index] = UInt8(truncatingIfNeeded: value >> (index * 8))
            }
        }
        header.replaceSubrange(0..<4, with: [0x4c, 0x53, 0x46, 0x52])
        put(UInt16(80), at: 4)
        put(UInt16(1), at: 6)
        put(UInt16(raw.bytes.count), at: 8)
        put(UInt16(raw.originalLength), at: 10)
        put(UInt64(raw.sequence), at: 12)
        put(raw.timestampMicroseconds, at: 20)
        put(raw.presentFields, at: 28)
        put(raw.centerFrequencyHz, at: 32)
        put(raw.bandwidthHz, at: 36)
        put(raw.bitRateBps, at: 40)
        put(raw.frequencyDeviationHz, at: 44)
        put(raw.airtimeMicroseconds, at: 48)
        put(raw.frequencyErrorHz, at: 52)
        put(Int16(frame.rssiDBmX10), at: 56)
        put(Int16(frame.snrDBX10), at: 58)
        put(UInt16(raw.preambleSymbols), at: 60)
        put(UInt16(raw.syncWord), at: 62)
        put(UInt16(raw.profileID), at: 64)
        put(Int16(raw.radioStatus), at: 66)
        put(Int8(raw.txPowerDBm), at: 68)
        for (index, value) in [raw.spreadingFactor, raw.codingRateDenominator, raw.channelIndex,
                               raw.radioIndex, raw.modulation, raw.direction, raw.crcStatus, raw.metadataFlags].enumerated() {
            header[69 + index] = UInt8(value)
        }
        data.append(header)
        data.append(raw.bytes)
        frameCount += 1
        if raw.origin == .synthetic { syntheticCount += 1 }
        if raw.origin == .net { networkCount += 1 }
        return .recorded
    }

    /// Snapshot only on stop, avoiding a copy of the growing buffer per frame.
    public func snapshot() -> Data { data }
}
