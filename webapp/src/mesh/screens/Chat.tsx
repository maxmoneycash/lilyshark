import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearUnread, getSnapshot, subscribe, type Message } from "../store";
import { clearConvo, retryMessage, sendText } from "../radio";
import { saveText, stamp } from "../export";
import { getDeviceLinkState } from "../../lib/deviceLink";
import { t } from "../i18n";
import { dateTime, hhmm } from "../fmt";

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
  // the 3 s disarm of the CLEAR confirmation
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<Message | undefined>();
  const followLatest = useRef(true);
  const previousView = useRef("");
  const previousLast = useRef("");
  const [hasNewMessages, setHasNewMessages] = useState(false);

  useEffect(() => {
    if (focusSearch) searchRef.current?.select();
  }, [focusSearch]);

  useEffect(() => () => clearTimeout(clearTimer.current), []);

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
    if (q) return;
    const el = listRef.current;
    if (!el) return;
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

  const onSend = async () => {
    const text = draft.trim();
    if (!text) return;
    const existing = new Set(getSnapshot().messages.map((m) => `${m.id}:${m.ts}`));
    const reply = replyTo;
    setDraft("");
    setError("");
    const rid = replyTo?.id;
    setReplyTo(undefined);
    try {
      await sendText(text, convo, rid);
    } catch (e) {
      setError(t("TX FAILED: {0}", String(e)));
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
    <main>
      <div className="panel" style={{ width: 230, flexShrink: 0 }}>
        <div className="panel-title">{t("PANEL // CHANNELS")}</div>
        <div style={{ padding: "8px 0" }}>
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
        <div style={{ padding: "8px 0" }}>
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

      <div className="panel" style={{ flex: 1, minWidth: 0 }}>
        <div className="panel-title">
          <span>
            PANEL // CHAT · {convoLabel}
            {convo.startsWith("dm:") &&
              (s.nodes.get(Number(convo.slice(3)))?.publicKey ? (
                <span title={t("END-TO-END ENCRYPTED (PKI)")}> PKI</span>
              ) : (
                <span
                  className="warn"
                  title={t("NO PUBLIC KEY: ENCRYPTED WITH THE CHANNEL PSK ONLY")}
                >
                  {" "}
                  {t("NO PKI")}
                </span>
              ))}
          </span>
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
              placeholder={t("SEARCH THE WHOLE HISTORY_")}
              aria-label={t("Search message history")}
              title={t("CTRL+F · ESC CLEARS")}
              style={{ width: 190, fontSize: 11 }}
            />
            <button

              title={t("EXPORT THIS CONVERSATION TO A TEXT FILE")}
              disabled={msgs.length === 0}
              onClick={async () => {
                try {
                  const path = await saveText(
                    `meshcore-${convo.replace(":", "-")}-${stamp()}.txt`,
                    msgs
                      .map(
                        (m) =>
                          `${new Date(m.ts).toISOString()} [${convoLabel}] <${m.mine ? t("ME") : nodeShort(m.from)}> ${m.text}${m.mine ? ` (${m.state})` : ""}`,
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
            <span>{t("{0} KNOWN NODES", s.nodes.size)}</span>
          </span>
        </div>
        <div
          ref={listRef}
          className="scroll-y chat-msgs"
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
                  ? t("NO RESULTS FOR \"{0}\"", search)
                  : t("NO MESSAGES IN {0}", convoLabel)}
              </div>
              <div className="dim">
                {q
                  ? t("TRY ANOTHER WORD OR CLEAR SEARCH WITH ESC.")
                  : t("TYPE BELOW AND PRESS SEND E. ENTER ALSO TRANSMITS.")}
              </div>
            </div>
          )}
          {!q && getDeviceLinkState().status === "linked" && (
            <div className="chat-hint">
              {t("SAME RADIO AS THE T-DECK. DEVICE: CHAT TAB, TYPE, ENTER. TAB CYCLES LONGFAST OR A HEARD NODE.")}
            </div>
          )}
          {q && msgs.length > 0 && (
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
              {t("{0} RESULTS · CLICK TO JUMP TO THE CONVERSATION", msgs.length)}
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
              className={m.mine ? `msg-mine ${m.state === "failed" ? "failed" : ""}` : ""}
              style={q ? { cursor: "pointer" } : undefined}
              onClick={
                q
                  ? () => {
                      setConvo(m.convo);
                      setSearch("");
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
              <span className="dim" title={dateTime(m.ts)}>[{hhmm(m.ts)}]</span>{" "}
              <span
                className={`nodelink ${m.mine ? "" : "warn"}`}
                style={m.mine ? { fontWeight: 700 } : undefined}
                title={t("NODE ACTIONS")}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu({ num: m.from, x: e.clientX, y: e.clientY });
                }}
              >
                &lt;{m.mine ? t("ME") : nodeShort(m.from)}&gt;
              </span>{" "}
              {!m.mine &&
                (m.hops !== undefined || m.snr !== undefined) &&
                (() => {
                  const parts = [
                    m.hops === 0
                      ? t("DIRECT")
                      : m.hops === 1
                        ? t("1 HOP")
                        : m.hops !== undefined
                          ? t("{0} HOPS", m.hops)
                          : null,
                    m.snr !== undefined ? `${m.snr.toFixed(1)} DB` : null,
                  ].filter(Boolean);
                  return (
                    <span
                      className="dim"
                      style={{ fontSize: 10 }}
                      title={t("HOPS TO REACH US (HOPSTART − HOPLIMIT) · SNR OF THE LAST HOP",
                      )}
                    >
                      [{parts.join(" · ")}]{" "}
                    </span>
                  );
                })()}
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
            </Fragment>
            );
          })}
        </div>
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
            onKeyDown={(e) => e.key === "Enter" && onSend()}
            placeholder={t("TYPE A MESSAGE")}
            aria-label={t("Message")}
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
            className="primary chat-send"
            disabled={!draft.trim()}
            onClick={() => void onSend()}
          >
            {t("SEND E")}
          </button>
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
              <div className="node-menu" style={{ left: menu.x, top: menu.y }}>
                <div className="node-menu-title">{nodeShort(menu.num)}</div>
                {menu.num !== s.myNodeNum && (
                  <button
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
                  onClick={() => {
                    onViewNode(menu.num);
                    close();
                  }}
                >
                  {t("VIEW IN NODES")}
                </button>
                {hasPos && (
                  <button
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
