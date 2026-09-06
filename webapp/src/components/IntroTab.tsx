import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import { TDeckModel } from './TDeckModel';
import {
  INTRO_FRAMES,
  INTRO_SCREEN_GROUPS,
  INTRO_VIEWPORTS,
  introFrameIndex,
  introSectionProgress,
  introSnapTop,
} from './intro-sequence';

/**
 * INTRO — the device, scroll-driven.
 *
 * One interactive T-Deck stays pinned while scrolling steps through all 42
 * firmware screens. The twelve original headlines follow their screen groups.
 * Model movement is independent of this scroll sequence.
 *
 * Headlines are laid out with Cheng Lou's pretext — line breaks computed from
 * the font's own metrics, no DOM measurement, no reflow — and each word rides
 * its own framer-motion spring. Pretext gives the words their resting
 * positions; the springs give them their entrance.
 */

interface Section {
  /** Firmware renders visited by scrolling through this narrative group. */
  screens: readonly string[];
  head: string;
  body: string;
}

/** Each section describes the firmware screens shown beside it. */
const SECTIONS: Section[] = [
  {
    screens: INTRO_SCREEN_GROUPS[0],
    head: 'A LoRa packet sniffer for your T-Deck.',
    body: 'Lilyshark turns the LILYGO T-Deck and T-Deck Plus into a handheld tool for inspecting mesh radio traffic. Open a packet to read its headers and raw bytes, then save a capture for Wireshark. The firmware is open source.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[1],
    head: "See who's on the channel.",
    body: 'Watch LoRa frames arrive in the traffic feed. Check which protocols are active and open a node to see when it was last heard. Source IDs and routing details appear when the received packet exposes them.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[2],
    head: 'Check reception as you move.',
    body: 'Run a survey to record received packets and signal measurements. Compare RSSI and SNR between locations, or open the map to see positions reported by nearby nodes. The T-Deck Plus has GPS for your own position.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[3],
    head: "Find out what's using the airtime.",
    body: 'Put packet rate, signal levels and CRC failures on the same timeline. Filter the traffic view by protocol or decode state to inspect a burst of activity. The capture keeps the frames you filtered out.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[4],
    head: 'Scan the band.',
    body: 'Use the SX1262 to look for activity around your channel. The spectrum waterfall shows how signal levels change over time. Packet reception pauses during a sweep and resumes when it finishes.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[5],
    head: 'Check the log when something breaks.',
    body: 'The event log records radio changes, capture activity and hardware faults. Open an entry for the details when a capture stops or the microSD card fails to write.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[6],
    head: 'Inspect mesh packet headers.',
    body: "Lilyshark has decoders for Meshtastic, MeshCore and Reticulum/RNode framing. Packet details keep decoded fields beside the radio measurements. Anything the decoder can't read stays available as raw bytes.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[7],
    head: 'Open the hex dump.',
    body: 'Page through the captured bytes alongside frequency, spreading factor, coding rate and CRC state. Save .lscap and LoRaTap PCAP files to microSD for inspection on a computer. Wireshark can open the PCAP files.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[8],
    head: 'Set the radio for your mesh.',
    body: "Choose the network and radio profile during first boot. Match the frequency, bandwidth and spreading factor to the traffic you want to receive. A radio listening with the wrong settings won't see those packets.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[9],
    head: 'Use the keyboard and trackball.',
    body: 'Move between tools and open packets on the T-Deck itself. Setup shows the controls, and the device status screen reports the radio, storage, GPS and battery state. Keyboard shortcuts are listed in Help.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[10],
    head: 'Change settings on the device.',
    body: 'Switch radio profiles or adjust individual LoRa parameters from Settings. Capture controls show whether the card is writing and where the files are going. Display brightness and input settings live here too.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[11],
    head: 'Share a capture over a slow link.',
    body: 'Upload a capture to Shelby from the web analyzer, then share an 82-byte reference over LoRa. A recipient with internet access can use it to fetch the file. Local captures stay on your microSD card until you choose to share them.',
  },
];

const MONO = '"JetBrains Mono"';

/** Pretext line layout for one headline at one size, memoized by its inputs. */
function useHeadlines(width: number, fontPx: number): string[][] | null {
  const [lines, setLines] = useState<string[][] | null>(null);
  useEffect(() => {
    if (width <= 0) return;
    let dead = false;
    void (async () => {
      try {
        await document.fonts.load(`700 ${fontPx}px ${MONO}`);
      } catch {
        /* fall through — pretext measures with whatever the canvas resolves */
      }
      if (dead) return;
      try {
        const out = SECTIONS.map((s) => {
          const prepared = prepareWithSegments(s.head, `700 ${fontPx}px ${MONO}`);
          const { lines } = layoutWithLines(prepared, width, fontPx * 1.18);
          return lines.map((l: { text: string }) => l.text);
        });
        if (!dead) setLines(out);
      } catch {
        // pretext unavailable for any reason: single-line fallback
        if (!dead) setLines(SECTIONS.map((s) => [s.head]));
      }
    })();
    return () => {
      dead = true;
    };
  }, [width, fontPx]);
  return lines;
}

const wordSpring = { type: 'spring', stiffness: 420, damping: 34 } as const;

export function IntroTab({ onOpen }: { onOpen: (tab: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [textW, setTextW] = useState(0);
  const [compactPhone, setCompactPhone] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const { scrollYProgress } = useScroll({
    container: scrollRef,
    offset: ['start start', 'end end'],
  });
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    setFrameIndex(introFrameIndex(p));
  });

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTextW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Match the compact CSS breakpoint so pretext measures the displayed size.
    const query = window.matchMedia('(max-width: 860px) and (max-height: 720px)');
    const update = () => setCompactPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const fontPx = compactPhone
    ? textW > 330 ? 22 : 20
    : textW > 700 ? 46 : textW > 420 ? 34 : 27;
  const headlines = useHeadlines(textW, fontPx);
  const { sectionIndex: idx, screen: screenSrc } = INTRO_FRAMES[frameIndex];
  const s = SECTIONS[idx];
  const last = idx === SECTIONS.length - 1;

  const jumpToSection = (sectionIndex: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: (el.scrollHeight - el.clientHeight) * introSectionProgress(sectionIndex),
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <main className="fill">
      <div
        className="intro-scroll"
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label="Lilyshark introduction"
      >
        <div
          className="intro-track"
          style={
            {
              height: `${INTRO_VIEWPORTS * 100}%`,
              '--intro-n': INTRO_VIEWPORTS,
            } as CSSProperties
          }
        >
          {/* Forty-two native stops share the original twelve-viewport
              track. The final marker is at the maximum scroll position. */}
          {INTRO_FRAMES.map((frame, i) => (
            <div
              className="intro-snap"
              key={frame.screen}
              aria-hidden="true"
              style={{ top: `${introSnapTop(i) * 100}%` }}
            />
          ))}
          <div className="intro-stage">
            <div className="intro-copy" ref={textRef} tabIndex={0} role="region" aria-label="About Lilyshark">
              {/* Replace copy immediately when scrolling interrupts an entrance.
                  Waiting for an exit can leave an earlier section beside the LCD. */}
              <div key={idx}>
                <h1 className="intro-head" style={{ fontSize: fontPx }} aria-label={s.head}>
                  {(headlines?.[idx] ?? [s.head]).map((line, li) => (
                    <span className="intro-line" key={line + li}>
                      {line.split(' ').map((w, wi) => (
                        <motion.span
                          className="intro-word"
                          key={w + wi}
                          initial={reducedMotion ? false : { opacity: 0, y: 26 }}
                          animate={{
                            opacity: 1,
                            y: 0,
                            transition: reducedMotion
                              ? { duration: 0 }
                              : { ...wordSpring, delay: (li * 3 + wi) * 0.05 },
                          }}
                        >
                          {w}
                        </motion.span>
                      ))}
                    </span>
                  ))}
                </h1>
                <motion.p
                  className="intro-body"
                  initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0, transition: reducedMotion ? { duration: 0 } : { ...wordSpring, delay: 0.28 } }}
                >
                  {s.body}
                </motion.p>
                {last && (
                  <motion.div
                    className="intro-cta"
                    initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0, transition: reducedMotion ? { duration: 0 } : { ...wordSpring, delay: 0.42 } }}
                  >
                    <button className="primary" onClick={() => onOpen('TRAFFIC')}>
                      OPEN THE ANALYZER
                    </button>
                    <button onClick={() => onOpen('FLASH')}>
                      FLASH A T-DECK
                    </button>
                    <button className="cta-link" onClick={() => onOpen('PAPER')}>
                      READ THE PAPER
                    </button>
                  </motion.div>
                )}
              </div>
              {idx === 0 && (
                <div className="intro-hint dim" aria-hidden="true">
                  SCROLL ▾
                </div>
              )}
            </div>

            <div className="intro-device">
              <TDeckModel screen={screenSrc} />
            </div>

            <nav className="intro-pager" aria-label="Introduction sections">
              <button type="button" disabled={idx === 0} onClick={() => jumpToSection(idx - 1)}>PREVIOUS</button>
              <span>{idx + 1} / {SECTIONS.length}</span>
              <button type="button" disabled={last} onClick={() => jumpToSection(idx + 1)}>NEXT</button>
            </nav>

            <nav className="intro-rail" aria-label="Introduction sections">
              {SECTIONS.map((sec, i) => (
                <button
                  key={sec.head}
                  type="button"
                  className={i === idx ? 'on' : ''}
                  aria-label={`Section ${i + 1}: ${sec.head}`}
                  aria-current={i === idx ? 'step' : undefined}
                  onClick={() => jumpToSection(i)}
                />
              ))}
            </nav>
          </div>
        </div>
      </div>
    </main>
  );
}
