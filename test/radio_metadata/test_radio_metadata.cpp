#include "lilyshark/device/radio_service.h"

#include <cassert>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

void testSx126xCodingRateMapping()
{
    constexpr std::uint8_t expected[] = {0, 5, 6, 7, 8, 5, 6, 8};
    for (std::uint8_t code = 0; code < sizeof(expected); ++code) {
        assert(sx126xLoRaCodingRateDenominator(code) == expected[code]);
    }
    assert(sx126xLoRaCodingRateDenominator(8) == 0U);
    assert(sx126xLoRaCodingRateDenominator(0xff) == 0U);
}

void testExplicitHeaderMetadataWins()
{
    const LoRaRxMetadata metadata = resolveLoRaRxMetadata(true, 7, false, 5, true, false);
    assert(metadata.coding_rate_denominator == 8U);
    assert(metadata.crc == CrcStatus::NotPresent);

    const LoRaRxMetadata failed = resolveLoRaRxMetadata(true, 5, true, 8, false, true);
    assert(failed.coding_rate_denominator == 5U);
    assert(failed.crc == CrcStatus::Invalid);
}

void testCodingRateFieldPolicy()
{
    constexpr std::uint32_t base_fields = RfFieldRssi | RfFieldCodingRate;

    const LoRaRxMetadata reserved = resolveLoRaRxMetadata(true, 0, true, 5, true, false);
    assert(reserved.coding_rate_denominator == 0U);
    const std::uint32_t reserved_fields = resolveLoRaRxPresentFields(base_fields, reserved);
    assert((reserved_fields & RfFieldCodingRate) == 0U);
    assert((reserved_fields & RfFieldAirtime) == 0U);
    assert((reserved_fields & RfFieldRssi) != 0U);

    const LoRaRxMetadata out_of_range =
        resolveLoRaRxMetadata(true, 0xff, true, 5, true, false);
    assert(out_of_range.coding_rate_denominator == 0U);
    assert((resolveLoRaRxPresentFields(base_fields, out_of_range) & RfFieldCodingRate) == 0U);

    const LoRaRxMetadata valid = resolveLoRaRxMetadata(true, 1, true, 8, true, false);
    assert((resolveLoRaRxPresentFields(RfFieldRssi, valid) & RfFieldCodingRate) != 0U);
    assert((resolveLoRaRxPresentFields(RfFieldRssi, valid) & RfFieldAirtime) != 0U);
}

void testConfiguredFallbackMetadata()
{
    const LoRaRxMetadata with_crc = resolveLoRaRxMetadata(false, 7, false, 6, true, false);
    assert(with_crc.coding_rate_denominator == 6U);
    assert(with_crc.crc == CrcStatus::Valid);

    const LoRaRxMetadata without_crc = resolveLoRaRxMetadata(false, 1, true, 7, false, false);
    assert(without_crc.coding_rate_denominator == 7U);
    assert(without_crc.crc == CrcStatus::NotPresent);
}

void testInvalidExplicitHeaderDoesNotReuseConfiguredMetadata()
{
    const LoRaRxMetadata corrupt = unavailableExplicitLoRaRxMetadata(true);
    assert(corrupt.coding_rate_denominator == 0U);
    assert(corrupt.crc == CrcStatus::Invalid);
    assert((resolveLoRaRxPresentFields(RfFieldCodingRate | RfFieldAirtime,
                                      corrupt) &
            (RfFieldCodingRate | RfFieldAirtime)) == 0U);

    const LoRaRxMetadata unavailable = unavailableExplicitLoRaRxMetadata(false);
    assert(unavailable.coding_rate_denominator == 0U);
    assert(unavailable.crc == CrcStatus::Unknown);
}

} // namespace

int main()
{
    testSx126xCodingRateMapping();
    testExplicitHeaderMetadataWins();
    testCodingRateFieldPolicy();
    testConfiguredFallbackMetadata();
    testInvalidExplicitHeaderDoesNotReuseConfiguredMetadata();
    std::puts("radio metadata tests passed");
    return 0;
}
