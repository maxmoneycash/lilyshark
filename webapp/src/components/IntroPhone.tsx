import { useEffect, useState } from 'react';
import { INTRO_SECTIONS, introScreenLabel } from './intro-copy';
import { TDeckModel } from './TDeckModel';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

const DEVICE_SCREEN_MS = 3200;

/**
 * INTRO on a phone: an ordinary page.
 *
 * The headline and the device come first, then each chapter with its real
 * firmware screens in a strip you swipe sideways. Nothing is pinned and
 * nothing hijacks the scroll: a swipe moves the page, like every other tab.
 */
export function IntroPhone() {
  const [lead, ...chapters] = INTRO_SECTIONS;
  const reducedMotion = usePrefersReducedMotion();
  const [deviceFrame, setDeviceFrame] = useState(0);

  // The device cycles through the first chapter's screens; that is the
  // whole of chapter one, so it gets no strip of its own.
  useEffect(() => {
    if (reducedMotion || lead.screens.length < 2) return;
    const id = window.setInterval(
      () => setDeviceFrame((i) => (i + 1) % lead.screens.length),
      DEVICE_SCREEN_MS,
    );
    return () => window.clearInterval(id);
  }, [reducedMotion, lead.screens.length]);

  return (
    <main className="fill">
      <article className="intro-page" aria-label="Lilyshark introduction">
        <header className="intro-page-hero">
          <h1 className="intro-page-title">{lead.head}</h1>
          <p className="intro-page-lead">{lead.body}</p>
          <div className="intro-page-device">
            <TDeckModel screen={lead.screens[deviceFrame] ?? lead.screens[0]} />
          </div>
        </header>

        {chapters.map((chapter, i) => (
          <section className="intro-page-chapter" key={chapter.head}>
            <p className="intro-page-count" aria-hidden="true">
              {String(i + 2).padStart(2, '0')} / {String(INTRO_SECTIONS.length).padStart(2, '0')}
            </p>
            <h2 className="intro-page-head">{chapter.head}</h2>
            <p className="intro-page-body">{chapter.body}</p>
            <ul className="intro-page-screens" aria-label={`Screens: ${chapter.head}`}>
              {chapter.screens.map((src) => (
                <li className="intro-page-screen" key={src}>
                  <img
                    src={src}
                    width={640}
                    height={480}
                    loading="lazy"
                    decoding="async"
                    alt={`${introScreenLabel(src)} screen on the T-Deck`}
                  />
                  <span className="intro-page-caption">{introScreenLabel(src)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </main>
  );
}
