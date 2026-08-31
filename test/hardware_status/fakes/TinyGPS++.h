#pragma once

#include <cstdint>

class TinyGPSLocation
{
  public:
    bool isValid() const noexcept { return valid; }
    std::uint32_t age() const noexcept { return valid ? 0U : UINT32_MAX; }
    double lat() const noexcept { return latitude; }
    double lng() const noexcept { return longitude; }

    bool valid = false;
    double latitude = 0.0;
    double longitude = 0.0;
};

class TinyGPSAltitude
{
  public:
    bool isValid() const noexcept { return valid; }
    double meters() const noexcept { return value_meters; }

    bool valid = false;
    double value_meters = 0.0;
};

class TinyGPSInteger
{
  public:
    bool isValid() const noexcept { return valid; }
    std::uint32_t value() const noexcept { return integer_value; }

    bool valid = false;
    std::uint32_t integer_value = 0;
};

class TinyGPSDate
{
  public:
    bool isValid() const noexcept { return valid; }
    std::uint32_t age() const noexcept { return valid ? age_ms : UINT32_MAX; }
    std::uint16_t year() const noexcept { return year_value; }
    std::uint8_t month() const noexcept { return month_value; }
    std::uint8_t day() const noexcept { return day_value; }

    bool valid = false;
    std::uint32_t age_ms = 0;
    std::uint16_t year_value = 2000;
    std::uint8_t month_value = 1;
    std::uint8_t day_value = 1;
};

class TinyGPSTime
{
  public:
    bool isValid() const noexcept { return valid; }
    std::uint32_t age() const noexcept { return valid ? age_ms : UINT32_MAX; }
    std::uint8_t hour() const noexcept { return hour_value; }
    std::uint8_t minute() const noexcept { return minute_value; }
    std::uint8_t second() const noexcept { return second_value; }

    bool valid = false;
    std::uint32_t age_ms = 0;
    std::uint8_t hour_value = 0;
    std::uint8_t minute_value = 0;
    std::uint8_t second_value = 0;
};

class TinyGPSHDOP
{
  public:
    bool isValid() const noexcept { return valid; }
    double hdop() const noexcept { return value; }

    bool valid = false;
    double value = 0.0;
};

class TinyGPSPlus
{
  public:
    bool encode(char value) noexcept
    {
        if (value == 'S') {
            ++passed_checksum_count;
            return true;
        }
        if (value == 'F') {
            ++passed_checksum_count;
            location.valid = true;
            location.latitude = 37.7749;
            location.longitude = -122.4194;
            altitude.valid = true;
            altitude.value_meters = 15.0;
            satellites.valid = true;
            satellites.integer_value = 7;
            hdop.valid = true;
            hdop.value = 0.9;
            // WITNESS-VECTOR-1's wall clock: 2030-01-01T00:00:00Z, unix
            // 1893456000, so the GPS-time session test pins the same instant
            // the frozen witness derivation is vectored against.
            date.valid = true;
            date.year_value = 2030;
            date.month_value = 1;
            date.day_value = 1;
            time.valid = true;
            time.hour_value = 0;
            time.minute_value = 0;
            time.second_value = 0;
            return true;
        }
        // 'T' delivers time without a position fix, as RMC can before GGA
        // reports satellites: 2029-12-31T23:59:30Z, unix 1893455970.
        if (value == 'T') {
            ++passed_checksum_count;
            date.valid = true;
            date.year_value = 2029;
            date.month_value = 12;
            date.day_value = 31;
            time.valid = true;
            time.hour_value = 23;
            time.minute_value = 59;
            time.second_value = 30;
            return true;
        }
        return false;
    }

    std::uint32_t passedChecksum() const noexcept { return passed_checksum_count; }

    TinyGPSLocation location{};
    TinyGPSAltitude altitude{};
    TinyGPSInteger satellites{};
    TinyGPSHDOP hdop{};
    TinyGPSDate date{};
    TinyGPSTime time{};
    std::uint32_t passed_checksum_count = 0;
};
