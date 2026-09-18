import { useSyncExternalStore } from 'react';

/** Matches the phone shell breakpoint in meshterm.css (`max-width: 860px`). */
const query = '(max-width: 860px)';
const snapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;
const subscribe = (update: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
};

export function useIsPhone() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
