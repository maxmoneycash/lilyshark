# Lilyshark UI references

These ten images are the visual contract for the 320 x 240 T-Deck interface.

| File | Screen pattern |
| --- | --- |
| `01-node-detail.png` | Node name, current state, and stacked SNR/RSSI/hop plots |
| `02-node-roster.png` | Five-row roster with battery and per-node sparklines |
| `03-packet-detail.png` | Packet metadata, route, payload, and hex detail with a left rail |
| `04-dense-node-roster.png` | High-density roster and strong full-row focus state |
| `05-node-map.png` | Full-canvas spatial/radar view |
| `06-survey-capture.png` | Single capture state, progress, live metrics, and contextual action |
| `07-spectrum-waterfall.png` | Full-width waterfall with noise, busiest, and quietest summaries |
| `08-events.png` | Timestamped semantic event log |
| `09-live-traffic.png` | Dense packet feed with row focus |
| `10-channel-utilization.png` | Hero utilization metric, supporting values, and channel histogram |

Shared rules:

- 4 px spacing rhythm, 6-8 px outer inset, and 1 px dividers.
- Flat near-black surfaces with square geometry.
- Condensed sans for labels and IBM Plex Mono for telemetry.
- Off-white primary text with lime, cyan, amber, and coral reserved for state.
- A 20-22 px status strip contains battery, GPS, packet rate, and the current view.
- Data plots own the canvas. Decorative cards and persistent branding do not.
