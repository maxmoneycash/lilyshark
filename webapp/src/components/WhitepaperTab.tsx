import { useEffect, useRef, useState } from 'react';

/**
 * Whitepaper — the research the pointer design rests on.
 *
 * Deliberately short on the page. Four numbers and one paragraph earn the click;
 * the argument itself lives in the document, opened in a modal reader or taken
 * away as a file.
 */

const PDF = '/lilyshark-whitepaper.pdf';

const READOUTS = [
  { v: '7.36', u: '', k: 'Rebroadcast factor' },
  { v: '68.6→25.8', u: '%', k: 'Reach as nodes grow' },
  { v: '6,721', u: 'nodes', k: 'Transit saturation' },
  { v: '67', u: 'pp', k: '26 figures · 52 sources' },
];

function Reader({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Freeze the page behind the reader so only the document scrolls.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="ls-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="The Growth Trap in Proof of Physical Work"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ls-modal">
        <div className="ls-panel-h" style={{ borderRadius: 0 }}>
          <strong className="ls-h2">The Growth Trap in Proof of Physical Work</strong>
          <span className="ls-label dim" style={{ marginLeft: 'auto' }}>67 pages</span>
          <a className="ls-btn" href={PDF} download="lilyshark-whitepaper.pdf">Download</a>
          <button ref={closeRef} className="ls-btn" onClick={onClose} aria-label="Close reader">Close</button>
        </div>
        {/* #view=FitH keeps the document at page width, so the reader scrolls in
            one direction only and never shows a horizontal bar. */}
        <iframe
          src={`${PDF}#view=FitH&toolbar=0`}
          title="The Growth Trap in Proof of Physical Work"
          style={{ flex: 1, width: '100%', border: 0, background: 'var(--ls-bg)' }}
        />
      </div>
    </div>
  );
}

export function WhitepaperTab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        <header>
          <p className="ls-label" style={{ margin: 0 }}>Lilyshark research · August 2026</p>
          <h1 className="ls-h1" style={{ marginTop: '0.4rem' }}>
            The Growth Trap in Proof of Physical Work
          </h1>
          <p className="ls-sub">
            Adding operators makes most DePIN networks worse at the thing they sell.
            Measured on the largest deployed mesh in the world — and the reason this
            firmware sends an 82-byte pointer instead of a payload.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button className="ls-btn ls-btn--primary" onClick={() => setOpen(true)}>Read the paper</button>
            <a className="ls-btn" href={PDF} download="lilyshark-whitepaper.pdf">Download PDF</a>
          </div>
        </header>

        <dl className="ls-readouts">
          {READOUTS.map((r) => (
            <div className="ls-readout" key={r.k}>
              <dt>{r.k}</dt>
              <dd>{r.v}{r.u && <span> {r.u}</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      {open && <Reader onClose={() => setOpen(false)} />}
    </>
  );
}
