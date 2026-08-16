#include "lilyshark/core/app_settings.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {

using namespace lilyshark;

constexpr std::size_t kChecksumOffset = 12U;

bool sameSettings(const AppSettings &left, const AppSettings &right) noexcept
{
    return left.onboarding_version == right.onboarding_version &&
           left.onboarding_complete == right.onboarding_complete &&
           left.display_brightness == right.display_brightness &&
           left.keyboard_brightness == right.keyboard_brightness &&
           left.capture_enabled == right.capture_enabled &&
           left.gps_enabled == right.gps_enabled &&
           left.resume_last_view == right.resume_last_view &&
           left.last_primary_diagnostic_index ==
               right.last_primary_diagnostic_index &&
           left.spectrum_warning_acknowledged ==
               right.spectrum_warning_acknowledged &&
           left.simulate_mode == right.simulate_mode;
}

std::uint32_t referenceCrc32(const std::uint8_t *bytes, std::size_t size) noexcept
{
    std::uint32_t crc = 0xffffffffU;
    for(std::size_t index = 0; index < size; ++index) {
        crc ^= bytes[index];
        for(std::uint8_t bit = 0; bit < 8U; ++bit) {
            crc = (crc >> 1U) ^ ((crc & 1U) == 0U ? 0U : 0xedb88320U);
        }
    }
    return ~crc;
}

void refreshChecksum(std::array<std::uint8_t, kAppSettingsV1Size> &bytes) noexcept
{
    const std::uint32_t crc = referenceCrc32(bytes.data(), kChecksumOffset);
    bytes[12] = static_cast<std::uint8_t>(crc);
    bytes[13] = static_cast<std::uint8_t>(crc >> 8U);
    bytes[14] = static_cast<std::uint8_t>(crc >> 16U);
    bytes[15] = static_cast<std::uint8_t>(crc >> 24U);
}

AppSettings sentinelSettings() noexcept
{
    AppSettings settings{};
    settings.onboarding_version = kAppSettingsOnboardingVersion;
    settings.onboarding_complete = true;
    settings.display_brightness = 3U;
    settings.keyboard_brightness = 7U;
    settings.capture_enabled = false;
    settings.gps_enabled = false;
    settings.resume_last_view = true;
    settings.last_primary_diagnostic_index = 4U;
    settings.spectrum_warning_acknowledged = true;
    settings.simulate_mode = true;
    return settings;
}

void assertDecodeRejectedWithoutMutation(
    const std::uint8_t *bytes, std::size_t size) noexcept
{
    const AppSettings sentinel = sentinelSettings();
    AppSettings output = sentinel;
    assert(decodeAppSettings(bytes, size, output) ==
           AppSettingsDecodeResult::Invalid);
    assert(sameSettings(output, sentinel));
}

void testDefaultsHaveStableGoldenEncoding()
{
    const AppSettings settings = defaultAppSettings();
    assert(!settings.onboarding_complete);
    assert(settings.onboarding_version == 0U);
    assert(settings.display_brightness == 16U);
    assert(settings.keyboard_brightness == 96U);
    assert(settings.capture_enabled);
    assert(settings.gps_enabled);
    assert(!settings.resume_last_view);
    assert(settings.last_primary_diagnostic_index == 0U);
    assert(!settings.spectrum_warning_acknowledged);
    assert(!settings.simulate_mode);
    assert(isValidAppSettings(settings));

    constexpr std::array<std::uint8_t, kAppSettingsV1Size> expected = {{
        0x4c, 0x53, 0x41, 0x53, 0x01, 0x06, 0x00, 0x10,
        0x60, 0x00, 0x00, 0x00, 0x33, 0xc3, 0xfb, 0x61,
    }};
    std::array<std::uint8_t, kAppSettingsV1Size> encoded{};
    assert(encodeAppSettingsV1(settings, encoded.data(), encoded.size()));
    assert(encoded == expected);

    AppSettings decoded = sentinelSettings();
    assert(decodeAppSettings(encoded.data(), encoded.size(), decoded) ==
           AppSettingsDecodeResult::LoadedV1);
    assert(sameSettings(decoded, settings));
}

void testBoundariesRoundTripWithStableEncoding()
{
    AppSettings settings{};
    settings.onboarding_version = kAppSettingsOnboardingVersion;
    settings.onboarding_complete = true;
    settings.display_brightness = kAppSettingsMaximumDisplayBrightness;
    settings.keyboard_brightness = 255U;
    settings.capture_enabled = true;
    settings.gps_enabled = true;
    settings.resume_last_view = true;
    settings.last_primary_diagnostic_index =
        kAppSettingsMaximumPrimaryDiagnosticIndex;
    settings.spectrum_warning_acknowledged = true;
    settings.simulate_mode = true;

    constexpr std::array<std::uint8_t, kAppSettingsV1Size> expected = {{
        0x4c, 0x53, 0x41, 0x53, 0x01, 0x3f, 0x01, 0x10,
        0xff, 0x08, 0x00, 0x00, 0x5d, 0x50, 0x6c, 0x7c,
    }};
    std::array<std::uint8_t, kAppSettingsV1Size> encoded{};
    assert(encodeAppSettingsV1(settings, encoded.data(), encoded.size()));
    assert(encoded == expected);

    AppSettings decoded{};
    assert(decodeAppSettings(encoded.data(), encoded.size(), decoded) ==
           AppSettingsDecodeResult::LoadedV1);
    assert(sameSettings(decoded, settings));

    settings.display_brightness = 0U;
    settings.keyboard_brightness = 0U;
    settings.last_primary_diagnostic_index = 0U;
    assert(encodeAppSettingsV1(settings, encoded.data(), encoded.size()));
    assert(decodeAppSettings(encoded.data(), encoded.size(), decoded) ==
           AppSettingsDecodeResult::LoadedV1);
    assert(sameSettings(decoded, settings));
}

void testEveryUncheckedCorruptionIsRejected()
{
    std::array<std::uint8_t, kAppSettingsV1Size> encoded{};
    assert(encodeAppSettingsV1(defaultAppSettings(), encoded.data(), encoded.size()));
    for(std::size_t index = 0; index < encoded.size(); ++index) {
        auto corrupt = encoded;
        corrupt[index] ^= 0x01U;
        assertDecodeRejectedWithoutMutation(corrupt.data(), corrupt.size());
    }
    assertDecodeRejectedWithoutMutation(nullptr, encoded.size());
    assertDecodeRejectedWithoutMutation(encoded.data(), encoded.size() - 1U);
    assertDecodeRejectedWithoutMutation(encoded.data(), encoded.size() + 1U);
}

void testWellChecksummedUnknownFieldsAreRejected()
{
    std::array<std::uint8_t, kAppSettingsV1Size> encoded{};
    assert(encodeAppSettingsV1(defaultAppSettings(), encoded.data(), encoded.size()));

    auto invalid = encoded;
    invalid[4] = 2U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());

    invalid = encoded;
    invalid[5] |= 0x80U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());

    invalid = encoded;
    invalid[10] = 1U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());

    invalid = encoded;
    invalid[11] = 1U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());
}

void testWellChecksummedInvalidValuesAreRejected()
{
    std::array<std::uint8_t, kAppSettingsV1Size> encoded{};
    assert(encodeAppSettingsV1(defaultAppSettings(), encoded.data(), encoded.size()));

    auto invalid = encoded;
    invalid[7] = kAppSettingsMaximumDisplayBrightness + 1U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());

    invalid = encoded;
    invalid[9] = kAppSettingsMaximumPrimaryDiagnosticIndex + 1U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());

    invalid = encoded;
    invalid[6] = kAppSettingsOnboardingVersion;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());

    invalid = encoded;
    invalid[5] |= 0x01U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());

    invalid = encoded;
    invalid[5] |= 0x01U;
    invalid[6] = kAppSettingsOnboardingVersion + 1U;
    refreshChecksum(invalid);
    assertDecodeRejectedWithoutMutation(invalid.data(), invalid.size());
}

void testInvalidSettingsDoNotModifyEncodeDestination()
{
    AppSettings invalid = defaultAppSettings();
    invalid.display_brightness = kAppSettingsMaximumDisplayBrightness + 1U;
    std::array<std::uint8_t, kAppSettingsV1Size> output{};
    output.fill(0xa5U);
    const auto untouched = output;
    assert(!encodeAppSettingsV1(invalid, output.data(), output.size()));
    assert(output == untouched);
    assert(!encodeAppSettingsV1(defaultAppSettings(), output.data(), output.size() - 1U));
    assert(output == untouched);
    assert(!encodeAppSettingsV1(defaultAppSettings(), nullptr, output.size()));
}

void testSettingsValidationRejectsInconsistentOnboardingState()
{
    AppSettings settings = defaultAppSettings();
    settings.onboarding_version = kAppSettingsOnboardingVersion;
    assert(!isValidAppSettings(settings));
    settings.onboarding_complete = true;
    assert(isValidAppSettings(settings));
    settings.onboarding_version = 0U;
    assert(!isValidAppSettings(settings));
    settings.onboarding_version = kAppSettingsOnboardingVersion + 1U;
    assert(!isValidAppSettings(settings));
}

} // namespace

int main()
{
    testDefaultsHaveStableGoldenEncoding();
    testBoundariesRoundTripWithStableEncoding();
    testEveryUncheckedCorruptionIsRejected();
    testWellChecksummedUnknownFieldsAreRejected();
    testWellChecksummedInvalidValuesAreRejected();
    testInvalidSettingsDoNotModifyEncodeDestination();
    testSettingsValidationRejectsInconsistentOnboardingState();
    std::puts("app settings tests passed");
    return 0;
}
