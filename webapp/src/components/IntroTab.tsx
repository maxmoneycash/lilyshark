import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';

/**
 * INTRO — the device, scroll-driven.
 *
 * One T-Deck photo (matted to transparency) stays pinned while scrolling
 * swaps the firmware screens on its display and brings a new headline up for
 * each one. The screens are the real LVGL simulator frames at the device's
 * exact 320×240 layout, composited into the photo's display rectangle, so
 * what the page shows is what the hardware shows.
 *
 * Headlines are laid out with Cheng Lou's pretext — line breaks computed from
 * the font's own metrics, no DOM measurement, no reflow — and each word rides
 * its own framer-motion spring. Pretext gives the words their resting
 * positions; the springs give them their entrance.
 */

const DEVICE = '/intro/tdeck.webp';
/** The display rectangle inside the device photo, as fractions of its box. */
const SCREEN = { left: 0.0619, top: 0.3656, width: 0.8704, height: 0.2921 };

interface Section {
  /** Firmware renders this beat cycles through on the device's display. */
  screens: string[];
  head: string;
  body: string;
}

const fw = (name: string) => `/intro/fw/${name}.png`;

/**
 * The argument, in eight beats. Every number here is from the whitepaper the
 * PAPER tab ships — measured or sourced there, not invented for a landing
 * page. The screens are the firmware's own render-test output: all 38 of the
 * simulator's pixel-locked frames, distributed across the beats they belong
 * to and cycled on the device's display while a section is up.
 */
const SECTIONS: Section[] = [
  {
    screens: ['splash', 'home'].map(fw),
    head: 'A packet sniffer for the mesh age.',
    body: 'Lilyshark is C++ firmware that turns the LILYGO T-Deck Plus — a $60 handheld with a LoRa radio, QWERTY keyboard and GPS — into a packet sniffer and RF analyzer for off-grid mesh networks.',
  },
  {
    screens: ['traffic', 'protocols', 'protocol-detail', 'nodes'].map(fw),
    head: 'Off-grid went mainstream.',
    body: 'Meshtastic passed 40,000 GitHub stars and an 80,000-member subreddit, with 100+ supported boards, sub-$50 entry devices, and active meshes in most major US cities. When India ordered a mesh app off GitHub during the Delhi protests, it was carrying 430,000 daily users — and stayed up.',
  },
  {
    screens: ['map', 'node-detail', 'survey'].map(fw),
    head: 'Kilometers, not meters.',
    body: "Bluetooth mesh dies at 30–300 m — it works at a protest because a protest is a crowd. LoRa carries 2–15 km per hop, across a city, a county, a disaster zone; MeshCore's source routing now spans 64 hops with deterministic delivery receipts.",
  },
  {
    screens: ['utilization', 'timeline', 'traffic-filter'].map(fw),
    head: 'The air is the bottleneck.',
    body: 'A LongFast channel moves about 987 bit/s and flood routing repeats everything: we measured 7.36 transmissions per delivered message, reach collapsing from 68.6% to 25.8% as the mesh grows, saturation near 6,721 nodes. Growth is exactly what breaks it.',
  },
  {
    screens: ['spectrum', 'spectrum-warning', 'events', 'event-detail'].map(fw),
    head: "You can't fix what you can't see.",
    body: 'So we built the instrument: a live spectrum waterfall with noise floor and channel occupancy, node rosters with SNR, RSSI and hop-count history, survey mode for coverage runs, and every frame kept with its radio physics.',
  },
  {
    screens: [
      'packet-detail',
      'packet-pkt',
      'packet-rf',
      'packet-dec',
      'packet-hex',
      'packet-hex-2',
      'packet-hex-3',
      'packet-raw',
    ].map(fw),
    head: 'Down to the byte.',
    body: 'Meshtastic, MeshCore and Reticulum share one capture engine. Each decoder claims only what it can prove from the frame; the rest stays as raw hex with frequency, bandwidth, SF, CR, CRC state and airtime. Captures write to microSD as .lscap and export as LoRaTap PCAP — desktop Wireshark opens them.',
  },
  {
    screens: [
      'setup-welcome',
      'setup-capabilities',
      'setup-network',
      'setup-profile',
      'setup-controls',
      'setup-ready',
      'settings',
      'radio-profile',
      'display-input',
      'device-status',
      'help',
      'about',
      'reset-setup',
    ].map(fw),
    head: 'The first T-Deck firmware built to be seen.',
    body: 'A complete LVGL device shell — guided first run, Home, live diagnostics, Help — instead of a debug menu. T-Deck Plus first, and portable to Meshtastic-class radios with a screen.',
  },
  {
    screens: ['storage'].map(fw),
    head: 'The first Shelby × LoRa application.',
    body: "Captures are evidence, so they live in Shelby's content-addressed storage on Aptos. A radio has no uplink — it broadcasts an 82-byte pointer instead, and any connected node resolves the bytes. Radio-frequency capture meets verifiable storage for the first time.",
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
  const [idx, setIdx] = useState(0);
  const [textW, setTextW] = useState(0);

  const { scrollYProgress } = useScroll({ container: scrollRef });
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    setIdx(Math.min(SECTIONS.length - 1, Math.max(0, Math.floor(p * SECTIONS.length))));
  });

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTextW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fontPx = textW > 700 ? 46 : textW > 420 ? 34 : 27;
  const headlines = useHeadlines(textW, fontPx);
  const s = SECTIONS[idx];
  const last = idx === SECTIONS.length - 1;

  // While a section is up, the device pages through that beat's screens —
  // this is how all 38 firmware renders get shown without 38 sections.
  const [sub, setSub] = useState(0);
  useEffect(() => {
    setSub(0);
    if (SECTIONS[idx].screens.length < 2) return;
    const id = setInterval(() => setSub((v) => v + 1), 2100);
    return () => clearInterval(id);
  }, [idx]);
  const screenSrc = s.screens[sub % s.screens.length];

  return (
    <main className="fill">
      <div className="intro-scroll" ref={scrollRef}>
        <div
          className="intro-track"
          style={
            {
              height: `${SECTIONS.length * 100}%`,
              // The stage divides the track back into one viewport; hardcoding
              // the count in CSS once left the stage 20% too tall when a
              // section was added, pushing the device half off screen.
              '--intro-n': SECTIONS.length,
            } as CSSProperties
          }
        >
          {/* Invisible snap areas, one per section. Absolutely positioned so
              the sticky stage stays the only in-flow child; mandatory snap +
              snap-stop turns each flick into exactly one section instead of a
              free scroll that sails past three. */}
          {SECTIONS.map((sec, i) => (
            <div
              className="intro-snap"
              key={sec.head}
              style={{ top: `${(i * 100) / SECTIONS.length}%` }}
            />
          ))}
          <div className="intro-stage">
            <div className="intro-copy" ref={textRef}>
              <AnimatePresence mode="wait">
                <motion.div key={idx} exit={{ opacity: 0, transition: { duration: 0.07 } }}>
                  <h1 className="intro-head" style={{ fontSize: fontPx }} aria-label={s.head}>
                    {(headlines?.[idx] ?? [s.head]).map((line, li) => (
                      <span className="intro-line" key={line + li}>
                        {line.split(' ').map((w, wi) => (
                          <motion.span
                            className="intro-word"
                            key={w + wi}
                            initial={{ opacity: 0, y: 26 }}
                            animate={{
                              opacity: 1,
                              y: 0,
                              transition: { ...wordSpring, delay: (li * 3 + wi) * 0.05 },
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
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0, transition: { ...wordSpring, delay: 0.28 } }}
                  >
                    {s.body}
                  </motion.p>
                  {last && (
                    <motion.div
                      className="intro-cta"
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0, transition: { ...wordSpring, delay: 0.42 } }}
                    >
                      <button className="primary" onClick={() => onOpen('TRAFFIC')}>
                        OPEN THE ANALYZER
                      </button>
                      <button onClick={() => onOpen('PAPER')}>READ THE PAPER</button>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
              {idx === 0 && (
                <div className="intro-hint dim" aria-hidden="true">
                  SCROLL ▾
                </div>
              )}
            </div>

            <div className="intro-device">
              <img className="intro-device-img" src={DEVICE} alt="LILYGO T-Deck running Lilyshark" />
              <div
                className="intro-screen"
                style={{
                  left: `${SCREEN.left * 100}%`,
                  top: `${SCREEN.top * 100}%`,
                  width: `${SCREEN.width * 100}%`,
                  height: `${SCREEN.height * 100}%`,
                }}
              >
                <AnimatePresence mode="popLayout">
                  <motion.img
                    key={screenSrc}
                    src={screenSrc}
                    alt=""
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: 0.32 } }}
                    exit={{ opacity: 0, transition: { duration: 0.22 } }}
                  />
                </AnimatePresence>
              </div>
            </div>

            <div className="intro-rail" aria-hidden="true">
              {SECTIONS.map((sec, i) => (
                <button
                  key={sec.head}
                  className={i === idx ? 'on' : ''}
                  tabIndex={-1}
                  onClick={() => {
                    const el = scrollRef.current;
                    if (el)
                      el.scrollTo({
                        top: (el.scrollHeight - el.clientHeight) * (i / (SECTIONS.length - 1)),
                        behavior: 'smooth',
                      });
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
