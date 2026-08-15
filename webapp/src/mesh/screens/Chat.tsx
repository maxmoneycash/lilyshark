import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearUnread, getSnapshot, subscribe, type Message } from "../store";
import { clearConvo, retryMessage, sendText } from "../radio";
import { saveText, stamp } from "../export";
import { t } from "../i18n";
import { fechaHora, hora } from "../fmt";

// in search results the time alone isn't enough: they may be from another day
const fecha = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });

// midnight-to-midnight day key: two timestamps in the same local day match
const diaKey = (ms: number) => new Date(ms).toDateString();

// Day separator between messages: HOY/AYER for the recent ones, the full date
// (with weekday) for the rest, so a long backlog doesn't blur across days.
const fechaSep = (ms: number): string => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((hoy.getTime() - d.getTime()) / 86_400_000);
  if (dias === 0) return t("HOY");
  if (dias === 1) return t("AYER");
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
  // the 3 s disarm of the LIMPIAR confirmation
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<Message | undefined>();

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
  useEffect(() => {
    if (q) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, q]);

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
    channelConvos.push({ key: "ch:0", label: t("#Principal") });
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
      ? t("YO")
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
    setDraft("");
    setError("");
    const rid = replyTo?.id;
    setReplyTo(undefined);
    try {
      await sendText(text, convo, rid);
    } catch (e) {
      setError(t("FALLO TX: {0}", String(e)));
    }
  };

  return (
    <main>
      <div className="panel" style={{ width: 230, flexShrink: 0 }}>
        <div className="panel-title">{t("PANEL // CANALES")}</div>
        <div style={{ padding: "8px 0" }}>
          {channelConvos.map((c) => (
            <div
              key={c.key}
              className={`convo-item ${c.key === convo ? "active" : ""}`}
              onClick={() => setConvo(c.key)}
            >
              <span>{c.label}</span>
              {(s.unread.get(c.key) ?? 0) > 0 && (
                <span className="unread-badge">{s.unread.get(c.key)}</span>
              )}
            </div>
          ))}
        </div>
        <div className="panel-title" style={{ borderTop: "1px solid var(--border)" }}>
          {t("MENSAJES DIRECTOS")}
        </div>
        <div style={{ padding: "8px 0" }}>
          {dmConvos.length === 0 && (
            <div className="convo-item dim" style={{ cursor: "default" }}>
              <span>{t("— ninguno —")}</span>
            </div>
          )}
          {dmConvos.map((c) => (
            <div
              key={c.key}
              className={`convo-item ${c.key === convo ? "active" : ""}`}
              onClick={() => setConvo(c.key)}
            >
              <span>{c.label}</span>
              {(s.unread.get(c.key) ?? 0) > 0 && (
                <span className="unread-badge">{s.unread.get(c.key)}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ flex: 1, minWidth: 0 }}>
        <div className="panel-title">
          <span>
            PANEL // CHAT · {convoLabel}
            {convo.startsWith("dm:") &&
              (s.nodes.get(Number(convo.slice(3)))?.publicKey ? (
                <span title={t("cifrado extremo a extremo (PKI)")}> 🔒 PKI</span>
              ) : (
                <span
                  className="warn"
                  title={t("sin clave pública: va cifrado sólo con la PSK del canal")}
                >
                  {" "}
                  {t("⚠ SIN PKI")}
                </span>
              ))}
          </span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
              placeholder={t("buscar en todo el historial_")}
              title={t("Ctrl+F · ESC limpia")}
              style={{ width: 190, fontSize: 11 }}
            />
            <button
              style={{ fontSize: 10, padding: "0 6px" }}
              title={t("Exportar esta conversación a un archivo de texto")}
              disabled={msgs.length === 0}
              onClick={async () => {
                try {
                  const path = await saveText(
                    `meshcore-${convo.replace(":", "-")}-${stamp()}.txt`,
                    msgs
                      .map(
                        (m) =>
                          `${new Date(m.ts).toISOString()} [${convoLabel}] <${nodeShort(m.from)}> ${m.text}${m.mine ? ` (${m.state})` : ""}`,
                      )
                      .join("\n"),
                  );
                  setError(path ? t("EXPORTADO → {0}", path) : "");
                } catch (e) {
                  setError(t("FALLO EXPORT: {0}", String(e)));
                }
              }}
            >
              {t("⭳ EXPORTAR")}
            </button>
            <button
              className="danger"
              style={{ fontSize: 10, padding: "0 6px" }}
              title={t("Borrar todos los mensajes de esta conversación")}
              disabled={convoCount === 0}
              onClick={() => {
                if (confirmClear) {
                  setConfirmClear(false);
                  setError("");
                  clearConvo(convo).catch((e) => setError(String(e)));
                } else {
                  setConfirmClear(true);
                  setError(
                    t("⚠ SE BORRARÁN {0} MENSAJES · PULSA OTRA VEZ", convoCount),
                  );
                  clearTimeout(clearTimer.current);
                  clearTimer.current = setTimeout(
                    () => setConfirmClear(false),
                    3000,
                  );
                }
              }}
            >
              {confirmClear ? t("¿SEGURO?") : t("🗑 LIMPIAR")}
            </button>
            {t("{0} NODOS EN ESCUCHA", s.nodes.size)}
          </span>
        </div>
        <div
          ref={listRef}
          className="scroll-y chat-msgs"
          style={{
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {msgs.length === 0 && (
            <div className="dim" style={{ fontSize: 11 }}>
              {q
                ? t('SIN RESULTADOS PARA "{0}"_', search)
                : t("──── SIN MENSAJES EN {0} — AWAITING SIGNAL_ ────", convoLabel)}
            </div>
          )}
          {q && msgs.length > 0 && (
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
              {t("{0} RESULTADOS · CLIC PARA IR A LA CONVERSACIÓN", msgs.length)}
            </div>
          )}
          {msgs.map((m, i) => {
            // a separator when the day changes from the previous message; not in
            // search, where results aren't a single day-ordered thread
            const sep =
              !q && (i === 0 || diaKey(m.ts) !== diaKey(msgs[i - 1].ts));
            return (
            <Fragment key={`${m.id}-${m.ts}`}>
            {sep && <div className="chat-daysep">{fechaSep(m.ts)}</div>}
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
                  <span className="dim">{fecha(m.ts)}</span>{" "}
                  <span className="warn">{labelOf(m.convo)}</span>{" "}
                </>
              )}
              {m.replyId !== undefined &&
                (() => {
                  const orig = s.messages.find((x) => x.id === m.replyId);
                  return (
                    <div className="reply-ref dim">
                      ↩{" "}
                      {orig
                        ? `<${nodeShort(orig.from)}> ${orig.text}`
                        : t("(mensaje original)")}
                    </div>
                  );
                })()}
              <span className="dim" title={fechaHora(m.ts)}>[{hora(m.ts)}]</span>{" "}
              <span
                className={`nodelink ${m.mine ? "" : "warn"}`}
                style={m.mine ? { fontWeight: 700 } : undefined}
                title={t("Acciones del nodo")}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu({ num: m.from, x: e.clientX, y: e.clientY });
                }}
              >
                &lt;{nodeShort(m.from)}&gt;
              </span>{" "}
              {!m.mine &&
                (m.hops !== undefined || m.snr !== undefined) &&
                (() => {
                  const parts = [
                    m.hops === 0
                      ? t("directo")
                      : m.hops === 1
                        ? t("1 salto")
                        : m.hops !== undefined
                          ? t("{0} saltos", m.hops)
                          : null,
                    m.snr !== undefined ? `${m.snr.toFixed(1)} dB` : null,
                  ].filter(Boolean);
                  return (
                    <span
                      className="dim"
                      style={{ fontSize: 10 }}
                      title={t(
                        "Saltos hasta nosotros (hopStart − hopLimit) · SNR del último salto",
                      )}
                    >
                      [{parts.join(" · ")}]{" "}
                    </span>
                  );
                })()}
              {m.text}{" "}
              {m.mine && m.state === "queued" && (
                <span className="warn">{t("⧗ en cola")}</span>
              )}
              {m.mine && m.state === "sent" && (
                <span className="dim">{t("➤ enviado a radio")}</span>
              )}
              {m.mine && m.state === "delivered" && (
                <span className="dim">{t("✓ entregado")}</span>
              )}
              {m.mine && m.state === "failed" && (
                <>
                  <span className="err">{t("✗ fallo")}</span>{" "}
                  <button
                    style={{ fontSize: 10, padding: "0 6px" }}
                    title={t("Reintentar envío")}
                    onClick={() => retryMessage(m).catch(() => {})}
                  >
                    {t("↻ REINTENTAR")}
                  </button>
                </>
              )}
              {!q && (
                <button
                  className="quote-btn"
                  title={t("Responder")}
                  onClick={() => {
                    setReplyTo(m);
                    inputRef.current?.focus();
                  }}
                >
                  ↩
                </button>
              )}
            </div>
            </Fragment>
            );
          })}
        </div>
        {error && <p className="error">{error}</p>}
        {replyTo && (
          <div className="reply-bar">
            <span className="dim">
              ↩ {t("respondiendo a")} &lt;{nodeShort(replyTo.from)}&gt;:{" "}
              {replyTo.text.slice(0, 60)}
            </span>
            <button
              style={{ fontSize: 10, padding: "0 6px" }}
              onClick={() => setReplyTo(undefined)}
            >
              ✕
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
            placeholder={t("escribe un mensaje_")}
          />
          <span className="cursor">█</span>
          <span className="dim" style={{ fontSize: 11 }}>
            {t(
              "ENTER=TX · {0} B LIBRES",
              Math.max(0, 200 - new TextEncoder().encode(draft).length),
            )}
          </span>
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
                    {t("✉ Enviar DM")}
                  </button>
                )}
                <button
                  onClick={() => {
                    onViewNode(menu.num);
                    close();
                  }}
                >
                  {t("☷ Ver en NODOS")}
                </button>
                {hasPos && (
                  <button
                    onClick={() => {
                      onViewOnMap(menu.num);
                      close();
                    }}
                  >
                    {t("⚲ Ver en MAPA")}
                  </button>
                )}
              </div>
            </>
          );
        })()}
    </main>
  );
}
