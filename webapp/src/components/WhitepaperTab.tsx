/**
 * Whitepaper — the research the product is built on.
 *
 * The document itself is served as the original typeset PDF rather than being
 * re-flowed into HTML: it is a two-column technical report with 26 generated
 * figures, and re-typesetting it would lose the layout the analysis depends on.
 * This page frames it, pulls out the results that matter to Lilyshark, and
 * embeds the full document inline.
 */

import { useState } from 'react';

const PDF = '/lilyshark-whitepaper.pdf';

const HEADLINE = [
  { value: '7.36', unit: '', label: 'Rebroadcast factor R, measured', note: 'against the 3–5 the literature assumed' },
  { value: '68.6→25.8', unit: '%', label: 'Reach as nodes are added', note: 'a flooded mesh gets worse as it grows' },
  { value: '6,721', unit: 'nodes', label: 'Where transit demand saturates', note: 'past this, capacity nobody buys' },
  { value: '67', unit: 'pages', label: '26 figures · 52 sources', note: 'every figure from one parameter set' },
];

const FINDINGS: Array<{ heading: string; body: string }> = [
  {
    heading: 'Verification tier predicts revenue',
    body:
      'Sort networks by what an outside referee can check a contribution against, not by the resource sold. Coverage is checkable against nothing — Helium peaked near $6,500 a month against $365M raised. Delivery is checkable against a counterparty. Observation is checkable against physics, and it is the only tier with networks producing revenue today.',
  },
  {
    heading: 'The delivery tier is capped, and the cap is measurable',
    body:
      "Meshtastic publishes a discrete-event simulator of its own production routing. Driving it across node densities from 5 to 75 and hop limits of 3, 5 and 7 gives R = 7.36 transmissions per delivered message at realistic density — a correction that cuts the tier's revenue ceiling by 32 percent.",
  },
  {
    heading: 'Growth is the failure mode',
    body:
      'Capacity scales linearly with deployed nodes. Demand does not scale at all. Past 6,721 nodes every additional operator adds capacity against fixed demand and dilutes revenue for everyone already there. Protocol revenue tops out near $1.12M a year however large the network gets.',
  },
  {
    heading: 'Why this product sends a pointer',
    body:
      'Airtime is the scarce resource and every relay consumes it. That is the empirical case for moving the smallest possible object over the air: Lilyshark puts an 82-byte Shelby pointer in the frame and lets a connected node carry the payload. The measurement is the design rationale.',
  },
];

export function WhitepaperTab() {
  const [inline, setInline] = useState(false);

  return (
    <column gap-="1" pad-="1">
      {/* ── Masthead ─────────────────────────────────────────────── */}
      <box shear-="top">
        <column gap-="0">
          <row gap-="1" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span is-="badge" variant-="foreground1">WHITEPAPER</span>
            <span style={{ opacity: 0.6 }}>Submitted to Multicoin Capital · 7 August 2026</span>
          </row>
          <h2 style={{ margin: '0.6rem 0 0.2rem', lineHeight: 1.15 }}>
            The Growth Trap in Proof of Physical Work
          </h2>
          <p style={{ margin: 0, opacity: 0.8 }}>
            Verification tiers, mesh capacity, and a protocol specification.
          </p>
          <p style={{ margin: '0.75rem 0 0', maxWidth: '58ch' }}>
            Adding operators makes most DePIN networks worse at the thing they sell.
            I measured it on the largest deployed mesh in the world.
          </p>
          <row gap-="1" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
            <a href={PDF} target="_blank" rel="noopener noreferrer">
              <button>Open full PDF ↗</button>
            </a>
            <a href={PDF} download="lilyshark-whitepaper.pdf">
              <button>Download</button>
            </a>
          </row>
        </column>
      </box>

      {/* ── Headline numbers ─────────────────────────────────────── */}
      <row gap-="1" style={{ flexWrap: 'wrap' }}>
        {HEADLINE.map((m) => (
          <box key={m.label} style={{ flex: '1 1 12rem', minWidth: '11rem' }}>
            <column gap-="0">
              <strong style={{ fontSize: '1.5rem', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                {m.value}
                {m.unit && <span style={{ fontSize: '0.85rem', opacity: 0.65 }}> {m.unit}</span>}
              </strong>
              <span style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>{m.label}</span>
              <span style={{ fontSize: '0.72rem', opacity: 0.55 }}>{m.note}</span>
            </column>
          </box>
        ))}
      </row>

      {/* ── Abstract ─────────────────────────────────────────────── */}
      <box>
        <column gap-="0">
          <span is-="badge" variant-="foreground2">ABSTRACT</span>
          <p style={{ marginTop: '0.6rem', maxWidth: '78ch', lineHeight: 1.6 }}>
            Decentralized physical infrastructure networks are conventionally sorted by the
            resource they sell. We argue the more predictive axis is <em>what the network can
            check a contribution against</em>, and that three tiers exist: coverage, checkable
            against nothing; delivery, checkable against a counterparty; and observation,
            checkable against physics using published reference data. Realised revenue tracks
            that ordering closely. We test the delivery tier from first principles, measuring
            its governing parameter — the rebroadcast factor R — with the Meshtastic project's
            own discrete-event simulator and obtaining <strong>R = 7.36</strong> against the 3
            to 5 commonly assumed. The correction cuts the tier's revenue ceiling by 32 percent;
            reach falls from 68.6 to 25.8 percent as nodes are added, so a flooded mesh degrades
            before it monetises; and addressable transit demand saturates at 6,721 nodes, past
            which a growing network destroys its own unit economics.
          </p>
        </column>
      </box>

      {/* ── What it establishes ──────────────────────────────────── */}
      <row gap-="1" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
        {FINDINGS.map((f) => (
          <box key={f.heading} style={{ flex: '1 1 22rem', minWidth: '18rem' }}>
            <column gap-="0">
              <strong>{f.heading}</strong>
              <p style={{ margin: '0.5rem 0 0', lineHeight: 1.55, opacity: 0.9 }}>{f.body}</p>
            </column>
          </box>
        ))}
      </row>

      {/* ── The document ─────────────────────────────────────────── */}
      <box>
        <column gap-="0">
          <row gap-="1" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span is-="badge" variant-="foreground2">FULL DOCUMENT</span>
            <span style={{ opacity: 0.55, fontSize: '0.8rem' }}>67 pages · 26 figures · 52 sources</span>
            <button style={{ marginLeft: 'auto' }} onClick={() => setInline((v) => !v)}>
              {inline ? 'Hide inline viewer' : 'Read inline'}
            </button>
          </row>

          {/* The viewer is opt-in. Some browsers hand a PDF plugin the whole tab
              when it is embedded on load, which navigates the app away; loading it
              only on request keeps the dashboard stable and the page light. */}
          {inline ? (
            <iframe
              src={PDF}
              title="The Growth Trap in Proof of Physical Work"
              style={{ width: '100%', height: '78vh', marginTop: '0.75rem', border: 0 }}
            />
          ) : (
            <p style={{ margin: '0.75rem 0 0', opacity: 0.75, maxWidth: '62ch' }}>
              Read it inline here, or{' '}
              <a href={PDF} target="_blank" rel="noopener noreferrer">open the PDF in a new tab</a>{' '}
              for the full typeset document with its figures and tables.
            </p>
          )}
        </column>
      </box>
    </column>
  );
}
