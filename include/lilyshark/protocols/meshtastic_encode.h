#pragma once

#include "lilyshark/protocols/meshtastic_payload.h"

#include "lilyshark/protocols/meshtastic_pkc.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Stable node number this firmware uses on Meshtastic LongFast until a
/// user-set identity exists. Non-zero so official radios do not drop it.
inline constexpr std::uint32_t kLilysharkMeshtasticNodeNum = 0x4c534b01U;

inline constexpr char kMeshtasticDefaultChannelName[] = "LongFast";

/// The default channel's name is the modem preset's name, and the preset is
/// determined by spreading factor and bandwidth. The name matters because it
/// is hashed into every frame header: a Bay Area Mesh node on MediumFast
/// silently drops a frame stamped with LongFast's hash. Table verified
/// against meshtastic.org/docs/overview/radio-settings.
inline constexpr const char *meshtasticDefaultChannelName(
    std::uint8_t spreading_factor, std::uint32_t bandwidth_hz) noexcept
{
    if (bandwidth_hz == 250000U) {
        switch (spreading_factor) {
        case 7: return "ShortFast";
        case 8: return "ShortSlow";
        case 9: return "MediumFast";
        case 10: return "MediumSlow";
        case 11: return "LongFast";
        default: break;
        }
    } else if (bandwidth_hz == 125000U) {
        if (spreading_factor == 11) return "LongModerate";
        if (spreading_factor == 12) return "LongSlow";
    } else if (bandwidth_hz == 500000U) {
        if (spreading_factor == 7) return "ShortTurbo";
        if (spreading_factor == 11) return "LongTurbo";
    }
    return kMeshtasticDefaultChannelName;
}

/// XOR hash Meshtastic puts in the outer header channel byte.
std::uint8_t meshtasticChannelHash(const char *name, const std::uint8_t *psk,
                                   std::size_t psk_length) noexcept;

struct MeshtasticEncodeRequest {
    std::uint32_t from_node = kLilysharkMeshtasticNodeNum;
    std::uint32_t to_node = 0xffffffffU;
    std::uint32_t packet_id = 1;
    std::uint8_t hop_limit = 3;
    /// Sets the header's want-ack bit, so official firmware replies with a
    /// Routing acknowledgement carrying this packet's id.
    bool want_ack = false;
    /// For a Routing acknowledgement: the id of the packet being confirmed.
    /// Written as the Data message's request_id when non-zero.
    std::uint32_t request_id = 0;
    MeshtasticPort port = MeshtasticPort::TextMessage;
    const char *text = nullptr;
    double latitude_degrees = 0.0;
    double longitude_degrees = 0.0;
    const char *long_name = "Lilyshark";
    const char *short_name = "LSK";
    /// Hashed into the header; stock nodes drop frames whose hash names a
    /// channel they do not have, so this must match the active preset. On a
    /// keyed channel it must be the channel's own name, because the hash is
    /// taken over the name and the key together.
    const char *channel_name = kMeshtasticDefaultChannelName;
    /// The channel key this frame is sealed under, or null for the published
    /// default PSK. Exactly `crypto::kAes128KeySize` bytes when set; this
    /// build has no other cipher, and `ChannelKeyStore` refuses to hold a key
    /// of any other length.
    ///
    /// Null is the whole of the old behaviour: the key and the psk half of
    /// the header hash both come from `kMeshtasticDefaultPsk`, so a request
    /// that does not set this encodes byte for byte what it always did.
    const std::uint8_t *channel_key = nullptr;
    /// Set both of these to send a private message only the destination can
    /// read. When they are present on a direct text, the payload is sealed
    /// with the pair's shared secret instead of the channel key everybody
    /// has, and the header's channel byte goes to zero -- which is exactly
    /// how stock firmware marks a public-key message on the air.
    const MeshtasticPkcKeypair *identity = nullptr;
    const std::uint8_t *peer_public_key = nullptr;
    /// Fresh randomness per packet, mixed into the nonce so that a repeated
    /// packet id can never repeat a keystream. Ignored without a peer key.
    std::uint32_t extra_nonce = 0;
};

/// True when this request will be sealed to one recipient. Broadcasts and
/// the protocol's own housekeeping ports stay on the channel key, matching
/// the exclusions in stock firmware's Router::send. A request naming a stored
/// channel key is never one of these: the operator picked a channel to speak
/// on, and quietly sealing that message to a person instead would move it out
/// of the conversation it was written in.
bool meshtasticRequestUsesPkc(const MeshtasticEncodeRequest &request) noexcept;

/// Build a native 16-byte header plus ciphertext, sealed under
/// `request.channel_key` or the published default PSK when that is null.
/// Returns 0 if the buffer is too small or the request is empty.
std::size_t encodeMeshtasticFrame(const MeshtasticEncodeRequest &request,
                                  std::uint8_t *out, std::size_t out_size) noexcept;

} // namespace lilyshark
