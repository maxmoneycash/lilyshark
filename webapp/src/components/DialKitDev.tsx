import { useEffect } from 'react';
import { DialRoot, useDialKit } from 'dialkit';
import 'dialkit/styles.css';
import { setTDeckTune } from './tdeck-tune';

/** Dev-only live knobs for the intro T-Deck. Hidden in production builds. */
export function DialKitDev() {
  const values = useDialKit('T-Deck', {
    halfHeight: [0.064, 0.04, 0.1, 0.001],
    pan: [0.3, 0, 0.6, 0.01],
    exposure: [1, 0.6, 1.6, 0.01],
    envIntensity: [1.05, 0.4, 2, 0.01],
    breathe: [0.012, 0, 0.04, 0.001],
  });

  useEffect(() => {
    setTDeckTune(values);
  }, [values]);

  return <DialRoot theme="light" position="bottom-left" />;
}
