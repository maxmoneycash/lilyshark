#include "lilyshark/shelby/shelby_pointer.h"
#include "lilyshark/shelby/shelby_pointer_decoder.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

using namespace lilyshark;

ShelbyPointer makePointer() noexcept
{
    ShelbyPointer pointer{};
    for (std::size_t i = 0; i < ShelbyPointer::kCommitmentSize; ++i) {
        pointer.commitment[i] = static_cast<std::uint8_t>(0xA0 + i);
    }
    for (std::size_t i = 0; i < ShelbyPointer::kOwnerSize; ++i) {
        pointer.owner[i] = static_cast<std::uint8_t>(i * 3 + 1);
    }
    pointer.flags = ShelbyPointer::kFlagEncrypted | ShelbyPointer::kFlagCapture;
    pointer.size_bytes = 1u << 20;
    pointer.expires_at_unix = 1893456000u;
    pointer.chunk_index = 0;
    pointer.chunk_count = 1;
    return pointer;
}

void roundTripPreservesEveryField()
{
    const ShelbyPointer original = makePointer();
    std::array<std::uint8_t, ShelbyPointer::kEncodedSize> buffer{};

    assert(encodeShelbyPointer(original, buffer.data(), buffer.size()) == ShelbyPointerResult::Ok);

    ShelbyPointer decoded{};
    assert(decodeShelbyPointer(buffer.data(), buffer.size(), decoded) == ShelbyPointerResult::Ok);

    assert(decoded.version == ShelbyPointer::kVersion);
    assert(decoded.flags == original.flags);
    assert(std::memcmp(decoded.commitment, original.commitment,
                       ShelbyPointer::kCommitmentSize) == 0);
    assert(std::memcmp(decoded.owner, original.owner, ShelbyPointer::kOwnerSize) == 0);
    assert(decoded.size_bytes == original.size_bytes);
    assert(decoded.expires_at_unix == original.expires_at_unix);
    assert(decoded.chunk_index == original.chunk_index);
    assert(decoded.chunk_count == original.chunk_count);
    assert(decoded.isEncrypted());
    assert(decoded.isCapture());
    assert(!decoded.isChunked());
}

void wireLayoutIsStable()
{
    // The encoding is a wire format shared with the webapp reader, so the byte
    // positions are asserted directly rather than only via round trip.
    const ShelbyPointer pointer = makePointer();
    std::array<std::uint8_t, ShelbyPointer::kEncodedSize> buffer{};
    assert(encodeShelbyPointer(pointer, buffer.data(), buffer.size()) == ShelbyPointerResult::Ok);

    assert(buffer[0] == 'S' && buffer[1] == 'H' && buffer[2] == 'L' && buffer[3] == 'B');
    assert(buffer[4] == ShelbyPointer::kVersion);
    assert(buffer[5] == pointer.flags);
    assert(buffer[6] == 0xA0);                    // commitment starts at 6
    assert(buffer[38] == 1);                      // owner starts at 38
    assert(buffer[70] == 0x00 && buffer[71] == 0x00 && buffer[72] == 0x10 && buffer[73] == 0x00);
    assert(buffer[80] == 1 && buffer[81] == 0);   // chunk_count little-endian
    assert(ShelbyPointer::kEncodedSize == 82);
}

void encodeRejectsSmallBufferAndBadChunking()
{
    const ShelbyPointer pointer = makePointer();
    std::array<std::uint8_t, ShelbyPointer::kEncodedSize - 1> tooSmall{};
    assert(encodeShelbyPointer(pointer, tooSmall.data(), tooSmall.size()) ==
           ShelbyPointerResult::BufferTooSmall);

    std::array<std::uint8_t, ShelbyPointer::kEncodedSize> buffer{};
    ShelbyPointer zeroCount = pointer;
    zeroCount.chunk_count = 0;
    assert(encodeShelbyPointer(zeroCount, buffer.data(), buffer.size()) ==
           ShelbyPointerResult::Malformed);

    ShelbyPointer indexPastEnd = pointer;
    indexPastEnd.chunk_count = 2;
    indexPastEnd.chunk_index = 2;
    assert(encodeShelbyPointer(indexPastEnd, buffer.data(), buffer.size()) ==
           ShelbyPointerResult::Malformed);
}

void decodeRejectsForeignAndInconsistentPayloads()
{
    ShelbyPointer decoded{};

    const std::array<std::uint8_t, ShelbyPointer::kEncodedSize> notShelby{};
    assert(decodeShelbyPointer(notShelby.data(), notShelby.size(), decoded) ==
           ShelbyPointerResult::NoMagic);

    const std::array<std::uint8_t, 8> tiny{{'S', 'H', 'L', 'B', 1, 0, 0, 0}};
    assert(decodeShelbyPointer(tiny.data(), tiny.size(), decoded) ==
           ShelbyPointerResult::BufferTooSmall);

    std::array<std::uint8_t, ShelbyPointer::kEncodedSize> buffer{};
    assert(encodeShelbyPointer(makePointer(), buffer.data(), buffer.size()) ==
           ShelbyPointerResult::Ok);

    auto corrupted = buffer;
    corrupted[4] = 99; // unsupported version
    assert(decodeShelbyPointer(corrupted.data(), corrupted.size(), decoded) ==
           ShelbyPointerResult::UnsupportedVersion);

    // chunk_count > 1 without kFlagChunked must be rejected: a receiver would
    // otherwise treat one part of a split blob as a whole one.
    corrupted = buffer;
    corrupted[80] = 4;
    assert(decodeShelbyPointer(corrupted.data(), corrupted.size(), decoded) ==
           ShelbyPointerResult::Malformed);
}

void chunkedPointersRoundTrip()
{
    ShelbyPointer pointer = makePointer();
    pointer.flags |= ShelbyPointer::kFlagChunked;
    pointer.chunk_index = 3;
    pointer.chunk_count = 7;

    std::array<std::uint8_t, ShelbyPointer::kEncodedSize> buffer{};
    assert(encodeShelbyPointer(pointer, buffer.data(), buffer.size()) == ShelbyPointerResult::Ok);

    ShelbyPointer decoded{};
    assert(decodeShelbyPointer(buffer.data(), buffer.size(), decoded) == ShelbyPointerResult::Ok);
    assert(decoded.isChunked());
    assert(decoded.chunk_index == 3);
    assert(decoded.chunk_count == 7);
}

void pointerIsFoundInsideAnEnclosingProtocolPayload()
{
    // The pointer rides inside Meshtastic / MeshCore / Reticulum payloads, so it
    // must be locatable after an arbitrary protocol header.
    std::array<std::uint8_t, 16 + ShelbyPointer::kEncodedSize + 5> frame{};
    for (std::size_t i = 0; i < 16; ++i) {
        frame[i] = static_cast<std::uint8_t>(i);
    }
    assert(encodeShelbyPointer(makePointer(), frame.data() + 16,
                               frame.size() - 16) == ShelbyPointerResult::Ok);

    assert(findShelbyPointer(frame.data(), frame.size()) == 16);
    assert(looksLikeShelbyPointer(frame.data() + 16, ShelbyPointer::kEncodedSize));
    assert(!looksLikeShelbyPointer(frame.data(), frame.size()));

    const std::array<std::uint8_t, 40> noPointer{};
    assert(findShelbyPointer(noPointer.data(), noPointer.size()) == noPointer.size());
}

void fitsInsideOneLoRaFrame()
{
    // The whole premise is that a pointer fits one frame while the bytes do not.
    // Meshtastic's practical payload ceiling is ~200 bytes.
    static_assert(ShelbyPointer::kEncodedSize <= 200,
                  "pointer must fit inside a single LoRa payload");
    assert(ShelbyPointer::kEncodedSize == 82);
}

RawFrame frameCarryingPointer(std::size_t header_bytes)
{
    std::array<std::uint8_t, 256> scratch{};
    for (std::size_t i = 0; i < header_bytes; ++i) {
        scratch[i] = static_cast<std::uint8_t>(0x10 + i);
    }
    const ShelbyPointerResult encoded =
        encodeShelbyPointer(makePointer(), scratch.data() + header_bytes,
                            scratch.size() - header_bytes);
    assert(encoded == ShelbyPointerResult::Ok);

    RawFrame frame{};
    frame.assignPayload(scratch.data(), header_bytes + ShelbyPointer::kEncodedSize);
    return frame;
}

void decoderFindsPointerRegardlessOfEnclosingProtocol()
{
    const ShelbyPointerDecoder decoder;
    RadioProfile profile{};
    DecodedPacket packet{};

    // The pointer is an application payload convention, so it must be found
    // behind any protocol's header — and with no profile hint at all.
    for (const ProtocolId hint : {ProtocolId::Meshtastic, ProtocolId::MeshCore,
                                  ProtocolId::Reticulum, ProtocolId::Unknown}) {
        profile.protocol_hint = hint;
        for (const std::size_t header_bytes : {std::size_t{0}, std::size_t{4},
                                               std::size_t{16}, std::size_t{24}}) {
            const RawFrame frame = frameCarryingPointer(header_bytes);
            packet = DecodedPacket{};
            assert(decoder.decode(frame, profile, packet) == DecodeResult::Matched);
            assert(packet.payload_offset == header_bytes);
            assert(packet.payload_length == ShelbyPointer::kEncodedSize);
            assert(packet.hasAttribute(AttributeEncrypted)); // makePointer sets the flag

            ShelbyPointer extracted{};
            assert(ShelbyPointerDecoder::extract(frame, extracted));
            assert(extracted.size_bytes == (1u << 20));
            assert(extracted.isCapture());
        }
    }
}

void decoderIgnoresFramesWithoutPointers()
{
    const ShelbyPointerDecoder decoder;
    RadioProfile profile{};
    DecodedPacket packet{};

    std::array<std::uint8_t, 96> ordinary{};
    for (std::size_t i = 0; i < ordinary.size(); ++i) {
        ordinary[i] = static_cast<std::uint8_t>(i);
    }
    RawFrame frame{};
    frame.assignPayload(ordinary.data(), ordinary.size());

    assert(decoder.decode(frame, profile, packet) == DecodeResult::NoMatch);

    ShelbyPointer extracted{};
    assert(!ShelbyPointerDecoder::extract(frame, extracted));
}

} // namespace

int main()
{
    roundTripPreservesEveryField();
    wireLayoutIsStable();
    encodeRejectsSmallBufferAndBadChunking();
    decodeRejectsForeignAndInconsistentPayloads();
    chunkedPointersRoundTrip();
    pointerIsFoundInsideAnEnclosingProtocolPayload();
    fitsInsideOneLoRaFrame();
    decoderFindsPointerRegardlessOfEnclosingProtocol();
    decoderIgnoresFramesWithoutPointers();
    std::printf("shelby_pointer: all assertions passed\n");
    return 0;
}
