---
id: FW-009
title: Fix the device-shell test target at HEAD
area: firmware
size: S
priority: P1
status: done
eval:
  rubric:
  - '`pio test -e device-shell-test` passes on a clean checkout: the fake HardwareSerial grows the print() overloads the shell code uses, and the reset-settings-save-failure scenario is diagnosed and fixed (test_device_shell.cpp:1500).'
  - The lvgl dependency fetch under an egress-restricted environment is documented (the zip fetch 403s; a git clone of the pinned v9.3.0 into .pio/libdeps works).
---

Why: While proving FW-004's sim_main changes compile for the device, the
`device-shell-test` PlatformIO target turned out to fail at clean HEAD,
before any new changes: the fake `HardwareSerial` lacks `print()` used by
`emit_analyzer_heard_frame`, and with that patched, the
`reset-settings-save-failure` scenario fails at test_device_shell.cpp:1500.
Host suites (30 C++ + 7 Python) are green, so this is isolated to the
device-shell test environment — but a red target nobody runs is a trap.

What: Reproduce both failures on a clean checkout, fix the fake serial and
the failing scenario on their merits, and note the lvgl fetch workaround
where the CI/dev docs describe running device tests.
