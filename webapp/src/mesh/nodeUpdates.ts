import type { NodeEntry } from './store';

/** Local edits preserve origin. Actual radio observations replace external or
 * generated evidence, including coordinates the radio has never reported. */
export function mergeNodeUpdate(previous: NodeEntry, patch: Partial<NodeEntry>, fromRadio = false): NodeEntry {
  const replaceExternal = fromRadio && (previous.viaNet || previous.viaSim || previous.viaDemo);
  const base: NodeEntry = replaceExternal ? {
    num: previous.num,
    longName: `!${previous.num.toString(16)}`,
    shortName: previous.num.toString(16).slice(-4),
    lastHeard: 0,
    fav: previous.fav,
    ignored: previous.ignored,
  } : previous;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return {
    ...base, ...defined,
    ...(fromRadio ? { viaNet: false, viaSim: false, viaDemo: false } : {}),
  };
}
