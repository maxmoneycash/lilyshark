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
import { clearDemo, isDemo, seedDemo } from "./demo";
import { preverBateria } from "./battery";
import { addLog, DeviceStatus, fmtLog, getSnapshot, subscribe } from "./store";
import { getAutoPurgeDays, loadTelemetry, purgeOlderThan } from "./db";
import Chat from "./screens/Chat";
import Nodes from "./screens/Nodes";
import Mesh from "./screens/Mesh";
import Config from "./screens/Config";
import { TrafficTab } from "../components/TrafficTab";
import { WhitepaperTab } from "../components/WhitepaperTab";
import { ShelbyScreen } from "./screens/Shelby";

// The heavy screens load on first visit rather than riding in the main chunk:
// Leaflet (MAP) and uPlot (TELEMETRY) together outweigh most of the app.
// PAPER is eager — it is the landing screen, and since the pages became
// pre-rendered images its code is a few kilobytes.
const MapView = lazy(() => import("./screens/MapView"));
const Telemetry = lazy(() => import("./screens/Telemetry"));
import { fmtFreq, useHourTick } from "./fmt";
import { saveText, stamp } from "./export";
import { t, useLangTick } from "./i18n";
import "./meshterm.css";

const VERSION = "0.1.0";

const TABS = [
  "PAPER",
  "TRAFFIC",
  "SHELBY",
  "CHAT",
  "NODOS",
  "MAPA",
  "MALLA",
  "TELEMETRÍA",
  "CONFIG",
  "DEBUG",
] as const;
type Tab = (typeof TABS)[number];

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
              <span>{t("ERROR EN PANTALLA")}</span>
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
          title={fs ? t("Salir de pantalla completa") : t("Pantalla completa")}
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
  // The paper opens first: it is the argument the rest of the app demonstrates.
  const [tab, setTab] = useState<Tab>("PAPER");
  // Phone nav: the ten tabs live behind a hamburger instead of a side-scroll.
  const [menuOpen, setMenuOpen] = useState(false);
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
    if (connected) {
      everConnectedRef.current = true;
      clearDemo();
    } else if (!everConnectedRef.current) {
      seedDemo();
    }
  }, [connected]);

  // Leaving the map drops the focus: the ring shouldn't outlive the jump
  useEffect(() => {
    if (tab !== "MAPA") setMapFocus(undefined);
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
            t("{0} · batería {1}%", a.name, a.value),
            t("Por debajo del umbral ({0}%)", a.threshold),
          );
        } else {
          void notify(
            t("{0} · sin señal", a.name),
            t("{0} h sin dar señal", a.value),
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
            preverBateria(rows),
            cfg,
            fired,
          );
          if (a) {
            void notify(
              t("{0} · autonomía ~{1} h", a.name, a.value),
              t("Al ritmo actual se agota por debajo de {0} h", a.threshold),
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
            if (n > 0) addLog("Purga automática: {0} filas borradas", n);
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
        addLog("RECONEXION: no hay conexión previa que reintentar");
        return;
      }
      wantRef.current = true;
      // A node that just dropped is either rebooting or out of range. Either
      // way it takes 10-20 s to answer again, so retrying immediately only
      // burns the first attempt.
      setError(t("Enlace perdido · reconectando en {0}s", RECONNECT_WAIT_MS / 1000));
      addLog("RECONEXION: programada en {0}s", RECONNECT_WAIT_MS / 1000);
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

  const onConnect = async () => {
    setError("");
    setConnecting(true);
    canceledRef.current = false;
    wantRef.current = true;
    try {
      // The browser's device picker is the port selector of a web app: it
      // opens on this click (a user gesture is mandatory for Web Serial/BLE).
      await (mode === "serie" ? connectSerial() : connectBle());
      if (canceledRef.current) return;
      setConnectedAt(Date.now());
      saveLastMode(mode);
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
      addLog("RECONEXION: cancelada (desconexión manual)");
      return;
    }
    if (reconnectBusyRef.current) {
      addLog("RECONEXION: ya hay un intento en curso");
      return;
    }
    reconnectBusyRef.current = true;
    setConnecting(true);
    setError(t("Reconectando… (intento {0})", attemptRef.current + 1));
    addLog("RECONEXION: intento {0}", attemptRef.current + 1);
    try {
      await reconnectLast();
      if (!wantRef.current) return; // the user cancelled while reconnecting
      setConnectedAt(Date.now());
      setError("");
      attemptRef.current = 0;
      addLog("RECONEXION: conectado");
    } catch (e) {
      if (!wantRef.current) return;
      // Swallowing this was why a failed reconnect left no trace anywhere:
      // the header string is the next thing to overwrite itself.
      addLog("RECONEXION: intento {0} fallido: {1}", attemptRef.current + 1, String(e));
      attemptRef.current++;
      const delay = Math.min(15000, 2000 * 2 ** (attemptRef.current - 1));
      setError(t("Reconexión fallida, reintento en {0}s", delay / 1000));
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
    setError(t("Conexión cancelada"));
    await stopAndForget();
  };


  const ledClass = connected ? "on" : connecting || configuring ? "connecting" : "";
  const connText = connected
    ? s.status === DeviceStatus.Configured
      ? "DEVICE CONFIGURED"
      : "LINK UP"
    : connecting || configuring
      ? "ESTABLISHING LINK…"
      : "NO LINK";

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
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          disabled={connected || connecting}
          title={t("El navegador pedirá el dispositivo al conectar")}
        >
          <option value="serie">USB</option>
          <option value="ble">BLE</option>
        </select>
        {connected ? (
          <button className="primary" onClick={stopAndForget}>
            {t("DESCONECTAR")}
          </button>
        ) : connecting ? (
          <button className="primary" onClick={onCancel}>
            {t("CANCELAR")}
          </button>
        ) : (
          <button className="primary" onClick={onConnect}>
            {t("CONECTAR")}
          </button>
        )}
        <div className="conn-pill">
          <span className={`led ${ledClass}`} />
          <span
            className={
              connected ? "" : connecting || configuring ? "txt-connecting" : "txt-off"
            }
          >
            {connText}
          </span>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

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
      {tab === "TRAFFIC" && <TrafficTab />}
      {tab === "SHELBY" && <ShelbyScreen />}
      {tab === "PAPER" && <WhitepaperTab />}
      {tab === "CHAT" && (
        <Chat
          convo={chatConvo}
          setConvo={setChatConvo}
          focusSearch={focusSearch}
          onViewNode={(num) => {
            setNodeFocus(num);
            setTab("NODOS");
          }}
          onViewOnMap={(num) => {
            setMapFocus(num);
            setTab("MAPA");
          }}
        />
      )}
      {tab === "NODOS" && (
        <Nodes
          initialSelected={nodeFocus}
          onOpenDm={(num) => {
            setChatConvo(`dm:${num}`);
            setTab("CHAT");
          }}
        />
      )}
      {tab === "MAPA" && (
        <MapView
          focusNode={mapFocus}
          onOpenNode={(num) => {
            setNodeFocus(num);
            setTab("NODOS");
          }}
        />
      )}
      {tab === "MALLA" && <Mesh />}
      {tab === "CONFIG" && <Config />}
      {tab === "TELEMETRÍA" && <Telemetry />}
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
                  title={t("Exportar el log a un archivo de texto")}
                  disabled={s.log.length === 0}
                  onClick={() =>
                    saveText(`meshcore-log-${stamp()}.txt`, s.log.map(fmtLog).join("\n"))
                      .then((p) => p && setError(t("EXPORTADO → {0}", p)))
                      .catch((e) => setError(t("FALLO EXPORT: {0}", String(e))))
                  }
                >
                  {t("⭳ EXPORTAR")}
                </button>
                {t("{0} LÍNEAS", s.log.length)}
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
        {isDemo() && <span className="warn">DEMO DATA</span>}
        {s.deviceInfo?.model && <span>HW {s.deviceInfo.model}</span>}
        {s.selfInfo && (
          <span>
            {t("FREQ")} {fmtFreq(s.selfInfo.radioFreq)} · SF{s.selfInfo.radioSf}
          </span>
        )}
        {ch0 && <span>{t("CANAL")} 0 #{ch0.name}</span>}
        {(() => {
          const nowS = Date.now() / 1000;
          const act = [...s.nodes.values()].filter(
            (n) => nowS - n.lastHeard < 3600,
          ).length;
          return <span>{t("{0} NODOS · {1} ACTIVOS 1H", s.nodes.size, act)}</span>;
        })()}
        <span className="spacer" />
        {/* Uplink duration and host battery moved down from the header: they
            are session status, which is what this strip is for, and the
            header stays down to identity, navigation, and the connect act. */}
        {connected && connectedAt && <span>UPLINK {hms(now - connectedAt)}</span>}
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
