#include "lilyshark/core/app_settings.h"

#include "lilyshark/core/settings_checksum.h"

#include <algorithm>
#include <iterator>

namespace lilyshark {
namespace {

constexpr std::uint8_t kMagic[] = {'L', 'S', 'A', 'S'};
constexpr std::size_t kChecksumOffset = 12U;
constexpr std::uint8_t kOnboardingCompleteFlag = 1U << 0U;
constexpr std::uint8_t kCaptureEnabledFlag = 1U << 1U;
constexpr std::uint8_t kGpsEnabledFlag = 1U << 2U;
constexpr std::uint8_t kResumeLastViewFlag = 1U << 3U;
constexpr std::uint8_t kSpectrumWarningAcknowledgedFlag = 1U << 4U;
constexpr std::uint8_t kSimulateModeFlag = 1U << 5U;
constexpr std::uint8_t kKnownFlags = kOnboardingCompleteFlag |
                                      kCaptureEnabledFlag |
                                      kGpsEnabledFlag |
                                      kResumeLastViewFlag |
                                      kSpectrumWarningAcknowledgedFlag |
                                      kSimulateModeFlag;

std::uint32_t getU32(const std::uint8_t *bytes) noexcept
{
    return static_cast<std::uint32_t>(bytes[0]) |
           (static_cast<std::uint32_t>(bytes[1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[2]) << 16U) |
           (static_cast<std::uint32_t>(bytes[3]) << 24U);
}

void putU32(std::uint8_t *bytes, std::uint32_t value) noexcept
{
    bytes[0] = static_cast<std::uint8_t>(value);
    bytes[1] = static_cast<std::uint8_t>(value >> 8U);
    bytes[2] = static_cast<std::uint8_t>(value >> 16U);
    bytes[3] = static_cast<std::uint8_t>(value >> 24U);
}

bool hasMagic(const std::uint8_t *bytes) noexcept
{
    return std::equal(std::begin(kMagic), std::end(kMagic), bytes);
}

std::uint8_t encodeFlags(const AppSettings &settings) noexcept
{
    return static_cast<std::uint8_t>(
        (settings.onboarding_complete ? kOnboardingCompleteFlag : 0U) |
        (settings.capture_enabled ? kCaptureEnabledFlag : 0U) |
        (settings.gps_enabled ? kGpsEnabledFlag : 0U) |
        (settings.resume_last_view ? kResumeLastViewFlag : 0U) |
        (settings.spectrum_warning_acknowledged
             ? kSpectrumWarningAcknowledgedFlag
             : 0U) |
        (settings.simulate_mode ? kSimulateModeFlag : 0U));
}

} // namespace

AppSettings defaultAppSettings() noexcept
{
    return AppSettings{};
}

bool isValidAppSettings(const AppSettings &settings) noexcept
{
    const bool onboarding_state_valid = settings.onboarding_complete
        ? settings.onboarding_version == kAppSettingsOnboardingVersion
        : settings.onboarding_version == 0U;
    return onboarding_state_valid &&
           settings.display_brightness <= kAppSettingsMaximumDisplayBrightness &&
           settings.last_primary_diagnostic_index <=
               kAppSettingsMaximumPrimaryDiagnosticIndex;
}

bool encodeAppSettingsV1(const AppSettings &settings, std::uint8_t *bytes,
                         std::size_t size) noexcept
{
    if(bytes == nullptr || size != kAppSettingsV1Size ||
       !isValidAppSettings(settings)) {
        return false;
    }

    std::uint8_t encoded[kAppSettingsV1Size]{};
    std::copy(std::begin(kMagic), std::end(kMagic), encoded);
    encoded[4] = kAppSettingsSchemaVersion;
    encoded[5] = encodeFlags(settings);
    encoded[6] = settings.onboarding_version;
    encoded[7] = settings.display_brightness;
    encoded[8] = settings.keyboard_brightness;
    encoded[9] = settings.last_primary_diagnostic_index;
    putU32(&encoded[kChecksumOffset], settingsCrc32(encoded, kChecksumOffset));
    std::copy(std::begin(encoded), std::end(encoded), bytes);
    return true;
}

AppSettingsDecodeResult decodeAppSettings(const std::uint8_t *bytes,
                                          std::size_t size,
                                          AppSettings &settings) noexcept
{
    if(bytes == nullptr || size != kAppSettingsV1Size || !hasMagic(bytes) ||
       bytes[4] != kAppSettingsSchemaVersion ||
       (bytes[5] & static_cast<std::uint8_t>(~kKnownFlags)) != 0U ||
       bytes[10] != 0U || bytes[11] != 0U ||
       getU32(&bytes[kChecksumOffset]) != settingsCrc32(bytes, kChecksumOffset)) {
        return AppSettingsDecodeResult::Invalid;
    }

    AppSettings candidate{};
    candidate.onboarding_complete = (bytes[5] & kOnboardingCompleteFlag) != 0U;
    candidate.capture_enabled = (bytes[5] & kCaptureEnabledFlag) != 0U;
    candidate.gps_enabled = (bytes[5] & kGpsEnabledFlag) != 0U;
    candidate.resume_last_view = (bytes[5] & kResumeLastViewFlag) != 0U;
    candidate.spectrum_warning_acknowledged =
        (bytes[5] & kSpectrumWarningAcknowledgedFlag) != 0U;
    candidate.simulate_mode = (bytes[5] & kSimulateModeFlag) != 0U;
    candidate.onboarding_version = bytes[6];
    candidate.display_brightness = bytes[7];
    candidate.keyboard_brightness = bytes[8];
    candidate.last_primary_diagnostic_index = bytes[9];
    if(!isValidAppSettings(candidate)) {
        return AppSettingsDecodeResult::Invalid;
    }

    settings = candidate;
    return AppSettingsDecodeResult::LoadedV1;
}

} // namespace lilyshark
