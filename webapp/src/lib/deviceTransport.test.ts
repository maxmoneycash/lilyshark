import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chunkForMtu,
  encodeLine,
  LineAssembler,
  MAX_PENDING_LINE_BYTES,
} from './deviceTransport';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test('LineAssembler emits nothing until a newline arrives', () => {
  const assembler = new LineAssembler();
  assert.deepEqual(assembler.push(bytes('LSK ID {"fw"')), []);
  assert.deepEqual(assembler.push(bytes(':"0.1.0"}')), []);
  assert.deepEqual(assembler.push(bytes('\n')), ['LSK ID {"fw":"0.1.0"}']);
});

test('LineAssembler splits several lines out of one chunk', () => {
  const assembler = new LineAssembler();
  assert.deepEqual(assembler.push(bytes('LSK OK {}\nLSK ERR {}\nLSK T {')), [
    'LSK OK {}',
    'LSK ERR {}',
  ]);
  assert.equal(assembler.buffered, 'LSK T {');
});

test('LineAssembler strips the CR a serial monitor leaves behind', () => {
  const assembler = new LineAssembler();
  assert.deepEqual(assembler.push(bytes('Lilyshark starting\r\n')), ['Lilyshark starting']);
});

test('LineAssembler reassembles a UTF-8 character split across chunks', () => {
  const assembler = new LineAssembler();
  const line = bytes('LSK F {"name":"Bahía"}\n');
  // Cut inside the two-byte í.
  const cut = line.indexOf(0xc3) + 1;
  assert.ok(cut > 0);
  assert.deepEqual(assembler.push(line.slice(0, cut)), []);
  assert.deepEqual(assembler.push(line.slice(cut)), ['LSK F {"name":"Bahía"}']);
});

test('LineAssembler drops a fragment from a device that never sends a newline', () => {
  const assembler = new LineAssembler();
  assembler.push(bytes('x'.repeat(MAX_PENDING_LINE_BYTES + 1)));
  assert.equal(assembler.buffered, '');
  assert.deepEqual(assembler.push(bytes('LSK OK {}\n')), ['LSK OK {}']);
});

test('LineAssembler reset forgets a half-line so a reconnect starts clean', () => {
  const assembler = new LineAssembler();
  assembler.push(bytes('LSK T {"bat'));
  assembler.reset();
  assert.equal(assembler.buffered, '');
  assert.deepEqual(assembler.push(bytes('LSK OK {}\n')), ['LSK OK {}']);
});

test('encodeLine frames exactly one newline-terminated line', () => {
  assert.deepEqual(encodeLine('LSK HELLO'), bytes('LSK HELLO\n'));
});

test('chunkForMtu splits a payload into ATT-sized writes that rejoin', () => {
  const payload = encodeLine('LSK TX meshtastic text hello from the browser');
  const chunks = chunkForMtu(payload, 20);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 20);
  const rejoined = new Uint8Array(payload.length);
  let at = 0;
  for (const chunk of chunks) {
    rejoined.set(chunk, at);
    at += chunk.length;
  }
  assert.equal(at, payload.length);
  assert.deepEqual(rejoined, payload);
});

test('chunkForMtu leaves a payload that already fits in one write', () => {
  const payload = encodeLine('LSK HELLO');
  assert.equal(payload.length, 10);
  assert.deepEqual(chunkForMtu(payload, 20), [payload]);
});

test('chunkForMtu still produces one write for an empty payload', () => {
  const chunks = chunkForMtu(new Uint8Array(0), 20);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 0);
});

test('chunkForMtu refuses a chunk size that could never carry a byte', () => {
  assert.throws(() => chunkForMtu(encodeLine('LSK HELLO'), 0), /at least one byte/);
  assert.throws(() => chunkForMtu(encodeLine('LSK HELLO'), Number.NaN), /at least one byte/);
});
