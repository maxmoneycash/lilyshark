---
id: FW-012
title: Reticulum regional channel presets and airtime profiles
area: firmware
size: S
priority: P2
status: done
eval:
  auto:
  - clang++ -std=c++17 -Wall -Wextra -Werror -Iinclude src/core/builtin_profiles.cpp src/core/profile_tuning.cpp test/profile_tuning/test_profile_tuning.cpp -o /tmp/test_profile_tuning && /tmp/test_profile_tuning
  - clang++ -std=c++17 -Wall -Wextra -Werror -Iinclude src/core/builtin_profiles.cpp src/core/profile_tuning.cpp src/core/profile_settings.cpp test/profile_settings/test_profile_settings.cpp -o /tmp/test_profile_settings && /tmp/test_profile_settings
  - (cd webapp && node --import tsx --test "src/lib/dissect/tree.test.ts")
  rubric:
  - Built-in profiles added for European (868 MHz SF9/125kHz) and high-speed US (915 MHz SF7/500kHz) Reticulum interface channels.
  - Derived preamble symbol calculations match SX1262 LoRa airtime requirements for each band and spreading factor.
  - Profile ID mappings in webapp and firmware stay in lockstep without second-guessing.
---

Why: Reticulum operators use distinct standard PHY profiles across regional frequency
bands (EU 868 MHz 125 kHz SF9, US 915 MHz 500 kHz SF7). A sniffer with only one
generic US profile is inconvenient to deploy and blind to standard European mesh
configurations.
