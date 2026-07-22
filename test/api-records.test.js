// Integration test for per-wallet, per-record subcollections (profiles/orders).
// DEFERRED unless FIRESTORE_EMULATOR_HOST is set (Firestore emulator + Java).
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

const put = (base, addr, kind, id, body) =>
  fetch(`${base}/api/wallet/${addr}/${kind}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
const list = (base, addr, kind) => fetch(`${base}/api/wallet/${addr}/${kind}`).then((r) => r.json());

test('per-wallet orders: upsert, list, delete, isolation', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const A = '0xaaa' + process.hrtime.bigint();
    const B = '0xbbb' + process.hrtime.bigint();
    assert.strictEqual((await put(base, A, 'orders', 'o1', { id: 'o1', name: 'One', nis: 10 })).status, 200);
    await put(base, A, 'orders', 'o2', { id: 'o2', name: 'Two', nis: 20 });

    const both = await list(base, A, 'orders');
    assert.strictEqual(both.length, 2);
    assert.deepStrictEqual(both.map((o) => o.id).sort(), ['o1', 'o2']);

    await fetch(`${base}/api/wallet/${A}/orders/o1`, { method: 'DELETE' });
    const after = await list(base, A, 'orders');
    assert.deepStrictEqual(after.map((o) => o.id), ['o2']);

    // wallet B sees none of A's orders
    assert.deepStrictEqual(await list(base, B, 'orders'), []);
  } finally { server.close(); }
});

test('a second session sees the first session\'s write (shared per-wallet)', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const A = '0xccc' + process.hrtime.bigint();
    await put(base, A, 'profiles', 'p1', { id: 'p1', name: 'Alice', txs: [] });
    // "second session" = a fresh GET against the same backend
    const seen = await list(base, A, 'profiles');
    assert.deepStrictEqual(seen, [{ id: 'p1', name: 'Alice', txs: [] }]);
  } finally { server.close(); }
});

test('rejects an unknown kind', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    assert.strictEqual((await put(base, '0xddd', 'widgets', 'w1', { id: 'w1' })).status, 400);
  } finally { server.close(); }
});
