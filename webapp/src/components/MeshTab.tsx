import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, DeviceStatus, type Message, type NodeEntry } from '../mesh/store';
import { connectSerial, connectBle, disconnect, sendText } from '../mesh/radio';
import { t } from '../mesh/i18n';
import { applyTheme } from '../mesh/theme';
import Nodes from '../mesh/screens/Nodes';
import MapView from '../mesh/screens/MapView';
import Mesh from '../mesh/screens/Mesh';
import Telemetry from '../mesh/screens/Telemetry';
import Config from '../mesh/screens/Config';
import '../mesh/meshterm.css';

/**
 * Mesh — connect a radio, then read and send messages on it.
 *
 * The transport is the device's own USB serial or BLE link, so nothing routes
 * through a server: the browser talks to the radio in the user's hand. Web
 * Serial is Chromium-only, which the connect screen states rather than letting
 * the button fail silently elsewhere.
 */

const hasSerial = typeof navigator !== 'undefined' && 'serial' in navigator;
const hasBle = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const nodeName = (n: NodeEntry | undefined, num: number) =>
  n?.longName?.trim() || n?.shortName?.trim() || `node ${num.toString(16).slice(-4)}`;

// Sub-views of the ported meshcore-terminal UI, shown once a radio is connected.
// CHAT is the lilyshark-native thread below; the rest are the ported screens.
const MESH_VIEWS = ['CHAT', 'NODOS', 'MAPA', 'MALLA', 'TELEMETRÍA', 'CONFIG'] as const;
type MeshView = (typeof MESH_VIEWS)[number];

function Connect({ onError }: { onError: (m: string) => void }) {
  const [busy, setBusy] = useState<'serial' | 'ble' | null>(null);

  const go = async (kind: 'serial' | 'ble') => {
    setBusy(kind);
    try {
      await (kind === 'serial' ? connectSerial() : connectBle());
    } catch (e) {
      // A user closing the picker is a cancel, not a failure worth shouting about.
      const msg = e instanceof Error ? e.message : 'Could not open the radio';
      if (!/cancel|abort|No port selected|chooser/i.test(msg)) onError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ls-panel">
      <div className="ls-empty" style={{ paddingBlock: 'clamp(2.5rem, 9vw, 4.5rem)' }}>
        <h2 className="ls-h1" style={{ fontSize: 'clamp(1.25rem, 1rem + 1.2vw, 1.6rem)' }}>
          Connect a radio
        </h2>
        <p>
          Plug in a Meshtastic, MeshCore, or RNode device over USB, or pair it over
          Bluetooth. Messages stay between the browser and the radio.
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.4rem' }}>
          <button className="ls-btn ls-btn--primary" disabled={!hasSerial || busy !== null} onClick={() => void go('serial')}>
            {busy === 'serial' ? 'Opening…' : 'Connect over USB'}
          </button>
          <button className="ls-btn" disabled={!hasBle || busy !== null} onClick={() => void go('ble')}>
            {busy === 'ble' ? 'Pairing…' : 'Connect over Bluetooth'}
          </button>
        </div>
        {!hasSerial && (
          <p className="ls-label warn" style={{ marginTop: '0.4rem' }}>
            This browser has no Web Serial. Use Chrome, Edge, or Arc on desktop.
          </p>
        )}
      </div>
    </div>
  );
}

export function MeshTab() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const [convo, setConvo] = useState('ch:0');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<MeshView>('CHAT');
  const [nodeFocus, setNodeFocus] = useState<number | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  // The ported terminal UI reads its palette from CSS vars; apply the saved
  // theme (lilyshark pink by default) to every .meshterm wrapper on mount.
  useEffect(() => { applyTheme(); }, []);

  const connected = snap.status === DeviceStatus.Connected || snap.nodes.size > 0;

  const contacts = useMemo(() => {
    const list: Array<{ key: string; label: string; sub: string }> = [
      { key: 'ch:0', label: 'Public', sub: 'broadcast channel' },
    ];
    for (const [num, n] of snap.nodes) {
      list.push({
        key: `dm:${num}`,
        label: nodeName(n, num),
        sub: n.snr !== undefined ? `${n.snr.toFixed(1)} dB` : 'no direct signal',
      });
    }
    return list;
  }, [snap.nodes, snap.version]);

  const thread = useMemo(
    () => snap.messages.filter((m: Message) => m.convo === convo).sort((a, b) => a.ts - b.ts),
    [snap.messages, convo, snap.version],
  );

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread.length, convo]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try { await sendText(text, convo); }
    catch (e) { setError(e instanceof Error ? e.message : 'Send failed'); }
  };

  if (!connected) return <Connect onError={setError} />;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {error && (
        <div className="ls-panel"><div className="ls-panel-b"><span className="bad" style={{ fontSize: '0.85rem' }}>{error}</span></div></div>
      )}

      {/* Sub-navigation for the ported terminal views (terminal-styled). */}
      <div className="meshterm" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 10px', background: 'var(--panel)', border: '1px solid var(--border)' }}>
        {MESH_VIEWS.map((v) => (
          <button key={v} type="button" className={`tab${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
            {t(v)}
          </button>
        ))}
      </div>

      {view !== 'CHAT' && (
        /* The ported screens expect a full viewport; confine them to the tab's
           panel area so the lilyshark header/nav stay usable. */
        <div
          className="meshterm"
          style={{
            display: 'flex',
            flexDirection: 'column',
            ...(view === 'MAPA' ? { height: '65vh' } : { maxHeight: '65vh' }),
            overflowY: 'auto',
          }}
        >
          {view === 'NODOS' && (
            <Nodes
              initialSelected={nodeFocus}
              onOpenDm={(num) => {
                setConvo(`dm:${num}`);
                setView('CHAT');
              }}
            />
          )}
          {view === 'MAPA' && (
            <MapView
              onOpenNode={(num) => {
                setNodeFocus(num);
                setView('NODOS');
              }}
            />
          )}
          {view === 'MALLA' && <Mesh />}
          {view === 'TELEMETRÍA' && <Telemetry />}
          {view === 'CONFIG' && <Config />}
        </div>
      )}

      {view === 'CHAT' && (
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(0, 15rem) minmax(0, 1fr)' }} className="ls-mesh-grid">
        {/* Contacts */}
        <div className="ls-panel" style={{ alignSelf: 'start' }}>
          <div className="ls-panel-h">
            <span className="ls-label">CONTACTS</span>
            <button className="ls-btn" style={{ marginLeft: 'auto', padding: '0.3rem 0.55rem' }}
                    onClick={() => void disconnect()}>Disconnect</button>
          </div>
          <div className="ls-scroll" style={{ maxHeight: '58vh' }}>
            {contacts.map((c) => (
              <button key={c.key} onClick={() => setConvo(c.key)}
                      aria-selected={convo === c.key}
                      className="ls-contact">
                <span className="ls-contact-name">{c.label}</span>
                <span className="ls-label dim">{c.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div className="ls-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: '58vh' }}>
          <div className="ls-panel-h">
            <span className="ls-h2">{contacts.find((c) => c.key === convo)?.label ?? 'Public'}</span>
          </div>

          <div className="ls-scroll" style={{ flex: 1, padding: '0.9rem', display: 'grid', gap: '0.5rem', alignContent: 'start' }}>
            {thread.length === 0 && (
              <p className="dim" style={{ margin: 'auto', fontSize: '0.88rem' }}>No messages yet.</p>
            )}
            {thread.map((m) => (
              <div key={m.id} className={`ls-msg${m.mine ? ' ls-msg--mine' : ''}`}>
                <span>{m.text}</span>
                <span className="ls-msg-meta">
                  {clock(m.ts)}
                  {m.mine && (
                    <> · <span className={m.state === 'failed' ? 'bad' : m.state === 'delivered' ? 'ok' : 'dim'}>{m.state}</span></>
                  )}
                  {m.snr !== undefined && <> · {m.snr.toFixed(1)} dB</>}
                </span>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="ls-panel-h" style={{ borderBottom: 0, borderTop: '1px solid var(--ls-line-soft)' }}>
            <input className="ls-input" placeholder="Message" value={draft}
                   onChange={(e) => setDraft(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && void send()} />
            <button className="ls-btn ls-btn--primary" onClick={() => void send()} disabled={!draft.trim()}>Send</button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
