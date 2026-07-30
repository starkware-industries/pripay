// Per-wallet, per-record subcollections (profiles/orders): upsert, list, delete,
// isolation between wallets, and the authorization on each verb.
//
// Was emulator-gated (so it never ran) and had no auth coverage. Now runs on the
// local JSON store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const A = '0xaaa111';
const B = '0xbbb222';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-rec-'));
  process.env.LOCAL_STORE = '1';
  process.env.LOCAL_STORE_FILE = path.join(dir, 'store.json');
  process.env.AUTH_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
  process.env.ADMIN_WALLETS = '';
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASS;
  // local-store.js resolves its file path at module scope, so it must be evicted
  // too, or every boot() silently reuses the first temp store.
  delete require.cache[require.resolve('../local-store')];
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function sessionCookie(addr) {
  const body = Buffer.from(JSON.stringify({ a: addr, exp: Date.now() + 60000 })).toString('base64url');
  const mac = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('base64url');
  return `pripay_session=${body}.${mac}`;
}

const put = (base, addr, kind, id, body, cookie) =>
  fetch(`${base}/api/wallet/${addr}/${kind}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const list = (base, addr, kind, cookie) =>
  fetch(`${base}/api/wallet/${addr}/${kind}`, { headers: cookie ? { cookie } : {} });

test('per-wallet orders: upsert, list, delete, isolation', async () => {
  const { server, base } = await boot();
  const cookieA = sessionCookie(A);
  try {
    assert.strictEqual((await put(base, A, 'orders', 'o1', { id: 'o1', name: 'One', nis: 10 }, cookieA)).status, 200);
    await put(base, A, 'orders', 'o2', { id: 'o2', name: 'Two', nis: 20 }, cookieA);

    const both = await (await list(base, A, 'orders', cookieA)).json();
    assert.strictEqual(both.length, 2);
    assert.deepStrictEqual(both.map((o) => o.id).sort(), ['o1', 'o2']);

    await fetch(`${base}/api/wallet/${A}/orders/o1`, { method: 'DELETE', headers: { cookie: cookieA } });
    const after = await (await list(base, A, 'orders', cookieA)).json();
    assert.deepStrictEqual(after.map((o) => o.id), ['o2']);

    // wallet B sees none of A's orders
    assert.deepStrictEqual(await (await list(base, B, 'orders', sessionCookie(B))).json(), []);
  } finally { server.close(); }
});

test('a second session on the same wallet sees the first session\'s write', async () => {
  const { server, base } = await boot();
  const cookieA = sessionCookie(A);
  try {
    await put(base, A, 'profiles', 'p1', { id: 'p1', name: 'Alice', txs: [] }, cookieA);
    // "second session" = a fresh cookie for the same wallet
    const seen = await (await list(base, A, 'profiles', sessionCookie(A))).json();
    assert.deepStrictEqual(seen, [{ id: 'p1', name: 'Alice', txs: [] }]);
  } finally { server.close(); }
});

test('records require a session for the wallet in the path', async () => {
  const { server, base } = await boot();
  try {
    // no session
    assert.strictEqual((await put(base, A, 'orders', 'o1', { id: 'o1' })).status, 401);
    assert.strictEqual((await list(base, A, 'orders')).status, 401);
    // someone else's session
    assert.strictEqual((await put(base, A, 'orders', 'o1', { id: 'o1' }, sessionCookie(B))).status, 403);
    assert.strictEqual((await list(base, A, 'orders', sessionCookie(B))).status, 403);
    assert.strictEqual(
      (await fetch(`${base}/api/wallet/${A}/orders/o1`, { method: 'DELETE', headers: { cookie: sessionCookie(B) } })).status,
      403,
    );
  } finally { server.close(); }
});

test('rejects an unknown kind', async () => {
  const { server, base } = await boot();
  try {
    assert.strictEqual((await put(base, A, 'widgets', 'w1', { id: 'w1' }, sessionCookie(A))).status, 400);
  } finally { server.close(); }
});

// Per-wallet ceilings. Without them a single signed session can create unlimited
// documents (the id is caller-supplied) at up to the 2mb JSON body limit each.
// Sepolia makes that cheaper to attempt, not harder — testnet accounts are free.
test('a record larger than the cap is refused', async () => {
  const { server, base } = await boot();
  const cookieA = sessionCookie(A);
  try {
    const tooBig = { id: 'p1', notes: 'x'.repeat(64 * 1024) };
    const r = await put(base, A, 'profiles', 'p1', tooBig, cookieA);
    assert.strictEqual(r.status, 413);
    assert.match((await r.json()).error, /exceeds/);
    // ...and nothing was stored
    assert.deepStrictEqual(await (await list(base, A, 'profiles', cookieA)).json(), []);
  } finally { server.close(); }
});

test('a realistic record with years of history is comfortably under the cap', async () => {
  const { server, base } = await boot();
  const cookieA = sessionCookie(A);
  try {
    // 120 txs ~ 10 years of monthly payments on one contact.
    const txs = Array.from({ length: 120 }, (_, i) => ({
      date: '2026-07-30', type: 'transfer', amount: 12500.5, currency: 'USDC', tx: '0x' + 'a'.repeat(63),
    }));
    const r = await put(base, A, 'profiles', 'p1', { id: 'p1', name: 'Alice', addr: '0x' + 'b'.repeat(63), nis: 45000, txs }, cookieA);
    assert.strictEqual(r.status, 200, 'a decade of history must not trip the size cap');
  } finally { server.close(); }
});

test('the record count is capped, and updates still work at the ceiling', async () => {
  const { server, base } = await boot();
  const cookieA = sessionCookie(A);
  try {
    // Fill to the cap. Sequential because each create reads the collection.
    for (let i = 0; i < 500; i++) {
      const r = await put(base, A, 'orders', 'o' + i, { id: 'o' + i, nis: i }, cookieA);
      assert.strictEqual(r.status, 200, `create ${i} should succeed below the cap`);
    }
    // One more NEW record is refused.
    const over = await put(base, A, 'orders', 'o500', { id: 'o500' }, cookieA);
    assert.strictEqual(over.status, 409);
    assert.match((await over.json()).error, /limit of 500 orders/);

    // But updating an existing record still works — it can't grow the collection.
    const upd = await put(base, A, 'orders', 'o0', { id: 'o0', nis: 999 }, cookieA);
    assert.strictEqual(upd.status, 200, 'updates must not be blocked by the count cap');

    // And deleting frees a slot.
    await fetch(`${base}/api/wallet/${A}/orders/o1`, { method: 'DELETE', headers: { cookie: cookieA } });
    assert.strictEqual((await put(base, A, 'orders', 'o500', { id: 'o500' }, cookieA)).status, 200);
  } finally { server.close(); }
});

test('the cap is per wallet, not global', async () => {
  const { server, base } = await boot();
  try {
    await put(base, A, 'orders', 'o1', { id: 'o1' }, sessionCookie(A));
    // B has its own budget.
    assert.strictEqual((await put(base, B, 'orders', 'o1', { id: 'o1' }, sessionCookie(B))).status, 200);
  } finally { server.close(); }
});
