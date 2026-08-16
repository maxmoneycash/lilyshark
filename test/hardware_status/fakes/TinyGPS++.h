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
            return true;
        }
        return false;
    }

    std::uint32_t passedChecksum() const noexcept { return passed_checksum_count; }

    TinyGPSLocation location{};
    TinyGPSAltitude altitude{};
    TinyGPSInteger satellites{};
    TinyGPSHDOP hdop{};
    std::uint32_t passed_checksum_count = 0;
};
