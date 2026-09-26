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

BLECharacteristic *lsk_rx = nullptr;
BLECharacteristic *lsk_tx = nullptr;

constexpr std::size_t kMaxLskLine = 240;
constexpr std::size_t kLskQueueDepth = 8;
struct LskLineQueue {
    char lines[kLskQueueDepth][kMaxLskLine]{};
    std::size_t head = 0;
    std::size_t count = 0;

    bool push(const char *line) noexcept
    {
        if (line == nullptr || count == kLskQueueDepth) return false;
        char *slot = lines[(head + count) % kLskQueueDepth];
        std::strncpy(slot, line, kMaxLskLine - 1);
        slot[kMaxLskLine - 1] = '\0';
        ++count;
        return true;
    }

    bool pop(char *out, std::size_t capacity) noexcept
    {
        if (count == 0 || out == nullptr || capacity == 0) return false;
        std::strncpy(out, lines[head], capacity - 1);
        out[capacity - 1] = '\0';
        head = (head + 1) % kLskQueueDepth;
        --count;
        return true;
    }

    void clear() noexcept
    {
        head = 0;
        count = 0;
    }
};

constexpr std::size_t kLskTxRingSize = 2048;
struct LskTxRing {
    std::uint8_t buffer[kLskTxRingSize]{};
    std::size_t head = 0;
    std::size_t tail = 0;
    std::size_t count = 0;

    bool push(const std::uint8_t *data, std::size_t len) noexcept
    {
        if (data == nullptr || len == 0 || count + len > kLskTxRingSize) return false;
        for (std::size_t i = 0; i < len; ++i) {
            buffer[head] = data[i];
            head = (head + 1) % kLskTxRingSize;
        }
        count += len;
        return true;
    }

    std::size_t pop(std::uint8_t *out, std::size_t max_len) noexcept
    {
        if (out == nullptr || max_len == 0 || count == 0) return 0;
        const std::size_t to_copy = std::min(max_len, count);
        for (std::size_t i = 0; i < to_copy; ++i) {
            out[i] = buffer[tail];
            tail = (tail + 1) % kLskTxRingSize;
        }
        count -= to_copy;
        return to_copy;
    }

    void clear() noexcept
    {
        head = 0;
        tail = 0;
        count = 0;
    }
};

LskLineQueue lsk_commands{};
char lsk_rx_buffer[kMaxLskLine]{};
std::size_t lsk_rx_len = 0;
bool lsk_rx_discarding = false;
bool lsk_disconnect_pending = false;
LskTxRing lsk_tx_ring{};

class ServerEvents final : public BLEServerCallbacks {
    void onConnect(BLEServer *) override { status.connected = true; }
    void onDisconnect(BLEServer *server) override
    {
        status.connected = false;
        portENTER_CRITICAL(&queue_lock);
        lsk_tx_ring.clear();
        lsk_commands.clear();
        lsk_rx_len = 0;
        lsk_rx_discarding = false;
        lsk_disconnect_pending = true;
        portEXIT_CRITICAL(&queue_lock);
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

class LskRxEvents final : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *characteristic) override
    {
        const std::string value = characteristic->getValue();
        if (value.empty()) return;
        portENTER_CRITICAL(&queue_lock);
        for (char c : value) {
            if (c == '\n' || c == '\r') {
                if (!lsk_rx_discarding && lsk_rx_len > 0) {
                    lsk_rx_buffer[lsk_rx_len] = '\0';
                    if (lsk_commands.push(lsk_rx_buffer)) {
                        ++status.lsk_commands;
                    }
                }
                lsk_rx_len = 0;
                lsk_rx_discarding = false;
            } else if (lsk_rx_discarding) {
                continue;
            } else if (lsk_rx_len + 1 < sizeof(lsk_rx_buffer)) {
                lsk_rx_buffer[lsk_rx_len++] = c;
            } else {
                // Ignore the entire overlong line, including later BLE writes.
                lsk_rx_len = 0;
                lsk_rx_discarding = true;
            }
        }
        portEXIT_CRITICAL(&queue_lock);
    }
};

ServerEvents server_events{};
ToRadioEvents to_radio_events{};
FromRadioEvents from_radio_events{};
LskRxEvents lsk_rx_events{};

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

    BLEService *lsk_service = server->createService(kLskBleService);
    if (lsk_service == nullptr) return false;

    lsk_rx = lsk_service->createCharacteristic(
        kLskBleRxChar, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    lsk_tx = lsk_service->createCharacteristic(
        kLskBleTxChar, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
    if (lsk_rx == nullptr || lsk_tx == nullptr) return false;

    lsk_rx->setCallbacks(&lsk_rx_events);
    lsk_tx->addDescriptor(new BLE2902());

    lsk_service->start();

    BLEAdvertising *advertising = BLEDevice::getAdvertising();
    // Legacy advertising has 31 bytes per packet. Two 128-bit UUIDs need 36
    // bytes before flags or a name, so put LSK in the primary advertisement
    // and Meshtastic plus a short recognisable name in the scan response.
    BLEAdvertisementData advertisement_data;
    advertisement_data.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
    advertisement_data.setCompleteServices(BLEUUID(kLskBleService));
    BLEAdvertisementData scan_response_data;
    scan_response_data.setCompleteServices(BLEUUID(kMeshtasticBleService));
    scan_response_data.setName("Lilyshark");
    advertising->setAdvertisementData(advertisement_data);
    advertising->setScanResponseData(scan_response_data);
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

bool queueLskBleTx(const std::uint8_t *bytes, std::size_t length) noexcept
{
    if (!status.started || bytes == nullptr || length == 0) return false;
    portENTER_CRITICAL(&queue_lock);
    const bool queued = lsk_tx_ring.push(bytes, length);
    portEXIT_CRITICAL(&queue_lock);
    return queued;
}

bool queueLskBleTx(const char *str) noexcept
{
    if (str == nullptr) return false;
    return queueLskBleTx(reinterpret_cast<const std::uint8_t *>(str), std::strlen(str));
}

bool takeLskBleCommand(char *out, std::size_t capacity) noexcept
{
    if (!status.started || out == nullptr || capacity == 0) return false;
    portENTER_CRITICAL(&queue_lock);
    const bool taken = lsk_commands.pop(out, capacity);
    portEXIT_CRITICAL(&queue_lock);
    return taken;
}

bool takeLskBleDisconnect() noexcept
{
    portENTER_CRITICAL(&queue_lock);
    const bool disconnected = lsk_disconnect_pending;
    lsk_disconnect_pending = false;
    portEXIT_CRITICAL(&queue_lock);
    return disconnected;
}

void serviceLskBleTx() noexcept
{
    if (!status.started || !status.connected || lsk_tx == nullptr) return;
    // Deliver chunks to the 20-byte ATT MTU floor (docs/lsk-ble-contract.md).
    constexpr std::size_t kAttFloor = 20;
    std::uint8_t chunk[kAttFloor]{};
    for (int i = 0; i < 4; ++i) {
        portENTER_CRITICAL(&queue_lock);
        const std::size_t len = lsk_tx_ring.pop(chunk, sizeof(chunk));
        portEXIT_CRITICAL(&queue_lock);
        if (len == 0) break;
        lsk_tx->setValue(chunk, len);
        lsk_tx->notify();
        ++status.lsk_notifications;
    }
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
bool queueLskBleTx(const std::uint8_t *, std::size_t) noexcept { return false; }
bool queueLskBleTx(const char *) noexcept { return false; }
bool takeLskBleCommand(char *, std::size_t) noexcept { return false; }
bool takeLskBleDisconnect() noexcept { return false; }
void serviceLskBleTx() noexcept {}
const BleStatus &tdeckBleStatus() noexcept { return host_status; }
}  // namespace lilyshark

#endif
