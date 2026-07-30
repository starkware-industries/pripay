// Value round-tripping through the /api/:key store: the `{ v: … }` wrapper the
// client uses for scalars, and bare arrays.
//
// Authorization lives in api-kv-auth.test.js. This file used to assert the pre-fix
// behaviour — an unauthenticated PUT to pripay:vk:0x… returning 200, plus a
// `GET /api` list-all endpoint that has since been removed for dumping every
// wallet's data — so it would have failed had it ever run. It was emulator-gated and
// never did; it now runs on the local JSON store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const WALLET = '0xabc123';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-kvrt-'));
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

test('round-trips a wrapped scalar under a colon key', async () => {
  const { server, base } = await boot();
  const cookie = sessionCookie(WALLET);
  try {
    const key = `pripay:vk:${WALLET}`;
    const put = await fetch(`${base}/api/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ v: '0x123' }),
    });
    assert.strictEqual(put.status, 200);
    const got = await (await fetch(`${base}/api/${encodeURIComponent(key)}`, { headers: { cookie } })).json();
    assert.deepStrictEqual(got, { v: '0x123' });
  } finally { server.close(); }
});

test('round-trips a bare array (state.ts saveWalletBlob convention)', async () => {
  const { server, base } = await boot();
  const cookie = sessionCookie(WALLET);
  try {
    const key = `pripay:unshieldedTxs:${WALLET}`;
    const arr = [{ tx: '0x1', amount: 10 }, { tx: '0x2', amount: 20 }];
    await fetch(`${base}/api/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(arr),
    });
    const got = await (await fetch(`${base}/api/${encodeURIComponent(key)}`, { headers: { cookie } })).json();
    assert.deepStrictEqual(got, arr);
  } finally { server.close(); }
});

test('GET of a known-shape key that was never written returns null', async () => {
  const { server, base } = await boot();
  const cookie = sessionCookie(WALLET);
  try {
    const got = await (await fetch(`${base}/api/${encodeURIComponent(`pripay:txMeta:${WALLET}`)}`, { headers: { cookie } })).json();
    assert.strictEqual(got, null);
  } finally { server.close(); }
});

test('the removed list-all endpoint is not reachable', async () => {
  const { server, base } = await boot();
  try {
    // GET /api used to fold every kv doc into one map — every wallet's company info,
    // tx metadata and viewing keys — bypassing the per-wallet checks.
    const r = await fetch(`${base}/api`);
    assert.notStrictEqual(r.status, 200);
  } finally { server.close(); }
});
