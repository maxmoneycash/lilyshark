import { INTRO_SCREEN_GROUPS } from './intro-sequence';

export interface IntroSection {
  /** Firmware renders visited by scrolling through this narrative group. */
  screens: readonly string[];
  head: string;
  body: string;
}

/** Copy restored verbatim from lilyshark.com on 2026-09-08 (main-BwMualIR.js). */
export const INTRO_SECTIONS: IntroSection[] = [
  {
    screens: INTRO_SCREEN_GROUPS[0],
    head: "Turn a $60 handheld into a LoRa packet sniffer.",
    body: "Lilyshark is C++ firmware that turns the LILYGO T-Deck Plus into a packet sniffer and RF analyzer for off-grid mesh networks.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[1],
    head: "Hundreds of thousands of users.",
    body: "Meshtastic has 40,000 GitHub stars and active meshes in most major cities. In protests, it carried 430,000 daily users — and stayed up.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[2],
    head: "Kilometers per hop, not meters.",
    body: "Bluetooth mesh dies at 30–300m. LoRa carries 2–15km per hop across cities and disaster zones. MeshCore spans 64 hops with delivery receipts.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[3],
    head: "Flooded meshes deliver less as they grow. We measured it.",
    body: "A LongFast channel moves about 987 bit/s and flood routing repeats everything: we measured 7.36 transmissions per delivered message, reach collapsing from 68.6% to 25.8% as the mesh grows, saturation near 6,721 nodes. Growth is exactly what breaks it.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[4],
    head: "The firmware measures everything the radio hears.",
    body: "So we built the instrument: a live spectrum waterfall with noise floor and channel occupancy, node rosters with SNR, RSSI and hop-count history, survey mode for coverage runs, and every frame kept with its radio physics.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[5],
    head: "Every anomaly becomes a logged event.",
    body: "CRC failures, profile changes, storage faults, capture starts and stops — the firmware keeps a running event log with one-line causes, and each entry opens into its own detail screen. When something went wrong in the field, you can read back exactly when and why.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[6],
    head: "Three mesh protocols, one capture engine.",
    body: "Meshtastic, MeshCore and Reticulum share one capture engine. Each decoder claims only what it can prove from the frame: packet fields, RF measurements and decode state are separate tabs on the same packet, so interpretation never overwrites measurement.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[7],
    head: "Down to the last byte.",
    body: "What a decoder cannot prove stays as raw hex with frequency, bandwidth, SF, CR, CRC state and airtime. Captures write to microSD as .lscap and export as LoRaTap PCAP — desktop Wireshark opens them.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[8],
    head: "A guided first run, not a config file.",
    body: "The device explains its tools, checks what hardware it is running on, and walks a first-time user through network and radio-profile selection before the Home screen ever appears. No companion app, no serial console, no YAML.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[9],
    head: "It teaches its own controls.",
    body: "The trackball, keyboard and shortcuts are taught on the device, the hardware check reports radio, storage, GPS and battery, and Help stays one keypress away. A field tool has to work where the manual is whatever the screen says.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[10],
    head: "Every control lives on the device.",
    body: "Radio profiles, display and input, capture and storage, setup reset — all of it adjustable from the T-Deck itself. Change a spreading factor at the trailhead without opening a laptop.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[11],
    head: "Captures are stored on Shelby; the mesh carries an 82-byte pointer.",
    body: "Captures are evidence, so they live in Shelby's content-addressed storage on Aptos. A radio has no uplink — it broadcasts an 82-byte pointer instead, and any connected node resolves the bytes. Radio-frequency capture meets verifiable storage for the first time.",
  },
];

/** Plain-word names for the firmware screens, keyed by their asset name. */
export const INTRO_SCREEN_LABELS: Record<string, string> = {
  splash: 'Splash',
  home: 'Home',
  traffic: 'Traffic',
  'traffic-live': 'Live traffic',
  protocols: 'Protocols',
  'protocol-detail': 'Protocol detail',
  nodes: 'Nodes',
  map: 'Map',
  'node-detail': 'Node detail',
  survey: 'Survey',
  utilization: 'Channel use',
  timeline: 'Timeline',
  'timeline-live': 'Live timeline',
  'traffic-filter': 'Traffic filter',
  spectrum: 'Spectrum',
  'spectrum-live': 'Live spectrum',
  'spectrum-warning': 'Spectrum warning',
  events: 'Events',
  'event-detail': 'Event detail',
  'packet-detail': 'Packet',
  'packet-live': 'Live packet',
  'packet-pkt': 'Packet fields',
  'packet-rf': 'Radio measurements',
  'packet-dec': 'Decode state',
  'packet-hex': 'Hex view',
  'packet-hex-2': 'Hex view, page 2',
  'packet-hex-3': 'Hex view, page 3',
  'packet-raw': 'Raw bytes',
  'setup-welcome': 'Welcome',
  'setup-profile': 'Choose a profile',
  'setup-controls': 'Controls',
  'radio-profile': 'Radio profile',
  storage: 'Storage',
};

/** `/intro/fw/traffic-live.png` -> `traffic-live`. */
export function introScreenName(src: string): string {
  return src.replace(/^.*\//, '').replace(/\.png$/, '');
}

export function introScreenLabel(src: string): string {
  return INTRO_SCREEN_LABELS[introScreenName(src)] ?? introScreenName(src);
}
