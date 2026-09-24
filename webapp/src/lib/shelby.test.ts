import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anchorWithWallet,
  buildAnchorPayload,
  CAPTURE_REGISTRY,
  fetchRegistrySlice,
} from './shelby';

test('buildAnchorPayload formats 32-byte hex commitment and numeric strings', () => {
  const commitmentHex = '0x6ab9566563ba70a73965f89a46edf3d49978c5091b8da8786e8cb58a449a32c9';
  const payload = buildAnchorPayload({
    commitment: commitmentHex,
    blobName: 'captures/field-001.lscap',
    sizeBytes: 4096,
    expiresAtUnix: 1794606691,
  });

  assert.equal(payload.function, `${CAPTURE_REGISTRY}::register`);
  assert.deepEqual(payload.type_arguments, []);
  assert.equal(Array.isArray(payload.arguments[0]), true);
  assert.equal((payload.arguments[0] as number[]).length, 32);
  assert.equal((payload.arguments[0] as number[])[0], 0x6a);
  assert.equal((payload.arguments[0] as number[])[31], 0xc9);
  assert.equal(payload.arguments[1], 'captures/field-001.lscap');
  assert.equal(payload.arguments[2], '4096');
  assert.equal(payload.arguments[3], '1794606691');
});

test('buildAnchorPayload handles Uint8Array commitment', () => {
  const bytes = new Uint8Array(32);
  bytes[0] = 0xde;
  bytes[31] = 0xad;
  const payload = buildAnchorPayload({
    commitment: bytes,
    blobName: 'captures/raw.lscap',
    sizeBytes: 128,
    expiresAtUnix: 1800000000,
  });

  assert.equal((payload.arguments[0] as number[])[0], 0xde);
  assert.equal((payload.arguments[0] as number[])[31], 0xad);
});

test('fetchRegistrySlice parses view response when endpoint returns rows', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/view')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          [
            {
              blob_name: 'captures/cap-0.lscap',
              commitment: '0x010203',
              size_bytes: '100',
              expires_at_unix: '1800',
              registered_at_unix: '1700',
            },
          ],
        ],
      } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  };

  try {
    const rows = await fetchRegistrySlice('0x123', 0, 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].blobName, 'captures/cap-0.lscap');
    assert.equal(rows[0].sizeBytes, 100);
    assert.equal(rows[0].expiresAtUnix, 1800);
    assert.equal(rows[0].registeredAtUnix, 1700);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('anchorWithWallet throws clear error when wallet extension is missing', async () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {};

  try {
    await assert.rejects(
      async () => {
        await anchorWithWallet({
          commitment: '0x' + '00'.repeat(32),
          blobName: 'cap.lscap',
          sizeBytes: 512,
          expiresAtUnix: 1800,
        });
      },
      /No Aptos wallet detected/,
    );
  } finally {
    (globalThis as Record<string, unknown>).window = prevWindow;
  }
});

test('anchorWithWallet submits transaction through window.aptos', async () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  let submittedPayload: unknown = null;
  (globalThis as Record<string, unknown>).window = {
    aptos: {
      signAndSubmitTransaction: async (tx: { payload: unknown }) => {
        submittedPayload = tx.payload;
        return { hash: '0xabc123' };
      },
    },
  };

  try {
    const res = await anchorWithWallet({
      commitment: '0x' + 'ab'.repeat(32),
      blobName: 'test.lscap',
      sizeBytes: 256,
      expiresAtUnix: 1900000000,
    });
    assert.equal(res.hash, '0xabc123');
    assert.notEqual(submittedPayload, null);
  } finally {
    (globalThis as Record<string, unknown>).window = prevWindow;
  }
});
