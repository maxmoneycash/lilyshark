#include "lilyshark/device/tdeck_ble.h"

#if defined(ESP_PLATFORM)

#include <BLE2902.h>
#include <BLECharacteristic.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#include <cstring>

#include <freertos/FreeRTOS.h>

namespace lilyshark {
namespace {

/// Meshtastic's largest protobuf over this transport comfortably fits; a phone
/// that sends more than this is not speaking the API.
constexpr std::size_t kMaxMessage = 512;
/// Depth of each direction. Small on purpose: a phone that connects and stops
/// reading must not grow a queue at the radio's expense.
constexpr std::size_t kQueueDepth = 8;

struct Message {
    std::uint8_t bytes[kMaxMessage]{};
    std::size_t length = 0;
};

struct Queue {
    Message slots[kQueueDepth]{};
    std::size_t head = 0;
    std::size_t count = 0;

    bool push(const std::uint8_t *data, std::size_t length) noexcept
    {
        if (length == 0 || length > kMaxMessage || count == kQueueDepth) return false;
        Message &slot = slots[(head + count) % kQueueDepth];
        std::memcpy(slot.bytes, data, length);
        slot.length = length;
        ++count;
        return true;
    }

    std::size_t pop(std::uint8_t *out, std::size_t capacity) noexcept
    {
        if (count == 0) return 0;
        const Message &slot = slots[head];
        const std::size_t length = slot.length > capacity ? 0 : slot.length;
        if (length != 0) std::memcpy(out, slot.bytes, length);
        head = (head + 1) % kQueueDepth;
        --count;
        return length;
    }
};

BleStatus status{};
Queue to_phone{};
Queue from_phone{};
// Each queue is written on one task and read on another -- the BLE host task
// on its side, the main loop on ours -- so every touch happens inside this
// lock. It was originally bare, which was survivable only while nothing ever
// wrote to ToRadio.
portMUX_TYPE queue_lock = portMUX_INITIALIZER_UNLOCKED;
BLECharacteristic *from_radio = nullptr;
BLECharacteristic *from_num = nullptr;
std::uint32_t from_num_value = 0;

class ServerEvents final : public BLEServerCallbacks {
    void onConnect(BLEServer *) override { status.connected = true; }
    void onDisconnect(BLEServer *server) override
    {
        status.connected = false;
        // Without this a deck is invisible after the first phone walks away.
        server->startAdvertising();
    }
};

/// The phone writes one protobuf per write. Queued rather than handled here:
/// this runs on the BLE stack's task, and the mesh state it will touch belongs
/// to the main loop.
class ToRadioEvents final : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *characteristic) override
    {
        const std::string value = characteristic->getValue();
        if (value.empty()) return;
        portENTER_CRITICAL(&queue_lock);
        const bool queued =
            from_phone.push(reinterpret_cast<const std::uint8_t *>(value.data()),
                            value.size());
        portEXIT_CRITICAL(&queue_lock);
        if (queued) ++status.writes;
    }
};

/// A read hands over the next queued protobuf, or nothing when the queue is
/// empty. Meshtastic clients drain FromRadio by reading until they get an
/// empty response, so empty is a valid and expected answer.
class FromRadioEvents final : public BLECharacteristicCallbacks {
    void onRead(BLECharacteristic *characteristic) override
    {
        std::uint8_t buffer[kMaxMessage]{};
        portENTER_CRITICAL(&queue_lock);
        const std::size_t length = to_phone.pop(buffer, sizeof(buffer));
        portEXIT_CRITICAL(&queue_lock);
        if (length == 0) {
            characteristic->setValue(static_cast<std::uint8_t *>(nullptr), 0);
            return;
        }
        characteristic->setValue(buffer, length);
        ++status.reads;
    }
};

ServerEvents server_events{};
ToRadioEvents to_radio_events{};
FromRadioEvents from_radio_events{};

}  // namespace

bool startTDeckBle(const char *name) noexcept
{
    if (status.started) return true;
    BLEDevice::init(name != nullptr ? name : "Lilyshark");
    BLEServer *server = BLEDevice::createServer();
    if (server == nullptr) return false;
    server->setCallbacks(&server_events);

    BLEService *service = server->createService(kMeshtasticBleService);
    if (service == nullptr) return false;

    from_radio = service->createCharacteristic(kMeshtasticBleFromRadio,
                                               BLECharacteristic::PROPERTY_READ);
    BLECharacteristic *to_radio = service->createCharacteristic(
        kMeshtasticBleToRadio, BLECharacteristic::PROPERTY_WRITE);
    from_num = service->createCharacteristic(
        kMeshtasticBleFromNum, BLECharacteristic::PROPERTY_READ |
                                   BLECharacteristic::PROPERTY_NOTIFY |
                                   BLECharacteristic::PROPERTY_WRITE);
    if (from_radio == nullptr || to_radio == nullptr || from_num == nullptr) return false;

    from_radio->setCallbacks(&from_radio_events);
    to_radio->setCallbacks(&to_radio_events);
    from_num->addDescriptor(new BLE2902());
    from_num->setValue(reinterpret_cast<std::uint8_t *>(&from_num_value),
                       sizeof(from_num_value));

    service->start();
    BLEAdvertising *advertising = BLEDevice::getAdvertising();
    // The phone scans for the service UUID; advertising without it makes the
    // deck a nameless peripheral no Meshtastic client will offer to connect to.
    advertising->addServiceUUID(kMeshtasticBleService);
    advertising->setScanResponse(true);
    BLEDevice::startAdvertising();

    status.started = true;
    return true;
}

bool queueBleFromRadio(const std::uint8_t *bytes, std::size_t length) noexcept
{
    if (!status.started || bytes == nullptr) return false;
    portENTER_CRITICAL(&queue_lock);
    const bool queued = to_phone.push(bytes, length);
    portEXIT_CRITICAL(&queue_lock);
    if (!queued) return false;
    if (from_num != nullptr && status.connected) {
        ++from_num_value;
        from_num->setValue(reinterpret_cast<std::uint8_t *>(&from_num_value),
                           sizeof(from_num_value));
        from_num->notify();
    }
    return true;
}

std::size_t takeBleToRadio(std::uint8_t *out, std::size_t capacity) noexcept
{
    if (!status.started || out == nullptr) return 0;
    portENTER_CRITICAL(&queue_lock);
    const std::size_t length = from_phone.pop(out, capacity);
    portEXIT_CRITICAL(&queue_lock);
    return length;
}

const BleStatus &tdeckBleStatus() noexcept { return status; }

}  // namespace lilyshark

#else

namespace lilyshark {
namespace {
BleStatus host_status{};
}
bool startTDeckBle(const char *) noexcept { return false; }
bool queueBleFromRadio(const std::uint8_t *, std::size_t) noexcept { return false; }
std::size_t takeBleToRadio(std::uint8_t *, std::size_t) noexcept { return 0; }
const BleStatus &tdeckBleStatus() noexcept { return host_status; }
}  // namespace lilyshark

#endif
