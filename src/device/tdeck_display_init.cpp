#include "lilyshark/device/tdeck_display_init.h"

#if defined(LILYSHARK_DEVICE)

#include <Arduino.h>
#include <TFT_eSPI.h>

#if defined(CONFIG_IDF_TARGET_ESP32S3)
// Arduino-ESP32 names the public default bus FSPI=0 on ESP32-S3, while the
// low-level register macros used by TFT_eSPI require the hardware index 2.
// Lilyshark pins the upstream one-line SPI_PORT correction on top of 2.5.43,
// preserving TFT_eSPI's reference to the same global SPI object used by SD and
// RadioLib. Fail the build if either pinned dependency changes that contract.
#if defined(USE_FSPI_PORT) || defined(USE_HSPI_PORT)
#error "TFT_eSPI must use Lilyshark's shared global SPI object"
#endif
static_assert(SPI_PORT == 2, "TFT_eSPI must address ESP32-S3 SPI2 registers");
static_assert(REG_SPI_BASE(SPI_PORT) == DR_REG_SPI2_BASE,
              "TFT_eSPI resolved the wrong ESP32-S3 SPI register base");
#endif

namespace lilyshark {

void applyTDeckDisplayInit(TFT_eSPI &display) noexcept
{
    display.writecommand(kTDeckDisplaySoftwareResetCommand);
    delay(kTDeckDisplaySoftwareResetDelayMs);

    for(const TDeckDisplayInitStep &step : kTDeckDisplayVendorInitSequence) {
        switch(step.action) {
        case TDeckDisplayInitAction::Command:
            display.writecommand(static_cast<std::uint8_t>(step.value));
            break;
        case TDeckDisplayInitAction::Data:
            display.writedata(static_cast<std::uint8_t>(step.value));
            break;
        case TDeckDisplayInitAction::DelayMs:
            delay(step.value);
            break;
        }
    }
}

} // namespace lilyshark

#endif
