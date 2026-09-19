import { INTRO_SCREEN_GROUPS } from './intro-sequence';

export interface IntroSection {
  /** Firmware renders visited by scrolling through this narrative group. */
  screens: readonly string[];
  head: string;
  body: string;
}

/**
 * One chapter per scroll stop. Every heading and paragraph is written to the
 * same length (Max, 2026-09-18) so the block of words below the device never
 * changes height, and the device never has to move to make room for it.
 */
export const INTRO_SECTIONS: IntroSection[] = [
  {
    screens: INTRO_SCREEN_GROUPS[0],
    head: "Turn a $60 handheld into a sniffer.",
    body: "Lilyshark is C++ firmware for the LILYGO T-Deck Plus. It turns a pocket keyboard computer into a packet sniffer and RF analyzer for mesh radio.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[1],
    head: "Hundreds of thousands of users.",
    body: "Meshtastic has 40,000 GitHub stars and live meshes in most major cities. In one protest it carried 430,000 people in a day, and it stayed up.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[2],
    head: "Kilometers per hop, not meters.",
    body: "Bluetooth mesh dies at 30 to 300 m. LoRa carries 2 to 15 km per hop across cities and disaster zones, and MeshCore spans 64 hops with receipts.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[3],
    head: "Flooded meshes deliver less as they grow.",
    body: "We measured 7.36 transmissions per delivered message on LongFast, and reach falling from 68.6% to 25.8% as the mesh fills up. Growth breaks it.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[4],
    head: "The radio gets an instrument panel.",
    body: "A live spectrum waterfall with noise floor and channel use, node rosters carrying SNR, RSSI and hop counts, and a survey mode for coverage runs.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[5],
    head: "Every anomaly becomes a logged event.",
    body: "CRC failures, profile changes, storage faults and capture starts land in a running event log, each with a one-line cause and its own detail screen.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[6],
    head: "Three mesh protocols, one capture engine.",
    body: "Meshtastic, MeshCore and Reticulum share one capture engine. Each decoder claims only what the frame proves, so reading never overwrites measurement.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[7],
    head: "Readable down to the last byte.",
    body: "What no decoder can prove stays raw hex, with frequency, bandwidth, spreading factor, CRC state and airtime. Captures export as PCAP for Wireshark.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[8],
    head: "Captures are evidence, so they persist.",
    body: "Captures live in Shelby's content-addressed storage on Aptos. A radio has no uplink, so it sends an 82-byte pointer any connected node resolves.",
  },
];
