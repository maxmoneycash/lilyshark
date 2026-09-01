// On-device channel keys: the store, the keyed decode order, and the promise
// that key material never reaches an output file.
//
// The security design these tests hold to the wall lives in
// include/lilyshark/core/channel_keys.h and docs/channel-key-security.md.

#include "lilyshark/core/channel_keys.h"
#include "lilyshark/core/decoder_registry.h"
#include "lilyshark/core/settings_checksum.h"
#include "lilyshark/crypto/aes128.h"
#include "lilyshark/export/lilyshark_capture.h"
#include "lilyshark/protocols/meshtastic_decoder.h"
#include "lilyshark/protocols/meshtastic_encode.h"
#include "lilyshark/protocols/meshtastic_payload.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

namespace {

using namespace lilyshark;

constexpr std::size_t kHeaderLength = 16U;
constexpr std::size_t kRecordChecksumOffset = 264U;

/// A private channel key, used everywhere below as "the operator's key".
constexpr std::uint8_t kOperatorKey[kChannelKeySize] = {
    0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
};

constexpr std::uint8_t kOtherKey[kChannelKeySize] = {
    0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf,
};

/// A key that decrypts nothing here, used to prove wrong keys are skipped
/// rather than allowed to produce noise.
constexpr std::uint8_t kWrongKey[kChannelKeySize] = {
    0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
    0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
};

class RecordingSink final : public ByteSink
{
  public:
    bool write(const std::uint8_t *data, std::size_t length) noexcept override
    {
        bytes.insert(bytes.end(), data, data + length);
        return true;
    }

    std::vector<std::uint8_t> bytes;
};

/// True when `needle` appears anywhere in `haystack`.
bool contains(const std::vector<std::uint8_t> &haystack, const std::uint8_t *needle,
              std::size_t needle_size) noexcept
{
    if (needle_size == 0U || haystack.size() < needle_size) {
        return false;
    }
    for (std::size_t offset = 0; offset + needle_size <= haystack.size(); ++offset) {
        if (std::memcmp(haystack.data() + offset, needle, needle_size) == 0) {
            return true;
        }
    }
    return false;
}

/// Builds a Meshtastic frame whose payload is readable only under `key`, by
/// taking a default-key frame apart and re-encrypting the same plaintext.
std::size_t encodeFrameUnderKey(const MeshtasticEncodeRequest &request,
                                const std::uint8_t key[kChannelKeySize],
                                std::uint8_t *out, std::size_t out_size) noexcept
{
    const std::size_t size = encodeMeshtasticFrame(request, out, out_size);
    if (size <= kHeaderLength) {
        return 0U;
    }
    const std::size_t cipher_length = size - kHeaderLength;

    std::uint8_t nonce[crypto::kAesBlockSize]{};
    nonce[0] = static_cast<std::uint8_t>(request.packet_id & 0xffU);
    nonce[1] = static_cast<std::uint8_t>((request.packet_id >> 8U) & 0xffU);
    nonce[2] = static_cast<std::uint8_t>((request.packet_id >> 16U) & 0xffU);
    nonce[3] = static_cast<std::uint8_t>((request.packet_id >> 24U) & 0xffU);
    nonce[8] = static_cast<std::uint8_t>(request.from_node & 0xffU);
    nonce[9] = static_cast<std::uint8_t>((request.from_node >> 8U) & 0xffU);
    nonce[10] = static_cast<std::uint8_t>((request.from_node >> 16U) & 0xffU);
    nonce[11] = static_cast<std::uint8_t>((request.from_node >> 24U) & 0xffU);

    std::uint8_t plain[kMaxFrameBytes]{};
    crypto::aesCtrXcrypt(kMeshtasticDefaultPsk, nonce, out + kHeaderLength, cipher_length,
                         plain);
    crypto::aesCtrXcrypt(key, nonce, plain, cipher_length, out + kHeaderLength);
    return size;
}

MeshtasticEncodeRequest textRequest() noexcept
{
    MeshtasticEncodeRequest request{};
    request.from_node = 0x336a1b2cU;
    request.packet_id = 0x51a00001U;
    request.port = MeshtasticPort::TextMessage;
    request.text = "private channel traffic";
    return request;
}

void testNameValidationRefusesWhatCannotBeShown()
{
    assert(isValidChannelKeyName("FIELD TEAM"));
    assert(isValidChannelKeyName("a"));
    assert(isValidChannelKeyName("123456789012345"));

    assert(!isValidChannelKeyName(nullptr));
    assert(!isValidChannelKeyName(""));
    assert(!isValidChannelKeyName(" leading"));
    assert(!isValidChannelKeyName("trailing "));
    assert(!isValidChannelKeyName("1234567890123456"));
    assert(!isValidChannelKeyName("tab\there"));
    assert(!isValidChannelKeyName("high\x80"));
}

void testAddRenameRemoveReportExplicitResults()
{
    ChannelKeyStore store;
    assert(store.empty());
    assert(store.capacity() == kChannelKeyCapacity);

    std::size_t slot = 99U;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    assert(slot == 0U);
    assert(store.size() == 1U);
    assert(std::strcmp(store.name(0U), "FIELD TEAM") == 0);
    assert(store.name(1U) == nullptr);

    // Wrong sizes, null keys, bad names and duplicates all name their reason.
    assert(store.add("SECOND", kOtherKey, kChannelKeySize - 1U, slot) ==
           ChannelKeyResult::InvalidKey);
    assert(store.add("SECOND", nullptr, kChannelKeySize, slot) ==
           ChannelKeyResult::InvalidKey);
    assert(store.add("", kOtherKey, kChannelKeySize, slot) ==
           ChannelKeyResult::InvalidName);
    assert(store.add("FIELD TEAM", kOtherKey, kChannelKeySize, slot) ==
           ChannelKeyResult::DuplicateName);
    assert(store.add("ANOTHER NAME", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::DuplicateKey);
    assert(store.size() == 1U);

    assert(store.add("SECOND", kOtherKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);
    assert(slot == 1U);

    assert(store.rename(1U, "RENAMED") == ChannelKeyResult::Ok);
    assert(std::strcmp(store.name(1U), "RENAMED") == 0);
    assert(store.rename(1U, "RENAMED") == ChannelKeyResult::Ok);
    assert(store.rename(1U, "FIELD TEAM") == ChannelKeyResult::DuplicateName);
    assert(store.rename(2U, "NOPE") == ChannelKeyResult::InvalidSlot);
    assert(store.rename(0U, "trailing ") == ChannelKeyResult::InvalidName);

    // Removal keeps the remaining keys in their decode order.
    assert(store.remove(0U) == ChannelKeyResult::Ok);
    assert(store.size() == 1U);
    assert(std::strcmp(store.name(0U), "RENAMED") == 0);
    assert(std::memcmp(store.channelKeyBytes(0U), kOtherKey, kChannelKeySize) == 0);
    assert(store.remove(1U) == ChannelKeyResult::InvalidSlot);
    assert(store.remove(0U) == ChannelKeyResult::Ok);
    assert(store.empty());
    assert(store.channelKeyBytes(0U) == nullptr);
}

void testStoreFillsAndRefusesOverflow()
{
    ChannelKeyStore store;
    for (std::size_t index = 0; index < kChannelKeyCapacity; ++index) {
        char name[kChannelKeyNameCapacity]{};
        std::snprintf(name, sizeof(name), "KEY %u", static_cast<unsigned>(index));
        std::uint8_t key[kChannelKeySize]{};
        key[0] = static_cast<std::uint8_t>(index + 1U);
        std::size_t slot = 0;
        assert(store.add(name, key, sizeof(key), slot) == ChannelKeyResult::Ok);
        assert(slot == index);
    }
    assert(store.full());

    std::uint8_t overflow[kChannelKeySize]{};
    overflow[0] = 0xffU;
    std::size_t slot = 0;
    assert(store.add("ONE TOO MANY", overflow, sizeof(overflow), slot) ==
           ChannelKeyResult::StoreFull);
    assert(store.size() == kChannelKeyCapacity);

    store.clear();
    assert(store.empty());
    assert(store.channelKeyCount() == 0U);
}

void testFingerprintsIdentifyKeysWithoutRevealingThem()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    assert(store.add("SECOND", kOtherKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);

    char first[kChannelKeyFingerprintDigits + 1]{};
    char second[kChannelKeyFingerprintDigits + 1]{};
    assert(store.fingerprint(0U, first, sizeof(first)));
    assert(store.fingerprint(1U, second, sizeof(second)));
    assert(std::strlen(first) == kChannelKeyFingerprintDigits);
    assert(std::strcmp(first, second) != 0);

    // Stable across calls, and independent of the name.
    char again[kChannelKeyFingerprintDigits + 1]{};
    assert(store.rename(0U, "RENAMED") == ChannelKeyResult::Ok);
    assert(store.fingerprint(0U, again, sizeof(again)));
    assert(std::strcmp(first, again) == 0);

    for (std::size_t index = 0; index < kChannelKeyFingerprintDigits; ++index) {
        const char digit = first[index];
        assert((digit >= '0' && digit <= '9') || (digit >= 'A' && digit <= 'F'));
    }

    // A fingerprint is a digest, not a prefix of the key rendered as hex.
    char key_prefix[kChannelKeyFingerprintDigits + 1]{};
    std::snprintf(key_prefix, sizeof(key_prefix), "%02X%02X%02X", kOperatorKey[0],
                  kOperatorKey[1], kOperatorKey[2]);
    assert(std::strcmp(first, key_prefix) != 0);

    // Two keys differing in one byte give unrelated fingerprints.
    std::uint8_t near_miss[kChannelKeySize]{};
    std::memcpy(near_miss, kOperatorKey, sizeof(near_miss));
    near_miss[kChannelKeySize - 1U] ^= 0x01U;
    ChannelKeyStore neighbour;
    assert(neighbour.add("NEAR", near_miss, sizeof(near_miss), slot) ==
           ChannelKeyResult::Ok);
    char near_print[kChannelKeyFingerprintDigits + 1]{};
    assert(neighbour.fingerprint(0U, near_print, sizeof(near_print)));
    assert(std::strcmp(first, near_print) != 0);

    assert(!store.fingerprint(2U, first, sizeof(first)));
    assert(!store.fingerprint(0U, nullptr, sizeof(first)));
    assert(!store.fingerprint(0U, first, kChannelKeyFingerprintDigits));
}

void testRecordRoundTripsAndRefusesEveryCorruption()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    assert(store.add("SECOND", kOtherKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);

    std::array<std::uint8_t, kChannelKeyStoreRecordSize> encoded{};
    assert(store.encode(encoded.data(), encoded.size()));
    assert(encoded[0] == 'L' && encoded[1] == 'S' && encoded[2] == 'C' && encoded[3] == 'K');
    assert(encoded[4] == kChannelKeyStoreSchemaVersion);
    assert(encoded[5] == 2U);

    ChannelKeyStore loaded;
    assert(loaded.decode(encoded.data(), encoded.size()) == ChannelKeyDecodeResult::LoadedV1);
    assert(loaded.size() == 2U);
    assert(std::strcmp(loaded.name(0U), "FIELD TEAM") == 0);
    assert(std::strcmp(loaded.name(1U), "SECOND") == 0);
    assert(std::memcmp(loaded.channelKeyBytes(0U), kOperatorKey, kChannelKeySize) == 0);
    assert(std::memcmp(loaded.channelKeyBytes(1U), kOtherKey, kChannelKeySize) == 0);

    // Every single-bit corruption is refused, and the store keeps what it had.
    for (std::size_t index = 0; index < encoded.size(); ++index) {
        auto corrupt = encoded;
        corrupt[index] ^= 0x01U;
        assert(loaded.decode(corrupt.data(), corrupt.size()) ==
               ChannelKeyDecodeResult::Invalid);
        assert(loaded.size() == 2U);
        assert(std::strcmp(loaded.name(0U), "FIELD TEAM") == 0);
    }

    assert(loaded.decode(nullptr, encoded.size()) == ChannelKeyDecodeResult::Invalid);
    assert(loaded.decode(encoded.data(), encoded.size() - 1U) ==
           ChannelKeyDecodeResult::Invalid);
    assert(loaded.size() == 2U);

    assert(!store.encode(nullptr, encoded.size()));
    assert(!store.encode(encoded.data(), encoded.size() - 1U));
}

void testWellChecksummedButMalformedRecordsAreRefused()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    std::array<std::uint8_t, kChannelKeyStoreRecordSize> encoded{};
    assert(store.encode(encoded.data(), encoded.size()));

    const auto reseal = [](std::array<std::uint8_t, kChannelKeyStoreRecordSize> &bytes) {
        const std::uint32_t crc = settingsCrc32(bytes.data(), kRecordChecksumOffset);
        bytes[kRecordChecksumOffset] = static_cast<std::uint8_t>(crc);
        bytes[kRecordChecksumOffset + 1U] = static_cast<std::uint8_t>(crc >> 8U);
        bytes[kRecordChecksumOffset + 2U] = static_cast<std::uint8_t>(crc >> 16U);
        bytes[kRecordChecksumOffset + 3U] = static_cast<std::uint8_t>(crc >> 24U);
    };

    ChannelKeyStore loaded;

    // A count past capacity.
    auto invalid = encoded;
    invalid[5] = static_cast<std::uint8_t>(kChannelKeyCapacity + 1U);
    reseal(invalid);
    assert(loaded.decode(invalid.data(), invalid.size()) == ChannelKeyDecodeResult::Invalid);

    // A used reserved byte.
    invalid = encoded;
    invalid[6] = 1U;
    reseal(invalid);
    assert(loaded.decode(invalid.data(), invalid.size()) == ChannelKeyDecodeResult::Invalid);

    // An unterminated name field.
    invalid = encoded;
    for (std::size_t index = 0; index < kChannelKeyNameCapacity; ++index) {
        invalid[8U + index] = 'A';
    }
    reseal(invalid);
    assert(loaded.decode(invalid.data(), invalid.size()) == ChannelKeyDecodeResult::Invalid);

    // Bytes hiding past a name's terminator.
    invalid = encoded;
    invalid[8U + kChannelKeyNameCapacity - 1U] = 'X';
    reseal(invalid);
    assert(loaded.decode(invalid.data(), invalid.size()) == ChannelKeyDecodeResult::Invalid);

    // A non-printable name.
    invalid = encoded;
    invalid[8U] = 0x07U;
    reseal(invalid);
    assert(loaded.decode(invalid.data(), invalid.size()) == ChannelKeyDecodeResult::Invalid);

    // Anything in an entry past the stated count.
    invalid = encoded;
    invalid[8U + (kChannelKeyNameCapacity + kChannelKeySize)] = 'B';
    reseal(invalid);
    assert(loaded.decode(invalid.data(), invalid.size()) == ChannelKeyDecodeResult::Invalid);

    // Two entries carrying the same key material.
    ChannelKeyStore two;
    assert(two.add("FIRST", kOperatorKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);
    assert(two.add("SECOND", kOtherKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);
    std::array<std::uint8_t, kChannelKeyStoreRecordSize> duplicate{};
    assert(two.encode(duplicate.data(), duplicate.size()));
    constexpr std::size_t entry_size = kChannelKeyNameCapacity + kChannelKeySize;
    std::memcpy(duplicate.data() + 8U + entry_size + kChannelKeyNameCapacity, kOperatorKey,
                kChannelKeySize);
    reseal(duplicate);
    assert(loaded.decode(duplicate.data(), duplicate.size()) ==
           ChannelKeyDecodeResult::Invalid);
}

void testResultLabelsCoverEveryOutcome()
{
    const ChannelKeyResult results[] = {
        ChannelKeyResult::Ok,        ChannelKeyResult::InvalidName,
        ChannelKeyResult::DuplicateName, ChannelKeyResult::InvalidKey,
        ChannelKeyResult::DuplicateKey,  ChannelKeyResult::StoreFull,
        ChannelKeyResult::InvalidSlot,
    };
    for (const ChannelKeyResult result : results) {
        const char *label = channelKeyResultLabel(result);
        assert(label != nullptr && label[0] != '\0');
    }
    assert(std::strcmp(channelKeyResultLabel(static_cast<ChannelKeyResult>(0xffU)),
                       "UNKNOWN") == 0);
}

void testDefaultKeyIsTriedBeforeAnyStoredKey()
{
    std::uint8_t frame[kMaxFrameBytes]{};
    const std::size_t size = encodeMeshtasticFrame(textRequest(), frame, sizeof(frame));
    assert(size > kHeaderLength);

    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);

    MeshtasticPayload payload{};
    MeshtasticKeyState state{};
    assert(readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                         textRequest().from_node, textRequest().packet_id,
                                         &store, payload, state));
    assert(state.source == MeshtasticKeySource::DefaultKey);
    assert(std::strcmp(payload.text, "private channel traffic") == 0);

    // With no keys at all the result is identical, byte for byte.
    MeshtasticPayload keyless{};
    MeshtasticKeyState keyless_state{};
    assert(readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                         textRequest().from_node, textRequest().packet_id,
                                         nullptr, keyless, keyless_state));
    assert(keyless_state.source == MeshtasticKeySource::DefaultKey);
    assert(std::strcmp(keyless.text, payload.text) == 0);
}

void testStoredKeysAreTriedInOrderAndFailClosed()
{
    std::uint8_t frame[kMaxFrameBytes]{};
    const std::size_t size =
        encodeFrameUnderKey(textRequest(), kOperatorKey, frame, sizeof(frame));
    assert(size > kHeaderLength);

    // No keys: the payload stays opaque rather than surfacing as noise.
    MeshtasticPayload payload{};
    MeshtasticKeyState state{};
    assert(!readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                          textRequest().from_node, textRequest().packet_id,
                                          nullptr, payload, state));
    assert(state.source == MeshtasticKeySource::None);
    assert(!payload.readable);

    // A wrong key does not change that, and does not claim the frame.
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("WRONG", kWrongKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);
    assert(!readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                          textRequest().from_node, textRequest().packet_id,
                                          &store, payload, state));
    assert(state.source == MeshtasticKeySource::None);

    // The right key, listed second, wins and is named by its slot.
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    assert(slot == 1U);
    assert(readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                         textRequest().from_node, textRequest().packet_id,
                                         &store, payload, state));
    assert(state.source == MeshtasticKeySource::StoredKey);
    assert(state.slot == 1U);
    assert(std::strcmp(store.name(state.slot), "FIELD TEAM") == 0);
    assert(std::strcmp(payload.text, "private channel traffic") == 0);

    // Removing the key returns the frame to opaque immediately.
    assert(store.remove(1U) == ChannelKeyResult::Ok);
    assert(!readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                          textRequest().from_node, textRequest().packet_id,
                                          &store, payload, state));
}

void testDecoderReportsKeyStatePerFrame()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);

    MeshtasticDecoder decoder;
    assert(decoder.channelKeys() == nullptr);
    decoder.setChannelKeys(&store);
    assert(decoder.channelKeys() == &store);

    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;
    profile.modulation = Modulation::LoRa;

    RawFrame frame{};
    frame.captured_length = static_cast<std::uint16_t>(
        encodeFrameUnderKey(textRequest(), kOperatorKey, frame.bytes, sizeof(frame.bytes)));
    frame.original_length = frame.captured_length;
    assert(frame.captured_length > kHeaderLength);

    DecodedPacket decoded{};
    assert(decoder.decode(frame, profile, decoded) == DecodeResult::Matched);
    assert(decoded.hasAttribute(AttributeStoredKeyReadable));
    assert(!decoded.hasAttribute(AttributeDefaultKeyReadable));
    assert(decoded.channel_key_slot == 0U);
    assert(decoded.state == DecodeState::PayloadDecoded);

    // Without the key the same frame is header-only and opaque.
    MeshtasticDecoder keyless;
    DecodedPacket opaque{};
    assert(keyless.decode(frame, profile, opaque) == DecodeResult::Matched);
    assert(!opaque.hasAttribute(AttributeStoredKeyReadable));
    assert(!opaque.hasAttribute(AttributeDefaultKeyReadable));
    assert(opaque.kind == PacketKind::OpaquePayload);
    assert(opaque.channel_key_slot == 0U);

    // Default-key traffic keeps its own, stronger label even with keys loaded.
    RawFrame open_frame{};
    open_frame.captured_length = static_cast<std::uint16_t>(
        encodeMeshtasticFrame(textRequest(), open_frame.bytes, sizeof(open_frame.bytes)));
    open_frame.original_length = open_frame.captured_length;
    DecodedPacket open_decoded{};
    assert(decoder.decode(open_frame, profile, open_decoded) == DecodeResult::Matched);
    assert(open_decoded.hasAttribute(AttributeDefaultKeyReadable));
    assert(!open_decoded.hasAttribute(AttributeStoredKeyReadable));
}

void testCaptureRecordsCarryNoKeyMaterial()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);

    MeshtasticDecoder decoder;
    decoder.setChannelKeys(&store);
    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;
    profile.modulation = Modulation::LoRa;

    RawFrame frame{};
    frame.captured_length = static_cast<std::uint16_t>(
        encodeFrameUnderKey(textRequest(), kOperatorKey, frame.bytes, sizeof(frame.bytes)));
    frame.original_length = frame.captured_length;
    frame.rf.present_fields = RfFieldSyncWord | RfFieldPreamble;
    frame.rf.sync_word = 0x2bU;
    frame.rf.preamble_symbols = 16U;

    DecodedPacket decoded{};
    assert(decoder.decode(frame, profile, decoded) == DecodeResult::Matched);
    assert(decoded.hasAttribute(AttributeStoredKeyReadable));

    FrameRecord record{};
    record.sequence = 7U;
    record.raw = frame;
    record.decoded = decoded;

    RecordingSink sink;
    LilysharkCaptureWriter writer(sink);
    assert(writer.begin() == LilysharkCaptureWriteResult::Ok);
    assert(writer.write(record) == LilysharkCaptureWriteResult::Ok);

    // The whole point: a capture of a frame this device could read still
    // contains nothing that would let its reader read it.
    assert(!contains(sink.bytes, kOperatorKey, kChannelKeySize));
    for (std::size_t length = 4U; length <= kChannelKeySize; ++length) {
        assert(!contains(sink.bytes, kOperatorKey, length));
    }
    // The key's name is not in the file either — a capture names no channel
    // the operator configured privately.
    const char *name = "FIELD TEAM";
    assert(!contains(sink.bytes, reinterpret_cast<const std::uint8_t *>(name),
                     std::strlen(name)));

    // And the ciphertext is still ciphertext: the writer stored the frame as
    // received, not the plaintext the decoder recovered.
    const char *text = "private channel traffic";
    assert(!contains(sink.bytes, reinterpret_cast<const std::uint8_t *>(text),
                     std::strlen(text)));
    assert(contains(sink.bytes, frame.bytes, frame.captured_length));
}

void testRegisteredDecoderUsesTheKeyStore()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);

    MeshtasticDecoder decoder;
    decoder.setChannelKeys(&store);
    DecoderRegistry registry;
    assert(registry.add(decoder));

    RadioProfile profile{};
    profile.protocol_hint = ProtocolId::Meshtastic;
    profile.modulation = Modulation::LoRa;

    RawFrame frame{};
    frame.captured_length = static_cast<std::uint16_t>(
        encodeFrameUnderKey(textRequest(), kOperatorKey, frame.bytes, sizeof(frame.bytes)));
    frame.original_length = frame.captured_length;

    DecodedPacket decoded{};
    assert(registry.decode(frame, profile, decoded) == DecodeResult::Matched);
    assert(decoded.hasAttribute(AttributeStoredKeyReadable));
    assert(decoded.channel_key_slot == 0U);

    // Clearing the store — what setup reset does — takes the capability away
    // without touching the decoder or the registry.
    store.clear();
    DecodedPacket after{};
    assert(registry.decode(frame, profile, after) == DecodeResult::Matched);
    assert(!after.hasAttribute(AttributeStoredKeyReadable));
    assert(after.kind == PacketKind::OpaquePayload);
}

} // namespace

int main()
{
    testNameValidationRefusesWhatCannotBeShown();
    testAddRenameRemoveReportExplicitResults();
    testStoreFillsAndRefusesOverflow();
    testFingerprintsIdentifyKeysWithoutRevealingThem();
    testRecordRoundTripsAndRefusesEveryCorruption();
    testWellChecksummedButMalformedRecordsAreRefused();
    testResultLabelsCoverEveryOutcome();
    testDefaultKeyIsTriedBeforeAnyStoredKey();
    testStoredKeysAreTriedInOrderAndFailClosed();
    testDecoderReportsKeyStatePerFrame();
    testCaptureRecordsCarryNoKeyMaterial();
    testRegisteredDecoderUsesTheKeyStore();
    std::puts("channel key tests passed");
    return 0;
}
