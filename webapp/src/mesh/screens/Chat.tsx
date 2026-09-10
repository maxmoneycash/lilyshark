import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearUnread, DeviceStatus, getSnapshot, subscribe, type Message } from "../store";
import { clearConvo, retryMessage, sendText } from "../radio";
import { saveText, stamp } from "../export";
import { getDeviceLinkState } from "../../lib/deviceLink";
import { t } from "../i18n";
import { dateTime, hhmm } from "../fmt";
import "./chat-polish.css";

// in search results the time alone isn't enough: they may be from another day
const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });

// midnight-to-midnight day key: two timestamps in the same local day match
const dayKey = (ms: number) => new Date(ms).toDateString();

// Day separator: TODAY/YESTERDAY for recent messages, full date otherwise.
const dateSep = (ms: number): string => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return t("TODAY");
  if (days === 1) return t("YESTERDAY");
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export default function Chat({
  convo,
  setConvo,
  focusSearch,
  onViewNode,
  onViewOnMap,
}: {
  convo: string;
  setConvo: (c: string) => void;
  // changes on every Ctrl+F, even when the chat was already open
  focusSearch?: number;
  onViewNode: (num: number) => void;
  onViewOnMap: (num: number) => void;
}) {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  // context menu opened by clicking a sender name in a message
  const [menu, setMenu] = useState<{ num: number; x: number; y: number }>();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  // the 3 s disarm of the CLEAR confirmation
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<Message | undefined>();
  const followLatest = useRef(true);
  const previousView = useRef("");
  const previousLast = useRef("");
  const searchTarget = useRef<string>();
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [sendShake, setSendShake] = useState(false);

  useEffect(() => {
    if (focusSearch) searchRef.current?.select();
  }, [focusSearch]);

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  // Sticky bottom:0 is the layout viewport; iOS keyboard covers it. CONNECT
  // already pins to visualViewport — same inset math, same listeners.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const spacer = spacerRef.current;
    if (!dock) return;
    const vv = window.visualViewport;
    const parent = dock.parentElement;

    const clearInset = () => {
      parent?.style.removeProperty("--keyboard-inset");
      spacer?.style.removeProperty("height");
      dock.style.removeProperty("bottom");
      dock.style.removeProperty("padding-bottom");
      dock.style.removeProperty("margin-bottom");
    };

    const syncVv = () => {
      const focused = dock.contains(document.activeElement);
      const obscured = vv ? window.innerHeight - vv.height - vv.offsetTop : 0;
      if (!vv || !focused || obscured < 40) {
        clearInset();
        return;
      }
      const inset = `${obscured}px`;
      const pos = getComputedStyle(dock).position;
      const sticky = pos === "sticky" || pos === "-webkit-sticky";
      dock.style.paddingBottom = "0px";
      if (sticky) {
        parent?.style.setProperty("--keyboard-inset", inset);
        dock.style.bottom = inset;
        dock.style.removeProperty("margin-bottom");
        if (spacer) spacer.style.height = inset;
      } else {
        parent?.style.removeProperty("--keyboard-inset");
        dock.style.removeProperty("bottom");
        if (spacer) spacer.style.removeProperty("height");
        dock.style.marginBottom = inset;
      }
      if (!followLatest.current) return;
      const list = listRef.current;
      if (list && list.scrollHeight - list.clientHeight > 1) {
        list.scrollTop = list.scrollHeight;
      } else {
        const se = document.scrollingElement;
        if (se) se.scrollTop = se.scrollHeight;
      }
    };

    const onFocusOut = () => {
      requestAnimationFrame(syncVv);
    };

    vv?.addEventListener("resize", syncVv);
    vv?.addEventListener("scroll", syncVv);
    dock.addEventListener("focusin", syncVv);
    dock.addEventListener("focusout", onFocusOut);
    syncVv();
    return () => {
      vv?.removeEventListener("resize", syncVv);
      vv?.removeEventListener("scroll", syncVv);
      dock.removeEventListener("focusin", syncVv);
      dock.removeEventListener("focusout", onFocusOut);
      clearInset();
    };
  }, []);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(12, Math.min(menu.x, window.innerWidth - bounds.width - 12))}px`;
    element.style.top = `${Math.max(12, Math.min(menu.y, window.innerHeight - bounds.height - 12))}px`;
    const items = [...element.querySelectorAll<HTMLButtonElement>("button")];
    items[0]?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(undefined);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (menuTrigger.current?.isConnected) menuTrigger.current.focus({ preventScroll: true });
    };
  }, [menu]);

  // Search walks ALL conversations: finding an old message usually matters
  // more than which channel it was in. Each result says where it came from.
  const q = search.trim().toLowerCase();
  const msgs = q
    ? s.messages.filter((m) => m.text.toLowerCase().includes(q))
    : s.messages.filter((m) => m.convo === convo);
  const convoCount = s.messages.filter((m) => m.convo === convo).length;

  // Scroll the list, not the page. scrollIntoView asks the nearest scrollable
  // ancestor to move, and on a phone — where the panes have stacked and the
  // document is the scroller — that yanked the whole page down on every message.
  const lastMessage = msgs[msgs.length - 1];
  const lastMessageKey = lastMessage ? `${lastMessage.id}:${lastMessage.ts}` : "";
  useLayoutEffect(() => {
    const viewChanged = previousView.current !== `${convo}:${q}`;
    previousView.current = `${convo}:${q}`;
    const messageArrived = previousLast.current !== lastMessageKey;
    previousLast.current = lastMessageKey;
    const el = listRef.current;
    if (!el) return;
    if (q) {
      if (viewChanged) el.scrollTop = 0;
      return;
    }
    if (searchTarget.current) {
      const target = el.querySelector<HTMLElement>(`[data-message-key="${searchTarget.current}"]`);
      searchTarget.current = undefined;
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "instant" });
        followLatest.current = false;
        setHasNewMessages(false);
        return;
      }
    }
    if (viewChanged || followLatest.current || (messageArrived && lastMessage?.mine)) {
      el.scrollTop = el.scrollHeight;
      followLatest.current = true;
      setHasNewMessages(false);
    } else if (messageArrived) {
      setHasNewMessages(true);
    }
  }, [convo, lastMessageKey, lastMessage?.mine, q]);

  // Viewing a conversation (or a message arriving while open) clears unread
  useEffect(() => {
    clearUnread(convo);
  }, [convo, msgs.length]);

  // Never carry an armed "clear" or a reply target across conversations
  useEffect(() => {
    setConfirmClear(false);
    setReplyTo(undefined);
  }, [convo]);

  const channelConvos = [...s.channels.values()].map((c) => ({
    key: `ch:${c.index}`,
    label: `#${c.name}`,
  }));
  if (channelConvos.length === 0) {
    channelConvos.push({ key: "ch:0", label: t("LONGFAST") });
  }
  const dmKeys = new Set(
    s.messages.filter((m) => m.convo.startsWith("dm:")).map((m) => m.convo),
  );
  if (convo.startsWith("dm:")) dmKeys.add(convo);
  const dmConvos = [...dmKeys].map((key) => {
    const num = Number(key.slice(3));
    return { key, label: `@${s.nodes.get(num)?.shortName ?? num.toString(16)}` };
  });

  const nodeShort = (num: number) =>
    num === s.myNodeNum
      ? t("ME")
      : (s.nodes.get(num)?.shortName ?? num.toString(16).slice(-4));

  const labelOf = (key: string) =>
    [...channelConvos, ...dmConvos].find((c) => c.key === key)?.label ??
    (key.startsWith("dm:")
      ? `@${s.nodes.get(Number(key.slice(3)))?.shortName ?? key.slice(3)}`
      : key);
  const convoLabel = labelOf(convo);
  const openSearchMessage = (message: Message) => {
    searchTarget.current = `${message.id}:${message.ts}`;
    setConvo(message.convo);
    setSearch("");
  };

  const onSend = async () => {
    const text = draft.trim();
    if (!text) return;
    const existing = new Set(getSnapshot().messages.map((m) => `${m.id}:${m.ts}`));
    const reply = replyTo;
    setDraft("");
    setError("");
    setSendShake(false);
    const rid = replyTo?.id;
    setReplyTo(undefined);
    try {
      await sendText(text, convo, rid);
    } catch (e) {
      setError(t("TX FAILED: {0}", String(e)));
      setSendShake(true);
      // A disconnected link can reject before creating a retryable chat row.
      // Keep that draft available without duplicating messages already stored.
      const stored = getSnapshot().messages.some((m) =>
        m.mine && m.convo === convo && m.text === text && !existing.has(`${m.id}:${m.ts}`),
      );
      if (!stored) {
        setDraft((current) => current || draft);
        setReplyTo((current) => current ?? reply);
      }
    }
  };

  return (
    <main className="chat-screen">
      <div className="panel chat-convos" style={{ width: 230, flexShrink: 0 }}>
        <div className="panel-title">{t("PANEL // CHANNELS")}</div>
        <div className="chat-convo-list">
          {channelConvos.map((c) => (
            <button
              type="button"
              key={c.key}
              className={`convo-item ${c.key === convo ? "active" : ""}`}
              aria-pressed={c.key === convo}
              onClick={() => setConvo(c.key)}
            >
              <span>{c.label}</span>
              {(s.unread.get(c.key) ?? 0) > 0 && (
                <span className="unread-badge">{s.unread.get(c.key)}</span>
              )}
            </button>
          ))}
        </div>
        <div className="panel-title" style={{ borderTop: "1px solid var(--border)" }}>
          {t("DIRECT MESSAGES")}
        </div>
        <div className="chat-convo-list">
          {dmConvos.length === 0 && (
            <div className="convo-item dim" style={{ cursor: "default" }}>
              <span>{t("Choose a node to start a direct message.")}</span>
            </div>
          )}
          {dmConvos.map((c) => (
            <button
              type="button"
              key={c.key}
              className={`convo-item ${c.key === convo ? "active" : ""}`}
              aria-pressed={c.key === convo}
              onClick={() => setConvo(c.key)}
            >
              <span>{c.label}</span>
              {(s.unread.get(c.key) ?? 0) > 0 && (
                <span className="unread-badge">{s.unread.get(c.key)}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="panel chat-thread" style={{ flex: 1, minWidth: 0 }}>
        <div className="panel-title chat-titlebar">
          <div className="chat-heading">
            <span className="chat-heading-label">CHAT · {convoLabel}</span>
            <label className="chat-conversation-picker-wrap">
              <span className="chat-conversation-picker-k">{t("CHAT")}</span>
              <select
                className="chat-conversation-picker"
                aria-label={t("Conversation")}
                value={convo}
                onChange={(e) => setConvo(e.target.value)}
              >
                <optgroup label={t("Channels")}>
                  {channelConvos.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}{(s.unread.get(c.key) ?? 0) > 0 ? ` · ${s.unread.get(c.key)} unread` : ""}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("Direct messages")}>
                  {dmConvos.length === 0 ? (
                    <option value="" disabled>
                      {t("No direct messages yet")}
                    </option>
                  ) : (
                    dmConvos.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}{(s.unread.get(c.key) ?? 0) > 0 ? ` · ${s.unread.get(c.key)} unread` : ""}
                      </option>
                    ))
                  )}
                </optgroup>
              </select>
            </label>
            {convo.startsWith("dm:") &&
              (s.nodes.get(Number(convo.slice(3)))?.publicKey ? (
                <span className="chat-encryption" title={t("END-TO-END ENCRYPTED (PKI)")}>PKI</span>
              ) : (
                <span
                  className="chat-encryption warn"
                  title={t("NO PUBLIC KEY: ENCRYPTED WITH THE CHANNEL PSK ONLY")}
                >
                  {t("NO PKI")}
                </span>
              ))}
            {dmConvos.length === 0 && (
              <span className="chat-dm-empty-hint dim">
                {t("Open a node to start a direct message.")}
              </span>
            )}
          </div>
          <span className="chat-tools">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  e.currentTarget.blur();
                }
              }}
              placeholder={t("Search")}
              aria-label={t("Search message history")}
              title={t("CTRL+F · ESC CLEARS")}
              className="chat-search"
            />
            <button

              title={q ? t("Export search results to a text file") : t("Export this conversation to a text file")}
              disabled={msgs.length === 0}
              onClick={async () => {
                try {
                  const path = await saveText(
                    `meshcore-${q ? "search" : convo.replace(":", "-")}-${stamp()}.txt`,
                    msgs
                      .map(
                        (m) =>
                          `${new Date(m.ts).toISOString()} [${labelOf(m.convo)}] <${m.mine ? t("ME") : nodeShort(m.from)}> ${m.text}${m.mine ? ` (${m.state})` : ""}`,
                      )
                      .join("\n"),
                  );
                  setError(path ? t("EXPORTED → {0}", path) : "");
                } catch (e) {
                  setError(t("EXPORT FAILED: {0}", String(e)));
                }
              }}
            >
              {t("EXPORT")}
            </button>
            <button
              className="danger"

              title={t("DELETE ALL MESSAGES IN THIS CONVERSATION")}
              aria-label={t("Clear {0} history", convoLabel)}
              disabled={convoCount === 0}
              onClick={() => {
                if (confirmClear) {
                  setConfirmClear(false);
                  setError("");
                  clearConvo(convo).catch((e) => setError(String(e)));
                } else {
                  setConfirmClear(true);
                  setError(
                    t("{0} MESSAGES WILL BE DELETED · PRESS AGAIN", convoCount),
                  );
                  clearTimeout(clearTimer.current);
                  clearTimer.current = setTimeout(
                    () => setConfirmClear(false),
                    3000,
                  );
                }
              }}
            >
              {confirmClear ? t("SURE?") : t("CLEAR")}
            </button>
          </span>
        </div>
        <div
          ref={listRef}
          className="scroll-y chat-msgs"
          data-searching={Boolean(q)}
          tabIndex={0}
          role="region"
          aria-label={t("Messages in {0}", convoLabel)}
          onScroll={(e) => {
            const el = e.currentTarget;
            followLatest.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48;
            if (followLatest.current) setHasNewMessages(false);
          }}
          style={{
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {msgs.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-title">
                {q
                  ? t("No messages match \"{0}\"", search)
                  : t("No messages in {0} yet", convoLabel)}
              </div>
              <div className="dim">
                {q
                  ? t("Try another word or clear the search field.")
                  : (s.status ?? DeviceStatus.Disconnected) >= DeviceStatus.Connected || getDeviceLinkState().status === "linked"
                    ? t("Write a message below to start the conversation.")
                    : t("Connect a radio to send and receive mesh messages.")}
              </div>
              {(!q && (s.status ?? DeviceStatus.Disconnected) < DeviceStatus.Connected && getDeviceLinkState().status !== "linked") && (
                <button className="primary" onClick={() => window.dispatchEvent(new CustomEvent('lilyshark-connect'))} style={{ alignSelf: 'center', marginTop: 16 }}>
                  {t("CONNECT")}
                </button>
              )}
            </div>
          )}
          {!q && getDeviceLinkState().status === "linked" && (
            <div className="chat-hint">
              {t("Messages sent here also appear in the T-Deck’s Chat tab.")}
            </div>
          )}
          {q && msgs.length > 0 && (
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
              {t("{0} {1} across all conversations. Select a message to open it.", msgs.length, msgs.length === 1 ? "result" : "results")}
            </div>
          )}
          {msgs.map((m, i) => {
            // a separator when the day changes from the previous message; not in
            // search, where results aren't a single day-ordered thread
            const sep =
              !q && (i === 0 || dayKey(m.ts) !== dayKey(msgs[i - 1].ts));
            return (
            <Fragment key={`${m.id}-${m.ts}`}>
            {sep && <div className="chat-daysep">{dateSep(m.ts)}</div>}
            <div
              className={`chat-line${m.mine ? ` msg-mine${m.state === "failed" ? " failed" : ""}` : ""}`}
              role={q ? "button" : undefined}
              tabIndex={q ? 0 : undefined}
              onKeyDown={q ? (e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  openSearchMessage(m);
                }
              } : undefined}
              style={q ? { cursor: "pointer" } : undefined}
              data-message-key={`${m.id}:${m.ts}`}
              onClick={
                q
                  ? () => {
                      openSearchMessage(m);
                    }
                  : undefined
              }
            >
              {q && (
                <>
                  <span className="dim">{dateLabel(m.ts)}</span>{" "}
                  <span className="warn">{labelOf(m.convo)}</span>{" "}
                </>
              )}
              {m.replyId !== undefined &&
                (() => {
                  const orig = s.messages.find((x) => x.id === m.replyId);
                  return (
                    <div className="reply-ref dim">
                      {t("Reply to")}{" "}
                      {orig
                        ? `<${nodeShort(orig.from)}> ${orig.text}`
                        : t("(ORIGINAL MESSAGE)")}
                    </div>
                  );
                })()}
              <div className="chat-message-head">
              <time className="dim chat-message-time" dateTime={new Date(m.ts).toISOString()} title={dateTime(m.ts)}>{hhmm(m.ts, false)}</time>{" "}
              <button
                type="button"
                className={`nodelink chat-sender ${m.mine ? "" : "warn"}`}
                style={m.mine ? { fontWeight: 700 } : undefined}
                title={t("NODE ACTIONS")}
                aria-haspopup="menu"
                aria-expanded={menu?.num === m.from}
                onClick={(e) => {
                  e.stopPropagation();
                  const bounds = e.currentTarget.getBoundingClientRect();
                  menuTrigger.current = e.currentTarget;
                  setMenu({ num: m.from, x: e.clientX || bounds.left, y: e.clientY || bounds.bottom });
                }}
              >
                &lt;{m.mine ? t("ME") : nodeShort(m.from)}&gt;
              </button>{" "}
              {!m.mine &&
                (m.hops !== undefined || m.rssi !== undefined || m.snr !== undefined) &&
                (() => {
                  const parts = [
                    m.hops === 0
                      ? t("DIRECT")
                      : m.hops === 1
                        ? t("1 HOP")
                        : m.hops !== undefined
                          ? t("{0} HOPS", m.hops)
                          : null,
                    m.rssi !== undefined ? `${m.rssi.toFixed(0)} DBM` : null,
                    m.snr !== undefined ? `${m.snr.toFixed(1)} DB` : null,
                  ].filter(Boolean);
                  return (
                    <span
                      className="dim chat-link-quality"
                      title={t("HOPS TO REACH US (HOPSTART − HOPLIMIT) · RSSI AND SNR OF THE LAST HOP")}
                    >
                      [{parts.join(" · ")}]{" "}
                    </span>
                  );
                })()}
              {!q && (
                <button
                  className="quote-btn"
                  title={t("REPLY")}
                  aria-label={t("Reply to {0}", nodeShort(m.from))}
                  onClick={() => {
                    setReplyTo(m);
                    inputRef.current?.focus();
                  }}
                >
                  {t("REPLY")}
                </button>
              )}
              </div>
              <div className="chat-message-body">
              {m.text}{" "}
              {m.mine && m.state === "queued" && (
                <span className="warn">{t("⧗ QUEUED")}</span>
              )}
              {m.mine && m.state === "sent" && (
                <span className="dim">{t("➤ SENT · DELIVERY UNCONFIRMED")}</span>
              )}
              {m.mine && m.state === "delivered" && (
                <span className="dim">{t("DELIVERED")}</span>
              )}
              {m.mine && m.state === "failed" && (
                <>
                  <span className="err">{t("FAILED")}{m.failureReason ? ` · ${m.failureReason}` : ""}</span>{" "}
                  <button
                    type="button"
                    className="chat-retry"
                    title={t("RETRY SEND")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setError("");
                      void retryMessage(m).catch((error) => setError(
                        t("Retry failed: {0}", error instanceof Error ? error.message : String(error)),
                      ));
                    }}
                  >
                    {t("RETRY")}
                  </button>
                </>
              )}
              </div>
            </div>
            </Fragment>
            );
          })}
        </div>
        <div
          ref={spacerRef}
          className="chat-keyboard-spacer"
          aria-hidden="true"
        />
        <div ref={dockRef} className="chat-dock">
          {!q && hasNewMessages && (
            <button
              type="button"
              className="chat-latest"
              onClick={() => {
                const el = listRef.current;
                if (el) el.scrollTop = el.scrollHeight;
                followLatest.current = true;
                setHasNewMessages(false);
              }}
            >
              {t("New messages · Jump to latest")}
            </button>
          )}
          {error && <p className="error" role="status">{error}</p>}
          {replyTo && (
            <div className="reply-bar">
              <span className="dim">
                {t("REPLYING TO")} &lt;{nodeShort(replyTo.from)}&gt;:{" "}
                {replyTo.text.slice(0, 60)}
              </span>
              <button
                type="button"
                aria-label={t("Cancel reply")}
                onClick={() => setReplyTo(undefined)}
              >
                CLOSE
              </button>
            </div>
          )}
          <div className="chat-input">
            <span className="prompt">&gt;</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && onSend()}
              placeholder={t("Message…")}
              aria-label={t("Message {0}", convoLabel)}
              maxLength={200}
            />
            <span
              className={
                200 - new TextEncoder().encode(draft).length < 20
                  ? "chat-remain warn"
                  : "chat-remain dim"
              }
            >
              {Math.max(0, 200 - new TextEncoder().encode(draft).length)}
            </span>
            <button
              type="button"
              className={sendShake ? "primary chat-send is-shake" : "primary chat-send"}
              disabled={!draft.trim()}
              onClick={() => void onSend()}
            >
              {t("SEND")}
            </button>
          </div>
        </div>
      </div>
      {menu &&
        (() => {
          const node = s.nodes.get(menu.num);
          const hasPos =
            node?.lat !== undefined &&
            node?.lon !== undefined &&
            (Math.abs(node.lat) > 0.1 || Math.abs(node.lon) > 0.1);
          const close = () => setMenu(undefined);
          return (
            <>
              <div className="menu-overlay" onClick={close} />
              <div ref={menuRef} className="node-menu" role="menu" aria-label={t("Actions for {0}", nodeShort(menu.num))} style={{ left: menu.x, top: menu.y }}>
                <div className="node-menu-title">{nodeShort(menu.num)}</div>
                {menu.num !== s.myNodeNum && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setConvo(`dm:${menu.num}`);
                      setSearch("");
                      close();
                    }}
                  >
                    {t("SEND DM")}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onViewNode(menu.num);
                    close();
                  }}
                >
                  {t("VIEW IN NODES")}
                </button>
                {hasPos && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onViewOnMap(menu.num);
                      close();
                    }}
                  >
                    {t("VIEW ON MAP")}
                  </button>
                )}
              </div>
            </>
          );
        })()}
    </main>
  );
}
