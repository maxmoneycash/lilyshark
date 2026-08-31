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
    assert(!gps.time_valid);
    assert(gps.unix_time_seconds == 0U);
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
    // The fix carries the GPS wall clock: 2030-01-01T00:00:00Z, the same
    // instant WITNESS-VECTOR-1 freezes, so the witness anchor is pinned here.
    assert(status.snapshot().gps.time_valid);
    assert(status.snapshot().gps.unix_time_seconds == 1893456000U);

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
    assert(!status.snapshot().gps.time_valid);

    // RMC time can be valid before a position fix; the wall clock (and so the
    // witness anchor) must not wait for satellites the sidecar never reads.
    serial.push('T');
    hardware_status_fake::now_ms = 350U;
    status.poll();
    assert(status.snapshot().gps.state == lilyshark::GpsState::Searching);
    assert(!status.snapshot().gps.position_valid);
    assert(status.snapshot().gps.time_valid);
    assert(status.snapshot().gps.unix_time_seconds == 1893455970U);

    serial.push('F');
    hardware_status_fake::now_ms = 400U;
    status.poll();
    assert(status.snapshot().gps.state == lilyshark::GpsState::Fix);
    assert(status.snapshot().gps.position_valid);

    // Official T-Deck Plus GPSShield firmware writes these before listening.
    // A silent listener never re-enables GGA/RMC after another image disabled
    // them, so SEARCH can last forever with only TXT checksums.
    HardwareSerial configured{};
    lilyshark::TDeckHardwareStatus bringup{configured};
    bringup.begin(true);
    assert(configured.written.find("$PCAS04,5*1C") != std::string::npos);
    assert(configured.written.find("$PCAS03,1,1,1,1,1,1,1,1,1,1,,,0,0*02") !=
           std::string::npos);
    assert(configured.written.find("$PCAS11,3*1E") != std::string::npos);
    const std::size_t after_begin = configured.written.size();
    configured.push('S');
    hardware_status_fake::now_ms = 500U;
    bringup.poll();
    assert(configured.written.size() > after_begin);
    assert(configured.written.find("$PCAS03,1,1,1,1,1,1,1,1,1,1,,,0,0*02", after_begin) !=
           std::string::npos);

    std::puts("hardware status GPS session tests passed");
    return 0;
}
