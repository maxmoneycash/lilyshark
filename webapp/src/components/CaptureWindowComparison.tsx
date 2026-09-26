import { useMemo } from 'react';
import type { LscapFrame } from '../lib/lscap';
import { summarizeCaptureWindow, type CaptureWindowSummary } from '../lib/captureSurvey';

interface Props {
  aName: string;
  aFrames: readonly LscapFrame[];
  bName: string;
  bFrames: readonly LscapFrame[];
}

function measurement(value: number | null, samples: number, unit: string): string {
  return value === null ? '—' : `${value.toFixed(1)} ${unit} · ${samples} frame(s)`;
}

function profiles(summary: CaptureWindowSummary): string {
  if (summary.profiles.length === 0) return 'RF settings not fully reported';
  const shown = summary.profiles.slice(0, 2).join(' / ');
  const extra = summary.profiles.length > 2 ? ` / +${summary.profiles.length - 2} more` : '';
  const incomplete = summary.incompleteProfileFrames > 0
    ? ` · ${summary.incompleteProfileFrames} frame(s) missing settings`
    : '';
  return shown + extra + incomplete;
}

export function CaptureWindowComparison({ aName, aFrames, bName, bFrames }: Props) {
  const a = useMemo(() => summarizeCaptureWindow(aFrames), [aFrames]);
  const b = useMemo(() => summarizeCaptureWindow(bFrames), [bFrames]);
  const sameProfile = a.profiles.length === 1 && b.profiles.length === 1
    && a.profiles[0] === b.profiles[0]
    && a.incompleteProfileFrames === 0 && b.incompleteProfileFrames === 0;

  return (
    <>
      <div className="panel-foot" style={{ display: 'block' }}>
        Separate visits show what each file recorded. These frames are not paired;
        counts and signal medians describe different packet populations. The
        first-to-last record span omits idle time before and after the records.
      </div>
      {!sameProfile && (
        <div className="panel-foot warn" style={{ display: 'block' }}>
          RF settings differ or are incomplete. Check both profiles before
          comparing the visits.
        </div>
      )}
      <div className="scroll-x">
        <table className="grid">
          <thead>
            <tr><th>OBSERVATION</th><th>A · {aName || 'open capture'}</th><th>B · {bName}</th></tr>
          </thead>
          <tbody>
            <tr><td>Received frames</td><td>{a.received}</td><td>{b.received}</td></tr>
            <tr><td>CRC invalid</td><td>{a.invalidCrc}</td><td>{b.invalidCrc}</td></tr>
            <tr><td>Recorded span</td>
              <td>{a.recordedSpanS === null ? '—' : `${a.recordedSpanS.toFixed(1)} s`}</td>
              <td>{b.recordedSpanS === null ? '—' : `${b.recordedSpanS.toFixed(1)} s`}</td>
            </tr>
            <tr><td>Median RSSI</td>
              <td>{measurement(a.medianRssiDbm, a.rssiSamples, 'dBm')}</td>
              <td>{measurement(b.medianRssiDbm, b.rssiSamples, 'dBm')}</td>
            </tr>
            <tr><td>Median SNR</td>
              <td>{measurement(a.medianSnrDb, a.snrSamples, 'dB')}</td>
              <td>{measurement(b.medianSnrDb, b.snrSamples, 'dB')}</td>
            </tr>
            <tr><td>RF settings</td><td>{profiles(a)}</td><td>{profiles(b)}</td></tr>
            <tr><td>Other records</td>
              <td>{a.transmitted} TX · {a.unknownDirection} direction unknown · {a.synthetic} generated</td>
              <td>{b.transmitted} TX · {b.unknownDirection} direction unknown · {b.synthetic} generated</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel-foot dim" style={{ display: 'block' }}>
        A higher frame count or signal median does not by itself prove that a
        location or antenna improved. Use a controlled test with known sends,
        comparable settings, and the receiving endpoint before making a
        delivery claim.
      </div>
    </>
  );
}
