import { useEffect } from 'react';
import { DialRoot, useDialKit } from 'dialkit';
import 'dialkit/styles.css';
import { setTDeckTune, TDECK_TUNE_DEFAULTS } from './tdeck-tune';

/** Dev-only live knobs for the intro T-Deck. Hidden in production builds. */
export function DialKitDev() {
  const values = useDialKit('T-Deck', {
    halfHeight: [TDECK_TUNE_DEFAULTS.halfHeight, 0.04, 0.1, 0.001],
    pan: [TDECK_TUNE_DEFAULTS.pan, 0, 0.6, 0.01],
    exposure: [TDECK_TUNE_DEFAULTS.exposure, 0.6, 1.6, 0.01],
    envIntensity: [TDECK_TUNE_DEFAULTS.envIntensity, 0.4, 2, 0.01],
    breathe: [TDECK_TUNE_DEFAULTS.breathe, 0, 0.04, 0.001],
  });

  useEffect(() => {
    setTDeckTune(values);
  }, [values]);

  return <DialRoot theme="light" position="bottom-left" />;
}
