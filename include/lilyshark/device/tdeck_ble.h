#pragma once

/// The Meshtastic client BLE service, so a phone app can talk to this deck.
///
/// Meshtastic phone apps speak one GATT service with three characteristics:
/// the phone writes protobufs to ToRadio, reads them back from FromRadio, and
/// subscribes to FromNum to be told when something is waiting. Presenting
/// exactly that service is what makes the official app -- and anything else
/// built against it -- able to see a Lilyshark deck at all.
///
/// This is the transport only. What travels over it is Meshtastic's protobuf
/// API, which is built up separately; a phone that connects before that exists
/// will pair and find nothing to read, which is the honest intermediate state.

#include <cstddef>
#include <cstdint>

namespace lilyshark {

/// Meshtastic's published client API UUIDs. A phone scans for the service and
/// will not recognise a device that advertises anything else.
inline constexpr char kMeshtasticBleService[] = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";
inline constexpr char kMeshtasticBleFromRadio[] = "2c55e69e-4993-11ed-b878-0242ac120002";
inline constexpr char kMeshtasticBleToRadio[] = "f75c76d2-129e-4dad-a1dd-7866124401e7";
inline constexpr char kMeshtasticBleFromNum[] = "ed9da18c-a800-4f66-a670-aa7547e34453";

struct BleStatus {
    bool started = false;
    bool connected = false;
    /// Protobufs the phone has written to ToRadio since boot.
    std::uint32_t writes = 0;
    /// Protobufs handed to the phone through FromRadio.
    std::uint32_t reads = 0;
};

/// Bring up the peripheral and start advertising under `name`. Safe to call
/// once; returns false when the stack could not start, which leaves the radio
/// and the rest of the device untouched.
bool startTDeckBle(const char *name) noexcept;

/// Queue one protobuf for the phone to collect from FromRadio, and raise the
/// FromNum notification that tells it to look. Returns false when the queue is
/// full -- a phone that has stopped reading must not be allowed to consume
/// memory the radio needs.
bool queueBleFromRadio(const std::uint8_t *bytes, std::size_t length) noexcept;

/// Take the next protobuf the phone wrote to ToRadio, if any. Returns the
/// length written into `out`, or 0 when nothing is waiting.
std::size_t takeBleToRadio(std::uint8_t *out, std::size_t capacity) noexcept;

const BleStatus &tdeckBleStatus() noexcept;

}  // namespace lilyshark
