import Foundation

/// Calculated airtime, not a radio measurement. Coding rate is the denominator
/// in 4/5 through 4/8, matching DeviceConfig and the firmware's radio profile.
public struct LoRaAirtimeEstimate: Equatable, Sendable {
    public let symbolDurationMs: Double
    public let preambleTimeMs: Double
    public let payloadSymbolCount: Int
    public let payloadTimeMs: Double
    public let totalAirtimeMs: Double
    public let bitRate: Double

    /// Semtech AN1200.13 section 4, with the SX1262 SF5/6 constants used by
    /// RadioLib and this repository's src/core/lora_airtime.cpp.
    /// https://www.mouser.com/pdfdocs/semtech-lora-modem-design.pdf
    public init?(
        spreadingFactor: Int,
        bandwidthKHz: Double,
        codingRateDenominator: Int,
        payloadBytes: Int,
        preambleSymbols: Int,
        explicitHeader: Bool,
        crcEnabled: Bool,
        lowDataRateOptimize: Bool
    ) {
        guard (5...12).contains(spreadingFactor),
              bandwidthKHz.isFinite, bandwidthKHz > 0,
              (5...8).contains(codingRateDenominator),
              (0...255).contains(payloadBytes),
              (0...65535).contains(preambleSymbols) else { return nil }

        let sf = Double(spreadingFactor)
        let symbolDuration = pow(2, sf) / bandwidthKHz
        let shortSpreadingFactor = spreadingFactor <= 6
        let preamble = (Double(preambleSymbols) + (shortSpreadingFactor ? 6.25 : 4.25)) * symbolDuration
        let numerator = 8 * payloadBytes - 4 * spreadingFactor
            + (shortSpreadingFactor ? 0 : 8)
            + (explicitHeader ? 20 : 0) + (crcEnabled ? 16 : 0)
        let denominator = 4 * (spreadingFactor - (lowDataRateOptimize ? 2 : 0))
        let codedBlocks = (max(numerator, 0) + denominator - 1) / denominator
        // Semtech's CR is 1...4, so (CR + 4) is already our denominator.
        let payloadSymbols = 8 + codedBlocks * codingRateDenominator
        let payload = Double(payloadSymbols) * symbolDuration
        let total = preamble + payload
        let rate = sf * (4 / Double(codingRateDenominator)) * bandwidthKHz * 1000 / pow(2, sf)
        guard symbolDuration.isFinite, total.isFinite, total > 0, rate.isFinite else { return nil }

        symbolDurationMs = symbolDuration
        preambleTimeMs = preamble
        payloadSymbolCount = payloadSymbols
        payloadTimeMs = payload
        totalAirtimeMs = total
        bitRate = rate
    }

    public func packetsPerHour(dutyCycle: Double) -> Int? {
        guard dutyCycle.isFinite, (0...1).contains(dutyCycle) else { return nil }
        return Int(exactly: floor(3_600_000 * dutyCycle / totalAirtimeMs))
    }
}
