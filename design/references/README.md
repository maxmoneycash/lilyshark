# Lilyshark historical UI references

These ten images were early 320 x 240 composition studies. They established the dense typography, focus treatment, color roles, and plot-first layout, but they are not the current data or navigation contract. Exact frames from the implemented firmware builders live in [`design/previews`](../previews), including the six-stage setup, Home, tools, Protocols, Timeline, and the five-tab Packet Inspector.

Some sketches include hop, remote-position, channel-frequency, or continuous-waterfall concepts that received frames cannot always prove and a single SX1262 cannot continuously collect. The current UI omits those claims or labels the data unavailable. Spectrum is an explicit fast/deep power-histogram sweep that pauses packet reception; Map shows only the local optional-GPS state.

| File | Screen pattern |
| --- | --- |
| `01-node-detail.png` | Density study for node name and stacked history; implemented detail keeps attributable SNR/RSSI activity and omits invented hops/position |
| `02-node-roster.png` | Five-row roster with battery and per-node sparklines |
| `03-packet-detail.png` | Basis for the implemented PKT/RF/DEC/HEX/RAW inspector rail |
| `04-dense-node-roster.png` | High-density roster and strong full-row focus state |
| `05-node-map.png` | Spatial treatment study; implemented Map is the local optional-GPS fix only |
| `06-survey-capture.png` | Single capture state, progress, live metrics, and contextual action |
| `07-spectrum-waterfall.png` | Heat-color study; implemented Spectrum grows a bounded SX1262 scan histogram across measured bins |
| `08-events.png` | Timestamped semantic event log |
| `09-live-traffic.png` | Dense packet feed with row focus |
| `10-channel-utilization.png` | Basis for the hero Airtime metric and recent time-history bars |

Shared rules:

- 4 px spacing rhythm, 6-8 px outer inset, and 1 px dividers.
- Flat near-black surfaces with square geometry.
- Condensed sans for labels and IBM Plex Mono for telemetry.
- Off-white primary text with lime, cyan, amber, and coral reserved for state.
- A 20-22 px status strip contains battery, GPS, packet rate, and the current view.
- Data plots own the canvas. Decorative cards and persistent branding do not.
