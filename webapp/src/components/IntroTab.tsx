import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MeshRoutingDemo, useMeshDemoMode } from './MeshRoutingDemo';
import { TDeckModel } from './TDeckModel';
import {
  INTRO_FRAMES,
  INTRO_SCREEN_GROUPS,
  INTRO_VIEWPORTS,
  introFrameIndex,
  introSnapTop,
} from './intro-sequence';

/**
 * INTRO — the device, scroll-driven.
 *
 * One interactive T-Deck stays pinned through the 42 deployed firmware screens.
 * The original twelve chapters retain their live-site copy and screen order.
 * Model movement is independent of this scroll sequence.
 *
 */

interface Section {
  /** Firmware renders visited by scrolling through this narrative group. */
  screens: readonly string[];
  head: string;
  body: string;
}

/** Copy restored verbatim from lilyshark.com on 2026-09-08 (main-BwMualIR.js). */
const SECTIONS: Section[] = [
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

export function IntroTab({
  onOpen,
  onConnect,
  connected = false,
}: {
  onOpen: (tab: string) => void;
  onConnect?: () => void;
  connected?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [copyEdges, setCopyEdges] = useState('');
  const reducedMotion = usePrefersReducedMotion();
  const [routingMode, setRoutingMode] = useMeshDemoMode(INTRO_FRAMES[frameIndex]?.sectionIndex ?? 0);

  const { scrollYProgress } = useScroll({
    container: scrollRef,
    offset: ['start start', 'end end'],
  });
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    setFrameIndex(introFrameIndex(p));
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Safari can size grid rows from the tall track before applying max-height.
    // Give the pinned stage the actual scroll viewport, including browser chrome.
    const resize = () => el.style.setProperty('--intro-height', `${el.clientHeight}px`);
    const observer = new ResizeObserver(resize);
    resize();
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { sectionIndex: idx, screen: screenSrc } = INTRO_FRAMES[frameIndex];
  const s = SECTIONS[idx];
  const last = frameIndex === INTRO_FRAMES.length - 1;
  const showMeshDemo = idx === 2 || idx === 3;
  const canConnect = Boolean(onConnect) && !connected;

  const updateCopyEdges = () => {
    const el = textRef.current;
    if (!el) return;
    setCopyEdges([
      el.scrollTop > 1 ? 'top' : '',
      el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? 'bottom' : '',
    ].filter(Boolean).join(' '));
  };

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const ro = new ResizeObserver(() => {
      updateCopyEdges();
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [idx]);

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
          {/* Each featured screen has one native stop. The final marker
              is at the maximum scroll position. */}
          {INTRO_FRAMES.map((frame, i) => (
            <div
              className="intro-snap"
              key={frame.screen}
              aria-hidden="true"
              style={{ top: `${introSnapTop(i) * 100}%` }}
            />
          ))}
          <div className="intro-stage">
            <div className="intro-copy" ref={textRef} tabIndex={0} role="region" aria-label="About Lilyshark" data-scroll-edges={copyEdges} onScroll={updateCopyEdges}>
              {/* Replace copy immediately when scrolling interrupts an entrance.
                  Waiting for an exit can leave an earlier section beside the LCD. */}
              <motion.div
                key={idx}
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
                onAnimationComplete={updateCopyEdges}
              >
                <h1 className="intro-head">{s.head}</h1>
                <p className="intro-body">{s.body}</p>
                {idx === 0 && canConnect && (
                  <div className="intro-cta">
                    <button className="primary" onClick={onConnect}>
                      CONNECT A RADIO
                    </button>
                    <button className="cta-link" onClick={() => onOpen('FLASH')}>
                      FLASH A T-DECK
                    </button>
                  </div>
                )}
                {showMeshDemo && (
                  <MeshRoutingDemo mode={routingMode} onModeChange={setRoutingMode} />
                )}
                {last && (
                  <div className="intro-cta">
                    {canConnect && (
                      <button className="primary" onClick={onConnect}>
                        CONNECT A RADIO
                      </button>
                    )}
                    <button className={canConnect ? undefined : 'primary'} onClick={() => onOpen('TRAFFIC')}>
                      OPEN THE ANALYZER
                    </button>
                    <button onClick={() => onOpen('FLASH')}>
                      FLASH A T-DECK
                    </button>
                    <button className="cta-link" onClick={() => onOpen('PAPER')}>
                      READ THE PAPER
                    </button>
                  </div>
                )}
              </motion.div>
            </div>

            <div className="intro-device">
              <TDeckModel screen={screenSrc} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
