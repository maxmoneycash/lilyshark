// What this deck's own transmissions cost, computed from the frames the real
// encoders actually produce.
//
// This file exists because a comment went stale and nothing noticed. The
// beacon constants in src/sim_main.cpp were justified by "at SF9/250 kHz a
// position is 144 ms and a NodeInfo 185 ms". The position figure was never
// right for this firmware's preamble, and the NodeInfo figure described a
// frame the firmware had stopped sending: writeUserPayload started publishing
// the 32-byte Curve25519 public key, which grew NodeInfo from 61 bytes to 95
// and its airtime by 53%. The comment kept quoting the old number for months
// because the number lived only in prose.
//
// So the numbers now live here, derived rather than asserted: every airtime
// below comes from running the real encoder and feeding its byte count to the
// same loraTimeOnAirUs() the firmware uses. Change what a beacon carries and
// this test fails with the new cost, which is the only mechanism that keeps a
// documented duty cycle honest.
//
// Nothing here is a measurement. These are computed times on air, and the
// report says so; the only external anchor is the canonical SF7 vector below.

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "lilyshark/core/lora_airtime.h"
#include "lilyshark/core/builtin_profiles.h"
#include "lilyshark/core/radio_profile.h"
#include "lilyshark/protocols/meshcore_encode.h"
#include "lilyshark/protocols/meshtastic_encode.h"
#include "lilyshark/protocols/meshtastic_pkc.h"
#include "lilyshark/crypto/ed25519.h"

using namespace lilyshark;

namespace {

// The profile this deck actually runs: MESHTASTIC BAY MF, the Bay Area
// community's Medium Range Fast slot. Named here rather than repeated as
// literals because two of the assertions below are about THIS configuration
// specifically -- SF9 at 250 kHz is comfortably above the low-data-rate
// threshold, and the channel name derived from the pair is what the deck
// puts on the air.
constexpr std::uint8_t kBaySpreadingFactor = 9;
constexpr std::uint32_t kBayBandwidthHz = 250000;




int failures = 0;

void expectEqual(const char *what, std::uint64_t actual, std::uint64_t expected)
{
    if (actual != expected) {
        std::printf("FAIL %s: got %llu, expected %llu\n", what,
                    static_cast<unsigned long long>(actual),
                    static_cast<unsigned long long>(expected));
        ++failures;
    }
}

void expectTrue(const char *what, bool condition)
{
    if (!condition) {
        std::printf("FAIL %s\n", what);
        ++failures;
    }
}

/// The real profile, by the name that appears on the deck's screen. Taken from
/// builtinProfiles() rather than restated here on purpose: the airtimes below
/// are only meaningful if they price the settings the radio is actually
/// configured with, and every previous hand-calculation of these frames went
/// wrong by assuming a parameter instead of reading one.
const RadioProfile &profileNamed(const char *name)
{
    const RadioProfile *profiles = builtinProfiles();
    for (std::size_t index = 0; index < builtinProfileCount(); ++index) {
        if (std::strcmp(profiles[index].name, name) == 0) {
            return profiles[index];
        }
    }
    std::printf("FAIL no builtin profile named %s\n", name);
    ++failures;
    return profiles[0];
}

/// Airtime for a frame sent under `profile`, using the profile's own coding
/// rate, preamble, header mode and CRC setting -- the same inputs
/// TDeckRadioService::airtimeUsFor() feeds the firmware.
std::uint32_t airtimeUnder(const RadioProfile &profile, std::size_t payload_bytes)
{
    return loraTimeOnAirUs(profile.spreading_factor, profile.bandwidth_hz,
                           profile.coding_rate_denominator, profile.preamble_symbols,
                           profile.implicit_header, profile.crc_enabled, payload_bytes);
}

/// Airtime for a frame of `bytes` as this deck would actually transmit it.
///
/// The remaining arguments are what encodeMeshtasticFrame produces on the Bay
/// profile: the SX1262 default 16-symbol preamble, an explicit header, and CRC
/// on. Wrapped so the assertions below read as "this many bytes takes this
/// long" rather than repeating six arguments that never vary.
std::uint32_t bayAirtimeUs(std::size_t bytes)
{
    return airtimeUnder(profileNamed("MESHTASTIC BAY MF"), bytes);
}

/// The same, for MESHCORE US.
///
/// Reads the profile rather than repeating its numbers, which matters here
/// more than it looks: MESHCORE US carries a 32-symbol preamble, not the
/// 16 the Meshtastic profiles use, and a hand-written helper that assumed 16
/// prices every advert below what it actually costs. That assumption is
/// exactly the one docs/meshcore-participation-plan.md made -- it worked the
/// advert at 8 symbols -- which is why the tuning is pinned in
/// testProfileTuningIsWhatTheAirtimesAssume before anything is priced under it.
std::uint32_t meshCoreAirtimeUs(std::size_t bytes)
{
    return airtimeUnder(profileNamed("MESHCORE US"), bytes);
}

/// The tuning each profile is expected to carry, checked before anything is
/// priced under it. MESHCORE US's 32-symbol preamble is the specific value
/// docs/meshcore-participation-plan.md assumed away -- it worked the advert at
/// 8 symbols and "corrected" a closer estimate to a worse one -- so it is
/// pinned here where the airtime that depends on it is computed.
void testProfileTuningIsWhatTheAirtimesAssume()
{
    const RadioProfile &bay = profileNamed("MESHTASTIC BAY MF");
    expectEqual("Bay MF spreading factor", bay.spreading_factor, 9U);
    expectEqual("Bay MF bandwidth", bay.bandwidth_hz, 250000U);
    expectEqual("Bay MF coding rate denominator", bay.coding_rate_denominator, 5U);
    expectEqual("Bay MF preamble symbols", bay.preamble_symbols, 16U);
    expectTrue("Bay MF uses an explicit header", !bay.implicit_header);
    expectTrue("Bay MF has CRC on", bay.crc_enabled);

    const RadioProfile &meshcore = profileNamed("MESHCORE US");
    expectEqual("MeshCore US spreading factor", meshcore.spreading_factor, 7U);
    expectEqual("MeshCore US bandwidth", meshcore.bandwidth_hz, 62500U);
    expectEqual("MeshCore US coding rate denominator", meshcore.coding_rate_denominator, 5U);
    expectEqual("MeshCore US preamble symbols", meshcore.preamble_symbols, 32U);
}

/// The one figure here with an origin outside this repository. SF7, 125 kHz,
/// CR 4/5, 8-symbol preamble, explicit header, CRC on, 13-byte payload is the
/// worked example in Semtech AN1200.13 and every LoRa airtime calculator built
/// from it, and they all give 46.336 ms. If this drifts, the transcription of
/// RadioLib's arithmetic is wrong and every other number in this file is too.
void testCanonicalVector()
{
    expectEqual("canonical SF7/125k/13-byte airtime (us)",
                loraTimeOnAirUs(7, 125000, 5, 8, false, true, 13), 46336U);
}

/// Low-data-rate optimization changes the divisor and therefore the airtime,
/// and it is switched on by symbol length rather than by anything in the
/// profile. Pinned at the boundary so a refactor cannot quietly move it.
void testLowDataRateThreshold()
{
    // SF11 at 125 kHz: 2048/125000 s = 16.384 ms, over the threshold.
    expectTrue("SF11/125k is low-data-rate optimized", loraLowDataRateOptimized(11, 125000));
    // SF10 at 125 kHz: 8.192 ms, under it.
    expectTrue("SF10/125k is not optimized", !loraLowDataRateOptimized(10, 125000));
    // Nothing this deck transmits on is optimized: Bay MF is 2.048 ms/symbol.
    expectTrue("Bay MF is not optimized",
               !loraLowDataRateOptimized(kBaySpreadingFactor, kBayBandwidthHz));
}

/// Absent is not zero. A profile that cannot support the calculation must
/// produce "no airtime" so the caller leaves RfFieldAirtime clear, never an
/// airtime of zero for a frame that occupied the channel.
void testRefusesImpossibleInputs()
{
    expectEqual("no bandwidth yields no airtime", loraTimeOnAirUs(9, 0, 5, 16, false, true, 30),
                0U);
    expectEqual("no coding rate yields no airtime",
                loraTimeOnAirUs(9, 250000, 0, 16, false, true, 30), 0U);
    expectEqual("spreading factor below SX1262 range yields no airtime",
                loraTimeOnAirUs(4, 250000, 5, 16, false, true, 30), 0U);
    expectEqual("spreading factor above SX1262 range yields no airtime",
                loraTimeOnAirUs(13, 250000, 5, 16, false, true, 30), 0U);
}

/// Build the two beacons the deck emits on a Meshtastic profile, byte for byte
/// as sim_main.cpp's transmit_meshtastic() builds them, and report what they
/// cost. The names are what formatLocalMeshtasticLongName() produces, the
/// channel name is what meshtasticDefaultChannelName() picks for SF9/250 kHz,
/// and the identity is present because setup() makes pkc_identity_ready true
/// on every boot -- which is precisely the detail the old comment missed.
void testMeshtasticBeaconAirtime()
{
    std::uint8_t entropy[kMeshtasticPkcKeySize];
    for (std::size_t index = 0; index < sizeof(entropy); ++index) {
        entropy[index] = static_cast<std::uint8_t>(index + 1);
    }
    MeshtasticPkcKeypair identity{};
    expectTrue("test identity generated", meshtasticPkcGenerateKeypair(entropy, identity));

    const char *channel = meshtasticDefaultChannelName(kBaySpreadingFactor, kBayBandwidthHz);
    expectTrue("Bay MF hashes as MediumFast", std::strcmp(channel, "MediumFast") == 0);

    MeshtasticEncodeRequest position{};
    position.from_node = 0x4c534b01U;
    position.packet_id = 1234U;
    position.port = MeshtasticPort::Position;
    position.channel_name = channel;
    position.long_name = "Lilyshark-4B01";
    position.short_name = "4B01";
    position.latitude_degrees = 37.911;
    position.longitude_degrees = -122.018;
    position.identity = &identity;

    std::uint8_t frame[256]{};
    const std::size_t position_bytes = encodeMeshtasticFrame(position, frame, sizeof(frame));
    expectEqual("position beacon length", position_bytes, 30U);
    const std::uint32_t position_us = bayAirtimeUs(position_bytes);
    expectEqual("position beacon airtime (us)", position_us, 129536U);

    MeshtasticEncodeRequest node_info = position;
    node_info.port = MeshtasticPort::NodeInfo;
    node_info.packet_id = 1235U;
    const std::size_t node_info_bytes = encodeMeshtasticFrame(node_info, frame, sizeof(frame));
    expectEqual("NodeInfo beacon length with published public key", node_info_bytes, 95U);
    const std::uint32_t node_info_us = bayAirtimeUs(node_info_bytes);
    expectEqual("NodeInfo beacon airtime (us)", node_info_us, 283136U);

    // The frame the old comment was describing: a NodeInfo from before the
    // public key was published. Kept so the 53% growth is visible as a number
    // rather than as an assertion in prose.
    MeshtasticEncodeRequest legacy = node_info;
    legacy.identity = nullptr;
    const std::size_t legacy_bytes = encodeMeshtasticFrame(legacy, frame, sizeof(frame));
    expectEqual("NodeInfo length without a public key", legacy_bytes, 61U);
    expectEqual("NodeInfo airtime without a public key (us)", bayAirtimeUs(legacy_bytes), 201216U);

    // Steady state on Bay MF. kPositionBeaconMs is 900000 and
    // kNodeInfoBeaconMs is 10800000, so the two schedules only line up over
    // three hours: twelve positions and one NodeInfo. Measured over that
    // window the arithmetic is exact, where a per-hour figure would need a
    // third of a NodeInfo and start rounding. Duty is in parts-per-million
    // because it is far below 1% and integer percent would call it zero.
    const std::uint64_t window_us = 3ULL * 3600ULL * 1000000ULL;
    const std::uint64_t window_airtime_us = 12ULL * position_us + node_info_us;
    expectEqual("beacon airtime per three hours (us)", window_airtime_us, 1837568U);
    const std::uint64_t duty_ppm = (window_airtime_us * 1000000ULL) / window_us;
    expectEqual("beacon duty cycle (ppm)", duty_ppm, 170U);

    std::printf("  position   %zu bytes  %.2f ms\n", position_bytes, position_us / 1000.0);
    std::printf("  nodeinfo   %zu bytes  %.2f ms\n", node_info_bytes, node_info_us / 1000.0);
    std::printf("  steady state %.4f%% duty (computed, not measured)\n",
                (window_airtime_us * 100.0) / static_cast<double>(window_us));
}

/// The airtime the old constants spent, so the regression this file guards is
/// stated as a number rather than as a memory. kPositionBeaconMs was 60000 and
/// kNodeInfoBeaconMs 90000: 60 positions and 40 NodeInfos an hour, which is
/// the 42-transmissions-in-24-minutes that was actually observed on the
/// community channel.
void testOldConstantsWereOverBudget()
{
    const std::uint32_t position_us = bayAirtimeUs(30);
    const std::uint32_t node_info_us = bayAirtimeUs(95);
    // Priced over the same three-hour window as the current spacing, so the
    // two are directly comparable: 180 positions and 120 NodeInfos against 12
    // and 1.
    const std::uint64_t window_us = 3ULL * 3600ULL * 1000000ULL;
    const std::uint64_t old_airtime_us = 180ULL * position_us + 120ULL * node_info_us;
    const std::uint64_t old_duty_ppm = (old_airtime_us * 1000000ULL) / window_us;
    const std::uint64_t new_airtime_us = 12ULL * position_us + node_info_us;

    expectEqual("old spacing airtime per three hours (us)", old_airtime_us, 57292800U);
    expectEqual("old spacing duty cycle (ppm)", old_duty_ppm, 5304U);
    // 100 transmissions an hour against 4.33. The observed 42 in 24 minutes
    // that prompted the fix is the same rate: 100/hr is 40 per 24 minutes.
    expectTrue("the old spacing cost more than thirty times the new one",
               old_airtime_us > new_airtime_us * 30ULL);

    std::printf("  old spacing  %.4f%% duty, 100 tx/hr (this is the bug that shipped)\n",
                (old_airtime_us * 100.0) / static_cast<double>(window_us));
}

/// The MeshCore advert, built the way transmit_meshcore_advert() builds it:
/// node type CHAT, the deck's own long name, and a position only when the GPS
/// has a usable fix. Both cases are priced, because the fix adds eight bytes
/// and the plan document quoted a length for neither.
void testMeshCoreAdvertAirtime()
{
    std::uint8_t seed[32];
    for (std::size_t index = 0; index < sizeof(seed); ++index) {
        seed[index] = static_cast<std::uint8_t>(0x40U + index);
    }
    std::uint8_t public_key[32]{};
    std::uint8_t private_key[64]{};
    crypto::ed25519CreateKeypair(public_key, private_key, seed);

    MeshCoreAdvertAppData app_data{};
    app_data.node_type = MeshCoreNodeType::Chat;
    app_data.name = "Lilyshark-4B01";

    std::uint8_t frame[kMeshCoreMaxFrameBytes]{};
    const std::size_t no_fix_bytes =
        encodeMeshCoreAdvert(app_data, 1788220800U, MeshCoreAdvertReach::ZeroHop, public_key,
                             private_key, frame, sizeof(frame));
    expectEqual("advert length without a fix", no_fix_bytes, 117U);
    expectEqual("advert airtime without a fix (us)", meshCoreAirtimeUs(no_fix_bytes), 438784U);

    app_data.has_location = true;
    app_data.latitude_micros = meshCoreDegreesToMicros(37.911);
    app_data.longitude_micros = meshCoreDegreesToMicros(-122.018);
    const std::size_t fix_bytes =
        encodeMeshCoreAdvert(app_data, 1788220801U, MeshCoreAdvertReach::ZeroHop, public_key,
                             private_key, frame, sizeof(frame));
    expectEqual("advert length with a fix", fix_bytes, 125U);
    const std::uint32_t advert_us = meshCoreAirtimeUs(fix_bytes);
    expectEqual("advert airtime with a fix (us)", advert_us, 469504U);

    // One advert per kMeshCoreAdvertMs = 900 s.
    const std::uint64_t duty_ppm = (static_cast<std::uint64_t>(advert_us) * 1000000ULL) /
                                   900000000ULL;
    expectEqual("advert duty cycle (ppm)", duty_ppm, 521U);

    // The claim this replaces, in both sim_main.cpp and the plan document, was
    // that the advert is "fifteen times more sparing than the position beacon".
    // Both intervals are 900 s now, and an advert is the more expensive frame
    // of the two, so the comparison was backwards as well as stale.
    expectTrue("an advert costs more airtime than a position beacon",
               advert_us > bayAirtimeUs(30));

    std::printf("  advert     %zu bytes  %.2f ms  (%.3f%% duty, computed)\n", fix_bytes,
                advert_us / 1000.0, (advert_us * 100.0) / 900000000.0);
}

} // namespace

int main()
{
    testProfileTuningIsWhatTheAirtimesAssume();
    testCanonicalVector();
    testLowDataRateThreshold();
    testRefusesImpossibleInputs();
    testMeshtasticBeaconAirtime();
    testOldConstantsWereOverBudget();
    testMeshCoreAdvertAirtime();

    if (failures != 0) {
        std::printf("lora_airtime: %d failure(s)\n", failures);
        return 1;
    }
    std::printf("lora_airtime: all checks passed\n");
    return 0;
}
