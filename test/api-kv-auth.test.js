// Authorization rules for the generic kv router (/api/:key).
//
// Regression cover for the pre-fix behaviour, where authorization was inferred from
// the key's shape: a `…:0x<addr>` suffix meant "check the owner" and anything else
// meant no check at all. That left pripay:payroll_class_hash world-writable, and
// whoever writes it picks the contract class every new operator deploys and funds.
//
// Runs on the local JSON store, so no Firestore emulator is needed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const CLASS_HASH_KEY = 'pripay:payroll_class_hash';
const ADMIN_WALLET = '0x1a2b3c';
const OTHER_WALLET = '0x9f8e7d';

async function boot({ adminWallets = ADMIN_WALLET } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-kv-'));
  process.env.LOCAL_STORE = '1';
  process.env.LOCAL_STORE_FILE = path.join(dir, 'store.json');
  process.env.AUTH_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
  process.env.ADMIN_WALLETS = adminWallets;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASS;
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, dir };
}

// Mints a session cookie the same way server.js does, so these tests exercise the
// authorization rules without standing up a wallet to sign a SIWS nonce.
function sessionCookie(addr) {
  const body = Buffer.from(JSON.stringify({ a: addr, exp: Date.now() + 60000 })).toString('base64url');
  const mac = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('base64url');
  return `pripay_session=${body}.${mac}`;
}

const put = (base, key, body, cookie) =>
  fetch(`${base}/api/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const get = (base, key, cookie) =>
  fetch(`${base}/api/${encodeURIComponent(key)}`, { headers: cookie ? { cookie } : {} });

test('payroll class hash: unauthenticated write is refused', async () => {
  const { server, base } = await boot();
  try {
    assert.strictEqual((await put(base, CLASS_HASH_KEY, { v: '0xdeadbeef' })).status, 403);
    // and nothing was persisted
    assert.strictEqual(await (await get(base, CLASS_HASH_KEY)).json(), null);
  } finally { server.close(); }
});

test('payroll class hash: a logged-in non-admin wallet is refused', async () => {
  const { server, base } = await boot();
  try {
    const r = await put(base, CLASS_HASH_KEY, { v: '0xdeadbeef' }, sessionCookie(OTHER_WALLET));
    assert.strictEqual(r.status, 403);
  } finally { server.close(); }
});

test('payroll class hash: an admin wallet may write, and anyone may read', async () => {
  const { server, base } = await boot();
  try {
    const r = await put(base, CLASS_HASH_KEY, { v: '0xabc123' }, sessionCookie(ADMIN_WALLET));
    assert.strictEqual(r.status, 200);
    // Readable without a session — the class hash is not a secret, and the client
    // needs it before login.
    assert.deepStrictEqual(await (await get(base, CLASS_HASH_KEY)).json(), { v: '0xabc123' });
  } finally { server.close(); }
});

test('an unknown key is refused rather than created (default deny)', async () => {
  const { server, base } = await boot();
  try {
    // Previously any non-wallet-scoped key was writable by anyone, so an attacker
    // could also grow the store without bound.
    assert.strictEqual((await put(base, 'pripay:bogus_new_key', { v: 1 })).status, 403);
    assert.strictEqual((await put(base, 'pripay:bogus_new_key', { v: 1 }, sessionCookie(ADMIN_WALLET))).status, 403);
    assert.strictEqual((await get(base, 'pripay:bogus_new_key')).status, 403);
  } finally { server.close(); }
});

test('wallet-scoped keys still require the matching session', async () => {
  const { server, base } = await boot();
  const key = `pripay:vk:${OTHER_WALLET}`;
  try {
    assert.strictEqual((await put(base, key, { v: '0x1' })).status, 401);                        // no session
    assert.strictEqual((await put(base, key, { v: '0x1' }, sessionCookie(ADMIN_WALLET))).status, 403); // wrong wallet
    assert.strictEqual((await put(base, key, { v: '0x1' }, sessionCookie(OTHER_WALLET))).status, 200); // owner
    assert.deepStrictEqual(await (await get(base, key, sessionCookie(OTHER_WALLET))).json(), { v: '0x1' });
  } finally { server.close(); }
});

test('admin is not a bypass for another wallet\'s viewing key', async () => {
  const { server, base } = await boot();
  try {
    const r = await get(base, `pripay:vk:${OTHER_WALLET}`, sessionCookie(ADMIN_WALLET));
    assert.strictEqual(r.status, 403);
  } finally { server.close(); }
});

test('company info cannot be written through the generic kv route', async () => {
  const { server, base } = await boot();
  try {
    const key = `pripay:companyInfo:${OTHER_WALLET}`;
    const r = await put(base, key, { name: 'x' }, sessionCookie(OTHER_WALLET));
    assert.strictEqual(r.status, 403);          // must go through PUT /api/company/:addr
    // but the owner can still read it (loadWalletData does)
    assert.strictEqual((await get(base, key, sessionCookie(OTHER_WALLET))).status, 200);
  } finally { server.close(); }
});
