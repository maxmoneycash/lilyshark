# Lilyshark on real hardware

Every simulator screenshot in these docs is pixel-locked to the firmware, but
a locked render is still a promise. These photos are the promise kept: a
LILYGO T-Deck Plus running Lilyshark `v0.1.0-alpha.7`, flashed from the
merged factory image on 2026-08-15, first field session that same night.

![The first-run tour on the T-Deck, with the Lilyshark web analyzer open on the laptop behind it](media/tdeck-onboarding-night.png)

The guided first run, mid-tour. The device explains its four diagnostic
groups — packets, radio, network, capture — before any configuration is
asked for. Behind it, the web analyzer's intro page is cycling the same
firmware screens the device renders.

![The About screen: wordmark, firmware version, protocol list, license](media/tdeck-about-night.png)

The About screen on hardware: `v0.1.0-alpha.7`, the three supported protocol
families, GPL-3.0, and the repository address. What the simulator renders is
what the panel shows — same layout engine, same fonts, same 320×240.

![The Traffic screen streaming frames, battery and GPS status in the top bar](media/tdeck-traffic-live-night.png)

The Traffic screen streaming in **simulate mode** — the deterministic
synthetic channel the firmware generates on-device for bench work and
demonstrations (always labeled, always logged as an event; see the
[quickstart](quickstart.md)). Battery, GPS state, and capture status ride in
the top bar; RSSI develops per-row exactly as it does for received frames,
because synthetic traffic enters through the same ingest path the SX1262
uses.
