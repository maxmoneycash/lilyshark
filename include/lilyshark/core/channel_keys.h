#pragma once

// On-device channel keys, and the security design that governs them.
//
// The prose version of everything below, written for an operator rather than
// a compiler, is docs/channel-key-security.md.
//
// ── What this is ────────────────────────────────────────────────────────────
// A fixed-size table of named AES-128 channel keys an operator types on the
// device, so the payload reader can open traffic on channels they are entitled
// to read. It is deliberately separate from `AppSettings`: preferences are
// written on every brightness nudge and are printed to the serial log during
// diagnostics, and key material must not ride along with either.
//
// ── Where the keys live ─────────────────────────────────────────────────────
// One NVS record ("keys") in the same `Preferences` namespace as the other
// preferences, holding the blob this header encodes: magic, schema version,
// entry count, the entries, and a trailing CRC-32 over everything before it —
// the same checksum-and-refuse discipline every other preference record uses
// (`settingsCrc32`, include/lilyshark/core/settings_checksum.h). A record that
// fails any check decodes to Invalid and leaves the caller's store untouched,
// so a torn write costs the operator their key list and never a wrong key.
//
// ── What the storage does NOT give you ──────────────────────────────────────
// This target has no secure storage available to this firmware. The T-Deck's
// ESP32-S3 does support flash encryption and NVS encryption, but both require
// burning eFuses and an `nvs_keys` partition, and this build does neither: it
// ships the stock `default_16MB.csv` partition table with an unencrypted `nvs`
// partition and no secure-boot or flash-encryption configuration. So:
//
//   Channel keys are stored in PLAINTEXT in the device's flash.
//
// Anyone who can attach a USB cable and run `esptool.py read_flash` can
// recover every stored key, as can anyone who desolders the flash. There is no
// passphrase, no key-derivation step, and no tamper response. Saying otherwise
// would be worse than storing nothing at all, because an operator would then
// trust the device with keys they should not.
//
// The threat model this store actually addresses is therefore narrow, and it
// is the honest one:
//
//   * IN SCOPE: keys do not leave the device through any output the firmware
//     produces — not `.lscap`, not PCAP, not BMP screenshots, not the serial
//     log, not the Shelby pointer. A capture handed to a colleague, or a
//     screenshot posted in a chat, carries no key material.
//   * IN SCOPE: a corrupted or truncated key record is refused rather than
//     half-applied, so the reader never runs on a key nobody entered.
//   * OUT OF SCOPE: an attacker with physical possession of the device, or
//     with a serial console on it. They get the keys. Treat a lost Lilyshark
//     as a disclosed key list and rotate the channel.
//
// ── Why keys cannot reach a capture, a screenshot, or the serial log ────────
// The exclusion is structural rather than a filter, because a filter is a
// thing somebody forgets to update:
//
//   * `.lscap` and PCAP records are serialised from `RawFrame` alone
//     (src/export/lilyshark_capture.cpp, src/export/pcap_loratap.cpp).
//     `RawFrame` has no key field and gains none.
//   * The one thing a successful decode reports about the key that opened it
//     is a `MeshtasticKeyState` — a source enum and a slot index, never bytes
//     (include/lilyshark/protocols/meshtastic_payload.h). Everything
//     downstream can therefore only ever learn that a key matched, not what it
//     was.
//   * A BMP screenshot is a dump of the framebuffer
//     (src/device/screenshot.cpp), so anything drawn on screen is in the file.
//     Key bytes are therefore never drawn: entry is masked, and the key list
//     shows a name and the `ChannelKeyStore::fingerprint()` digest below.
//     There is no UI path that renders a key, so there is nothing for a
//     screenshot to capture.
//   * `ChannelKeyProvider::channelKeyBytes()` is the one accessor that returns
//     key material, and its only caller is the Meshtastic payload reader. The
//     name is deliberately greppable so that stays checkable.
//
// ── Fingerprints ────────────────────────────────────────────────────────────
// `fingerprint()` is the first three bytes of SHA-256 over a domain-separation
// string and the key. It is one-way and far too short to invert usefully — it
// lets an operator tell two keys apart and confirm the one they typed, without
// putting key material on the screen.

#include "lilyshark/core/channel_key_provider.h"
#include "lilyshark/core/channel_key_result.h"

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Keys the device holds at once. Eight is more channels than a handheld
/// analyzer is realistically watching, and the table is a fixed member so the
/// store never allocates.
inline constexpr std::size_t kChannelKeyCapacity = 8U;

/// Name buffer, terminator included. Names are printable ASCII, which is what
/// the device font can render and what a screenshot can honestly show.
inline constexpr std::size_t kChannelKeyNameCapacity = 16U;

/// AES-128 only. The firmware's cipher is AES-128
/// (`crypto::kAes128KeySize`); Meshtastic also allows 256-bit channel PSKs,
/// and the browser dissector accepts them, but this build cannot decrypt one
/// and so refuses to store one rather than keeping a key it will never use.
inline constexpr std::size_t kChannelKeySize = 16U;

/// Bytes in the encoded record: header, eight entries, trailing CRC-32.
inline constexpr std::size_t kChannelKeyStoreRecordSize = 268U;

inline constexpr std::uint8_t kChannelKeyStoreSchemaVersion = 1U;

/// Hex digits in a rendered fingerprint, terminator excluded.
inline constexpr std::size_t kChannelKeyFingerprintDigits = 6U;

class ChannelKeyStore final : public ChannelKeyProvider
{
  public:
    [[nodiscard]] std::size_t size() const noexcept { return size_; }
    [[nodiscard]] constexpr std::size_t capacity() const noexcept
    {
        return kChannelKeyCapacity;
    }
    [[nodiscard]] bool empty() const noexcept { return size_ == 0U; }
    [[nodiscard]] bool full() const noexcept { return size_ == kChannelKeyCapacity; }

    /// Adds a key at the end of the list. `key_size` must be exactly
    /// `kChannelKeySize`. Names must be unique, non-empty printable ASCII, and
    /// short enough to fit; duplicate key material is refused too, so the same
    /// secret cannot be stored twice under two names and tried twice in the
    /// decode order. `slot` receives the new index on success.
    [[nodiscard]] ChannelKeyResult add(const char *name, const std::uint8_t *key,
                                       std::size_t key_size, std::size_t &slot) noexcept;

    /// Renames an existing key. The key material is untouched.
    [[nodiscard]] ChannelKeyResult rename(std::size_t slot, const char *name) noexcept;

    /// Removes a key, zeroing its bytes and closing the gap so the remaining
    /// keys keep their relative decode order.
    [[nodiscard]] ChannelKeyResult remove(std::size_t slot) noexcept;

    /// Zeroes every entry. Used by setup reset, and by any load that refuses a
    /// stored record.
    void clear() noexcept;

    /// The key's name, or nullptr when the slot is empty. Safe to render.
    [[nodiscard]] const char *name(std::size_t slot) const noexcept;

    /// Writes a six hex digit, one-way fingerprint of the key into `out`,
    /// which must hold `kChannelKeyFingerprintDigits + 1` bytes. Safe to
    /// render and safe to put in a screenshot. False for an empty slot or a
    /// destination that is too small.
    [[nodiscard]] bool fingerprint(std::size_t slot, char *out,
                                   std::size_t capacity) const noexcept;

    /// ChannelKeyProvider. The payload reader sees the store through these two
    /// calls and nothing else; `channelKeyBytes` is the single egress for key
    /// material.
    [[nodiscard]] std::size_t channelKeyCount() const noexcept override
    {
        return size_;
    }
    [[nodiscard]] const std::uint8_t *channelKeyBytes(std::size_t index) const noexcept override;

    /// Encodes the whole store, checksum included. `bytes` is untouched unless
    /// the call succeeds.
    [[nodiscard]] bool encode(std::uint8_t *bytes, std::size_t size) const noexcept;

    /// Replaces the store's contents with a stored record. The store is left
    /// exactly as it was on any failure — magic, version, count, name shape,
    /// reserved bytes, and CRC-32 must all check out.
    [[nodiscard]] ChannelKeyDecodeResult decode(const std::uint8_t *bytes,
                                                std::size_t size) noexcept;

  private:
    struct Entry {
        char name[kChannelKeyNameCapacity]{};
        std::uint8_t key[kChannelKeySize]{};
    };

    Entry entries_[kChannelKeyCapacity]{};
    std::size_t size_ = 0U;
};

/// True when the name is storable: non-empty, printable ASCII without leading
/// or trailing spaces, and short enough to fit with its terminator.
[[nodiscard]] bool isValidChannelKeyName(const char *name) noexcept;

/// Reads `kChannelKeySize * 2` hex digits into `key`. Case-insensitive, and
/// nothing but hex digits is accepted — a key typed with a stray space or a
/// truncated key is refused rather than padded, because a key that is nearly
/// right decrypts nothing and looks like a broken radio.
[[nodiscard]] bool parseChannelKeyHex(const char *hex, std::uint8_t *key,
                                      std::size_t key_size) noexcept;

} // namespace lilyshark
