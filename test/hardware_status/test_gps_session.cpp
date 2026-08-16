#include "lilyshark/device/hardware_status.h"
#include "lilyshark/tdeck.h"

#include <cassert>
#include <cstdint>
#include <cstdio>

namespace {

void assertClearedFix(const lilyshark::GpsStatus &gps)
{
    assert(!gps.receiver_detected);
    assert(!gps.position_valid);
    assert(gps.latitude_degrees == 0.0);
    assert(gps.longitude_degrees == 0.0);
    assert(gps.altitude_meters == 0.0F);
    assert(gps.hdop == 0.0F);
    assert(gps.satellites == 0U);
    assert(gps.last_sentence_age_ms == UINT32_MAX);
}

} // namespace

int main()
{
    HardwareSerial serial{};
    lilyshark::TDeckHardwareStatus status{serial};

    status.begin(true);
    assert(status.gpsEnabled());
    assert(serial.running);
    assert(serial.begin_calls == 1U);
    assert(serial.end_calls == 1U);
    assert(serial.last_baud == lilyshark::tdeck::gps_baud);
    assert(status.snapshot().gps.state == lilyshark::GpsState::Absent);
    assertClearedFix(status.snapshot().gps);

    serial.push('F');
    hardware_status_fake::now_ms = 100U;
    status.poll();
    assert(status.snapshot().gps.state == lilyshark::GpsState::Fix);
    assert(status.snapshot().gps.receiver_detected);
    assert(status.snapshot().gps.position_valid);
    assert(status.snapshot().gps.latitude_degrees == 37.7749);
    assert(status.snapshot().gps.longitude_degrees == -122.4194);
    assert(status.snapshot().gps.satellites == 7U);

    // This unread sentence belongs to the old session and must be discarded.
    serial.push('F');
    const std::uint32_t reads_before_disable = serial.read_calls;
    status.begin(false);
    assert(!status.gpsEnabled());
    assert(!serial.running);
    assert(serial.end_calls == 2U);
    assert(serial.read_calls == reads_before_disable + 1U);
    assert(status.snapshot().gps.state == lilyshark::GpsState::Disabled);
    assertClearedFix(status.snapshot().gps);

    // Bytes queued while disabled must not seed the next parser session.
    serial.push('F');
    const std::uint32_t reads_before_enable = serial.read_calls;
    hardware_status_fake::now_ms = 200U;
    status.begin(true);
    assert(serial.running);
    assert(serial.begin_calls == 2U);
    assert(serial.end_calls == 3U);
    assert(serial.read_calls == reads_before_enable + 1U);
    assert(status.snapshot().gps.state == lilyshark::GpsState::Absent);
    assertClearedFix(status.snapshot().gps);

    serial.push('S');
    hardware_status_fake::now_ms = 300U;
    status.poll();
    assert(status.snapshot().gps.state == lilyshark::GpsState::Searching);
    assert(status.snapshot().gps.receiver_detected);
    assert(!status.snapshot().gps.position_valid);

    serial.push('F');
    hardware_status_fake::now_ms = 400U;
    status.poll();
    assert(status.snapshot().gps.state == lilyshark::GpsState::Fix);
    assert(status.snapshot().gps.position_valid);

    std::puts("hardware status GPS session tests passed");
    return 0;
}
