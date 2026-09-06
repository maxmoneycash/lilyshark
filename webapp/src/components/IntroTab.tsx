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

/**
 * The argument, in twelve beats. Every number here is from the whitepaper the
 * PAPER tab ships — measured or sourced there, not invented for a landing
 * page. The screens are the firmware's own render-test output: all 42 of the
 * simulator's pixel-locked frames, distributed across the beats they belong
 * to. Each screen has a native scroll stop within the original track length.
 */
const SECTIONS: Section[] = [
  {
    screens: INTRO_SCREEN_GROUPS[0],
    head: 'Turn a $60 handheld into a LoRa packet sniffer.',
    body: 'Lilyshark is C++ firmware that turns the LILYGO T-Deck Plus — a $60 handheld with a LoRa radio, QWERTY keyboard and GPS — into a packet sniffer and RF analyzer for off-grid mesh networks.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[1],
    head: 'Mesh networks already carry hundreds of thousands of users.',
    body: 'Meshtastic passed 40,000 GitHub stars and an 80,000-member subreddit, with 100+ supported boards, sub-$50 entry devices, and active meshes in most major US cities. When India ordered a mesh app off GitHub during the Delhi protests, it was carrying 430,000 daily users — and stayed up.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[2],
    head: 'LoRa carries kilometers per hop, not meters.',
    body: "Bluetooth mesh dies at 30–300 m — it works at a protest because a protest is a crowd. LoRa carries 2–15 km per hop, across a city, a county, a disaster zone; MeshCore's source routing now spans 64 hops with deterministic delivery receipts.",
  },
  {
    screens: INTRO_SCREEN_GROUPS[3],
    head: 'Flooded meshes deliver less as they grow. We measured it.',
    body: 'A LongFast channel moves about 987 bit/s and flood routing repeats everything: we measured 7.36 transmissions per delivered message, reach collapsing from 68.6% to 25.8% as the mesh grows, saturation near 6,721 nodes. Growth is exactly what breaks it.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[4],
    head: 'The firmware measures everything the radio hears.',
    body: 'So we built the instrument: a live spectrum waterfall with noise floor and channel occupancy, node rosters with SNR, RSSI and hop-count history, survey mode for coverage runs, and every frame kept with its radio physics.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[5],
    head: 'Every anomaly becomes a logged event.',
    body: 'CRC failures, profile changes, storage faults, capture starts and stops — the firmware keeps a running event log with one-line causes, and each entry opens into its own detail screen. When something went wrong in the field, you can read back exactly when and why.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[6],
    head: 'Three mesh protocols, one capture engine.',
    body: 'Meshtastic, MeshCore and Reticulum share one capture engine. Each decoder claims only what it can prove from the frame: packet fields, RF measurements and decode state are separate tabs on the same packet, so interpretation never overwrites measurement.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[7],
    head: 'Down to the last byte.',
    body: 'What a decoder cannot prove stays as raw hex with frequency, bandwidth, SF, CR, CRC state and airtime. Captures write to microSD as .lscap and export as LoRaTap PCAP — desktop Wireshark opens them.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[8],
    head: 'A guided first run, not a config file.',
    body: 'The device explains its tools, checks what hardware it is running on, and walks a first-time user through network and radio-profile selection before the Home screen ever appears. No companion app, no serial console, no YAML.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[9],
    head: 'It teaches its own controls.',
    body: 'The trackball, keyboard and shortcuts are taught on the device, the hardware check reports radio, storage, GPS and battery, and Help stays one keypress away. A field tool has to work where the manual is whatever the screen says.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[10],
    head: 'Every control lives on the device.',
    body: 'Radio profiles, display and input, capture and storage, setup reset — all of it adjustable from the T-Deck itself. Change a spreading factor at the trailhead without opening a laptop.',
  },
  {
    screens: INTRO_SCREEN_GROUPS[11],
    head: 'Captures are stored on Shelby; the mesh carries an 82-byte pointer.',
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
            <div className="intro-copy" ref={textRef}>
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
