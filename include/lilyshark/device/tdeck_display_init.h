#ifndef LILYSHARK_DEVICE_TDECK_DISPLAY_INIT_H
#define LILYSHARK_DEVICE_TDECK_DISPLAY_INIT_H

// The panel command sequence below is adapted from TFT_eSPI as shipped in the
// official LilyGO T-Deck repository. TFT_eSPI original code uses the FreeBSD
// license:
//
// Copyright (c) 2023 Bodmer (https://github.com/Bodmer)
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
// 1. Redistributions of source code must retain the above copyright notice,
//    this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

#include <cstddef>
#include <cstdint>

#if defined(LILYSHARK_DEVICE)
class TFT_eSPI;
#endif

namespace lilyshark {

enum class TDeckDisplayInitAction : std::uint8_t {
    Command,
    Data,
    DelayMs,
};

struct TDeckDisplayInitStep {
    TDeckDisplayInitAction action;
    std::uint16_t value;
};

// Exact INIT_SEQUENCE_2 command stream from the official LilyGO T-Deck tree:
// https://github.com/Xinyuan-LilyGO/T-Deck/blob/274ddaa0d04fcf8acd43643f52d81c565326c984/lib/TFT_eSPI/TFT_Drivers/ST7789_Init.h
// TFT_MAD_COLOR_ORDER is expanded to 0x00 because this firmware selects TFT_RGB.
inline constexpr char kTDeckDisplayInitSourceCommit[] =
    "274ddaa0d04fcf8acd43643f52d81c565326c984";
inline constexpr std::uint8_t kTDeckDisplaySoftwareResetCommand = 0x01;
inline constexpr std::uint16_t kTDeckDisplaySoftwareResetDelayMs = 150;

inline constexpr TDeckDisplayInitStep kTDeckDisplayVendorInitSequence[] = {
    {TDeckDisplayInitAction::Command, 0x11}, // SLPOUT
    {TDeckDisplayInitAction::DelayMs, 120},
    {TDeckDisplayInitAction::Command, 0x13}, // NORON
    {TDeckDisplayInitAction::Command, 0x36}, // MADCTL
    {TDeckDisplayInitAction::Data, 0x00},
    {TDeckDisplayInitAction::Command, 0x3a}, // COLMOD
    {TDeckDisplayInitAction::Data, 0x55},
    {TDeckDisplayInitAction::DelayMs, 10},
    {TDeckDisplayInitAction::Command, 0xb2}, // PORCTRL
    {TDeckDisplayInitAction::Data, 0x0c},
    {TDeckDisplayInitAction::Data, 0x0c},
    {TDeckDisplayInitAction::Data, 0x00},
    {TDeckDisplayInitAction::Data, 0x33},
    {TDeckDisplayInitAction::Data, 0x33},
    {TDeckDisplayInitAction::Command, 0xb7}, // GCTRL
    {TDeckDisplayInitAction::Data, 0x75},
    {TDeckDisplayInitAction::Command, 0xbb}, // VCOMS
    {TDeckDisplayInitAction::Data, 0x1a},
    {TDeckDisplayInitAction::Command, 0xc0}, // LCMCTRL
    {TDeckDisplayInitAction::Data, 0x2c},
    {TDeckDisplayInitAction::Command, 0xc2}, // VDVVRHEN
    {TDeckDisplayInitAction::Data, 0x01},
    {TDeckDisplayInitAction::Command, 0xc3}, // VRHS
    {TDeckDisplayInitAction::Data, 0x13},
    {TDeckDisplayInitAction::Command, 0xc4}, // VDVSET
    {TDeckDisplayInitAction::Data, 0x20},
    {TDeckDisplayInitAction::Command, 0xc6}, // FRCTR2
    {TDeckDisplayInitAction::Data, 0x0f},
    {TDeckDisplayInitAction::Command, 0xd0}, // PWCTRL1
    {TDeckDisplayInitAction::Data, 0xa4},
    {TDeckDisplayInitAction::Data, 0xa1},
    {TDeckDisplayInitAction::Command, 0xe0}, // PVGAMCTRL
    {TDeckDisplayInitAction::Data, 0xd0},
    {TDeckDisplayInitAction::Data, 0x0d},
    {TDeckDisplayInitAction::Data, 0x14},
    {TDeckDisplayInitAction::Data, 0x0d},
    {TDeckDisplayInitAction::Data, 0x0d},
    {TDeckDisplayInitAction::Data, 0x09},
    {TDeckDisplayInitAction::Data, 0x38},
    {TDeckDisplayInitAction::Data, 0x44},
    {TDeckDisplayInitAction::Data, 0x4e},
    {TDeckDisplayInitAction::Data, 0x3a},
    {TDeckDisplayInitAction::Data, 0x17},
    {TDeckDisplayInitAction::Data, 0x18},
    {TDeckDisplayInitAction::Data, 0x2f},
    {TDeckDisplayInitAction::Data, 0x30},
    {TDeckDisplayInitAction::Command, 0xe1}, // NVGAMCTRL
    {TDeckDisplayInitAction::Data, 0xd0},
    {TDeckDisplayInitAction::Data, 0x09},
    {TDeckDisplayInitAction::Data, 0x0f},
    {TDeckDisplayInitAction::Data, 0x08},
    {TDeckDisplayInitAction::Data, 0x07},
    {TDeckDisplayInitAction::Data, 0x14},
    {TDeckDisplayInitAction::Data, 0x37},
    {TDeckDisplayInitAction::Data, 0x44},
    {TDeckDisplayInitAction::Data, 0x4d},
    {TDeckDisplayInitAction::Data, 0x38},
    {TDeckDisplayInitAction::Data, 0x15},
    {TDeckDisplayInitAction::Data, 0x16},
    {TDeckDisplayInitAction::Data, 0x2c},
    {TDeckDisplayInitAction::Data, 0x3e},
    {TDeckDisplayInitAction::Command, 0x21}, // INVON
    {TDeckDisplayInitAction::Command, 0x2a}, // CASET
    {TDeckDisplayInitAction::Data, 0x00},
    {TDeckDisplayInitAction::Data, 0x00},
    {TDeckDisplayInitAction::Data, 0x00},
    {TDeckDisplayInitAction::Data, 0xef},
    {TDeckDisplayInitAction::Command, 0x2b}, // RASET
    {TDeckDisplayInitAction::Data, 0x00},
    {TDeckDisplayInitAction::Data, 0x00},
    {TDeckDisplayInitAction::Data, 0x01},
    {TDeckDisplayInitAction::Data, 0x3f},
    {TDeckDisplayInitAction::DelayMs, 120},
    {TDeckDisplayInitAction::Command, 0x29}, // DISPON
    {TDeckDisplayInitAction::DelayMs, 120},
};

inline constexpr std::size_t kTDeckDisplayVendorInitSequenceSize =
    sizeof(kTDeckDisplayVendorInitSequence) / sizeof(kTDeckDisplayVendorInitSequence[0]);

#if defined(LILYSHARK_DEVICE)
void applyTDeckDisplayInit(TFT_eSPI &display) noexcept;
#endif

} // namespace lilyshark

#endif
