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

/// Meshtastic's outer header: to[0..3], from[4..7], id[8..11], flags[12],
/// channel hash[13], next hop[14], relay[15]. Synthetic frames carry a real
/// one so the decoder, the roster and the packet inspector see the same
/// structure they see off the air — a table of random bytes would only prove
/// the screen can draw noise.
constexpr std::size_t kEnclosingHeaderBytes = 16;

/// One simulated neighbourhood. Stable node numbers and per-node signal
/// baselines are what make the roster and the signal history look like a
/// place rather than a random number generator: the node two ridges over is
/// always weak and two hops out, the one on the desk is always strong.
struct SimulatedNode {
    std::uint32_t number;
    std::int16_t rssi_dbm_x10;
    std::uint8_t hops;
};

constexpr SimulatedNode kNodes[] = {
    {0xda5c7f21U, -612, 0},  // bench node, line of sight
    {0x7b13a4e0U, -734, 0},
    {0x4e91c2b8U, -812, 1},
    {0x2ac05d16U, -857, 1},
    {0x93f7e04aU, -889, 2},
    {0xc18b3927U, -921, 2},
    {0x60d4a8f3U, -948, 3},
    {0x0f2e6b5cU, -973, 3},  // far edge of the mesh
};
constexpr std::size_t kNodeCount = sizeof(kNodes) / sizeof(kNodes[0]);

/// LongFast primary channel hash, the default every stock radio uses.
constexpr std::uint8_t kChannelHash = 0x08;

void writeLittleEndian32(std::uint8_t *out, std::uint32_t value) noexcept
{
    out[0] = static_cast<std::uint8_t>(value & 0xffU);
    out[1] = static_cast<std::uint8_t>((value >> 8U) & 0xffU);
    out[2] = static_cast<std::uint8_t>((value >> 16U) & 0xffU);
    out[3] = static_cast<std::uint8_t>((value >> 24U) & 0xffU);
}

/// Build the outer header for one sender. Most traffic on a mesh is
/// broadcast; a direct message every so often gives the destination column
/// something to say.
void writeMeshtasticHeader(std::uint8_t *out, const SimulatedNode &sender, std::uint32_t sequence)
{
    const bool direct = (sequence % 7U) == 3U;
    const SimulatedNode &peer = kNodes[(sequence / 7U + 1U) % kNodeCount];
    writeLittleEndian32(out, direct ? peer.number : 0xffffffffU);
    writeLittleEndian32(out + 4, sender.number);
    writeLittleEndian32(out + 8, 0x51a00000U + sequence);

    const std::uint8_t hop_start = static_cast<std::uint8_t>(sender.hops == 0U ? 3U : 3U);
    const std::uint8_t hop_limit = static_cast<std::uint8_t>(hop_start - sender.hops);
    const bool want_ack = direct;
    out[12] = static_cast<std::uint8_t>((hop_limit & 0x07U) |
                                        (want_ack ? 0x08U : 0x00U) |
                                        static_cast<std::uint8_t>((hop_start & 0x07U) << 5U));
    out[13] = kChannelHash;
    // Relayed traffic names the neighbour it came through; direct arrivals
    // leave these zero, exactly as the firmware transmits them.
    out[14] = sender.hops == 0U ? 0x00U : static_cast<std::uint8_t>(peer.number & 0xffU);
    out[15] = sender.hops == 0U ? 0x00U : static_cast<std::uint8_t>(kNodes[0].number & 0xffU);
}

}  // namespace

RawFrame SimulateSource::next(std::uint32_t now_ms,
                              std::uint32_t center_frequency_hz,
                              std::uint32_t bandwidth_hz,
                              std::uint8_t spreading_factor,
                              std::uint8_t coding_rate_denominator,
                              std::uint16_t profile_id,
                              ProtocolId protocol_hint) noexcept
{
    const std::uint32_t sequence = emitted_++;
    last_emit_ms_ = now_ms;

    RawFrame frame{};

    // Each frame comes from a specific neighbour, so its signal sits around
    // that node's own baseline and only wanders a few dB — which is what
    // makes the roster read as a place with near and far radios in it.
    const SimulatedNode &sender = kNodes[sequence % kNodeCount];
    const std::uint32_t noise = mix(sequence * 2654435761U + 7U);
    const std::int16_t rssi_x10 = static_cast<std::int16_t>(
        sender.rssi_dbm_x10 + static_cast<std::int16_t>(noise % 45U) - 22);
    const std::int16_t snr_x10 =
        static_cast<std::int16_t>(((rssi_x10 + 920) * 55) / 100 +
                                  static_cast<std::int16_t>((noise >> 8) % 21U) - 10);

    // Only shape frames as Meshtastic when the radio is tuned to a Meshtastic
    // profile: its decoder keys off the profile hint, and inventing that
    // structure under another profile would be a lie the UI then repeats.
    const bool meshtastic_shape = protocol_hint == ProtocolId::Meshtastic;

    std::size_t length = 0;
    if (carriesPointer(sequence)) {
        // A pointer riding inside a mesh payload, exactly where a real one
        // sits: behind the enclosing protocol's header, found by scanning.
        std::uint8_t header[kEnclosingHeaderBytes]{};
        if (meshtastic_shape) {
            writeMeshtasticHeader(header, sender, sequence);
        } else {
            fillPayload(header, sizeof(header), sequence * 7U + 3U);
        }

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
        std::uint8_t payload[kMaxFrameBytes]{};
        if (meshtastic_shape) {
            // Header, then opaque bytes: a Meshtastic payload really is
            // encrypted on the air, so random content here is honest — the
            // decoder is expected to report structure, not meaning.
            writeMeshtasticHeader(payload, sender, sequence);
            const std::size_t payload_bytes = 14U + (mix(sequence * 40503U + 11U) % 78U);
            fillPayload(payload + kEnclosingHeaderBytes, payload_bytes, sequence * 7U + 3U);
            length = kEnclosingHeaderBytes + payload_bytes;
        } else {
            length = 24U + (mix(sequence * 40503U + 11U) % 150U);
            fillPayload(payload, length, sequence * 7U + 3U);
        }
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
