// GET /api/me — who is the caller, and are they an admin?
//
// Rewritten for the wallet-based model. The old version asserted the IAP-email
// model it replaced: it expected {email, isAdmin} keyed off ADMIN_EMAILS, and
// expected a request with NO identity at all to be treated as admin ("so Settings
// stays reachable in local dev"), which on Vercel made every caller an admin.
// Admin is now a SIWS session whose address is in ADMIN_WALLETS, and it fails closed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ADMIN_WALLET = '0x1a2b3c';
const OTHER_WALLET = '0x9f8e7d';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-me-'));
  process.env.LOCAL_STORE = '1';
  process.env.LOCAL_STORE_FILE = path.join(dir, 'store.json');
  process.env.AUTH_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
  process.env.ADMIN_WALLETS = ADMIN_WALLET;
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

const me = (base, cookie) =>
  fetch(`${base}/api/me`, { headers: cookie ? { cookie } : {} }).then((r) => r.json());

test('GET /api/me: no session is neither identified nor admin', async () => {
  const { server, base } = await boot();
  try {
    assert.deepStrictEqual(await me(base), { address: null, isAdmin: false });
  } finally { server.close(); }
});

test('GET /api/me: a session in ADMIN_WALLETS is admin', async () => {
  const { server, base } = await boot();
  try {
    assert.deepStrictEqual(await me(base, sessionCookie(ADMIN_WALLET)), { address: ADMIN_WALLET, isAdmin: true });
  } finally { server.close(); }
});

test('GET /api/me: a session outside ADMIN_WALLETS is not admin', async () => {
  const { server, base } = await boot();
  try {
    assert.deepStrictEqual(await me(base, sessionCookie(OTHER_WALLET)), { address: OTHER_WALLET, isAdmin: false });
  } finally { server.close(); }
});

test('GET /api/me: a spoofed IAP email header confers nothing', async () => {
  const { server, base } = await boot();
  try {
    const r = await fetch(`${base}/api/me`, {
      headers: { 'X-Goog-Authenticated-User-Email': 'accounts.google.com:admin@example.com' },
    }).then((x) => x.json());
    assert.deepStrictEqual(r, { address: null, isAdmin: false });
  } finally { server.close(); }
});

test('GET /api/me: a forged session cookie is rejected (bad HMAC)', async () => {
  const { server, base } = await boot();
  try {
    const body = Buffer.from(JSON.stringify({ a: ADMIN_WALLET, exp: Date.now() + 60000 })).toString('base64url');
    const r = await me(base, `pripay_session=${body}.not-a-valid-mac`);
    assert.deepStrictEqual(r, { address: null, isAdmin: false });
  } finally { server.close(); }
});
