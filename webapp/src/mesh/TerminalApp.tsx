import { Component, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  canReconnect,
  connectBle,
  connectSerial,
  disconnect,
  loadHistory,
  notify,
  reconnectLast,
  setConnectionLostHandler,
} from "./radio";
import { evalAlerts, evalAutonomia, getAlertCfg } from "./alerts";
import { clearDemo, seedDemo } from "./demo";
import { forecastBattery } from "./battery";
import { addLog, DeviceStatus, fmtLog, getSnapshot, subscribe } from "./store";
import { getAutoPurgeDays, loadTelemetry, purgeOlderThan } from "./db";
import Chat from "./screens/Chat";
import Nodes from "./screens/Nodes";
import Mesh from "./screens/Mesh";
import Config from "./screens/Config";
import { IntroTab } from "../components/IntroTab";
import { TrafficTab } from "../components/TrafficTab";
import { WhitepaperTab } from "../components/WhitepaperTab";
import { ShelbyScreen } from "./screens/Shelby";

// The heavy screens load on first visit rather than riding in the main chunk:
// Leaflet (MAP) and uPlot (TELEMETRY) together outweigh most of the app.
// PAPER is eager — it is the landing screen, and since the pages became
// pre-rendered images its code is a few kilobytes.
const MapView = lazy(() => import("./screens/MapView"));
const Telemetry = lazy(() => import("./screens/Telemetry"));
const Docs = lazy(() => import("./screens/Docs"));
import { fmtFreq, useHourTick } from "./fmt";
import { saveText, stamp } from "./export";
import { t, useLangTick } from "./i18n";
import {
  connectDeviceLink,
  disconnectDeviceLink,
  useDeviceLink,
} from "../lib/deviceLink";
import { bindAnalyzerMesh } from "./analyzerMesh";
import "./meshterm.css";

const VERSION = "0.1.0";

const TABS = [
  "INTRO",
  "PAPER",
  "DOCS",
  "TRAFFIC",
  "SHELBY",
  "CHAT",
  "NODES",
  "MAP",
  "MESH",
  "TELEMETRY",
  "CONFIG",
  "DEBUG",
] as const;
type Tab = (typeof TABS)[number];

// Deep links: a shared URL can land straight on a screen instead of the intro.
// #resolve opens TRAFFIC, where TrafficTab reads the same hash and plays the
// Shelby resolve demo unattended; the rest are plain entry points. The hash is
// read once at mount — this is an entry point, not a router, so tab changes
// afterwards never write it back.
const HASH_TAB: Partial<Record<string, Tab>> = {
  "#resolve": "TRAFFIC",
  "#traffic": "TRAFFIC",
  "#shelby": "SHELBY",
  "#docs": "DOCS",
  "#paper": "PAPER",
};

// ponytail: an error boundary for a single screen must not take down the app.
// key={tab} remounts it when switching tabs, clearing the error state.
class ScreenBoundary extends Component<
  { children: ReactNode },
  { err?: Error }
> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) {
    // A deploy rotates the chunk hashes under any session that is already
    // open, so the first lazy screen visited afterwards 404s. That is not a
    // crash, it is a stale page — reload once to pick up the new build, and
    // only fall through to the error panel if the reload didn't cure it.
    if (/dynamically imported module|Loading chunk|import\(\)/i.test(String(err))) {
      const KEY = "chunk-reload";
      if (sessionStorage.getItem(KEY) !== "1") {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
        return {};
      }
    }
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <main>
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-title">
              <span>{t("SCREEN ERROR")}</span>
            </div>
            <pre className="err" style={{ padding: 16, whiteSpace: "pre-wrap" }}>
              {String(this.state.err?.stack ?? this.state.err)}
            </pre>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

function Titlebar() {
  const [fs, setFs] = useState(false);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      setFs(false);
    } else {
      await document.documentElement.requestFullscreen().catch(() => {});
      setFs(true);
    }
  };
  return (
    <div className="titlebar">
      <span className="titlebar-label">
        ◊ LILYSHARK ·· MESH RADIO ANALYZER
        <span className="titlebar-ver">v{VERSION}</span>
      </span>
      <div className="titlebar-btns">
        <button
          className="tb-btn"
          onClick={toggleFullscreen}
          title={fs ? t("Exit fullscreen") : t("Fullscreen")}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}

// Last transport remembered (localStorage), to preselect the dropdown.
type Mode = "serie" | "ble";
const LAST_KEY = "meshLastConn";
function loadLastMode(): Mode | undefined {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const v = raw ? (JSON.parse(raw) as { mode?: string }) : undefined;
    return v?.mode === "ble" ? "ble" : v?.mode === "serie" ? "serie" : undefined;
  } catch {
    return undefined;
  }
}
function saveLastMode(mode: Mode): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ mode }));
  } catch {
    /* localStorage unavailable: no big deal */
  }
}

// Grace period before the first reconnect: the node is still booting.
const RECONNECT_WAIT_MS = 6000;
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// Host (this machine) battery via the Battery Status API. Returns null when the
// browser doesn't expose it (Safari doesn't) — the caller renders nothing.
function useHostBattery(): { level: number; charging: boolean } | null {
  const [bat, setBat] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getBattery = (navigator as any).getBattery?.bind(navigator);
    if (!getBattery) return;
    let mgr: { level: number; charging: boolean; removeEventListener: (t: string, f: () => void) => void } | undefined;
    let cancelled = false;
    const update = () => mgr && setBat({ level: mgr.level, charging: mgr.charging });
    getBattery().then((m: typeof mgr & { addEventListener: (t: string, f: () => void) => void }) => {
      if (cancelled) return;
      mgr = m;
      update();
      m.addEventListener("levelchange", update);
      m.addEventListener("chargingchange", update);
    });
    return () => {
      cancelled = true;
      mgr?.removeEventListener("levelchange", update);
      mgr?.removeEventListener("chargingchange", update);
    };
  }, []);
  return bat;
}

function App() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  // at the root: a clock format or language change repaints every screen
  useHourTick();
  useLangTick();
  const hostBat = useHostBattery();
  // The intro opens first: the device, its screens, and why it exists —
  // unless a deep link asked for a specific screen.
  const [tab, setTab] = useState<Tab>(
    () => HASH_TAB[window.location.hash.toLowerCase()] ?? "INTRO",
  );
  // Phone nav: the ten tabs live behind a hamburger instead of a side-scroll.
  const [menuOpen, setMenuOpen] = useState(false);
  // CONNECT opens a sheet with the steps and both transports; the header
  // itself carries no dropdown.
  const [connectOpen, setConnectOpen] = useState(false);
  const hasSerial = typeof navigator !== "undefined" && "serial" in navigator;
  const hasBle = typeof navigator !== "undefined" && "bluetooth" in navigator;
  const [chatConvo, setChatConvo] = useState("ch:0");
  // node to preselect when jumping MAP → NODES with [+INFO]
  const [nodeFocus, setNodeFocus] = useState<number | undefined>();
  // node to center on when jumping to MAP from a message
  const [mapFocus, setMapFocus] = useState<number | undefined>();
  // counter: each bump asks the chat to focus its search box
  const [focusSearch, setFocusSearch] = useState(0);
  const [mode, setMode] = useState<Mode>("serie");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [connectedAt, setConnectedAt] = useState<number | undefined>();
  const canceledRef = useRef(false);
  // Auto-reconnect: wantRef = the user wants to be connected (false after
  // DISCONNECT/CANCEL). Exponential backoff.
  const wantRef = useRef(false);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const reconnectBusyRef = useRef(false);
  // Once a radio has been seen, the demo mesh must never come back: a
  // disconnect in a real session would otherwise re-seed invented nodes on top
  // of the capture.
  const everConnectedRef = useRef(false);

  const connected = s.status !== undefined && s.status >= DeviceStatus.Connected;
  const configuring = s.status === DeviceStatus.Configuring;

  // `now` only feeds the footer UPLINK readout, which exists only while the
  // link is up — outside that the tick would re-render the whole tree once a
  // second for nothing.
  useEffect(() => {
    if (!connected) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [connected]);

  // Without a radio attached every screen is an empty panel, which shows
  // nothing about what the instrument does. Seed a demo mesh instead, and drop
  // it the instant real hardware appears so the two can never be confused.
  useEffect(() => {
    bindAnalyzerMesh();
    const onTab = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if ((TABS as readonly string[]).includes(next)) setTab(next as Tab);
    };
    window.addEventListener("lilyshark-tab", onTab);
    return () => window.removeEventListener("lilyshark-tab", onTab);
  }, []);

  const deviceLink = useDeviceLink();
  const lilyConnecting = deviceLink.status === "connecting";
  const lilyLinked = deviceLink.status === "linked";

  useEffect(() => {
    if (connected || lilyLinked) {
      everConnectedRef.current = true;
      clearDemo();
    } else if (!everConnectedRef.current) {
      seedDemo();
    }
  }, [connected, lilyLinked]);

  // Leaving the map drops the focus: the ring shouldn't outlive the jump
  useEffect(() => {
    if (tab !== "MAP") setMapFocus(undefined);
  }, [tab]);

  // Ctrl+1…9 and Ctrl+0 (the tenth tab) switch tabs · Ctrl+F searches the chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      // A shortcut must never fire while the user is typing: Ctrl+key inside a
      // field belongs to the field (and to the browser's own editing keys).
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        el?.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      ) {
        return;
      }
      // "1".."9" pick tabs 1-9; "0" picks the tenth, the way a browser numbers
      // its own tab shortcuts.
      const n = e.key === "0" ? 10 : Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= TABS.length) {
        e.preventDefault();
        setNodeFocus(undefined);
        setMapFocus(undefined);
        setTab(TABS[n - 1]);
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setTab("CHAT");
        setFocusSearch((v) => v + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Favorite node alerts (low battery / no signal). Once a minute is plenty:
  // these are conditions measured in hours, and evalAlerts has its own cooldown.
  useEffect(() => {
    const fired = new Map<string, number>();
    const check = () => {
      const st = getSnapshot();
      for (const a of evalAlerts(
        st.nodes.values(),
        getAlertCfg(),
        fired,
        Date.now(),
        st.myNodeNum,
      )) {
        if (a.kind === "bateria") {
          void notify(
            t("{0} · battery {1}%", a.name, a.value),
            t("Below the threshold ({0}%)", a.threshold),
          );
        } else {
          void notify(
            t("{0} · no signal", a.name),
            t("{0} h without a signal", a.value),
          );
        }
      }
    };
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  // Runtime: kept apart because it needs to read each favorite's battery
  // history from the database. Every 5 min is plenty — the slope moves slowly.
  useEffect(() => {
    const fired = new Map<string, number>();
    const check = async () => {
      const cfg = getAlertCfg();
      if (!cfg.on || !cfg.autonomiaH) return;
      const st = getSnapshot();
      for (const n of st.nodes.values()) {
        if (!n.fav || n.num === st.myNodeNum) continue;
        try {
          const rows = await loadTelemetry(
            n.num,
            "batteryLevel",
            Date.now() - 6 * 3_600_000,
          );
          const a = evalAutonomia(
            { num: n.num, nombre: n.longName || n.shortName, fav: n.fav },
            forecastBattery(rows),
            cfg,
            fired,
          );
          if (a) {
            void notify(
              t("{0} · runtime ~{1} h", a.name, a.value),
              t("At the current rate it runs out in under {0} h", a.threshold),
            );
          }
        } catch {
          // no data for that node: there is no forecast to give
        }
      }
    };
    const id = setInterval(check, 300_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Purge before loading: the history that reaches memory is already
    // trimmed and needs no second filter. If it fails, we load anyway.
    const days = getAutoPurgeDays();
    (days > 0
      ? purgeOlderThan(days)
          .then((n) => {
            if (n > 0) addLog("Automatic purge: {0} rows deleted", n);
          })
          .catch(() => {})
      : Promise.resolve()
    ).then(() => loadHistory().catch((e) => setError(`BD: ${e}`)));

    // Prefill the last transport used
    const last = loadLastMode();
    if (last) setMode(last);

    // When the link drops on its own, start auto-reconnecting
    setConnectionLostHandler(() => {
      // handleLost() only fires on an unexpected drop (a manual disconnect
      // clears `device` first and never gets this far), so reaching this
      // point already means we want to be back.
      if (!canReconnect()) {
        addLog("RECONNECT: no previous connection to retry");
        return;
      }
      wantRef.current = true;
      // A node that just dropped is either rebooting or out of range. Either
      // way it takes 10-20 s to answer again, so retrying immediately only
      // burns the first attempt.
      setError(t("Link lost · reconnecting in {0}s", RECONNECT_WAIT_MS / 1000));
      addLog("RECONNECT: scheduled in {0}s", RECONNECT_WAIT_MS / 1000);
      scheduleReconnect(RECONNECT_WAIT_MS);
    });
    return () => setConnectionLostHandler(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearReconnect = () => {
    if (reconnectTimerRef.current !== undefined) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    attemptRef.current = 0;
  };

  // The link-lost handler and the backoff both schedule retries: going through
  // here keeps a single live timer instead of one silently replacing the other.
  const scheduleReconnect = (ms: number) => {
    if (reconnectTimerRef.current !== undefined) {
      clearTimeout(reconnectTimerRef.current);
    }
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = undefined;
      void tryReconnect();
    }, ms) as unknown as number;
  };

  // Takes the transport explicitly: the connect sheet picks one and connects
  // in the same click, and reading `mode` from the closure there would see
  // the value from before setMode landed.
  const onConnect = async (m: Mode = mode) => {
    setError("");
    setConnecting(true);
    canceledRef.current = false;
    wantRef.current = true;
    try {
      // The browser's device picker is the port selector of a web app: it
      // opens on this click (a user gesture is mandatory for Web Serial/BLE).
      await (m === "serie" ? connectSerial() : connectBle());
      if (canceledRef.current) return;
      setConnectedAt(Date.now());
      saveLastMode(m);
    } catch (e) {
      wantRef.current = false; // manual connect failed: don't retry behind their back
      if (!canceledRef.current) setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  // Retries the last connection with exponential backoff (2s→15s cap) while
  // the user still wants to be connected. Serial reuses the granted port; BLE
  // reuses the chosen device, both without reopening the picker.
  const tryReconnect = async () => {
    if (!wantRef.current) {
      addLog("RECONNECT: cancelled (manual disconnect)");
      return;
    }
    if (reconnectBusyRef.current) {
      addLog("RECONNECT: an attempt is already in progress");
      return;
    }
    reconnectBusyRef.current = true;
    setConnecting(true);
    setError(t("Reconnecting… (attempt {0})", attemptRef.current + 1));
    addLog("RECONNECT: attempt {0}", attemptRef.current + 1);
    try {
      await reconnectLast();
      if (!wantRef.current) return; // the user cancelled while reconnecting
      setConnectedAt(Date.now());
      setError("");
      attemptRef.current = 0;
      addLog("RECONNECT: connected");
    } catch (e) {
      if (!wantRef.current) return;
      // Swallowing this was why a failed reconnect left no trace anywhere:
      // the header string is the next thing to overwrite itself.
      addLog("RECONNECT: attempt {0} failed: {1}", attemptRef.current + 1, String(e));
      attemptRef.current++;
      const delay = Math.min(15000, 2000 * 2 ** (attemptRef.current - 1));
      setError(t("Reconnect failed, retrying in {0}s", delay / 1000));
      scheduleReconnect(delay);
    } finally {
      reconnectBusyRef.current = false;
      setConnecting(false);
    }
  };

  const stopAndForget = async () => {
    wantRef.current = false;
    clearReconnect();
    setConnectedAt(undefined);
    await disconnect();
  };

  // Aborts a hung connection attempt (e.g. a picker left open or a silent
  // device). disconnect() closes the transport and makes the pending connect
  // reject; canceledRef keeps that rejection from overwriting the cancel message.
  const onCancel = async () => {
    canceledRef.current = true;
    setConnecting(false);
    setError(t("Connection cancelled"));
    await stopAndForget();
  };


  // The pill reports whichever link exists. MeshCore's states win when that
  // flow is active; otherwise a Lilyshark analyzer link is just as much a
  // radio on the other end of the cable, and "NO LINK" would be a lie.
  const ledClass =
    connected || lilyLinked
      ? "on"
      : connecting || configuring || lilyConnecting
        ? "connecting"
        : "";
  const connText = connected
    ? s.status === DeviceStatus.Configured
      ? "DEVICE CONFIGURED"
      : "LINK UP"
    : lilyLinked
      ? "LILYSHARK USB"
      : connecting || configuring || lilyConnecting
        ? "ESTABLISHING LINK…"
        : "NO LINK";
  const pillLive = connected || lilyLinked;

  // Only the header/sheet connect should steal the tab. Auto-link on a
  // granted port used to steal the CDC port, fail the USB-reset handshake,
  // and snap the header back to CONNECT with no error.
  const landOnLilyRef = useRef(false);
  useEffect(() => {
    if (deviceLink.status === "linked" && landOnLilyRef.current) {
      landOnLilyRef.current = false;
      setConnectOpen(false);
      setTab("TELEMETRY");
    }
    if (deviceLink.status === "error" || deviceLink.status === "off") {
      landOnLilyRef.current = false;
    }
  }, [deviceLink.status]);

  const onLilyDisconnect = async () => {
    await disconnectDeviceLink();
  };

  let totalUnread = 0;
  for (const n of s.unread.values()) totalUnread += n;

  const ch0 = s.channels.get(0);

  return (
    <div className={`app ${menuOpen ? "menu-open" : ""}`}>
      <Titlebar />
      <header>
        <div className="logo">
          <img className="logo-mark" src="/lilyshark-wordmark-pink.svg" alt="" aria-hidden="true" />
          <span className="wordmark">
            <span className="lily">lily</span>shark
          </span>
        </div>
        <nav>
          {TABS.map((tb, i) => (
            <button
              key={tb}
              className={`tab ${tb === tab ? "active" : ""}`}
              title={`Ctrl+${i === 9 ? 0 : i + 1}`}
              style={{ "--i": i } as CSSProperties}
              onClick={() => {
                setNodeFocus(undefined);
                setMapFocus(undefined);
                setTab(tb);
                setMenuOpen(false);
              }}
            >
              [{t(tb)}]
              {tb === "CHAT" && totalUnread > 0 && (
                <span className="unread-badge">{totalUnread}</span>
              )}
            </button>
          ))}
        </nav>
        {/* Phone-only: the ten tabs live behind this instead of a side-scroll. */}
        <button
          className="menu-btn"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <span className="spacer" />
        {connected ? (
          <button className="primary" onClick={stopAndForget}>
            {t("DISCONNECT")}
          </button>
        ) : lilyLinked ? (
          <button className="primary" onClick={() => void onLilyDisconnect()}>
            T-DECK LINKED
          </button>
        ) : connecting || lilyConnecting ? (
          <button
            className="primary"
            onClick={() => {
              if (lilyConnecting) void onLilyDisconnect();
              else void onCancel();
            }}
          >
            {t("CANCEL")}
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => {
              landOnLilyRef.current = true;
              void connectDeviceLink();
            }}
          >
            {t("CONNECT")}
          </button>
        )}
        {!connected && !lilyLinked && !connecting && !lilyConnecting && (
          <button onClick={() => setConnectOpen(true)}>OTHER RADIO</button>
        )}
        <div className="conn-pill">
          <span className={`led ${ledClass}`} />
          <span
            className={
              pillLive ? "" : connecting || configuring || lilyConnecting ? "txt-connecting" : "txt-off"
            }
          >
            {connText}
          </span>
        </div>
      </header>

      {/* The connect sheet: the same surface as the tab sheet, holding the
          three steps instead of a transport dropdown squeezed into the header. */}
      {connectOpen && (
        <div className="overlay-sheet" role="dialog" aria-label="Connect a radio">
          <button
            className="sheet-close"
            aria-label="Close"
            onClick={() => setConnectOpen(false)}
          >
            ✕
          </button>
          <div className="sheet-title">CONNECT A RADIO</div>
          <div className="flow">
            <div className="flow-step">
              <span className="flow-n">01</span>
              <span className="flow-k">FLASH</span>
              <span className="flow-v">
                the radio runs Lilyshark (<a href="/flash/" target="_blank" rel="noreferrer">
                install it from the browser</a>) or the MeshCore companion
                firmware — a T-Deck, Heltec, RAK or any supported LoRa board
              </span>
            </div>
            <div className="flow-step">
              <span className="flow-n">02</span>
              <span className="flow-k">LINK</span>
              <span className="flow-v">
                pick how this browser reaches it — the device picker opens on
                the same tap
              </span>
            </div>
            <div className="flow-step">
              <span className="flow-n">03</span>
              <span className="flow-k">LISTEN</span>
              <span className="flow-v">
                the terminal configures itself and every screen switches from
                the demo mesh to what your radio hears
              </span>
            </div>
          </div>
          <div className="sheet-actions">
            <button
              className="primary"
              disabled={!hasSerial}
              title="For a T-Deck running Lilyshark firmware: live device telemetry on TELEMETRY, your node on NODES, and Shelby pointer hand-off on TRAFFIC"
              onClick={() => {
                landOnLilyRef.current = true;
                setConnectOpen(false);
                void connectDeviceLink();
              }}
            >
              LILYSHARK T-DECK · USB
            </button>
            <button
              disabled={!hasSerial}
              onClick={() => {
                setMode("serie");
                setConnectOpen(false);
                void onConnect("serie");
              }}
            >
              MESHCORE · USB
            </button>
            <button
              disabled={!hasBle}
              onClick={() => {
                setMode("ble");
                setConnectOpen(false);
                void onConnect("ble");
              }}
            >
              MESHCORE · BLUETOOTH
            </button>
          </div>
          <p className="sheet-note">
            Pick by firmware, not by cable. A T-Deck running Lilyshark links
            with the first button — the header turns into DISCONNECT, and the
            live readout opens on TELEMETRY. The MeshCore buttons speak the
            companion protocol and will sit at ESTABLISHING LINK forever
            against a Lilyshark radio.
          </p>
          {!hasSerial && !hasBle && (
            <p className="sheet-note">
              This browser exposes neither Web Serial nor Web Bluetooth — open
              lilyshark.com in Chrome or Edge on a computer, or Chrome on
              Android, to attach a radio. Everything else works right here.
            </p>
          )}
          {!hasSerial && hasBle && (
            <p className="sheet-note">
              USB needs Chrome or Edge on a computer; Bluetooth works here.
            </p>
          )}
        </div>
      )}

      {(error || (deviceLink.status === "error" && deviceLink.error)) && (
        <p className="error">{error || deviceLink.error}</p>
      )}
      {deviceLink.status === "connecting" && (
        <p className="error">
          Waiting for the T-Deck after USB reset
          {deviceLink.lastRx ? ` · heard: ${deviceLink.lastRx}` : " · no serial yet"}
        </p>
      )}

      <ScreenBoundary key={tab}>
      <Suspense
        fallback={
          <main>
            <div className="panel" style={{ flex: 1 }}>
              <div className="panel-title">LOADING…</div>
            </div>
          </main>
        }
      >
      {tab === "TRAFFIC" && (
        <TrafficTab demoActive={!connected && !lilyLinked && !everConnectedRef.current} />
      )}
      {tab === "SHELBY" && <ShelbyScreen />}
      {tab === "INTRO" && <IntroTab onOpen={(next) => setTab(next as Tab)} />}
      {tab === "PAPER" && <WhitepaperTab />}
      {tab === "DOCS" && <Docs />}
      {tab === "CHAT" && (
        <Chat
          convo={chatConvo}
          setConvo={setChatConvo}
          focusSearch={focusSearch}
          onViewNode={(num) => {
            setNodeFocus(num);
            setTab("NODES");
          }}
          onViewOnMap={(num) => {
            setMapFocus(num);
            setTab("MAP");
          }}
        />
      )}
      {tab === "NODES" && (
        <Nodes
          initialSelected={nodeFocus}
          onOpenDm={(num) => {
            setChatConvo(`dm:${num}`);
            setTab("CHAT");
          }}
        />
      )}
      {tab === "MAP" && (
        <MapView
          focusNode={mapFocus}
          onOpenNode={(num) => {
            setNodeFocus(num);
            setTab("NODES");
          }}
        />
      )}
      {tab === "MESH" && <Mesh />}
      {tab === "CONFIG" && <Config />}
      {tab === "TELEMETRY" && <Telemetry />}
      {tab === "DEBUG" && (
        <main>
          {/* no background of its own: hardcoding a near-black left the light
              theme's dark text unreadable */}
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-title">
              <span>PANEL // DEBUG · SERIAL 115200 8N1</span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  style={{ fontSize: 10, padding: "0 6px" }}
                  title={t("Export the log to a text file")}
                  disabled={s.log.length === 0}
                  onClick={() =>
                    saveText(`meshcore-log-${stamp()}.txt`, s.log.map(fmtLog).join("\n"))
                      .then((p) => p && setError(t("EXPORTED → {0}", p)))
                      .catch((e) => setError(t("EXPORT FAILED: {0}", String(e))))
                  }
                >
                  {t("⭳ EXPORT")}
                </button>
                {t("{0} LINES", s.log.length)}
              </span>
            </div>
            <pre className="debuglog">
              {s.log.map(fmtLog).join("\n")}
              {"\n"}
              <span className="cursor">█</span>
            </pre>
          </div>
        </main>
      )}
      </Suspense>
      </ScreenBoundary>

      <footer>
        {/* The node counts to the right are invented while no radio is
            attached: say so before they are read as a measurement. */}
        {s.deviceInfo?.model && <span>HW {s.deviceInfo.model}</span>}
        {s.selfInfo && (
          <span>
            {t("FREQ")} {fmtFreq(s.selfInfo.radioFreq)} · SF{s.selfInfo.radioSf}
          </span>
        )}
        {ch0 && <span>{t("CHANNEL")} 0 #{ch0.name}</span>}
        {(() => {
          const nowS = Date.now() / 1000;
          const act = [...s.nodes.values()].filter(
            (n) => nowS - n.lastHeard < 3600,
          ).length;
          return <span>{t("{0} NODES · {1} ACTIVE 1H", s.nodes.size, act)}</span>;
        })()}
        <span className="spacer" />
        {/* Uplink duration and host battery moved down from the header: they
            are session status, which is what this strip is for, and the
            header stays down to identity, navigation, and the connect act. */}
        {connected && connectedAt && <span>UPLINK {hms(now - connectedAt)}</span>}
        {lilyLinked && deviceLink.firmware && (
          <span>LILYSHARK {deviceLink.firmware}</span>
        )}
        {hostBat && !hostBat.charging && (
          <span className={hostBat.level <= 0.2 ? "err" : "dim"}>
            BAT {Math.round(hostBat.level * 100)}%
          </span>
        )}
        <span>{s.log.length ? fmtLog(s.log[s.log.length - 1]) : "—"}</span>
      </footer>
    </div>
  );
}

export default App;
