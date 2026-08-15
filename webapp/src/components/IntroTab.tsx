import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
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
  screen: string;
  head: string;
  body: string;
}

/**
 * The argument, in six beats. Every number here is from the whitepaper the
 * PAPER tab ships — measured or sourced there, not invented for the landing.
 */
const SECTIONS: Section[] = [
  {
    screen: '/intro/screen-splash.png',
    head: 'Wireshark for mesh radio.',
    body: 'Lilyshark turns a LILYGO T-Deck into a handheld analyzer for LoRa mesh traffic — and the first firmware on this hardware built to look as good as it works.',
  },
  {
    screen: '/intro/screen-home.png',
    head: 'Off-grid is having a moment.',
    body: 'No carrier, no account, no server. During the 2025–26 blackouts one Bluetooth-mesh app was downloaded 48,800 times in a single day in Nepal and hit 430,000 daily users in India — and LoRa meshes like Meshtastic and MeshCore carry the same idea kilometres per hop.',
  },
  {
    screen: '/intro/screen-traffic.png',
    head: 'The air is the bottleneck.',
    body: 'A LongFast channel moves about 987 bit/s, and flood routing makes every node repeat everything. We measured a rebroadcast factor of 7.36 — delivery reach collapses from 68.6% to 25.8% as a mesh grows, saturating near 6,721 nodes.',
  },
  {
    screen: '/intro/screen-spectrum.png',
    head: "You can't fix what you can't see.",
    body: 'So we built the instrument: every frame captured with its RSSI, SNR, airtime and CRC, a live survey of the band, node and route maps, and LoRaTap PCAP export that Wireshark itself opens.',
  },
  {
    screen: '/intro/screen-settings.png',
    head: "Firmware you'd show someone.",
    body: 'A complete device shell — guided first run, live diagnostics, capture to microSD — on the T-Deck first, and built to travel to any Meshtastic-class radio with a screen.',
  },
  {
    screen: '/intro/screen-onboarding.png',
    head: 'Storage meets radio.',
    body: "The first application pairing Shelby's content-addressed storage with LoRa mesh: a capture is too big for the air, so the radio broadcasts an 82-byte pointer and any connected node resolves the bytes — evidence nobody can quietly edit.",
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

  return (
    <main className="fill">
      <div className="intro-scroll" ref={scrollRef}>
        <div className="intro-track" style={{ height: `${SECTIONS.length * 100}%` }}>
          <div className="intro-stage">
            <div className="intro-copy" ref={textRef}>
              <AnimatePresence mode="wait">
                <motion.div key={idx} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
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
                    key={s.screen}
                    src={s.screen}
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
                  key={sec.screen}
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
