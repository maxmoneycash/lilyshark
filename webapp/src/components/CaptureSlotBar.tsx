import { MAX_OPEN_CAPTURES, type SlotFacts, slotBadges, slotTitle } from '../lib/captureSlots';

/**
 * The row of open captures.
 *
 * The analyzer holds several captures at once (lib/captureSlots.ts), and this
 * is where an operator sees which ones and which is on screen. Each tab says
 * what its capture IS and not merely what it is called: a recording off the
 * cable, a bundled synthetic sample, something fetched from Shelby. That
 * matters here more than it looks — two captures side by side is exactly the
 * situation where frames from one could be read as the other's, so the tab
 * carries the provenance and the tooltip spells it out in full.
 */

export interface SlotTab {
  id: string;
  name: string;
  facts: SlotFacts;
}

interface CaptureSlotBarProps {
  tabs: SlotTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

/** Long enough for a file name, short enough that four tabs fit a laptop. */
const NAME_CHARS = 26;

const shortName = (name: string) =>
  name.length <= NAME_CHARS ? name : `${name.slice(0, NAME_CHARS - 1)}…`;

export function CaptureSlotBar({ tabs, activeId, onActivate, onClose }: CaptureSlotBarProps) {
  if (tabs.length === 0) return null;
  return (
    <div
      className="panel-foot"
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
    >
      <span className="k">CAPTURES</span>
      {tabs.map((tab) => {
        const badges = slotBadges(tab.facts);
        const title = slotTitle(tab.name, tab.facts);
        return (
          <span key={tab.id} style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
            <button
              className={tab.id === activeId ? 'primary' : ''}
              title={title}
              aria-current={tab.id === activeId ? 'true' : undefined}
              onClick={() => onActivate(tab.id)}
            >
              {shortName(tab.name)}
              {badges.length > 0 && ` · ${badges.join(' · ')}`}
            </button>
            <button
              title={`Close ${tab.name} — it is not saved anywhere unless you downloaded or published it`}
              onClick={() => onClose(tab.id)}
            >
              ✕
            </button>
          </span>
        );
      })}
      <span className="dim">
        {tabs.length} of {MAX_OPEN_CAPTURES} open
        {tabs.length >= MAX_OPEN_CAPTURES &&
          ' — opening another closes the one you have not looked at for longest'}
      </span>
    </div>
  );
}
