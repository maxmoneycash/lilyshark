// Reticulum announce decoding, semantic tier.
//
// Every fixture below is constructed from the header arithmetic the
// structural decoder already pins down, not from captured traffic:
//
//   [0]        RNode shim (bit0 clear = complete frame)
//   [1]        RNS flags: IFAC(0x80) | header type(0x40) | context flag(0x20)
//              | propagation(0x10) | destination type(0x0c) | packet type(0x03)
//   [2]        hops (< 128)
//   [3..19)    transport id, 16 bytes — HEADER_2 only
//   next 16    destination hash
//   next 1     context byte
//   payload    for ANNOUNCE (packet type 0x01):
//                public key 64B, name hash 10B, random hash 10B,
//                [ratchet 32B when the context flag is set,]
//                signature 64B, [app_data to end of frame]
//
// Each payload region is filled with a distinct byte ramp so a copy from the
// wrong offset cannot pass.

#include "lilyshark/core/decoder_registry.h"
#include "lilyshark/protocols/reticulum_decoder.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark;

constexpr std::uint8_t kAnnounceType = 0x01;
constexpr std::uint8_t kContextFlag = 0x20;
constexpr std::uint8_t kHeaderTwoFlag = 0x40;
constexpr std::uint8_t kTransportFlag = 0x10;

/// Builds a complete announce frame and returns its length. Region ramps:
/// transport id 0x70+, destination hash 0xd0+, public key 0x11+,
/// name hash 0x21+, random hash 0x31+, ratchet 0x41+, signature 0x51+,
/// app_data 0x61+.
std::size_t buildAnnounceFrame(std::uint8_t *bytes, bool header_two, bool with_ratchet,
                               std::size_t app_data_length, std::uint8_t hops,
                               std::uint8_t destination_type = 0) noexcept
{
    std::size_t cursor = 0;
    bytes[cursor++] = 0x00; // RNode shim: complete frame
    bytes[cursor++] = static_cast<std::uint8_t>((header_two ? kHeaderTwoFlag | kTransportFlag : 0) |
                                                (with_ratchet ? kContextFlag : 0) |
                                                (destination_type << 2) | kAnnounceType);
    bytes[cursor++] = hops;
    if (header_two) {
        for (std::size_t index = 0; index < kReticulumHashBytes; ++index) {
            bytes[cursor++] = static_cast<std::uint8_t>(0x70 + index);
        }
    }
    for (std::size_t index = 0; index < kReticulumHashBytes; ++index) {
        bytes[cursor++] = static_cast<std::uint8_t>(0xd0 + index);
    }
    bytes[cursor++] = 0x00; // context byte
    for (std::size_t index = 0; index < kReticulumAnnouncePublicKeyBytes; ++index) {
        bytes[cursor++] = static_cast<std::uint8_t>(0x11 + index);
    }
    for (std::size_t index = 0; index < kReticulumAnnounceNameHashBytes; ++index) {
        bytes[cursor++] = static_cast<std::uint8_t>(0x21 + index);
    }
    for (std::size_t index = 0; index < kReticulumAnnounceRandomHashBytes; ++index) {
        bytes[cursor++] = static_cast<std::uint8_t>(0x31 + index);
    }
    if (with_ratchet) {
        for (std::size_t index = 0; index < kReticulumAnnounceRatchetBytes; ++index) {
            bytes[cursor++] = static_cast<std::uint8_t>(0x41 + index);
        }
    }
    for (std::size_t index = 0; index < kReticulumAnnounceSignatureBytes; ++index) {
        bytes[cursor++] = static_cast<std::uint8_t>(0x51 + index);
    }
    for (std::size_t index = 0; index < app_data_length; ++index) {
        bytes[cursor++] = static_cast<std::uint8_t>(0x61 + index);
    }
    return cursor;
}

DecodeResult decodeFrame(const RawFrame &frame, DecodedPacket &decoded)
{
    ReticulumDecoder reticulum{};
    DecoderRegistry registry{};
    assert(registry.add(reticulum));
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Reticulum;
    return registry.decode(frame, profile, decoded);
}

void assertRange(const ReticulumByteRange &range, std::size_t offset, std::size_t length)
{
    assert(range.offset == offset);
    assert(range.length == length);
}

void assertRamp(const std::uint8_t *bytes, std::size_t length, std::uint8_t base)
{
    for (std::size_t index = 0; index < length; ++index) {
        assert(bytes[index] == static_cast<std::uint8_t>(base + index));
    }
}

// Minimal valid announce: HEADER_1, no ratchet, no app_data.
// 1 shim + 19 header + 148 payload = 168 bytes.
void testMinimalHeaderOneAnnounce()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length = buildAnnounceFrame(bytes, false, false, 0, 3);
    assert(length == 168);

    RawFrame frame{};
    assert(frame.assignPayload(bytes, length));
    DecodedPacket decoded{};
    assert(decodeFrame(frame, decoded) == DecodeResult::Matched);
    assert(decoded.protocol == ProtocolId::Reticulum);
    assert(decoded.kind == PacketKind::Advertisement);
    assert(decoded.state == DecodeState::PayloadDecoded);
    assert(!decoded.hasAttribute(AttributeEncrypted));
    assert(decoded.payload_offset == 20);
    assert(decoded.payload_length == 148);

    ReticulumAnnounce announce{};
    assert(readReticulumAnnounce(frame, decoded, announce));
    assert(announce.valid);
    assert(announce.header_type == ReticulumHeaderType::HeaderOne);
    assert(announce.hops == 3);
    assert(!announce.has_transport_id);
    assertRange(announce.transport_id_range, 0, 0);

    // Destination hash: bytes [3, 19), ramp 0xd0.., hex form to match.
    assertRange(announce.destination_hash_range, 3, 16);
    assertRamp(announce.destination_hash, 16, 0xd0);
    assert(std::strcmp(announce.destination_hash_hex,
                       "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf") == 0);

    // Payload fields, back to back from offset 20.
    assert(announce.has_public_key);
    assertRange(announce.public_key_range, 20, 64);
    assertRange(announce.name_hash_range, 84, 10);
    assertRamp(announce.name_hash, 10, 0x21);
    assertRange(announce.random_hash_range, 94, 10);
    assertRamp(announce.random_hash, 10, 0x31);
    assert(!announce.has_ratchet);
    assertRange(announce.ratchet_range, 0, 0);
    assert(announce.has_signature);
    assertRange(announce.signature_range, 104, 64);
    assert(!announce.has_app_data);
    assert(announce.app_data_length == 0);
    assertRange(announce.app_data_range, 0, 0);
}

// Announce carrying a ratchet (context flag set) and 5 bytes of app_data:
// 1 + 19 + 64 + 10 + 10 + 32 + 64 + 5 = 205 bytes.
void testRatchetAndAppDataAnnounce()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length = buildAnnounceFrame(bytes, false, true, 5, 0);
    assert(length == 205);

    RawFrame frame{};
    assert(frame.assignPayload(bytes, length));
    DecodedPacket decoded{};
    assert(decodeFrame(frame, decoded) == DecodeResult::Matched);
    assert(decoded.state == DecodeState::PayloadDecoded);
    assert(ReticulumDecoder::contextFlag(decoded));

    ReticulumAnnounce announce{};
    assert(readReticulumAnnounce(frame, decoded, announce));
    assert(announce.hops == 0);
    assertRange(announce.public_key_range, 20, 64);
    assertRange(announce.name_hash_range, 84, 10);
    assertRange(announce.random_hash_range, 94, 10);
    assert(announce.has_ratchet);
    assertRange(announce.ratchet_range, 104, 32);
    assertRange(announce.signature_range, 136, 64);
    assert(announce.has_app_data);
    assert(announce.app_data_length == 5);
    assertRange(announce.app_data_range, 200, 5);
    assertRamp(announce.app_data, 5, 0x61);
}

// HEADER_2 (transported) announce: two 16-byte address fields.
// 1 + 35 + 148 = 184 bytes.
void testHeaderTwoAnnounce()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length = buildAnnounceFrame(bytes, true, false, 0, 7);
    assert(length == 184);

    RawFrame frame{};
    assert(frame.assignPayload(bytes, length));
    DecodedPacket decoded{};
    assert(decodeFrame(frame, decoded) == DecodeResult::Matched);
    assert(decoded.state == DecodeState::PayloadDecoded);
    assert(ReticulumDecoder::headerType(decoded) == ReticulumHeaderType::HeaderTwo);
    assert(decoded.payload_offset == 36);

    ReticulumAnnounce announce{};
    assert(readReticulumAnnounce(frame, decoded, announce));
    assert(announce.header_type == ReticulumHeaderType::HeaderTwo);
    assert(announce.hops == 7);
    assert(announce.has_transport_id);
    assertRange(announce.transport_id_range, 3, 16);
    assertRamp(announce.transport_id, 16, 0x70);
    assertRange(announce.destination_hash_range, 19, 16);
    assertRamp(announce.destination_hash, 16, 0xd0);
    assertRange(announce.public_key_range, 36, 64);
    assertRange(announce.name_hash_range, 100, 10);
    assertRange(announce.random_hash_range, 110, 10);
    assert(!announce.has_ratchet);
    assertRange(announce.signature_range, 120, 64);
    assert(!announce.has_app_data);
}

// Cut a full announce at every length from 0 to complete, both as a frame
// that genuinely ends there and as a truncated capture (original longer than
// captured). No cut may crash under ASan, and the semantic tier may only
// succeed when the arithmetic still proves every promised field.
void testTruncationAtEveryBoundary()
{
    std::uint8_t minimal[kMaxFrameBytes]{};
    const std::size_t minimal_length = buildAnnounceFrame(minimal, false, false, 0, 2);
    std::uint8_t ratcheted[kMaxFrameBytes]{};
    const std::size_t ratcheted_length = buildAnnounceFrame(ratcheted, false, true, 5, 2);
    std::uint8_t two[kMaxFrameBytes]{};
    const std::size_t two_length = buildAnnounceFrame(two, true, false, 0, 2);

    struct Case {
        const std::uint8_t *bytes;
        std::size_t full_length;
        std::size_t header_length;   // physical: shim + RNS header
        std::size_t fixed_payload;   // announce fields the flags promise
    };
    const Case cases[] = {
        {minimal, minimal_length, 20, 148},
        {ratcheted, ratcheted_length, 20, 180},
        {two, two_length, 36, 148},
    };

    for (const Case &c : cases) {
        for (std::size_t cut = 0; cut <= c.full_length; ++cut) {
            // A frame that genuinely ends at `cut`.
            RawFrame genuine{};
            assert(genuine.assignPayload(c.bytes, cut));
            DecodedPacket decoded{};
            const DecodeResult result = decodeFrame(genuine, decoded);
            ReticulumAnnounce announce{};
            const bool read = readReticulumAnnounce(genuine, decoded, announce);
            if (cut < c.header_length) {
                assert(result == DecodeResult::Malformed);
                assert(!read);
            } else if (cut - c.header_length < c.fixed_payload) {
                // Structurally fine, semantically unproven: header only.
                assert(result == DecodeResult::Matched);
                assert(decoded.state == DecodeState::HeaderOnly);
                assert(!read);
            } else {
                // Enough room for every promised field; any excess is
                // app_data.
                assert(result == DecodeResult::Matched);
                assert(decoded.state == DecodeState::PayloadDecoded);
                assert(read);
                assert(announce.app_data_length == cut - c.header_length - c.fixed_payload);
                assert(announce.has_app_data == (announce.app_data_length != 0));
            }
            assert(read == announce.valid);

            // The same cut reported as a truncated capture must fail safe.
            if (cut == c.full_length) {
                continue;
            }
            RawFrame truncated{};
            assert(!truncated.assignPayload(c.bytes, cut) || true);
            truncated = RawFrame{};
            std::memcpy(truncated.bytes, c.bytes, cut);
            truncated.captured_length = static_cast<std::uint16_t>(cut);
            truncated.original_length = static_cast<std::uint16_t>(c.full_length);
            DecodedPacket truncated_decoded{};
            assert(decodeFrame(truncated, truncated_decoded) == DecodeResult::Malformed);
            ReticulumAnnounce truncated_announce{};
            assert(!readReticulumAnnounce(truncated, truncated_decoded, truncated_announce));
            assert(!truncated_announce.valid);
        }
    }
}

// A decoded packet must never be read against a shorter frame than the one
// it was decoded from — the reader re-checks bounds instead of trusting the
// caller.
void testMismatchedFrameFailsSafe()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length = buildAnnounceFrame(bytes, false, false, 0, 1);
    RawFrame full{};
    assert(full.assignPayload(bytes, length));
    DecodedPacket decoded{};
    assert(decodeFrame(full, decoded) == DecodeResult::Matched);

    RawFrame shorter{};
    assert(shorter.assignPayload(bytes, 40));
    ReticulumAnnounce announce{};
    assert(!readReticulumAnnounce(shorter, decoded, announce));
    assert(!announce.valid);
}

// Non-announce packet types keep their structural-only behaviour and are
// ignored by the announce reader, even with an announce-sized payload.
void testWrongPacketTypeIgnored()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length = buildAnnounceFrame(bytes, false, false, 0, 1);

    // Rewrite the packet type bits: DATA (0x00) on a PLAIN destination so the
    // payload stays clear, and LINKREQUEST (0x02) on SINGLE.
    const std::uint8_t variants[] = {
        static_cast<std::uint8_t>(0x08), // PLAIN destination, DATA
        static_cast<std::uint8_t>(0x02), // SINGLE destination, LINKREQUEST
    };
    for (std::uint8_t flags : variants) {
        bytes[1] = flags;
        RawFrame frame{};
        assert(frame.assignPayload(bytes, length));
        DecodedPacket decoded{};
        assert(decodeFrame(frame, decoded) == DecodeResult::Matched);
        assert(decoded.state == DecodeState::HeaderOnly);
        assert(decoded.kind != PacketKind::Advertisement);
        ReticulumAnnounce announce{};
        assert(!readReticulumAnnounce(frame, decoded, announce));
        assert(!announce.valid);
    }
}

// Flag inconsistencies stay structural: an "announce" from a non-SINGLE
// destination, or a context flag promising a ratchet the payload cannot
// hold, is never presented as a decoded announce.
void testFlagInconsistenciesStayStructural()
{
    // GROUP destination type (1) with an otherwise perfect announce payload.
    std::uint8_t group_bytes[kMaxFrameBytes]{};
    const std::size_t group_length = buildAnnounceFrame(group_bytes, false, false, 0, 1, 1);
    RawFrame group{};
    assert(group.assignPayload(group_bytes, group_length));
    DecodedPacket decoded{};
    assert(decodeFrame(group, decoded) == DecodeResult::Matched);
    assert(decoded.kind == PacketKind::Advertisement);
    assert(decoded.state == DecodeState::HeaderOnly);
    ReticulumAnnounce announce{};
    assert(!readReticulumAnnounce(group, decoded, announce));

    // Context flag set, but only the ratchet-less 148 payload bytes present.
    std::uint8_t promise_bytes[kMaxFrameBytes]{};
    const std::size_t promise_length = buildAnnounceFrame(promise_bytes, false, false, 0, 1);
    promise_bytes[1] |= kContextFlag;
    RawFrame promise{};
    assert(promise.assignPayload(promise_bytes, promise_length));
    assert(decodeFrame(promise, decoded) == DecodeResult::Matched);
    assert(decoded.state == DecodeState::HeaderOnly);
    assert(!readReticulumAnnounce(promise, decoded, announce));
    assert(!announce.valid);
}

// Split and IFAC-protected frames carry no readable announce.
void testSplitAndIfacRejected()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length = buildAnnounceFrame(bytes, false, false, 0, 1);

    std::uint8_t split_bytes[kMaxFrameBytes]{};
    std::memcpy(split_bytes, bytes, length);
    split_bytes[0] = 0x01; // RNode split marker
    RawFrame split{};
    assert(split.assignPayload(split_bytes, length));
    DecodedPacket decoded{};
    assert(decodeFrame(split, decoded) == DecodeResult::Matched);
    assert(ReticulumDecoder::isRNodeSplitFrame(decoded));
    ReticulumAnnounce announce{};
    assert(!readReticulumAnnounce(split, decoded, announce));

    std::uint8_t ifac_bytes[kMaxFrameBytes]{};
    std::memcpy(ifac_bytes, bytes, length);
    ifac_bytes[1] |= 0x80; // IFAC marker: header and payload are masked
    RawFrame ifac{};
    assert(ifac.assignPayload(ifac_bytes, length));
    assert(decodeFrame(ifac, decoded) == DecodeResult::Matched);
    assert(ReticulumDecoder::isIfacProtected(decoded));
    assert(!readReticulumAnnounce(ifac, decoded, announce));
    assert(!announce.valid);
}

// Hop counts pass through unchanged; 128 and above stays malformed exactly as
// the structural tier already promised.
void testHopCounts()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length = buildAnnounceFrame(bytes, false, false, 0, 0);

    const std::uint8_t valid_hops[] = {0, 1, 64, 127};
    for (std::uint8_t hops : valid_hops) {
        bytes[2] = hops;
        RawFrame frame{};
        assert(frame.assignPayload(bytes, length));
        DecodedPacket decoded{};
        assert(decodeFrame(frame, decoded) == DecodeResult::Matched);
        assert(ReticulumDecoder::observedHops(decoded) == hops);
        ReticulumAnnounce announce{};
        assert(readReticulumAnnounce(frame, decoded, announce));
        assert(announce.hops == hops);
    }

    bytes[2] = 128;
    RawFrame frame{};
    assert(frame.assignPayload(bytes, length));
    DecodedPacket decoded{};
    assert(decodeFrame(frame, decoded) == DecodeResult::Malformed);
    ReticulumAnnounce announce{};
    assert(!readReticulumAnnounce(frame, decoded, announce));
}

// The largest announce that fits a captured frame: HEADER_1, no ratchet,
// app_data filling every remaining byte up to kMaxFrameBytes.
void testMaximumAppData()
{
    std::uint8_t bytes[kMaxFrameBytes]{};
    const std::size_t length =
        buildAnnounceFrame(bytes, false, false, kReticulumAnnounceMaxAppDataBytes, 1);
    assert(length == kMaxFrameBytes);

    RawFrame frame{};
    assert(frame.assignPayload(bytes, length));
    DecodedPacket decoded{};
    assert(decodeFrame(frame, decoded) == DecodeResult::Matched);
    ReticulumAnnounce announce{};
    assert(readReticulumAnnounce(frame, decoded, announce));
    assert(announce.has_app_data);
    assert(announce.app_data_length == kReticulumAnnounceMaxAppDataBytes);
    assertRamp(announce.app_data, kReticulumAnnounceMaxAppDataBytes, 0x61);
}

} // namespace

int main()
{
    testMinimalHeaderOneAnnounce();
    testRatchetAndAppDataAnnounce();
    testHeaderTwoAnnounce();
    testTruncationAtEveryBoundary();
    testMismatchedFrameFailsSafe();
    testWrongPacketTypeIgnored();
    testFlagInconsistenciesStayStructural();
    testSplitAndIfacRejected();
    testHopCounts();
    testMaximumAppData();
    std::puts("reticulum announce tests passed");
    return 0;
}
