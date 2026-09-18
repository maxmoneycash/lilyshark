import Foundation

public enum LSCapParser {
    public enum ParseError: LocalizedError {
        case fileTooShort
        case invalidMagic
        case unsupportedVersion(UInt16)
        case invalidHeader(String)
        case limitExceeded

        public var errorDescription: String? {
            switch self {
            case .fileTooShort: return "The file is shorter than a capture header."
            case .invalidMagic: return "This file is not a Lilyshark .lscap capture."
            case .unsupportedVersion(let version): return "Capture version \(version) is not supported."
            case .invalidHeader(let reason): return "Invalid capture header: \(reason)"
            case .limitExceeded: return "Open a capture up to 32 MB with at most 100,000 frames. Split larger captures before importing."
            }
        }
    }

    public static let maximumFileBytes = 32 * 1024 * 1024
    public static let maximumFrames = 100_000
    
    public struct FileHeader: Sendable {
        public let majorVersion: UInt16
        public let minorVersion: UInt16
        public let fileHeaderSize: UInt16
        public let recordHeaderSize: UInt16
        public let fileFlags: UInt32
        public let ticksPerSecond: UInt32
    }
    
    public enum Modulation: String, Sendable {
        case unknown = "unknown"
        case lora = "lora"
        case fsk = "fsk"
    }
    
    public enum FrameDirection: String, Sendable {
        case unknown = "unknown"
        case rx = "rx"
        case tx = "tx"
    }
    
    public enum CrcStatus: String, Sendable {
        case unknown = "unknown"
        case absent = "absent"
        case valid = "valid"
        case invalid = "invalid"
    }
    
    public struct Frame: Identifiable, Sendable {
        /// File offset stays unique even when firmware sequence numbers repeat.
        public let id: Int
        public let sequence: UInt64
        public let timestampUs: UInt64
        public let capturedLength: UInt16
        public let originalLength: UInt16
        public let truncated: Bool
        public let presentFields: UInt32
        
        public let centerFrequencyHz: UInt32
        public let bandwidthHz: UInt32
        public let bitRateBps: UInt32
        public let frequencyDeviationHz: UInt32
        public let airtimeUs: UInt32
        public let frequencyErrorHz: Int32
        
        public let rssiDbm: Double
        public let snrDb: Double
        
        public let preambleSymbols: UInt16
        public let syncWord: UInt16
        public let profileId: UInt16
        public let radioStatus: Int16
        public let txPowerDbm: Int8
        public let spreadingFactor: UInt8
        public let codingRateDenominator: UInt8
        public let channelIndex: UInt8
        public let radioIndex: UInt8
        
        public let modulation: Modulation
        public let direction: FrameDirection
        public let crc: CrcStatus
        public let metadataFlags: UInt8
        public let synthetic: Bool
        public let netRelayed: Bool
        
        public let bytes: Data
        /// Keep unknown header extensions and legacy flags intact when exporting.
        public let recordData: Data

        public var originLabel: String {
            if netRelayed { return "Network relayed" }
            return synthetic ? "Synthetic" : "Unspecified"
        }

        public func hasField(_ bit: Int) -> Bool { presentFields & (1 << bit) != 0 }

        public var protocolHint: String {
            guard hasField(10) else { return "Unknown" }
            switch profileId {
            case 1, 4: return "Meshtastic"
            case 2, 3: return "MeshCore"
            case 5: return "Reticulum"
            case 0: return "Unknown"
            default: return "Custom"
            }
        }
    }
    
    public struct Capture: Sendable {
        public let header: FileHeader
        public let frames: [Frame]
        public let trailingBytes: Int
        public let recoveryMessage: String?
        public let headerData: Data
    }
    
    public static func parse(_ data: Data) throws -> Capture {
        guard data.count <= maximumFileBytes else { throw ParseError.limitExceeded }
        // A Data slice need not begin at index zero. Bytes also avoid alignment assumptions.
        let data = [UInt8](data)
        func read<T: FixedWidthInteger>(_ offset: Int) -> T {
            var value: T = 0
            for byte in 0..<MemoryLayout<T>.size {
                value |= T(truncatingIfNeeded: data[offset + byte]) << (byte * 8)
            }
            return value
        }
        guard data.count >= 24 else {
            throw ParseError.fileTooShort
        }
        
        let magic = String(decoding: data[0..<4], as: UTF8.self)
        guard magic == "LSCP" else {
            throw ParseError.invalidMagic
        }
        
        let majorVersion: UInt16 = read(4)
        guard majorVersion == 1 else {
            throw ParseError.unsupportedVersion(majorVersion)
        }
        
        let minorVersion: UInt16 = read(6)
        let fileHeaderSize: UInt16 = read(8)
        let recordHeaderSize: UInt16 = read(10)
        let fileFlags: UInt32 = read(12)
        let ticksPerSecond: UInt32 = read(16)
        guard fileHeaderSize >= 24, recordHeaderSize >= 80 else {
            throw ParseError.invalidHeader("header sizes must be at least 24 and 80 bytes.")
        }
        guard Int(fileHeaderSize) <= data.count else {
            throw ParseError.invalidHeader("the declared header is incomplete.")
        }
        guard ticksPerSecond == 1_000_000 else {
            throw ParseError.invalidHeader("version 1 timestamps must use microseconds.")
        }
        
        let header = FileHeader(
            majorVersion: majorVersion,
            minorVersion: minorVersion,
            fileHeaderSize: fileHeaderSize,
            recordHeaderSize: recordHeaderSize,
            fileFlags: fileFlags,
            ticksPerSecond: ticksPerSecond
        )
        
        var frames: [Frame] = []
        let syntheticSupported = minorVersion >= 1
        var offset = Int(fileHeaderSize)
        let recHeaderSize = Int(recordHeaderSize)
        var recoveryMessage: String?
        
        while offset < data.count {
            try Task.checkCancellation()
            guard data.count - offset >= recHeaderSize else {
                recoveryMessage = "Incomplete record header at byte \(offset)."
                break
            }
            let recMagic = String(decoding: data[offset..<(offset+4)], as: UTF8.self)
            guard recMagic == "LSFR" else {
                recoveryMessage = "Invalid record marker at byte \(offset)."
                break
            }
            let declaredSize: UInt16 = read(offset + 4)
            let layout: UInt16 = read(offset + 6)
            // Older browser exports wrote these fields as four reserved zeros.
            let legacyBrowser = minorVersion == 1 && recordHeaderSize == 80 && declaredSize == 0 && layout == 0
            guard legacyBrowser || (declaredSize == recordHeaderSize && layout == 1) else {
                recoveryMessage = "Unsupported record layout or header size at byte \(offset)."
                break
            }
            
            let capturedLength = Int(read(offset + 8) as UInt16)
            let originalLength = Int(read(offset + 10) as UInt16)
            guard capturedLength <= 255, originalLength >= capturedLength else {
                recoveryMessage = "Invalid payload lengths at byte \(offset)."
                break
            }
            let payloadStart = offset + recHeaderSize
            
            if payloadStart + capturedLength > data.count {
                recoveryMessage = "Incomplete payload at byte \(offset)."
                break
            }
            guard frames.count < maximumFrames else { throw ParseError.limitExceeded }
            
            let metadataFlags = data[offset+76]
            
            let modByte = data[offset+73]
            let modulation: Modulation = modByte == 1 ? .lora : (modByte == 2 ? .fsk : .unknown)
            
            let dirByte = data[offset+74]
            let direction: FrameDirection = dirByte == 1 ? .rx : (dirByte == 2 ? .tx : .unknown)
            
            let crcByte = data[offset+75]
            let crc: CrcStatus = crcByte == 1 ? .absent : (crcByte == 2 ? .valid : (crcByte == 3 ? .invalid : .unknown))
            
            let frame = Frame(
                id: offset,
                sequence: read(offset + 12),
                timestampUs: read(offset + 20),
                capturedLength: UInt16(capturedLength),
                originalLength: UInt16(originalLength),
                truncated: originalLength > capturedLength,
                presentFields: read(offset + 28),
                centerFrequencyHz: read(offset + 32),
                bandwidthHz: read(offset + 36),
                bitRateBps: read(offset + 40),
                frequencyDeviationHz: read(offset + 44),
                airtimeUs: read(offset + 48),
                frequencyErrorHz: read(offset + 52),
                rssiDbm: Double(read(offset + 56) as Int16) / 10.0,
                snrDb: Double(read(offset + 58) as Int16) / 10.0,
                preambleSymbols: read(offset + 60),
                syncWord: read(offset + 62),
                profileId: read(offset + 64),
                radioStatus: read(offset + 66),
                txPowerDbm: read(offset + 68),
                spreadingFactor: data[offset+69],
                codingRateDenominator: data[offset+70],
                channelIndex: data[offset+71],
                radioIndex: data[offset+72],
                modulation: modulation,
                direction: direction,
                crc: crc,
                metadataFlags: metadataFlags,
                synthetic: syntheticSupported && ((metadataFlags & (1 << 2)) != 0),
                netRelayed: syntheticSupported && ((metadataFlags & (1 << 3)) != 0),
                bytes: Data(data[payloadStart..<(payloadStart + capturedLength)]),
                recordData: Data(data[offset..<(payloadStart + capturedLength)])
            )
            frames.append(frame)
            offset = payloadStart + capturedLength
        }
        
        return Capture(header: header, frames: frames, trailingBytes: data.count - offset, recoveryMessage: recoveryMessage,
                       headerData: Data(data[..<Int(fileHeaderSize)]))
    }
}
