// Integration test for the Firestore-backed /api/:key store.
// DEFERRED: runs only when FIRESTORE_EMULATOR_HOST is set (needs Java + the
// Firestore emulator). Skips cleanly otherwise. See the deployment plan Phase 0.
const test = require('node:test');
const assert = require('node:assert');

const SKIP = process.env.FIRESTORE_EMULATOR_HOST
  ? false
  : 'set FIRESTORE_EMULATOR_HOST (run the Firestore emulator) to run this test';

async function boot() {
  process.env.GOOGLE_CLOUD_PROJECT ||= 'pripay-test';
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('PUT then GET round-trips a wrapped value under a colon key', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const key = 'pripay:vk:0xabc' + process.hrtime.bigint();
    const put = await fetch(`${base}/api/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: '0x123' }),
    });
    assert.strictEqual(put.status, 200);
    const got = await (await fetch(`${base}/api/${encodeURIComponent(key)}`)).json();
    assert.deepStrictEqual(got, { v: '0x123' });
  } finally { server.close(); }
});

test('PUT then GET round-trips a bare array (state.ts convention)', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const key = 'pripay:profiles:' + process.hrtime.bigint();
    const arr = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
    await fetch(`${base}/api/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arr),
    });
    const got = await (await fetch(`${base}/api/${encodeURIComponent(key)}`)).json();
    assert.deepStrictEqual(got, arr);
  } finally { server.close(); }
});

test('GET unknown key returns null', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const got = await (await fetch(`${base}/api/pripay:missing:${process.hrtime.bigint()}`)).json();
    assert.strictEqual(got, null);
  } finally { server.close(); }
});

test('GET /api folds all kv docs into a {key: value} map', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const key = 'pripay:company:' + process.hrtime.bigint();
    await fetch(`${base}/api/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Co' }),
    });
    const all = await (await fetch(`${base}/api`)).json();
    assert.deepStrictEqual(all[key], { name: 'Co' });
  } finally { server.close(); }
});
