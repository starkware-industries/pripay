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
