#include "lilyshark/device/simulate_source.h"

#include <cstring>

#include "lilyshark/shelby/shelby_pointer.h"

namespace lilyshark {
namespace device {
namespace {

/// Deterministic pseudo-random bytes. xorshift keyed on the sequence number,
/// so a given frame is byte-identical on every run and on every device.
std::uint32_t mix(std::uint32_t value) noexcept
{
    value ^= value << 13;
    value ^= value >> 17;
    value ^= value << 5;
    return value;
}

void fillPayload(std::uint8_t *out, std::size_t length, std::uint32_t seed) noexcept
{
    std::uint32_t state = seed * 2654435761U + 1U;
    for (std::size_t index = 0; index < length; ++index) {
        state = mix(state);
        out[index] = static_cast<std::uint8_t>(state & 0xffU);
    }
}

/// The synthetic mesh references one blob. Keeping the coordinates fixed means
/// a decoded pointer on the device matches the one the web analyzer resolves,
/// so both halves of the project tell the same story.
constexpr std::uint8_t kDemoOwner[ShelbyPointer::kOwnerSize] = {
    0x34, 0x94, 0x6d, 0x19, 0xfb, 0x18, 0x11, 0x50,
    0x46, 0xc8, 0x07, 0xb8, 0xf4, 0x88, 0x45, 0xa5,
    0x15, 0xef, 0xe1, 0x07, 0x89, 0x2b, 0xb9, 0xcc,
    0x49, 0xc6, 0xf1, 0x97, 0xa6, 0x99, 0x87, 0x28,
};
constexpr std::uint8_t kDemoCommitment[ShelbyPointer::kCommitmentSize] = {
    0x6a, 0xb9, 0x56, 0x65, 0x63, 0xba, 0x70, 0xa7,
    0x39, 0x65, 0xf8, 0x9a, 0x46, 0xed, 0xf3, 0xd4,
    0x99, 0x78, 0xc5, 0x09, 0x1b, 0x8d, 0xa8, 0x78,
    0x6e, 0x8c, 0xb5, 0x8a, 0x44, 0x9a, 0x32, 0xc9,
};
constexpr std::uint32_t kDemoBlobBytes = 4495U;
constexpr std::uint32_t kDemoExpiryUnix = 1794606691U;

/// Header bytes an enclosing protocol would put in front of the pointer, so
/// the decoder has to find it at an offset rather than at byte zero.
constexpr std::size_t kEnclosingHeaderBytes = 16;

}  // namespace

RawFrame SimulateSource::next(std::uint32_t now_ms,
                              std::uint32_t center_frequency_hz,
                              std::uint32_t bandwidth_hz,
                              std::uint8_t spreading_factor,
                              std::uint8_t coding_rate_denominator,
                              std::uint16_t profile_id) noexcept
{
    const std::uint32_t sequence = emitted_++;
    last_emit_ms_ = now_ms;

    RawFrame frame{};

    // Signal quality wanders across a believable band instead of sitting on
    // one value, so the roster sparklines and SNR plots have something to draw.
    const std::uint32_t noise = mix(sequence * 2654435761U + 7U);
    const std::int16_t rssi_x10 =
        static_cast<std::int16_t>(-880 - static_cast<std::int16_t>(noise % 280U));
    const std::int16_t snr_x10 =
        static_cast<std::int16_t>(((rssi_x10 + 920) * 55) / 100 +
                                  static_cast<std::int16_t>((noise >> 8) % 21U) - 10);

    std::size_t length = 0;
    if (carriesPointer(sequence)) {
        // A pointer riding behind an enclosing protocol header, matching the
        // placement used by an on-air payload.
        std::uint8_t header[kEnclosingHeaderBytes]{};
        fillPayload(header, sizeof(header), sequence * 7U + 3U);

        ShelbyPointer pointer{};
        pointer.version = ShelbyPointer::kVersion;
        pointer.flags = ShelbyPointer::kFlagCapture;
        std::memcpy(pointer.commitment, kDemoCommitment, sizeof(kDemoCommitment));
        std::memcpy(pointer.owner, kDemoOwner, sizeof(kDemoOwner));
        pointer.size_bytes = kDemoBlobBytes;
        pointer.expires_at_unix = kDemoExpiryUnix;
        pointer.chunk_index = 0;
        pointer.chunk_count = 1;

        std::uint8_t encoded[ShelbyPointer::kEncodedSize]{};
        if (encodeShelbyPointer(pointer, encoded, sizeof(encoded)) == ShelbyPointerResult::Ok) {
            std::uint8_t payload[kEnclosingHeaderBytes + ShelbyPointer::kEncodedSize]{};
            std::memcpy(payload, header, sizeof(header));
            std::memcpy(payload + sizeof(header), encoded, sizeof(encoded));
            length = sizeof(payload);
            (void)frame.assignPayload(payload, length);
        }
    }

    if (length == 0) {
        length = 24U + (mix(sequence * 40503U + 11U) % 150U);
        std::uint8_t payload[kMaxFrameBytes]{};
        fillPayload(payload, length, sequence * 7U + 3U);
        (void)frame.assignPayload(payload, length);
    }

    RfMetadata &rf = frame.rf;
    rf.origin = FrameOrigin::Synthetic;
    rf.timestamp_us = static_cast<std::uint64_t>(now_ms) * 1000ULL;
    rf.center_frequency_hz = center_frequency_hz;
    rf.bandwidth_hz = bandwidth_hz;
    rf.spreading_factor = spreading_factor;
    rf.coding_rate_denominator = coding_rate_denominator;
    rf.profile_id = profile_id;
    rf.rssi_dbm_x10 = rssi_x10;
    rf.snr_db_x10 = snr_x10;
    // Airtime from the payload at the measured LongFast rate (~987 bit/s), so
    // the airtime and duty readouts stay consistent with the frame sizes.
    rf.airtime_us = static_cast<std::uint32_t>((static_cast<std::uint64_t>(length) * 8ULL * 1000000ULL) / 987ULL);
    rf.frequency_error_hz = static_cast<std::int32_t>(mix(sequence + 19U) % 4200U) - 2100;
    rf.preamble_symbols = 16;
    rf.sync_word = 0x2b;
    rf.modulation = Modulation::LoRa;
    rf.direction = FrameDirection::Receive;
    // One CRC failure now and then: the integrity column should not be a
    // column of identical values, and the failure path needs exercising.
    rf.crc = (sequence % 13U == 7U) ? CrcStatus::Invalid : CrcStatus::Valid;
    rf.present_fields = RfFieldTimestamp | RfFieldFrequency | RfFieldBandwidth |
                        RfFieldAirtime | RfFieldFrequencyError | RfFieldRssi |
                        RfFieldSnr | RfFieldPreamble | RfFieldSyncWord |
                        RfFieldProfile | RfFieldSpreadingFactor | RfFieldCodingRate;

    return frame;
}

}  // namespace device
}  // namespace lilyshark
