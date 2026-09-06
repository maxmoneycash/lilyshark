import XCTest
@testable import MeshCoreKit

final class LoRaAirtimeEstimateTests: XCTestCase {
    func testCanonicalFirmwareVectorAcrossCodingRates() throws {
        // Canonical SF7/125 kHz, 13-byte, CRC-on, explicit-header fixture from
        // test/lora_airtime/test_lora_airtime.cpp. Five coded blocks cost 5...8
        // symbols each; using the rate's index instead underestimates airtime.
        let expected: [(rate: Int, symbols: Int, airtime: Double)] = [
            (5, 33, 46.336), (6, 38, 51.456),
            (7, 43, 56.576), (8, 48, 61.696),
        ]
        for fixture in expected {
            let result = try XCTUnwrap(estimate(codingRate: fixture.rate))
            XCTAssertEqual(result.payloadSymbolCount, fixture.symbols)
            XCTAssertEqual(result.totalAirtimeMs, fixture.airtime, accuracy: 0.000_001)
        }
        XCTAssertEqual(estimate()?.packetsPerHour(dutyCycle: 0.01), 776)
    }

    func testLowDataRateOptimizationAndHeaderFlags() throws {
        let optimized = try XCTUnwrap(estimate(spreadingFactor: 12, lowDataRateOptimize: true))
        XCTAssertEqual(optimized.payloadSymbolCount, 23)
        XCTAssertEqual(optimized.totalAirtimeMs, 1155.072, accuracy: 0.000_001)
        let implicit = try XCTUnwrap(estimate(explicitHeader: false, crcEnabled: false))
        XCTAssertEqual(implicit.payloadSymbolCount, 23)
        XCTAssertEqual(implicit.totalAirtimeMs, 36.096, accuracy: 0.000_001)
    }

    func testShortSpreadingFactorsMatchFirmwareConstants() throws {
        let sf5 = try XCTUnwrap(estimate(spreadingFactor: 5))
        XCTAssertEqual(sf5.payloadSymbolCount, 38)
        XCTAssertEqual(sf5.totalAirtimeMs, 13.376, accuracy: 0.000_001)
        let sf6 = try XCTUnwrap(estimate(spreadingFactor: 6))
        XCTAssertEqual(sf6.payloadSymbolCount, 33)
        XCTAssertEqual(sf6.totalAirtimeMs, 24.192, accuracy: 0.000_001)
    }

    func testInvalidInputsCannotProducePlausibleReadingsOrOverflow() {
        for bandwidth in [Double.nan, .infinity, -.infinity, 0, -1, .leastNonzeroMagnitude] {
            XCTAssertNil(estimate(bandwidthKHz: bandwidth))
        }
        XCTAssertNil(estimate(spreadingFactor: 4))
        XCTAssertNil(estimate(spreadingFactor: 13))
        XCTAssertNil(estimate(codingRate: 4))
        XCTAssertNil(estimate(codingRate: 9))
        XCTAssertNil(estimate(payloadBytes: Int.max))
        XCTAssertNil(estimate(payloadBytes: -1))
        XCTAssertNil(estimate(preambleSymbols: Int.max))
        XCTAssertNil(estimate(preambleSymbols: -1))
        XCTAssertNil(estimate()?.packetsPerHour(dutyCycle: .nan))
        XCTAssertNil(estimate()?.packetsPerHour(dutyCycle: 2))
    }

    private func estimate(
        spreadingFactor: Int = 7,
        bandwidthKHz: Double = 125,
        codingRate: Int = 5,
        payloadBytes: Int = 13,
        preambleSymbols: Int = 8,
        explicitHeader: Bool = true,
        crcEnabled: Bool = true,
        lowDataRateOptimize: Bool = false
    ) -> LoRaAirtimeEstimate? {
        LoRaAirtimeEstimate(
            spreadingFactor: spreadingFactor, bandwidthKHz: bandwidthKHz,
            codingRateDenominator: codingRate, payloadBytes: payloadBytes,
            preambleSymbols: preambleSymbols, explicitHeader: explicitHeader,
            crcEnabled: crcEnabled, lowDataRateOptimize: lowDataRateOptimize
        )
    }
}
