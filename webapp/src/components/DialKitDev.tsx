import { useEffect } from 'react';
import { DialRoot, useDialKit } from 'dialkit';
import 'dialkit/styles.css';
import { setTDeckTune, TDECK_SCENE } from './tdeck-tune';

/** Dev-only live knobs for the intro T-Deck. Hidden in production builds.
 *  Framing and breathe only — exposure / env were identity sliders. */
export function DialKitDev() {
  const values = useDialKit('T-Deck', {
    halfHeight: [TDECK_SCENE.halfHeight, 0.04, 0.1, 0.001],
    pan: [TDECK_SCENE.pan, 0, 0.6, 0.01],
    breathe: [TDECK_SCENE.breathe, 0, 0.04, 0.001],
  });

  useEffect(() => {
    setTDeckTune(values);
  }, [values]);

  return <DialRoot theme="light" position="bottom-left" />;
}
