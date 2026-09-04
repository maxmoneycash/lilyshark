# Lilyshark field UI marathon

Started: 2026-08-17
Goal: 10 hours of continuous UI craft on the T-Deck 320x240 field UI.
Identity: workbench / pixel instrument. Ground `#07100F`, pink `#FF4F9D`.
Never flash competitor firmware. Preview in the SDL simulator titled Lilyshark.

## How to keep going

Each scheduled fire must:

1. Read this file and pick the first item that is still `OPEN`.
2. Implement a visible, complete improvement (not a plan, not a comment).
3. Rebuild the simulator, run render + interaction tests, update hashes if pixels changed.
4. If the change is on a field screen, launch the simulator and dump a PPM/PNG of that screen.
5. Mark the item `DONE` with a one-line note of what changed.
6. Add new `OPEN` bugs you found while working. Do not shrink the list to look finished.
7. Do not flash unless the user asked this turn.
8. Stop only when every `OPEN` item is done *and* you have re-audited HOME/NODES/MAP/CHAT/RADIO.

## Pass 1 (this session)

- [DONE] Device MAP was a black radar plot. Georeference zoom. Paint a field chart (streets/parks/water/contours) when Esri tiles are missing. Load `/maps/{sat|dark}_lat_lon_zZ.rgb565` from SD on device.
- [DONE] MAP compile break: leftover `satellite` flag.
- [DONE] NODES on device showed raw hex; now uses short name + position pin.
- [DONE] NODE DETAIL shows name, hex, optional fix.
- [DONE] CHAT empty state + composer restyled to instrument chrome.
- [DONE] HOME GPS hemisphere no longer hardcodes N/W.
- [DONE] RADIO empty listening state is an instrument card, not a blank page.

## Backlog

- [DONE] MAP: show bearing + range to the selected node under the HUD. Pink strip: `Yosemite  487m  325` plus a range line.
- [DONE] MAP: GPS accuracy ring from HDOP/satellites so YOU is not a perfect lie. HDOP*5 m (or sat-count fallback) around YOU.
- [DONE] MAP: if SD has neighboring tiles, stitch them when you walk off the cached cell. 3x3 cell composite + field-chart gaps; simulator pans with YOU.
- [DONE] MAP HUD: zoom + SV count + CHART/imagery sit left of the +/− chips, not on top of them.
- [DONE] MAP: SAT/MAP chips should look selected (pink). Split into two chips; active is pink fill+ink.
- [DONE] MAP: node labels collide; skip or shorten when two marks share a pixel. Later labels drop when boxes overlap.
- [DONE] MAP no-fix: still a dead surface. Draw a muted chart with "NO FIX" instead of a blank card. Zoom/SAT still work.
- [DONE] HOME: HEARD is a lone number. List the last 3 callsigns in that card. Header `HEARD n` plus last 3 unique names.
- [DONE] HOME: LAST RX card repeats RSSI already shown top-right. Now name, proto, hops, age. RSSI stays in the meter card.
- [DONE] HOME: gear hit target is 22px and easy to miss. 40x20 SET chip under the wordmark.
- [DONE] HOME: LISTENING + profile + freq + LORA + ID is cramped and wraps mentally. One status + two pixel lines.
- [DONE] NODES: 8-row cap, no scroll hint. Show "and N more" or page. 7 visible rows + `n-m / N` footer with UP/DOWN.
- [DONE] NODES: tap row vs nav bar. Confirm 8th row is not under the tab bar. Rows end at y=202; footer 204-223; nav 226.
- [DONE] NODES empty vs RADIO empty copy should agree on what to do next. Both say stay on this profile; names appear after a packet.
- [DONE] NODE DETAIL: no CHAT / MAP actions. Add tap targets "CHAT" and "MAP".
- [DONE] NODE DETAIL: histories collide with the field nav. Re-fit charts into y=22..225. Latest line at y=196.
- [DONE] CHAT: only 6 messages, no scroll. Older lines vanish with no hint. 5 visible + `N OLDER`; Up/Down scrolls.
- [DONE] CHAT: TX FAILED is a shell_notice the chat screen does not show. Fault banner above the composer.
- [DONE] CHAT: LONGFAST vs DM is unclear. Mark broadcast vs direct. Tabs show DM; lines tagged ALL/DM; strip says BCAST/DIRECT.
- [DONE] CHAT: unread pip is 3px. Make a real badge. 12x10 pink count on the CHAT tab.
- [DONE] RADIO tab is TRAFFIC. Rename the screen title to RADIO or the tab to TRAFFIC. Live list title is now RADIO.
- [DONE] TRAFFIC rows are 14px and unreadable at arm's length. Use 18px instrument rows. 9 visible rows, last ends at y=200.
- [DONE] TRAFFIC has no column headers on the live list. TIME SRC DST KIND H SNR in pixel pink.
- [DONE] SPECTRUM / SURVEY / EVENTS are hidden behind number keys. Surface them from RADIO or HOME. SPEC/SURV/EVNT chips on RADIO.
- [DONE] SETTINGS still uses the old workbench list, not the pixel instrument. Pixel rows, pink rail, no white selected fill.
- [DONE] Onboarding still says "not another chat client" while chat is now a first-class tab. Now "RADIO, MAP, AND CHAT"; FIELD row lists nodes/map/chat.
- [DONE] Status bar title is right-aligned and fights the data. Left-align the screen name. Title left in pink pixel; BAT/GPS/rate follow.
- [DONE] Field nav labels are not optically centered in 64px tabs. Labels are now tab-centered.
- [DONE] Font mix: condensed + mono + pixel on one screen. Field chrome is pixel (chips/headers/empty titles); data is mono. Status title stays condensed_bold_16.
- [DONE] Display & Input / Help / About not reachable from field chrome except gear. HOME has a HELP chip next to SET.
- [DONE] HUD shows CHART when the device is painting the offline field map instead of Esri tiles.
- [DONE] Web analyzer chat/map should stay consistent with these field changes. SAT/MAP/CHART chips. CHART is a georeferenced #07100F grid layer.
- [DONE] MAP: nodes without a GPS fix are omitted with no "N unfixed" count. HUD shows `SAT n +k` / `NET +k`.
- [DONE] MAP: off-screen selected peer clips the range line; add an edge chevron so the heading is obvious.
- [DONE] MAP compass N sits on the HUD between coords and zoom. N is now a pink chip under the HUD, left of the field.
- [DONE] MAP +/− chips have no dimmed/disabled look at zoom min/max. Limits use muted ink.
- [DONE] HOME GPS card shows FIX/SEARCH/OFF but never HDOP or satellite count. Now `SAT n  H0.9` under the coords.
- [DONE] HOME LAST RX name can be "--" even when HEARD > 0 if the newest frame has no matching callsign. Walks back to the newest decoded source.
- [DONE] Simulator RADIO empty state is a lone muted line, not the device instrument card. Now the same listen card as device.
- [DONE] CHAT composer has no SEND hit target; only keyboard Enter transmits. 44x20 SEND chip.
- [DONE] MAP W/E compass letters wash out on bright satellite rooftops. W/E/S sit on black chips.
- [DONE] MAP stitched chart gaps at the tile edge have no EDGE/CHART seam cue. HUD appends EDGE when the stitch offset is nonzero.
- [DONE] MAP accuracy ring is only a few pixels at z15 and easy to miss next to YOU. Floor 8px plus a muted 2σ ring.
- [DONE] Analyzer `--screen map` / render-test MAP leave field nav selected on HOME. `--screen` and render-test now set field_tab from the screen.
- [DONE] `--screen node-detail` opens empty (no preselected identity). Preselects the first established node after telemetry reset.
- [DONE] HOME SET chip sits under the wordmark and can be mistaken for decoration. SET/HELP live at 200,28 / 200,50 next to RSSI.
- [DONE] HOME HEARD card is 70px; names after the third are count-only. Four unique names plus `+N` when more remain.
- [DONE] TRAFFIC selected row uses a blue focus fill that fights the pink instrument chrome. Pink rail + dark fill.
- [DONE] NODE DETAIL CHAT/MAP chips have no keyboard shortcut; only touch. Chips read CHAT C / MAP M; C and M fire those actions.
- [DONE] NODES PROTO column still says Meshtastic/MESHT instead of the short MESH tag used on HOME. PROTO is MESH/MCORE/RNS.
- [DONE] NODE DETAIL title stays right-aligned and crowds LAST/FRAMES on the identity line. Title is NODE; identity is `hex  MESH  LAST n  n FR`.
- [DONE] CHAT "N OLDER" hint has no UP/DOWN chip, so scroll is easy to miss. UP/DOWN chips sit on the older strip.
- [DONE] CHAT peer tabs stay 80px even with two peers, so names stay cramped. Tabs share the 320px strip; tap width matches draw.
- [DONE] RADIO SPEC/SURV/EVNT chips leave the RADIO tab selected on Spectrum/Survey/Events. That tab label becomes SPEC/SURV/AIR/EVNT.
- [DONE] RADIO still has no AIRTIME chip; key 6 is the only path. AIR chip sits between SURV and EVNT.
- [DONE] RADIO SRC/DST still show "--" for undecoded rows, so headers promise more than the row delivers. Callsigns when known, else RF/ALL.
- [DONE] Status-bar screen name is 6x8 pixel and thin at arm's length next to mono BAT/GPS. Title is condensed_bold_16 pink, clipped at 86.
- [DONE] SETTINGS DISPLAY/HELP/ABOUT rows have no value hint, so they look unfinished. Rows show INPUT/KEYS/INFO/RESET.
- [DONE] HOME SET+HELP sit under the wordmark and still compete with the lily tail. Profile/freq clip before x=196 so the chips stay clear.
- [DONE] Settings/Help/About kept the last field tab selected, so RADIO stayed lit on gear screens. Non-field shell routes now highlight no tab.
- [DONE] SPECTRUM status title was `SPECTRUM / FAST NARROW` and clipped to `SPECTRUM / FA`. Title is SPECTRUM; mode stays in the plot footer.
- [DONE] HOME freq line drops the local short name after the SET clip (76px holds `906.875 LORA` only). Freq is now `906.875 LORA`; a pink `ID  XXXX` line sits under it.
- [DONE] RADIO KIND still says OPAQUE for decoded Meshtastic instead of TEXT/POS/NODE. Simulator kinds cycle TEXT/POS/NODE/TELE/ROUTE; readable device ports use the same short tags; unread Meshtastic is ENC.
- [DONE] MAP 1σ ring is still easy to lose on pale satellite rooftops even at the 8px floor. Floor 12px, black halo, 2px pink stroke.
- [DONE] NODES selected row still used the old white workbench fill. Pink rail + dark fill, selected ink pink like RADIO.
- [DONE] Web analyzer Chat still routes through Spanish i18n leftovers (HOY/AYER/LIMPIAR comments and t() keys). Default channel is LONGFAST; comments/helpers are English.
- [DONE] HOME `ID  XXXX` sits 2px under HELP and can read as a caption for that chip. Short name is now a third chip under HELP (`SET` / `HELP` / `4B61`).
- [DONE] RADIO has no PROTO column, so MeshCore ACK/MULTI and Meshtastic TEXT/POS share KIND. PR column shows MESH/MCORE/RNS/RF beside KIND.
- [DONE] RADIO DST clips 9-character callsigns (`RidgeLink` → `RidgeLin`) after the PR column squeeze. SRC/DST are 56px (9×6 + 2); TIME has a 6px gap before SRC.
- [DONE] CHAT `N OLDER` sits on the same band as the first visible message. Dedicated 16px strip (OLDER/UP/DOWN/BCAST); messages start at y=62.
- [DONE] HOME route left the last analyzer tab lit (RADIO on Home dumps). Home always highlights HOME.
- [DONE] HOME profile `MESHTASTIC US LF` clipped in the 76px slot. Field tags: US LF / MCORE US / MCORE LEG / RNODE EU / RNODE US.
- [DONE] RADIO has no `n-m / N` footer when more than 9 frames, so extra traffic is silent unlike NODES. 8 rows + `1-8 / N` footer with UP/DOWN; tools stay at y=204.
- [DONE] Web analyzer map still uses OSM street tiles; field MAP is SAT/dark tiles or the georeferenced chart. Web map now uses Esri World Imagery like field SAT.
- [DONE] Web `fechaHora` helper and its tests still use the Spanish name. Renamed to `dateTime`; tests pass.
- [DONE] SPECTRUM / SURVEY / AIRTIME empty titles still use condensed_bold, not pixel chrome. Idle titles are pixel 6x8; SURVEY READY/CAPTURING/COMPLETE is pixel 18x24.
- [DONE] CHAT peer tabs have no per-conversation unread pip; only the nav CHAT badge counts. Per-peer pink count; nav badge is the sum; opening a tab clears only that convo.
- [DONE] SURVEY footer READY sat on the field nav. Strip at y=204 with pixel chrome, above nav 226.
- [DONE] Web map has SAT imagery but no MAP/CHART chip or offline field-chart fallback. SAT/MAP chips; HUD says ESRI SAT / CARTO DARK.
- [DONE] `fmt.test.ts` still has Spanish comments and identifiers (`medianoche`, `basura`, `anchos`). Comments and names are English.
- [DONE] NODES hop-history still names the previous hop `antes`. Public field is `previous`; IDB still stores `antes`.
- [DONE] AIRTIME percent is still condensed_bold_28 while SURVEY state is pixel_18x24. Percent is pixel_18x24; OLDEST/NEWEST sit in a y=204 strip.
- [DONE] PACKET DETAIL selected tab used the old white workbench fill. Pink rail + dark fill + pixel labels.
- [DONE] Web MAP chip uses Carto dark streets, not the field georeferenced chart when tiles are missing. CHART paints a seeded field grid from tile x/y/z; MAP stays Carto dark.
- [DONE] PACKET DETAIL status title is the longest field name and crowds BAT in the 86px clip. Titles are PACKET / EVENT / PROTO.
- [DONE] EVENTS list still uses condensed titles and may keep the old workbench selected fill. Pixel TIME/KIND, dark+pink selected, 5 rows + `n-m / N` footer. Range no longer sits on row 1.
- [DONE] Shell lists (setup/filter/profiles) still used white selected fill. Dark fill + pink label + lime value.
- [DONE] PROTOCOLS and TIMELINE leave the RADIO tab lit instead of PROTO/TIME. Nav says PROTO / TIME like SPEC/SURV/AIR/EVNT.
- [DONE] TIMELINE has not been re-skinned to pixel chrome / instrument selected rows. ALL/MESH/MCORE/RNS/RAW chips; selected is pink fill. Footer `-60s` / `NOW`.
- [DONE] EVENT detail has no BACK chip; only ESC / tap below y=204. BACK / UP / DOWN chips on a y=204 strip.
- [DONE] TIMELINE RATE/MEAN/CRC still use condensed-width mono_semibold instead of pixel chrome + mono values. Labels are pixel pink; values are mono 10.
- [DONE] PROTOCOL DETAIL has no BACK chip; only ESC. BACK chip on y=204; blurb sits on the same strip, not under the chart.
- [DONE] PACKET DETAIL has no BACK chip; only ESC. BACK chip under the PKT/RF/DEC/HEX/RAW rail at y=204.
- [DONE] PROTOCOL DETAIL blurb is clipped on the BACK strip (`channel hints.` can lose the period). Short field blurbs fit beside BACK.
- [DONE] NODE DETAIL has CHAT/MAP chips but no BACK chip; only ESC returns to the list. BACK chip on a y=204 strip; LATEST RSSI moved to 188.
- [DONE] NODE DETAIL BACK has no key hint, unlike CHAT C / MAP M. Footer chips read BACK ESC (56px). Event/proto share the same strip helper.
- [DONE] PACKET DETAIL rail BACK is 36px and still has no ESC hint. Full-width `BACK ESC` strip at y=204, same helper as NODE/EVENT/PROTO.
- [DONE] Web CHART is a hash-grid canvas, not the same street/park/contour painter as the T-Deck field chart. `fieldChart.ts` ports `paint_field_pixels` (120 m streets, parks, water, contours).
- [DONE] MAP SAT/MAP cannot force the field painter when tiles exist. CHART chip at y=138 skips Esri/dark tiles and paints the night chart.
- [DONE] CHAT: more than 4 peer tabs vanished with no hint. Tab window follows the selected peer; older strip shows `+N`.
- [DONE] Simulator NODES omit the pink position pin the device list draws when a node has a GPS fix. 5x5 pink pin at x=230 when the peer has a field fix.
- [DONE] HOME GPS compass is decorative N-up, not a heading to LAST RX or the selected map peer. Needle + `166` toward LAST RX when both ends have a fix.
- [DONE] NODE DETAIL has CHAT/MAP but no lat/lon or range when that node has a fix. Coords + `487m  325` beside MAP M; matches the map strip.
- [DONE] CHAT composer has no remaining-character count on the 80-char draft. Count appears while typing; pink under 10.
- [DONE] SURVEY READY has no START/STOP chip; capture is keyboard-only. Footer chip START/STOP; tap y>=176 still fires Enter.
- [DONE] SPECTRUM idle has no START chip; the sweep is keyboard-only. READY/SCANNING/COMPLETE strip with START or amber STOP.
- [DONE] NODE DETAIL fix uses signed decimal (`37.7785  -122.4218`) while HOME GPS uses hemisphere letters. Now `37.7785 N  122.422 W`.
- [DONE] NODES position pin has no POS header, so the 5px square can read as a spark artifact. POS header at x=224.
- [DONE] Web MAP chip is still Carto dark streets, not the device `/maps/dark_*` rgb565 tiles. MAP is Carto dark + gold field-chart contours; HUD says FIELD DARK.
- [DONE] IDB hop history still stores the previous hop as `antes`. Writes `previous` and still reads legacy `antes`.
- [DONE] HOME compass heading ignores the selected NODES peer when LAST RX has no fix. Falls back to the selected established node.
- [DONE] SPECTRUM has no FAST/DEEP chip; after the warning, mode is only changeable from that dialog. FAST/DEEP chips on the y=204 strip; selected is pink fill.
- [DONE] RADIO has no FILTER chip; key X is the only path to TRAFFIC FILTER. FILT chip at x=252; pink when the filter is active.
- [DONE] TRAFFIC FILTER rows still use condensed shell chrome, not pixel RADIO rows. Title FILTER; pixel rows + pink rail; BACK ESC strip; nav FILT.
- [DONE] RADIO FILT chip has no X key hint, unlike NODE CHAT C / MAP M. Chip reads FILT X.
- [DONE] Web MAP FIELD DARK contours are the field-chart hills, not terrarium lines baked into `/maps/dark_*.rgb565`. MAP fetches Mapzen terrarium and paints gold index lines; field-chart hills only if the tile fetch fails.
- [DONE] FILTER has no CLR chip; key R is the only way to reset predicates. CLR R chip at x=248; tap fires R.
- [DONE] SETTINGS still uses a condensed workbench header, not the field status bar. SETTINGS now uses the field status bar (BAT/GPS/rate).
- [DONE] STORAGE, DEVICE, DISPLAY, HELP, and ABOUT still use the condensed workbench header. Field status bar; titles CAPTURE / DEVICE / DISPLAY / HELP / ABOUT.
- [DONE] FILTER CLR R is muted when predicates are already ALL, so it can look non-interactive. CLR R stays pink so it reads as a hit target.
- [DONE] RADIO PROFILE (from SETTINGS) still uses the condensed workbench header. Title PROFILE; pixel rows with US LF / MCORE tags and freq+SF.
- [DONE] CAPTURE / DEVICE / DISPLAY rows still use condensed shell list chrome, not pixel SETTINGS rows. Shared `add_pixel_list_row`; DISPLAY tap math matches 26px rows.
- [DONE] HELP key list uses mono_10 only; no pixel section headers. NAV and KEYS pixel headers; keys are pixel, actions mono.
- [DONE] PROFILE rows dropped bandwidth after the SF squeeze (`906.875  SF11` has no kHz). Values are `906.875  250k  SF11`.
- [DONE] ABOUT tagline still uses condensed_bold, not pixel chrome. Pixel `LORA FIELD DIAGNOSTICS` / `FOR THE T-DECK`; field tags MESH / MCORE / RNS.
- [DONE] Onboarding screens still use the condensed workbench header. Pixel setup header + step (`FIRST RUN  1 / 6`); no fake BAT/GPS on first run.
- [DONE] Onboarding welcome tagline and action strip still use condensed workbench type. Pixel tagline; shared action strip is pixel at y=204.
- [DONE] Capability cards still use condensed_semibold labels, not pixel chrome. PACKETS/RADIO/FIELD/CAPTURE are pixel; values stay mono.
- [DONE] Splash still uses condensed_bold under the wordmark. Pixel `LORA FIELD DIAGNOSTICS` + `READY`.
- [DONE] Onboarding PROFILE still sets the preset name in condensed_bold_16. Pixel name + 18x24 freq + BW/SF/CR/SYNC card.
- [DONE] NETWORK setup rows still use condensed shell list chrome. Pixel rows, pink rail, ALL PRESETS hint.
- [DONE] SPECTRUM WARNING title is still condensed workbench type. Pixel header/title; FAST/DEEP rows are pixel.
- [DONE] RESET SETUP title is still condensed_bold_16. Pixel `RESET` / `SETUP` header + pixel question.
- [DONE] RESET SETUP still uses add_shell_header condensed chrome, not the pixel setup header. Pixel rows + action strip.
- [DONE] SPECTRUM WARNING and RESET SETUP paint field nav over the y=204 action strip. Those routes no longer draw field nav.
- [DONE] Onboarding CONTROLS TRACKBALL and M/P/S keys still use mono_semibold, not pixel.
- [DONE] Onboarding CHECK rows still use mono labels + mono_semibold values. Pixel labels, mono values.
- [DONE] MAP SAT/MAP/CHART/+/- chip labels still use mono_10, not pixel 6x8.
- [DONE] NODE DETAIL callsign is still mono_semibold_12, not pixel chrome. Pixel 18x24 name + pixel hex line.
- [DONE] Web Chat empty state was an ASCII rule. Instrument card + SEND chip + remaining count.
- [DONE] Web Chat mine messages used a left stripe. Full-row tint instead.
- [DONE] Web NODES empty state was `AWAITING SIGNAL_`. Same instrument empty card as Chat.
- [DONE] Device plots were 8-chunk meters and 1px min/max lines. 1px ridge plots with fixed dB scales; HOME RX well 252x38; AIRTIME linear 304px gauge; TIMELINE 60×1s bars.
- [DONE] HOME LAST RX name still used mono_semibold. Pixel name; `487m  166` when LAST RX has a fix.
- [DONE] RADIO empty listen card still used mono_semibold profile name. Pixel name + 18x24 freq + BW/SF/CR/SYNC.
- [DONE] MAP HUD, scale, bearing strip, and node tags still used mono_10. All pixel 6x8 on SAT/chart.
- [DONE] SPECTRUM paused footer still used mono_semibold. Pixel `SIMULATED / NOT AN RF MEASUREMENT`.
- [DONE] PACKET DETAIL `src > dst` line is still mono_semibold_12, not pixel chrome. Pixel `SRC` / `DST` labels + hex.
- [DONE] Web NODES sort keys and `distDesde` are still Spanish (`visto`/`nombre`/`saltos`/`bateria`). Keys are seen/name/short/hops/battery; helper is `distFrom`.
- [DONE] Web Mesh summary still uses `bateriaBaja` / `saltos` identifiers. Summary fields are English (`lowBattery`/`hops`/`silent`/`active1h`); edge src is `neighbors`.
- [DONE] CHAT composer placeholder is sentence-case `type a message`, not pixel instrument caps. Pixel `TYPE A MESSAGE`; draft stays mono.
- [DONE] HOME GPS `SAT n  H0.9` shares the bottom of the card with the compass heading. Smaller compass at right; SAT clipped left; heading under the ring.
- [DONE] Web Chat placeholder is still sentence-case `type a message`. Analyzer composer now says `TYPE A MESSAGE`.
- [DONE] PACKET DETAIL RF `CENTER` line is still mono_semibold_12. Pixel CENTER + 18x24 MHz + pixel RF rows.
- [DONE] EVENT detail time and body still use mono_semibold_12, not pixel + mono. 18x24 clock, pixel KIND, mono body.
- [DONE] PACKET DETAIL DEC `STATE` / `PORT` / `MESSAGE` still use mono_semibold_12. Pixel STATE 18x24 + KIND/PORT/MSG rows.
- [DONE] PACKET DETAIL RAW `CURRENT WRITER STATE` is still mono_semibold_12. Pixel WRITER / 18x24 STATE + capture rows.
- [DONE] PACKET HEX page header `RAW BYTES` is still muted mono_10, not pixel chrome. Pixel BYTES + 18x24 range + PAGE n/N.
- [DONE] PROTOCOL DETAIL metric values still use mono_semibold_12. Pixel FRAMES/SHARE/CRC 18x24 + MEAN line.
- [DONE] PROTOCOLS list header `N FRAMES / 60s` is still mono_semibold_12. Pixel FRAMES/DEC/CRC /60S + pixel row names.
- [DONE] SURVEY FRAMES / SOURCES / BEST SNR rows still use mono_semibold_12. Pixel labels + 18x24 values; CRC pixel.
- [DONE] SPECTRUM complete footer NOISE/BUSIEST/QUIETEST values still use mono_semibold_12. Pixel NOISE/BUSY/QUIET; idle mode line is pixel pink.
- [DONE] SPECTRUM axis labels (`-11` / `-139` / MHz) are still mono_10. Pixel chips on the plot: dBm + start/end MHz.
- [DONE] TIMELINE activity plot has no dB/time axis chips. Pixel PKT/SNR/CRC scale chips plus -60s/NOW on the CRC well.
- [DONE] AIRTIME utilization plot has no percent axis chips. Gauge chips `0%`/`50%`/`100%`; spark chips max ms/`0`/`OLD`/`NEW`.
- [DONE] HOME RX well `-70`/`-130` are still plain labels, not axis chips like SPECTRUM/TIMELINE/AIRTIME. Chips overlay a 280px spark.
- [DONE] Web Mesh screen locals are still Spanish (`vista`/`grafo`/`actividad`/`actHoras`/`rejilla`/`filas`/`celdas`/`vecinosSel`). Locals are view/graph/activity/actHours/grid/rows/cells/neighborSel.
- [DONE] Web alerts still use Spanish kinds (`bateria`/`mudo`/`autonomia`) plus `nombre`/`autonomiaH`. Kinds are battery/silent/runtime; `runtimeH` still reads legacy `autonomiaH`.
- [DONE] Web battery forecast still names the last sample `ultimo`. Field is `last`.
- [DONE] Web db still exports `loadActividad`. Export is `loadActivity`.
- [DONE] AIRTIME spark header still says `US` while the scale chip is milliseconds. Header follows the chip unit (`MS`/`US`).
- [DONE] HOME RX spark has dB chips but no OLD/NEW time chips. `OLD`/`NEW` sit on the spark with `-70`/`-130`.
- [DONE] SETTINGS RADIO PROFILE still shows the long preset name instead of the US LF / MCORE field tag. Value is `home_profile_tag`.
- [DONE] CHAT empty body is still sentence-case (`Broadcast on LongFast. SEND or Enter.`). Pixel caps: `LONGFAST BCAST. SEND OR ENTER.`
- [DONE] NODES empty body is still sentence-case (`Stay on this profile. Names appear after`). Pixel caps on both hint lines.
- [DONE] AIRTIME empty body is still sentence-case (`Waiting for received LoRa frames.`). Pixel `WAITING FOR RECEIVED LORA FRAMES.`
- [DONE] EVENTS empty body is still sentence-case (`Hardware and analyzer actions appear here.`). Pixel caps.
- [DONE] RADIO listen-card hint is still sentence-case (`Chat and node names appear when a packet lands.`). Pixel `NAMES APPEAR AFTER A PACKET LANDS.`
- [DONE] RADIO listen card still shows the long preset name, not the US LF / MCORE field tag. Uses `home_profile_tag`.
- [DONE] NODE DETAIL empty hint is still sentence-case (`Capture a decoded source first`). Pixel caps on device and simulator empty paths.
- [DONE] NODE DETAIL expired hint is still sentence-case (`Its frames left the capture buffer`). Pixel `ITS FRAMES LEFT THE CAPTURE BUFFER`.
- [DONE] PACKET DETAIL empty/expired hints are still sentence-case (`Open TRAFFIC and wait for radio activity`). Pixel caps on both empty and expired lines.
- [DONE] SPECTRUM warning body is still sentence-case (`Packet receive pauses while the SX1262 scans`). Pixel caps on idle sweep, sim-paused, and FIRST USE body.
- [DONE] FILTER hint is still sentence-case (`Capture files stay complete.`). Pixel `CAPTURE FILES STAY COMPLETE.`
- [DONE] RESET SETUP body is still sentence-case (`Saved radio profile and capture files remain.`). Pixel caps on both body lines.
- [DONE] Onboarding welcome/capability lines are still sentence-case (`Inspect packets, spectrum, nodes, routes,`). Pixel caps on welcome, capabilities, controls, and check.
- [DONE] Onboarding CHECK PROFILE still shows the long preset name, not the US LF / MCORE field tag. CHECK and PROFILE picker use `home_profile_tag`.
- [DONE] CAPTURE path notes are still sentence-case (`LSCAP keeps full RF metadata at every bandwidth.`). Pixel caps on paths and the note.
- [DONE] Gear screens (CAPTURE/SETTINGS/DEVICE) still light the RADIO field tab. Nav defaults to none; only HOME/CHAT/analyzer set a tab.
- [DONE] AIRTIME `BARS` is the fixed `kAirtimeBarCount`, not a live metric. Simulator now shows `FRAMES` from last-minute mix, like the device.
- [DONE] Web Mesh layout comments are still Spanish (`distancia ideal` / `magnitud`). Comments are English.
- [DONE] DISPLAY save-failed line is still mono_10 (`SAVE FAILED - VALUE RESTORED`). Pixel 6x8, same as CAPTURE `SAVE FAILED`.
- [DONE] PROTOCOL DETAIL blurbs are still sentence-case on the BACK strip. Pixel caps; `-60s`/`NOW` are axis chips.
- [DONE] DISPLAY INPUTS row is not a hit target while BRIGHTNESS/KEY LIGHT/GPS/STARTUP/SIMULATE are. Sixth row is selectable; tap and U/D reach it; L/R is status-only.
- [DONE] PROTOCOL DETAIL activity well has no vertical packet-count chips, only `-60s`/`NOW`. Lime `max`/`0` chips overlay the well.
- [DONE] CAPABILITIES tagline sat on the CAPTURE card. Moved to y=190 above the action strip.
- [DONE] HOME LAST RX age is still lowercase (`now` / `Ns ago`) while the rest of HOME is pixel caps. Now `NOW` / `Ns AGO`.
- [DONE] NODE DETAIL SNR/RSSI limits (`+5`/`-25`/`-80`/`-125`) are still plain labels, not axis chips. Black chips overlay the plots.
- [DONE] MAP HUD coords are signed decimal (`37.7749  -122.4186`) while HOME and NODE DETAIL use hemisphere letters. Shared `37.7749 N  122.419 W`.
- [DONE] MAP scale bar still uses spaced lowercase units (`200 m`) while the pink range strip says `487m`. Scale now uses `format_map_range` (`200M`).
- [DONE] Field range strings still use lowercase units (`924m` / `<1m`) on HOME, MAP, and NODE DETAIL. Shared helper now emits `924M` / `<1M` / `1.2KM`.
- [DONE] TIMELINE y=204 strip still repeats `-60s`/`NOW` as labels after the CRC well already has those chips. Strip now holds RATE/MEAN/CRC; rate is `24/MIN`.
- [DONE] Web map/node coords always suffix longitude with E, even for west (`122.1430E` instead of W). Shared `fmtHemisphere` uses W/S.
- [DONE] Web `hhmm` still names its seconds flag `segundos`. Renamed to `seconds`.
- [DONE] Web `fmtDist` still uses lowercase units (`840 m` / `12.4 km`) after field range went to `924M`. Now `840M` / `12.4KM`.
- [DONE] SETTINGS/DISPLAY/HELP/ABOUT still have no BACK ESC chip; only a silent tap band at y=204. Shared BACK ESC strip; PROFILE/CAPTURE/DEVICE too. HELP notes ABOUT.
- [DONE] DEVICE UPTIME still uses lowercase `s` (`142 s`). Now `142S`.
- [DONE] AIRTIME header still says `AIRTIME  60s` with a lowercase s. Header is `60S`; spark chip is `1093MS`. SURVEY timer is `0S/60S`.
- [DONE] Status bar rate is still lowercase `24 pkt/min` on every field screen. Now `24 PKT/MIN`.
- [DONE] NODES LAST ages are still lowercase (`22s` / `14s`) after UPTIME went to `142S`. Shared age helpers now emit `22S` / `14M` / `2H`.
- [DONE] RADIO/NODES UP/DOWN are plain muted labels, not chips like CHAT. Shared pink UP/DOWN chips; EVENTS list footer too.
- [DONE] EVENTS row bodies are still sentence-case (`Channel utilization reached 67%`) while KIND is pixel caps. Shared `ascii_upper`; list and detail are pixel caps.
- [DONE] Web demo log still says `18 pkt/min` after the field status bar went to `PKT/MIN`. Demo line is now `18 PKT/MIN`.
- [DONE] EVENT DETAIL status bar is the static default (`BAT 100%` / `18 PKT/MIN`) while the EVENTS list uses live BAT/GPS/rate. Simulator uses the live status bar.
- [DONE] CHAT status bar is the static default (`BAT 100%` / `GPS LOCK` / `18 PKT/MIN`) instead of live telemetry. Simulator uses the live status bar.
- [DONE] CHAT SEND chip has no ENTER hint, unlike NODE CHAT C / MAP M. Chip is `SEND E` (56px).
- [DONE] SPECTRUM and SURVEY START chips have no ENTER hint, unlike CHAT SEND E. Shared strip now paints `START E` / `STOP E`.
- [DONE] Web Chat SEND button has no ENTER hint after the field chip became `SEND E`. Button is `SEND E`; empty/linked hints are pixel caps.
- [DONE] SPECTRUM FAST/DEEP chips have no key hint, unlike START E. Chips are `FAST U` / `DEEP D`; U/Up select FAST, D/Down select DEEP.
- [DONE] Web Chat toolbar titles are still sentence-case (`Ctrl+F · ESC clears` / `Retry send`). Titles are `CTRL+F · ESC CLEARS` / `RETRY SEND`; search placeholder is pixel caps.
- [DONE] Web Chat hop/state/reply labels are still sentence-case (`direct` / `queued` / `on air LongFast` / `replying to`). Visible hop/state/reply/menu labels are pixel caps.
- [DONE] HOME SET/HELP chips have no key hint (`?` opens HELP; Enter from HOME opens SET). Chips are `SET E` / `HELP ?` at 44px.
- [DONE] MAP SAT/MAP/CHART chips have no key hint. Chips are `SAT I` / `MAP D` / `CHT G` (40px); I/D/G select the layer.
- [DONE] RADIO SPEC/SURV/AIR/EVNT chips have no number-key hints (2 / 5 / 6 / 7). Chips are `SPEC 2` / `SURV 5` / `AIR 6` / `EVNT 7`.
- [DONE] Web Chat tooltips are still sentence-case (`Node actions` / `Reply` / `end-to-end encrypted (PKI)` / export/delete titles). Tooltips are pixel caps.
- [DONE] TIMELINE ALL/MESH/MCORE/RNS/RAW chips have no key hint. Chips are `ALL A` / `MESH H` / `MCORE K` / `RNS N` / `RAW W`.
- [DONE] Web map SAT/MAP/CHART chips do not match field `SAT I` / `MAP D` / `CHT G`. Web chips use the same labels.
- [DONE] TIMELINE MEAN still uses mixed-case `dB` (`-19.8 dB`) after other units went to caps. MEAN is `DB`; axis chip is `-60S`.
- [DONE] PROTOCOL DETAIL MEAN still uses mixed-case `dB` and `-60s`. MEAN is `DB`; axis chip is `-60S`.
- [DONE] PACKET DETAIL SNR still uses mixed-case `dB`. Shared header is `DB`; RF AIR/ERR are `MS`/`HZ`.
- [DONE] SPECTRUM complete NOISE still uses mixed-case `dBm`. Complete footer is `DBM`.
- [OPEN] SPECTRUM idle plan and SCANNING lines still use mixed-case `MHz` / `kHz`.
- [OPEN] PACKET DETAIL BW still uses lowercase `k` (`250.8k`).
- [OPEN] Web analyzer RSSI/SNR still use mixed-case `dB` / `dBm` (ThisDevice, Traffic, Mesh).

## Visual QA checklist (every pass)

- HOME, NODES, MAP, CHAT, RADIO at 320x240
- Empty, one-item, and full-list states
- GPS off / searching / fix
- Chat empty / with messages / TX fail
- Zoom 12 and 16, SAT and MAP
- Nav selected tab is obvious
