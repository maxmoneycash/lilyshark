import { RF_FIELD, type LscapFrame } from './lscap';

export interface CaptureWindowSummary {
  received: number;
  transmitted: number;
  unknownDirection: number;
  synthetic: number;
  invalidCrc: number;
  /** First-to-last recorded frame span, not the full observation session. */
  recordedSpanS: number | null;
  medianRssiDbm: number | null;
  rssiSamples: number;
  medianSnrDb: number | null;
  snrSamples: number;
  /** Distinct complete RF setting sets reported by received frames. */
  profiles: string[];
  incompleteProfileFrames: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

function profileLabel(frame: LscapFrame): string | null {
  const needed = RF_FIELD.frequency | RF_FIELD.bandwidth
    | RF_FIELD.spreadingFactor | RF_FIELD.codingRate;
  if ((frame.presentFields & needed) !== needed) return null;
  // Preserve one-Hz differences so two distinct settings cannot display as
  // the same profile after rounding.
  return `${Number((frame.centerFrequencyHz / 1e6).toFixed(6))} MHz · `
    + `BW ${Number((frame.bandwidthHz / 1e3).toFixed(3))} kHz · `
    + `SF${frame.spreadingFactor} · CR 4/${frame.codingRateDenominator}`;
}

/** Describes one file on its own terms; never infers that two files overlap. */
export function summarizeCaptureWindow(frames: readonly LscapFrame[]): CaptureWindowSummary {
  const received = frames.filter((frame) => !frame.synthetic && frame.direction === 'rx');
  const rssi = received
    .filter((frame) => (frame.presentFields & RF_FIELD.rssi) !== 0 && Number.isFinite(frame.rssiDbm))
    .map((frame) => frame.rssiDbm);
  const snr = received
    .filter((frame) => (frame.presentFields & RF_FIELD.snr) !== 0 && Number.isFinite(frame.snrDb))
    .map((frame) => frame.snrDb);
  const profiles = new Set<string>();
  let incompleteProfileFrames = 0;
  for (const frame of received) {
    const label = profileLabel(frame);
    if (label === null) incompleteProfileFrames++;
    else profiles.add(label);
  }
  const timestamps = frames
    .filter((frame) => !frame.synthetic && (frame.presentFields & RF_FIELD.timestamp) !== 0)
    .map((frame) => frame.timestampUs);
  const min = timestamps.reduce<bigint | null>((best, value) => best === null || value < best ? value : best, null);
  const max = timestamps.reduce<bigint | null>((best, value) => best === null || value > best ? value : best, null);
  return {
    received: received.length,
    transmitted: frames.filter((frame) => !frame.synthetic && frame.direction === 'tx').length,
    unknownDirection: frames.filter((frame) => !frame.synthetic && frame.direction === 'unknown').length,
    synthetic: frames.filter((frame) => frame.synthetic).length,
    invalidCrc: received.filter((frame) => frame.crc === 'invalid').length,
    recordedSpanS: min !== null && max !== null && max > min ? Number(max - min) / 1e6 : null,
    medianRssiDbm: median(rssi),
    rssiSamples: rssi.length,
    medianSnrDb: median(snr),
    snrSamples: snr.length,
    profiles: [...profiles].sort(),
    incompleteProfileFrames,
  };
}
