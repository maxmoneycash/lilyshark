import { INTRO_SCREEN_GROUPS } from './intro-sequence';

export interface IntroSection {
  /** Firmware renders visited by scrolling through this narrative group. */
  screens: readonly string[];
  head: string;
  body: string;
}

/**
 * One chapter per scroll stop.
 *
 * The frame is Wireshark for mesh radio (Max, 2026-09-18): the opening line
 * makes that claim and every heading after it answers "what am I looking at
 * here?" about the screen on the device beside it. What used to be argued in
 * its own chapter — how many people run these meshes, how far a hop carries —
 * is now evidence inside the paragraph that needs it.
 *
 * Every heading and paragraph is written to the same length so the block of
 * words below the device never changes height, and the device never has to
 * move to make room for it.
 */
export const INTRO_SECTIONS: IntroSection[] = [
  {
    screens: INTRO_SCREEN_GROUPS[0],
    head: "Wireshark for mesh radio.",
    body: "Lilyshark is C++ firmware for the $60 LILYGO T-Deck Plus. It puts a LoRa radio into receive and explains every frame that lands, field by field.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[1],
    head: "Every frame the radio hears.",
    body: "Meshtastic alone has 40,000 stars and live meshes in most major cities. The traffic list names each sender, its protocol and the signal it rode in on.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[2],
    head: "Where each frame came from.",
    body: "LoRa carries 2 to 15 km per hop, so a neighbour can be a valley away. The map places every node you have heard, with its history of hops and signal.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[3],
    head: "How busy the channel really is.",
    body: "Flood routing repeats everything: we measured 7.36 transmissions per delivered message. Airtime and channel use show the band filling in real time.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[4],
    head: "The band, drawn as you watch.",
    body: "A sweep becomes a waterfall with a noise floor and peak hold, so a brief transmitter two channels over is a mark on screen you can point at.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[5],
    head: "Everything odd, written down.",
    body: "CRC failures, profile changes, storage faults and capture starts land in a running log, each with a one-line cause and its own detail screen.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[6],
    head: "One packet, taken apart.",
    body: "Packet fields, radio measurements and decode state are separate tabs on one frame, so what a decoder guessed never overwrites what was measured.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[7],
    head: "The bytes, with nothing hidden.",
    body: "What no decoder can prove stays raw hex, beside the frequency, bandwidth, spreading factor, CRC state and the airtime that frame actually took.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[8],
    head: "Captures you can open later.",
    body: "Captures write to microSD as .lscap and export as LoRaTap PCAP, which desktop Wireshark opens. An 82-byte Shelby pointer puts one on the mesh.",
  },
];
