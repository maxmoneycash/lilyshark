export interface ChatDraft {
  text: string;
  replyId?: number;
  replyTs?: number;
  persisted: boolean;
}
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const EMPTY: ChatDraft = Object.freeze({ text: '', persisted: true });
const PREFIX = 'lilyshark.chat-draft.v1:';
function decodeDraft(raw: string | null): ChatDraft {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value && typeof value.text === 'string') return {
      text: value.text,
      replyId: Number.isSafeInteger(value.replyId) ? value.replyId : undefined,
      replyTs: Number.isFinite(value.replyTs) ? value.replyTs : undefined,
      persisted: true,
    };
  } catch { /* Malformed storage does not block the composer. */ }
  return EMPTY;
}

export function chatDraftKey(scope: string, conversation: string): string {
  return JSON.stringify([scope, conversation]);
}

export class ChatDraftStore {
  private drafts = new Map<string, ChatDraft>();
  private storedValues = new Map<string, string | null>();
  private listeners = new Set<() => void>();
  constructor(private storage?: DraftStorage) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  read(key: string): ChatDraft {
    const existing = this.drafts.get(key);
    if (existing) return existing;
    let value = EMPTY;
    try {
      const raw = this.storage?.getItem(PREFIX + key) ?? null;
      this.storedValues.set(key, raw);
      value = decodeDraft(raw);
    } catch { /* A corrupt or unavailable draft does not block the conversation. */ }
    this.drafts.set(key, value);
    return value;
  }
  write(key: string, value: Omit<ChatDraft, 'persisted'>): void {
    const draft = { text: value.text, replyId: value.replyId, replyTs: value.replyTs };
    let persisted = false;
    const sample = key.startsWith('["demo",');
    try {
      if (!sample && this.storage) {
        const raw = !value.text && value.replyId === undefined ? null : JSON.stringify(draft);
        if (raw === null) this.storage.removeItem(PREFIX + key);
        else this.storage.setItem(PREFIX + key, raw);
        this.storedValues.set(key, raw);
        persisted = true;
      }
    } catch { /* Retain it in memory and expose the storage failure to the UI. */ }
    this.drafts.set(key, { ...draft, persisted: sample || persisted });
    for (const listener of this.listeners) listener();
  }
  clear(key: string): void { this.write(key, { text: '' }); }
  /** Consume only the revision the composer displayed. Another tab may have
   * saved newer text before its storage event reaches this tab. */
  take(key: string): ChatDraft | undefined {
    const draft = this.read(key);
    if (!key.startsWith('["demo",') && this.storage) {
      try {
        const raw = this.storage.getItem(PREFIX + key);
        if (draft.persisted && raw !== this.storedValues.get(key)) {
          this.storageChanged(PREFIX + key, raw);
          return;
        }
        if (!draft.persisted && raw !== null) {
          // A memory-only draft must not delete another saved revision.
          this.drafts.set(key, EMPTY);
          this.storedValues.delete(key);
          for (const listener of this.listeners) listener();
          return draft;
        }
      } catch { /* The in-memory draft is still usable if storage is unavailable. */ }
    }
    this.clear(key);
    return draft;
  }
  storageChanged(storageKey: string | null, raw: string | null): void {
    const keys = storageKey === null ? [...this.drafts.keys()]
      : storageKey.startsWith(PREFIX) ? [storageKey.slice(PREFIX.length)] : [];
    let changed = false;
    for (const key of keys) {
      if (key.startsWith('["demo",') || !this.drafts.has(key)) continue;
      this.storedValues.set(key, raw);
      // Never replace writing that this browser could not save.
      if (this.drafts.get(key)?.persisted === false) continue;
      this.drafts.set(key, decodeDraft(raw));
      changed = true;
    }
    if (changed) for (const listener of this.listeners) listener();
  }
  restoreIfEmpty(key: string, draft: Omit<ChatDraft, 'persisted'>): void {
    let current = this.read(key);
    if (!current.text && current.replyId === undefined && this.storage && !key.startsWith('["demo",')) {
      try {
        const raw = this.storage.getItem(PREFIX + key);
        if (raw !== this.storedValues.get(key)) this.storageChanged(PREFIX + key, raw);
        current = this.read(key);
      } catch { /* Failed sends still retain their draft when storage is unavailable. */ }
    }
    if (!current.text && current.replyId === undefined) this.write(key, draft);
  }
}
let storage: DraftStorage | undefined;
try { if (typeof localStorage !== 'undefined') storage = localStorage; } catch { /* Private storage can be unavailable. */ }
export const chatDrafts = new ChatDraftStore(storage);
if (typeof window !== 'undefined') {
  const changed = (event: StorageEvent) => {
    if (event.storageArea === storage) chatDrafts.storageChanged(event.key, event.newValue);
  };
  window.addEventListener('storage', changed);
  import.meta.hot?.dispose(() => window.removeEventListener('storage', changed));
}
