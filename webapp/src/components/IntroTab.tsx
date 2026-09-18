import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { TDeckModel } from './TDeckModel';
import {
  INTRO_FRAMES,
  INTRO_VIEWPORTS,
  introChapterFromHash,
  introFrameIndex,
  introSectionProgress,
  introSnapTop,
} from './intro-sequence';
import { INTRO_SECTIONS as SECTIONS } from './intro-copy';

/**
 * INTRO — the device, scroll-driven.
 *
 * One interactive T-Deck stays pinned through the curated firmware screens.
 * The original twelve chapters retain their live-site copy (intro-copy.ts).
 * Model movement is independent of this scroll sequence.
 *
 */



export function IntroTab() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

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
    // On a phone the device box is sized explicitly from what the copy
    // leaves over (a flex-grown box gave the canvas no definite height and
    // it painted nothing), so the copy's height is published too.
    const copy = textRef.current;
    const copyResize = () => {
      if (copy) el.style.setProperty('--intro-copy-height', `${copy.offsetHeight}px`);
    };
    const copyObserver = new ResizeObserver(copyResize);
    copyResize();
    if (copy) copyObserver.observe(copy);
    // A `#intro?chapter=N` link lands on that chapter's first screen.
    const chapter = introChapterFromHash(window.location.hash);
    if (chapter !== null) {
      el.scrollTop = introSectionProgress(chapter - 1) * (el.scrollHeight - el.clientHeight);
    }
    return () => {
      observer.disconnect();
      copyObserver.disconnect();
    };
  }, []);

  const { sectionIndex: idx, screen: screenSrc } = INTRO_FRAMES[frameIndex];
  const s = SECTIONS[idx];

  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = 0;
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
            <div className="intro-copy" ref={textRef} tabIndex={0} role="region" aria-label="About Lilyshark">
              {/* Replace copy immediately when scrolling interrupts an entrance.
                  Waiting for an exit can leave an earlier section beside the LCD. */}
              <motion.div
                key={idx}
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
              >
                <h1 className="intro-head">{s.head}</h1>
                <p className="intro-body">{s.body}</p>
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
