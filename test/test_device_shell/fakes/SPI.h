#pragma once

#include "device_shell_fake.h"

#include <cstdint>

class SPIClass {
  public:
    void begin(std::int8_t sck = -1, std::int8_t miso = -1,
               std::int8_t mosi = -1, std::int8_t = -1)
    {
        device_shell_fake::record("spi.begin." + std::to_string(sck) + "." +
                                  std::to_string(miso) + "." + std::to_string(mosi));
    }
};

inline SPIClass SPI{};
