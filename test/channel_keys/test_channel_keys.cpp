// On-device channel keys: the store, the keyed decode order, and the promise
// that key material never reaches an output file.
//
// The security design these tests hold to the wall lives in
// include/lilyshark/core/channel_keys.h and docs/channel-key-security.md.

#include "lilyshark/core/channel_keys.h"
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

void testHexEntryAcceptsOnlyAWholeKey()
{
    std::uint8_t key[kChannelKeySize]{};
    assert(parseChannelKeyHex("0123456789abcdeffedcba9876543210", key, sizeof(key)));
    assert(std::memcmp(key, kOperatorKey, sizeof(key)) == 0);

    // Case does not matter; a typed key is read off a card either way.
    std::uint8_t upper[kChannelKeySize]{};
    assert(parseChannelKeyHex("0123456789ABCDEFFEDCBA9876543210", upper, sizeof(upper)));
    assert(std::memcmp(upper, kOperatorKey, sizeof(upper)) == 0);

    // Short, long, non-hex, spaced, and null inputs are all refused rather
    // than silently padded into a key that decrypts nothing.
    assert(!parseChannelKeyHex("0123456789abcdeffedcba98765432", key, sizeof(key)));
    assert(!parseChannelKeyHex("0123456789abcdeffedcba98765432100", key, sizeof(key)));
    assert(!parseChannelKeyHex("0123456789abcdeffedcba987654321g", key, sizeof(key)));
    assert(!parseChannelKeyHex("0123456789abcdef fedcba987654321", key, sizeof(key)));
    assert(!parseChannelKeyHex("", key, sizeof(key)));
    assert(!parseChannelKeyHex(nullptr, key, sizeof(key)));
    assert(!parseChannelKeyHex("0123456789abcdeffedcba9876543210", nullptr, sizeof(key)));
    assert(!parseChannelKeyHex("0123456789abcdeffedcba9876543210", key, sizeof(key) - 1U));
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

    // A rename to a shorter name must not leave the old tail behind, because
    // the whole name field is what the stored record carries.
    assert(store.rename(1U, "AB") == ChannelKeyResult::Ok);
    assert(std::strcmp(store.name(1U), "AB") == 0);
    assert(store.name(1U)[2] == '\0' && store.name(1U)[3] == '\0');
    assert(store.rename(1U, "RENAMED") == ChannelKeyResult::Ok);

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

    // An empty store round-trips too; that is what a deck with no keys saves.
    ChannelKeyStore empty;
    std::array<std::uint8_t, kChannelKeyStoreRecordSize> blank{};
    assert(empty.encode(blank.data(), blank.size()));
    assert(loaded.decode(blank.data(), blank.size()) == ChannelKeyDecodeResult::LoadedV1);
    assert(loaded.empty());
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
        ChannelKeyResult::Ok,            ChannelKeyResult::InvalidName,
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

    // And identical to what the unkeyed entry point still returns, which is
    // the promise that adding keys changed nothing for existing callers.
    MeshtasticPayload legacy{};
    assert(readMeshtasticPayload(frame + kHeaderLength, size - kHeaderLength,
                                 textRequest().from_node, textRequest().packet_id, legacy));
    assert(legacy.readable == payload.readable);
    assert(legacy.portnum == payload.portnum);
    assert(std::strcmp(legacy.text, payload.text) == 0);
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

    // Clearing the store -- what setup reset does -- takes the capability away
    // without touching anything else.
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    assert(readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                         textRequest().from_node, textRequest().packet_id,
                                         &store, payload, state));
    store.clear();
    assert(!readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                          textRequest().from_node, textRequest().packet_id,
                                          &store, payload, state));
}

/// The port and the parsed fields must be the same whichever key opened the
/// frame -- one strict parser, not a laxer second definition of a message for
/// keyed traffic.
void testAStoredKeyYieldsTheSameParseAsTheDefaultKey()
{
    MeshtasticEncodeRequest request{};
    request.from_node = 0x0badf00dU;
    request.packet_id = 0x00c0ffeeU;
    request.port = MeshtasticPort::Position;
    request.latitude_degrees = 37.8044;
    request.longitude_degrees = -122.2712;

    std::uint8_t open_frame[kMaxFrameBytes]{};
    const std::size_t open_size =
        encodeMeshtasticFrame(request, open_frame, sizeof(open_frame));
    assert(open_size > kHeaderLength);
    MeshtasticPayload open_payload{};
    MeshtasticKeyState open_state{};
    assert(readMeshtasticPayloadWithKeys(open_frame + kHeaderLength,
                                         open_size - kHeaderLength, request.from_node,
                                         request.packet_id, nullptr, open_payload,
                                         open_state));
    assert(open_state.source == MeshtasticKeySource::DefaultKey);
    assert(open_payload.has_position);

    std::uint8_t keyed_frame[kMaxFrameBytes]{};
    const std::size_t keyed_size =
        encodeFrameUnderKey(request, kOperatorKey, keyed_frame, sizeof(keyed_frame));
    assert(keyed_size == open_size);
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    MeshtasticPayload keyed_payload{};
    MeshtasticKeyState keyed_state{};
    assert(readMeshtasticPayloadWithKeys(keyed_frame + kHeaderLength,
                                         keyed_size - kHeaderLength, request.from_node,
                                         request.packet_id, &store, keyed_payload,
                                         keyed_state));
    assert(keyed_state.source == MeshtasticKeySource::StoredKey);
    assert(keyed_state.slot == 0U);
    assert(keyed_payload.portnum == open_payload.portnum);
    assert(keyed_payload.has_position == open_payload.has_position);
    assert(keyed_payload.latitude_degrees == open_payload.latitude_degrees);
    assert(keyed_payload.longitude_degrees == open_payload.longitude_degrees);
}

void testCaptureRecordsCarryNoKeyMaterial()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);

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
    assert(frame.captured_length > kHeaderLength);

    MeshtasticDecoder decoder;
    DecodedPacket decoded{};
    assert(decoder.decode(frame, profile, decoded) == DecodeResult::Matched);

    // The stored key opens this payload, which is what makes the capture
    // assertions below worth making: the device really could read it.
    MeshtasticPayload payload{};
    MeshtasticKeyState state{};
    assert(readMeshtasticPayloadWithKeys(&frame.bytes[decoded.payload_offset],
                                         decoded.payload_length, decoded.source,
                                         decoded.packet_id, &store, payload, state));
    assert(state.source == MeshtasticKeySource::StoredKey);
    assert(std::strcmp(payload.text, "private channel traffic") == 0);

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
    // The key's name is not in the file either -- a capture names no channel
    // the operator configured privately.
    const char *name = "FIELD TEAM";
    assert(!contains(sink.bytes, reinterpret_cast<const std::uint8_t *>(name),
                     std::strlen(name)));

    // And the ciphertext is still ciphertext: the writer stored the frame as
    // received, not the plaintext the reader recovered.
    const char *text = "private channel traffic";
    assert(!contains(sink.bytes, reinterpret_cast<const std::uint8_t *>(text),
                     std::strlen(text)));
    assert(contains(sink.bytes, frame.bytes, frame.captured_length));
}

// ── Transmitting on a channel the store holds the key for ───────────────────

/// A frame the deck itself would put on the air for a stored key: sealed with
/// the key, and stamped with the header hash of that key's name and bytes.
/// Unlike `encodeFrameUnderKey` above -- which models a frame from a radio
/// whose channel name this deck does not know -- this is the whole encoder,
/// doing what the Chat screen asks of it.
std::size_t encodeFrameForStoredKey(MeshtasticEncodeRequest request,
                                    const ChannelKeyStore &store, std::size_t slot,
                                    std::uint8_t *out, std::size_t out_size) noexcept
{
    request.channel_name = store.name(slot);
    request.channel_key = store.channelKeyBytes(slot);
    if (request.channel_name == nullptr || request.channel_key == nullptr) return 0U;
    return encodeMeshtasticFrame(request, out, out_size);
}

void testAKeyedTransmissionCannotBeOpenedWithTheDefaultKey()
{
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("NORTH RIDGE", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);

    std::uint8_t frame[kMaxFrameBytes]{};
    const std::size_t size =
        encodeFrameForStoredKey(textRequest(), store, slot, frame, sizeof(frame));
    assert(size > kHeaderLength);

    // The header names the channel, by the same XOR of name and key that every
    // radio on it computes. Not the default channel's byte.
    assert(frame[13] == meshtasticChannelHash("NORTH RIDGE", kOperatorKey, kChannelKeySize));
    assert(frame[13] != meshtasticChannelHash(kMeshtasticDefaultChannelName,
                                              kMeshtasticDefaultPsk,
                                              sizeof(kMeshtasticDefaultPsk)));

    // Nobody holding only the published key can read it, through either entry
    // point. This is what "the deck can now answer privately" has to mean.
    MeshtasticPayload leaked{};
    assert(!readMeshtasticPayload(frame + kHeaderLength, size - kHeaderLength,
                                  textRequest().from_node, textRequest().packet_id, leaked));
    assert(!leaked.readable);
    MeshtasticKeyState leaked_state{};
    assert(!readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                          textRequest().from_node, textRequest().packet_id,
                                          nullptr, leaked, leaked_state));
    assert(leaked_state.source == MeshtasticKeySource::None);

    // A deck that holds the key reads it, and knows which key did it.
    MeshtasticPayload opened{};
    MeshtasticKeyState state{};
    assert(readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                         textRequest().from_node, textRequest().packet_id,
                                         &store, opened, state));
    assert(state.source == MeshtasticKeySource::StoredKey);
    assert(state.slot == slot);
    assert(std::strcmp(opened.text, "private channel traffic") == 0);

    // A deck holding a different key does not, and does not claim to.
    ChannelKeyStore stranger;
    std::size_t stranger_slot = 0;
    assert(stranger.add("OTHER CHANNEL", kWrongKey, kChannelKeySize, stranger_slot) ==
           ChannelKeyResult::Ok);
    MeshtasticPayload refused{};
    MeshtasticKeyState refused_state{};
    assert(!readMeshtasticPayloadWithKeys(frame + kHeaderLength, size - kHeaderLength,
                                          textRequest().from_node, textRequest().packet_id,
                                          &stranger, refused, refused_state));
    assert(refused_state.source == MeshtasticKeySource::None);
}

void testADefaultKeyTransmissionIsUntouchedByTheKeyStore()
{
    // The other half of the same promise. Sending on the public channel must
    // produce exactly the bytes it always did, whether the deck holds stored
    // keys or none, and must still read back as public traffic -- the claim
    // that carries "this was never private".
    std::uint8_t without_keys[kMaxFrameBytes]{};
    const std::size_t size =
        encodeMeshtasticFrame(textRequest(), without_keys, sizeof(without_keys));
    assert(size > kHeaderLength);
    assert(without_keys[13] == meshtasticChannelHash(kMeshtasticDefaultChannelName,
                                                     kMeshtasticDefaultPsk,
                                                     sizeof(kMeshtasticDefaultPsk)));

    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("NORTH RIDGE", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    assert(store.add("RIVER", kOtherKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);

    std::uint8_t with_keys[kMaxFrameBytes]{};
    const std::size_t again =
        encodeMeshtasticFrame(textRequest(), with_keys, sizeof(with_keys));
    assert(again == size);
    assert(std::memcmp(without_keys, with_keys, size) == 0);

    MeshtasticPayload payload{};
    MeshtasticKeyState state{};
    assert(readMeshtasticPayloadWithKeys(with_keys + kHeaderLength, size - kHeaderLength,
                                         textRequest().from_node, textRequest().packet_id,
                                         &store, payload, state));
    assert(state.source == MeshtasticKeySource::DefaultKey);
    assert(std::strcmp(payload.text, "private channel traffic") == 0);
}

void testAKeyedAcknowledgementAddressesTheChannelItAnswers()
{
    // The rule the ingest path enforces, stated as arithmetic: an
    // acknowledgement may go out on a keyed channel only when the header byte
    // this deck would stamp equals the header byte the frame it answers
    // arrived carrying. Anything else is a frame that announces a keyholder
    // and reaches nobody.
    ChannelKeyStore store;
    std::size_t slot = 0;
    assert(store.add("NORTH RIDGE", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);

    MeshtasticEncodeRequest incoming = textRequest();
    incoming.from_node = 0x336a1b2cU;
    incoming.to_node = 0x4c534b01U;
    incoming.packet_id = 0x51a00002U;
    incoming.want_ack = true;
    std::uint8_t heard[kMaxFrameBytes]{};
    const std::size_t heard_size =
        encodeFrameForStoredKey(incoming, store, slot, heard, sizeof(heard));
    assert(heard_size > kHeaderLength);

    MeshtasticPayload payload{};
    MeshtasticKeyState state{};
    assert(readMeshtasticPayloadWithKeys(heard + kHeaderLength, heard_size - kHeaderLength,
                                         incoming.from_node, incoming.packet_id, &store,
                                         payload, state));
    assert(state.source == MeshtasticKeySource::StoredKey);

    // What the deck computes from the key that opened the frame, and what the
    // frame actually carried. Equal, so the answer may be sent.
    const std::uint8_t computed = meshtasticChannelHash(store.name(state.slot),
                                                        store.channelKeyBytes(state.slot),
                                                        kChannelKeySize);
    assert(computed == heard[13]);

    MeshtasticEncodeRequest ack{};
    ack.from_node = incoming.to_node;
    ack.to_node = incoming.from_node;
    ack.packet_id = 0x51a00003U;
    ack.port = MeshtasticPort::Routing;
    ack.request_id = incoming.packet_id;
    std::uint8_t answer[kMaxFrameBytes]{};
    const std::size_t answer_size =
        encodeFrameForStoredKey(ack, store, state.slot, answer, sizeof(answer));
    assert(answer_size > kHeaderLength);

    // The acknowledgement is addressed to the same channel, byte for byte.
    assert(answer[13] == heard[13]);
    // And it says nothing in the clear: the id it confirms is inside the
    // ciphertext, where only the channel can read it.
    MeshtasticPayload leaked{};
    assert(!readMeshtasticPayload(answer + kHeaderLength, answer_size - kHeaderLength,
                                  ack.from_node, ack.packet_id, leaked));
    MeshtasticPayload confirmed{};
    MeshtasticKeyState confirmed_state{};
    assert(readMeshtasticPayloadWithKeys(answer + kHeaderLength, answer_size - kHeaderLength,
                                         ack.from_node, ack.packet_id, &store, confirmed,
                                         confirmed_state));
    assert(confirmed_state.source == MeshtasticKeySource::StoredKey);
    assert(confirmed.portnum == static_cast<std::uint16_t>(MeshtasticPort::Routing));
    assert(confirmed.has_request_id);
    assert(confirmed.request_id == incoming.packet_id);

    // A key named anything but the channel's own name fails that comparison,
    // which is exactly the case where the deck stays silent. The name is the
    // half of the hash the operator supplies, and getting it wrong costs
    // delivery rather than secrecy.
    ChannelKeyStore misnamed;
    std::size_t misnamed_slot = 0;
    assert(misnamed.add("RIDGE TEAM", kOperatorKey, kChannelKeySize, misnamed_slot) ==
           ChannelKeyResult::Ok);
    assert(meshtasticChannelHash(misnamed.name(misnamed_slot),
                                 misnamed.channelKeyBytes(misnamed_slot),
                                 kChannelKeySize) != heard[13]);
    // It still reads the channel perfectly -- only sending is affected.
    MeshtasticPayload readable{};
    MeshtasticKeyState readable_state{};
    assert(readMeshtasticPayloadWithKeys(heard + kHeaderLength, heard_size - kHeaderLength,
                                         incoming.from_node, incoming.packet_id, &misnamed,
                                         readable, readable_state));
    assert(readable_state.source == MeshtasticKeySource::StoredKey);
}

void testEveryMutationIsVisibleAsARevision()
{
    // Anything derived from the key list compares this instead of rebuilding
    // itself on every redraw, so a mutation that did not bump it would leave a
    // chat thread sealing with a key nobody chose.
    ChannelKeyStore store;
    const std::uint32_t empty = store.revision();

    std::size_t slot = 0;
    assert(store.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    const std::uint32_t added = store.revision();
    assert(added != empty);

    // A refused mutation changes nothing, so it must not look like a change.
    assert(store.add("FIELD TEAM", kOtherKey, kChannelKeySize, slot) ==
           ChannelKeyResult::DuplicateName);
    assert(store.revision() == added);
    assert(store.rename(9U, "NOPE") == ChannelKeyResult::InvalidSlot);
    assert(store.revision() == added);
    assert(store.remove(9U) == ChannelKeyResult::InvalidSlot);
    assert(store.revision() == added);

    assert(store.rename(0U, "RIDGE") == ChannelKeyResult::Ok);
    const std::uint32_t renamed = store.revision();
    assert(renamed != added);

    // The case a count comparison cannot see: one key out, a different key in
    // under the same name. The list is the same length and the same name, and
    // everything sealed with it from here on is sealed with other bytes.
    assert(store.remove(0U) == ChannelKeyResult::Ok);
    assert(store.add("RIDGE", kOtherKey, kChannelKeySize, slot) == ChannelKeyResult::Ok);
    assert(store.size() == 1U);
    assert(std::strcmp(store.name(0U), "RIDGE") == 0);
    assert(store.revision() != renamed);

    // clear() counts too, and never rewinds: a wiped store must not be
    // mistaken for the store a caller last looked at.
    const std::uint32_t before_clear = store.revision();
    store.clear();
    assert(store.revision() != before_clear);
    assert(store.revision() != empty);

    std::array<std::uint8_t, kChannelKeyStoreRecordSize> encoded{};
    ChannelKeyStore source;
    assert(source.add("FIELD TEAM", kOperatorKey, kChannelKeySize, slot) ==
           ChannelKeyResult::Ok);
    assert(source.encode(encoded.data(), encoded.size()));
    const std::uint32_t before_load = store.revision();
    assert(store.decode(encoded.data(), encoded.size()) == ChannelKeyDecodeResult::LoadedV1);
    assert(store.revision() != before_load);
}

} // namespace

int main()
{
    testNameValidationRefusesWhatCannotBeShown();
    testHexEntryAcceptsOnlyAWholeKey();
    testAddRenameRemoveReportExplicitResults();
    testStoreFillsAndRefusesOverflow();
    testFingerprintsIdentifyKeysWithoutRevealingThem();
    testRecordRoundTripsAndRefusesEveryCorruption();
    testWellChecksummedButMalformedRecordsAreRefused();
    testResultLabelsCoverEveryOutcome();
    testDefaultKeyIsTriedBeforeAnyStoredKey();
    testStoredKeysAreTriedInOrderAndFailClosed();
    testAStoredKeyYieldsTheSameParseAsTheDefaultKey();
    testCaptureRecordsCarryNoKeyMaterial();
    testAKeyedTransmissionCannotBeOpenedWithTheDefaultKey();
    testADefaultKeyTransmissionIsUntouchedByTheKeyStore();
    testAKeyedAcknowledgementAddressesTheChannelItAnswers();
    testEveryMutationIsVisibleAsARevision();
    std::puts("channel key tests passed");
    return 0;
}
