import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatDraftStore, chatDraftKey } from './chatDrafts';
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, values };
};

test('draft text and reply stay with their radio and conversation', () => {
  const store = new ChatDraftStore(memoryStorage());
  const first = chatDraftKey('radio-A', 'dm:42');
  const second = chatDraftKey('radio-A', 'ch:0');
  const otherRadio = chatDraftKey('radio-B', 'dm:42');
  store.write(first, { text: 'Meet at the trailhead', replyId: 4, replyTs: 123 });
  store.write(second, { text: 'Channel announcement' });
  assert.equal(store.read(first).text, 'Meet at the trailhead');
  assert.equal(store.read(first).replyId, 4);
  assert.equal(store.read(second).replyId, undefined);
  assert.equal(store.read(otherRadio).text, '');
});

test('a fresh store restores a saved draft after navigation or reload', () => {
  const storage = memoryStorage();
  const key = chatDraftKey('radio', 'dm:42');
  const store = new ChatDraftStore(storage);
  store.write(key, { text: 'Still composing', replyId: 5, replyTs: 123 });
  const reopened = new ChatDraftStore(storage);
  assert.deepEqual(reopened.read(key), store.read(key));
  assert.equal(reopened.read(key), reopened.read(key), 'external-store snapshots stay stable');
  reopened.clear(key);
  assert.equal(new ChatDraftStore(storage).read(key).text, '');
});

test('an async send failure restores only the original empty draft', () => {
  const store = new ChatDraftStore(memoryStorage());
  const origin = chatDraftKey('radio', 'dm:1');
  const destination = chatDraftKey('radio', 'dm:2');
  store.write(destination, { text: 'New conversation' });
  store.restoreIfEmpty(origin, { text: 'Failed before queueing', replyId: 2, replyTs: 88 });
  assert.equal(store.read(destination).text, 'New conversation');
  assert.equal(store.read(origin).text, 'Failed before queueing');
  store.write(origin, { text: 'Newer writing' });
  store.restoreIfEmpty(origin, { text: 'Older failed attempt' });
  assert.equal(store.read(origin).text, 'Newer writing');
});

test('storage failures preserve the in-memory draft and report its limited lifetime', () => {
  const store = new ChatDraftStore({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} });
  const key = chatDraftKey('radio', 'ch:0');
  store.write(key, { text: 'Keep this text' });
  assert.equal(store.read(key).text, 'Keep this text');
  assert.equal(store.read(key).persisted, false);
});

test('sample-session drafts never persist into browser history', () => {
  const storage = memoryStorage();
  const store = new ChatDraftStore(storage);
  const key = chatDraftKey('demo', 'ch:0');
  store.write(key, { text: 'Only a sample' });
  assert.equal(store.read(key).text, 'Only a sample');
  assert.equal(storage.values.size, 0);
});

test('an older tab cannot consume or delete a newer saved draft before its storage event arrives', () => {
  const storage = memoryStorage();
  const firstTab = new ChatDraftStore(storage);
  const secondTab = new ChatDraftStore(storage);
  const key = chatDraftKey('radio', 'dm:42');
  firstTab.write(key, { text: 'Earlier writing' });
  secondTab.write(key, { text: 'Newer writing in another tab' });
  assert.equal(firstTab.take(key), undefined);
  assert.equal(firstTab.read(key).text, 'Newer writing in another tab');
  assert.equal(new ChatDraftStore(storage).read(key).text, 'Newer writing in another tab');
});

test('storage events update subscribed drafts and preserve memory-only writing', () => {
  const storage = memoryStorage();
  const firstTab = new ChatDraftStore(storage);
  const secondTab = new ChatDraftStore(storage);
  const key = chatDraftKey('radio', 'ch:0');
  firstTab.write(key, { text: 'Earlier writing' });
  let changes = 0;
  firstTab.subscribe(() => changes++);
  secondTab.write(key, { text: 'Updated writing', replyId: 7, replyTs: 99 });
  const [storageKey, raw] = [...storage.values.entries()][0];
  firstTab.storageChanged(storageKey, raw);
  assert.equal(changes, 1);
  assert.equal(firstTab.read(key).text, 'Updated writing');
  assert.equal(firstTab.read(key).replyId, 7);
  assert.equal(firstTab.take(key)?.text, 'Updated writing');
  secondTab.storageChanged(storageKey, null);
  assert.equal(secondTab.read(key).text, '');
  assert.equal(storage.values.size, 0);

  const unavailable = new ChatDraftStore({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} });
  unavailable.write(key, { text: 'Unsaved local writing' });
  unavailable.storageChanged(storageKey, raw);
  assert.equal(unavailable.read(key).text, 'Unsaved local writing');
  assert.equal(unavailable.read(key).persisted, false);
});

test('a failed send does not overwrite a newer draft saved in another tab', () => {
  const storage = memoryStorage();
  const firstTab = new ChatDraftStore(storage);
  const secondTab = new ChatDraftStore(storage);
  const key = chatDraftKey('radio', 'ch:0');
  firstTab.write(key, { text: 'Failed attempt' });
  const attempted = firstTab.take(key)!;
  secondTab.write(key, { text: 'Keep the new writing' });
  firstTab.restoreIfEmpty(key, attempted);
  assert.equal(firstTab.read(key).text, 'Keep the new writing');
  assert.equal(new ChatDraftStore(storage).read(key).text, 'Keep the new writing');
});

test('consuming unsaved writing preserves a different saved draft even if sending fails', () => {
  const storage = memoryStorage();
  const key = chatDraftKey('radio', 'ch:0');
  new ChatDraftStore(storage).write(key, { text: 'Keep the saved revision' });
  const tab = new ChatDraftStore({ ...storage, setItem: () => { throw new Error('quota'); } });
  tab.read(key);
  tab.write(key, { text: 'Local writing that could not be saved' });
  const attempted = tab.take(key)!;
  assert.equal(attempted.text, 'Local writing that could not be saved');
  assert.equal(new ChatDraftStore(storage).read(key).text, 'Keep the saved revision');
  tab.restoreIfEmpty(key, attempted);
  assert.equal(tab.read(key).text, 'Keep the saved revision');
  assert.equal(new ChatDraftStore(storage).read(key).text, 'Keep the saved revision');
});
