import { UiIcon } from "../components/UiIcon";
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { connectMeshtasticBle } from "./meshtasticBle";
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
import { evalAlerts, evalRuntime, getAlertCfg } from "./alerts";
import { clearDemo, seedDemo } from "./demo";
import { startNetNodes } from "./netNodes";
import { forecastBattery } from "./battery";
import { addLog, DeviceStatus, fmtLog, getSnapshot, subscribe } from "./store";
import { getAutoPurgeDays, loadTelemetry, openHistoryDb, purgeOlderThan } from "./db";
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
// Instrument screens fed by the USB link: idle until a deck is attached, so
// they load on first visit like the other heavy screens.
const Spectrum = lazy(() => import("./screens/Spectrum"));
const Sniffer = lazy(() => import("./screens/Sniffer"));
const DialKitDev = import.meta.env.DEV && new URLSearchParams(window.location.search).has("tdeck-tune")
  ? lazy(() => import("../components/DialKitDev").then((m) => ({ default: m.DialKitDev })))
  : null;
import { useHourTick } from "./fmt";
import { saveText, stamp } from "./export";
import { t, useLangTick } from "./i18n";
import {
  connectDeviceLink,
  disconnectDeviceLink,
  useDeviceLink,
} from "../lib/deviceLink";
import { bindAnalyzerMesh, setNetPublisher } from "./analyzerMesh";
import { NAV_TABS, isTab, parentTab, tabFromLocation, tabHref, type Tab } from "./navigation";
import { netConnect, publishHeardFrame } from "./net";
import "./meshterm.css";

const VERSION = "0.1.0";

const FlashPage = lazy(() => import("../flash/FlashPage").then(module => ({ default: module.FlashPage })));

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
          aria-label={fs ? t("Exit fullscreen") : t("Fullscreen")}
        >
          <UiIcon name="expand" />
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

function onApplePhone(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function missingTransportError(kind: "usb" | "ble"): string {
  if (onApplePhone()) {
    return kind === "ble"
      ? "Safari on iPhone cannot open Bluetooth. Apple does not give websites that API. Use the Lilyshark iOS app, or Chrome on Android."
      : "Safari on iPhone has no USB serial. Use the Lilyshark iOS app, or Chrome on a computer.";
  }
  return kind === "ble"
    ? "This browser has no Web Bluetooth. Use Chrome or Edge on a computer, or Chrome on Android."
    : "USB needs Chrome or Edge on a computer. This browser has no Web Serial.";
}

function App() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  // at the root: a clock format or language change repaints every screen
  useHourTick();
  useLangTick();
  // The intro opens first: the device, its screens, and why it exists —
  // unless a deep link asked for a specific screen.
  const [tab, setTabState] = useState<Tab>(() => tabFromLocation(window.location));
  const setTab = useCallback((next: Tab) => {
    if (tabFromLocation(window.location) !== next) {
      window.history.pushState(null, "", tabHref(next));
    }
    setTabState(next);
    // A page selected from the sticky mobile menu starts at its beginning.
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    document.title = tab === "FLASH" ? "Flash Lilyshark — LILYGO T-Deck" : "Lilyshark — Mesh Radio Analyzer";
  }, [tab]);
  // Phone nav: the pages live behind a hamburger instead of a side-scroll.
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const debugCursorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const nav = navRef.current;
    const toggle = menuButtonRef.current;
    if (!nav || !toggle) return;
    const media = window.matchMedia("(max-width: 860px)");
    if (!media.matches) { setMenuOpen(false); return; }
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const controls = [...links, toggle];
    (links.find(link => link.getAttribute("aria-current") === "page") ?? links[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A modal dialog owns the keyboard; the hamburger trap must not steal Tab.
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      if (event.key === "Escape") {
        event.preventDefault(); setMenuOpen(false); toggle.focus();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const current = controls.indexOf(document.activeElement as HTMLAnchorElement | HTMLButtonElement);
        controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    };
    const onResize = () => { if (!media.matches) setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    media.addEventListener("change", onResize);
    return () => { document.removeEventListener("keydown", onKey); media.removeEventListener("change", onResize); };
  }, [menuOpen]);
  // Offer the transports this browser can use in a compact native dialog.
  const [connectOpen, setConnectOpen] = useState(false);
  const connectOpenRef = useRef(false);
  connectOpenRef.current = connectOpen;
  const connectDialog = useRef<HTMLDialogElement>(null);
  const openConnect = useCallback(() => {
    setMenuOpen(false);
    setConnectOpen(true);
  }, []);
  useEffect(() => {
    const dialog = connectDialog.current;
    if (!connectOpen || !dialog) return;
    const trigger = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const first =
      dialog.querySelector<HTMLButtonElement>(".sheet-actions button") ??
      dialog.querySelector<HTMLButtonElement>(".sheet-close");
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>(".sheet-close, .sheet-actions button"),
      );
      if (buttons.length === 0) return;
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? (i + 1) % buttons.length
        : (i - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    dialog.addEventListener("keydown", onKey);

    const vv = window.visualViewport;
    const syncVv = () => {
      if (!vv) return;
      const obscured = window.innerHeight - vv.height - vv.offsetTop;
      if (obscured < 40) {
        dialog.style.removeProperty("inset");
        dialog.style.removeProperty("top");
        dialog.style.removeProperty("left");
        dialog.style.removeProperty("right");
        dialog.style.removeProperty("max-height");
        dialog.style.removeProperty("margin");
        return;
      }
      const pad = 8;
      dialog.style.inset = "auto";
      dialog.style.left = "0";
      dialog.style.right = "0";
      dialog.style.margin = "0 auto";
      dialog.style.maxHeight = `${Math.max(160, vv.height - pad * 2)}px`;
      dialog.style.top = `${vv.offsetTop + pad}px`;
    };
    vv?.addEventListener("resize", syncVv);
    vv?.addEventListener("scroll", syncVv);
    syncVv();

    return () => {
      dialog.removeEventListener("keydown", onKey);
      vv?.removeEventListener("resize", syncVv);
      vv?.removeEventListener("scroll", syncVv);
      dialog.style.removeProperty("inset");
      dialog.style.removeProperty("left");
      dialog.style.removeProperty("right");
      dialog.style.removeProperty("top");
      dialog.style.removeProperty("max-height");
      dialog.style.removeProperty("margin");
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [connectOpen]);
  const hasSerial = typeof navigator !== "undefined" && "serial" in navigator;
  const hasBle = typeof navigator !== "undefined" && "bluetooth" in navigator;
  const onIos = onApplePhone();
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

  // Without a radio attached every screen is an empty panel, which shows
  // nothing about what the instrument does. Seed a demo mesh instead, and drop
  // it the instant real hardware appears so the two can never be confused.
  useEffect(() => {
    bindAnalyzerMesh();
    // The internet leg: frames the deck hears go to the shared room, and
    // frames other analyzers publish come back as NET nodes and messages.
    setNetPublisher(publishHeardFrame);
    netConnect();
    const onTab = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (isTab(next)) setTab(next);
    };
    window.addEventListener("lilyshark-tab", onTab);
    // A permalink pasted into the address bar of an already-open tab changes
    // the hash without reloading, so the deep link has to be honoured here as
    // well as at mount. Screens update their own part of the hash with
    // replaceState, which fires no event and so cannot loop back through this.
    const onHash = () => {
      setTabState(tabFromLocation(window.location));
      setMenuOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("lilyshark-tab", onTab);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, [setTab]);

  const deviceLink = useDeviceLink();
  const lilyConnecting = deviceLink.status === "connecting";
  const lilyLinked = deviceLink.status === "linked";

  useEffect(() => {
    if (connected || lilyLinked) {
      everConnectedRef.current = true;
      clearDemo();
      // With a real radio attached, add the internet's view of the mesh
      // around it -- amber, labelled NET -- so the map answers both "what do
      // I hear" and "who is out there".
      startNetNodes();
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
        tag === "SELECT" ||
        connectOpenRef.current ||
        el?.closest("dialog")
      ) {
        return;
      }
      // "1".."9" pick tabs 1-9; "0" picks the tenth, the way a browser numbers
      // its own tab shortcuts.
      const n = e.key === "0" ? 10 : Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= NAV_TABS.length) {
        e.preventDefault();
        setNodeFocus(undefined);
        setMapFocus(undefined);
        setTab(NAV_TABS[n - 1]);
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setTab("CHAT");
        setFocusSearch((v) => v + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

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
        if (a.kind === "battery") {
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
      if (!cfg.on || !cfg.runtimeH) return;
      const st = getSnapshot();
      for (const n of st.nodes.values()) {
        if (!n.fav || n.num === st.myNodeNum) continue;
        try {
          const rows = await loadTelemetry(
            n.num,
            "batteryLevel",
            Date.now() - 6 * 3_600_000,
          );
          const a = evalRuntime(
            { num: n.num, name: n.longName || n.shortName, fav: n.fav },
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
    ).then(() => openHistoryDb())
      .then(() => loadHistory())
      .catch((error) => {
        addLog("Saved history could not be loaded: {0}", String(error));
        setError("Saved history could not be loaded. Reload to try again.");
      });

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
  }, [deviceLink.status, setTab]);

  const onLilyDisconnect = async () => {
    await disconnectDeviceLink();
  };

  let totalUnread = 0;
  for (const n of s.unread.values()) totalUnread += n;
  const unreadMark = totalUnread > 9 ? "9+" : String(totalUnread);

  useEffect(() => {
    if (tab !== "DEBUG") return;
    debugCursorRef.current?.scrollIntoView({ block: "end", inline: "nearest" });
  }, [tab, s.log.length]);

  return (
    <div className={`app ${menuOpen ? "menu-open" : ""} ${tab === "FLASH" ? "app-flash" : ""}`}>
      <Titlebar />
      <header>
        <a className="logo" href={tabHref("INTRO")} aria-label="Lilyshark home" onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          setTab("INTRO");
          setMenuOpen(false);
        }}>
          <img className="logo-mark" src="/lilyshark-wordmark-pink.svg" alt="" aria-hidden="true" />
          <span className="wordmark">
            <span className="lily">lily</span>shark
          </span>
        </a>
        <nav ref={navRef} id="main-navigation" aria-label="Main navigation">
          {NAV_TABS.map((tb, i) => (
            <a
              key={tb}
              className={`tab ${tb === parentTab(tab) ? "active" : ""}`}
              href={tabHref(tb)}
              aria-current={tb === parentTab(tab) ? "page" : undefined}
              title={i < 10 ? `Ctrl+${i === 9 ? 0 : i + 1}` : undefined}
              style={{ "--i": i } as CSSProperties}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                setNodeFocus(undefined);
                setMapFocus(undefined);
                setTab(tb);
                setMenuOpen(false);
                if (menuOpen) menuButtonRef.current?.focus();
              }}
            >
              [{t(tb)}]
              {tb === "CHAT" && totalUnread > 0 && (
                <span className="unread-badge">{totalUnread}</span>
              )}
            </a>
          ))}
        </nav>
        {/* Phone-only: the pages live behind this instead of a side-scroll. */}
        <button
          ref={menuButtonRef}
          type="button"
          className="menu-btn"
          data-unread={totalUnread > 0 ? unreadMark : undefined}
          aria-label={menuOpen ? "Close menu" : totalUnread > 0 ? `Menu, ${totalUnread} unread` : "Menu"}
          aria-controls="main-navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <span className="spacer" />
        {connected ? (
          <button
            type="button"
            className="primary"
            title={t("Open this device's telemetry — disconnect from the status pill")}
            onClick={() => {
              setNodeFocus(undefined);
              setMapFocus(undefined);
              setMenuOpen(false);
              setTab("TELEMETRY");
            }}
          >
            {s.myNodeNum !== undefined
              ? (
                <>
                  <span className="conn-id">!{s.myNodeNum.toString(16).padStart(8, "0")} · </span>
                  {/t-deck/i.test(s.deviceInfo?.model ?? "") ? "T-DECK" : (s.deviceInfo?.model?.split(" ")[0]?.toUpperCase() ?? "RADIO")}
                </>
              )
              : t("LINKED")}
          </button>
        ) : lilyLinked ? (
          <button type="button" className="primary" onClick={() => void onLilyDisconnect()}>
            T-DECK LINKED
          </button>
        ) : connecting || lilyConnecting ? (
          <button
            type="button"
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
            type="button"
            className="primary"
            aria-haspopup="dialog"
            aria-expanded={connectOpen}
            onClick={openConnect}
          >
            {t("CONNECT")}
          </button>
        )}
        <button
          type="button"
          className="conn-pill"
          style={{ cursor: "pointer" }}
          title={t("Connection details")}
          aria-haspopup="dialog"
          aria-expanded={connectOpen}
          onClick={openConnect}
        >
          <span className={`led ${ledClass}`} />
          <span
            className={
              pillLive ? "" : connecting || configuring || lilyConnecting ? "txt-connecting" : "txt-off"
            }
          >
            {connText}
          </span>
        </button>
      </header>

      {connectOpen && (
        <dialog ref={connectDialog} className="overlay-sheet" aria-labelledby="connect-sheet-title" onCancel={() => { setConnectOpen(false); setError(""); }}>
          <div className="sheet-bar">
            <div className="sheet-title" id="connect-sheet-title">CONNECT A RADIO</div>
            <button
              type="button"
              className="sheet-close"
              aria-label="Close"
              onClick={() => {
                setConnectOpen(false);
                setError("");
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {!hasSerial && !hasBle && (
            <p className="sheet-note sheet-note-alert">
              This browser can explore the demo, but can’t connect to a radio.
              {onIos && " Use the Lilyshark iOS app to connect on this phone."}
            </p>
          )}
          {(hasSerial || hasBle) && <p className="sheet-note">Choose the firmware running on your radio.</p>}
          <div className="sheet-actions">
            {!hasSerial && !hasBle && !connected && !lilyLinked && (
              <button type="button" className="primary" onClick={() => { setConnectOpen(false); setTab("TRAFFIC"); }}>Explore demo</button>
            )}
            {(connected || lilyLinked) && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setConnectOpen(false);
                  if (connected) stopAndForget();
                  else void onLilyDisconnect();
                }}
              >
                {t("DISCONNECT")}
              </button>
            )}
            {hasSerial && (<button
              type="button"
              className="primary"
              title="For a T-Deck running Lilyshark firmware: live device telemetry on TELEMETRY, your node on NODES, and Shelby pointer hand-off on TRAFFIC"
              onClick={() => {
                if (!hasSerial) {
                  setError(missingTransportError("usb"));
                  return;
                }
                landOnLilyRef.current = true;
                setConnectOpen(false);
                void connectDeviceLink();
              }}
            >
              Lilyshark · USB
            </button>
            )}
            {hasBle && (<button
              type="button"
              title="For a T-Deck running Lilyshark firmware: pair over Bluetooth the way the Meshtastic phone app does — no cable, and it works with no internet at all"
              onClick={() => {
                if (!hasBle) {
                  setError(missingTransportError("ble"));
                  return;
                }
                setConnectOpen(false);
                setError("");
                void connectMeshtasticBle().catch((e) => setError(String(e)));
              }}
            >
              Lilyshark · Bluetooth
            </button>
            )}
            {hasSerial && (<button
              type="button"
              onClick={() => {
                if (!hasSerial) {
                  setError(missingTransportError("usb"));
                  return;
                }
                setMode("serie");
                setConnectOpen(false);
                void onConnect("serie");
              }}
            >
              MeshCore · USB
            </button>
            )}
            {hasBle && (<button
              type="button"
              onClick={() => {
                if (!hasBle) {
                  setError(missingTransportError("ble"));
                  return;
                }
                setMode("ble");
                setConnectOpen(false);
                void onConnect("ble");
              }}
            >
              MeshCore · Bluetooth
            </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          {(hasSerial || hasBle) && (
            <p className="sheet-note">
              USB carries analyzer telemetry. Bluetooth carries mesh messages.
            </p>
          )}
        </dialog>
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

      {(tab === "DOCS" || tab === "PAPER" || tab === "CONFIG" || tab === "DEBUG") && (
        <nav className="section-tabs" aria-label={parentTab(tab) === "DOCS" ? "Documentation views" : "Configuration views"}>
          {(parentTab(tab) === "DOCS" ? ["DOCS", "PAPER"] as const : ["CONFIG", "DEBUG"] as const).map((view) => (
            <a key={view} href={tabHref(view)} aria-current={tab === view ? "page" : undefined} onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); setTab(view);
            }}>{view === "DOCS" ? "Documentation" : view === "PAPER" ? "Whitepaper" : view === "CONFIG" ? "Settings" : "Diagnostics"}</a>
          ))}
        </nav>
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
      {tab === "INTRO" && (
        <IntroTab
          onOpen={(next) => setTab(next as Tab)}
          onConnect={openConnect}
          connected={connected || lilyLinked}
        />
      )}
      {tab === "FLASH" && <FlashPage onOpen={setTab} />}
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
      {tab === "SPECTRUM" && <Spectrum />}
      {tab === "SNIFFER" && <Sniffer />}
      {tab === "DEBUG" && (
        <main className="debug-main">
          {/* no background of its own: hardcoding a near-black left the light
              theme's dark text unreadable */}
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-title">
              <span>PANEL // DEBUG · SERIAL 115200 8N1</span>
              <span className="debug-tools">
                <button
                  type="button"
                  title={t("Export the log to a text file")}
                  disabled={s.log.length === 0}
                  onClick={() =>
                    saveText(`meshcore-log-${stamp()}.txt`, s.log.map(fmtLog).join("\n"))
                      .then((p) => p && setError(t("EXPORTED → {0}", p)))
                      .catch((e) => setError(t("EXPORT FAILED: {0}", String(e))))
                  }
                >
                  {t("EXPORT")}
                </button>
                {t("{0} LINES", s.log.length)}
              </span>
            </div>
            <pre className="debuglog" tabIndex={0} aria-label="Serial log">
              {s.log.map(fmtLog).join("\n")}
              {"\n"}
              <span className="cursor" ref={debugCursorRef}>█</span>
            </pre>
          </div>
        </main>
      )}
      </Suspense>
      </ScreenBoundary>
      {DialKitDev && (
        <Suspense fallback={null}>
          <DialKitDev />
        </Suspense>
      )}
    </div>
  );
}

export default App;
