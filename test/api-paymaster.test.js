// /api/paymaster proxy: session gate, config gate, and method allowlist.
//
// Pins the distinction that made a misconfiguration hard to read. The proxy answers
// 401 when there is no SIWS session and 503 only when AVNU_PAYMASTER_API_KEY is
// missing. Production logs showed nothing but 401s, which meant the paymaster health
// probe was running at page load — before login — rather than the API key being
// unset. Client-side, activation now hangs off wallet-changed (main.ts) instead of
// init(); if it ever moves back, the probe silently 401s and every user drops onto
// the paste-key submitter with no error surfaced.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const WALLET = '0xabc123';

async function boot({ apiKey } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-pm-'));
  process.env.LOCAL_STORE = '1';
  process.env.LOCAL_STORE_FILE = path.join(dir, 'store.json');
  process.env.AUTH_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
  process.env.ADMIN_WALLETS = '';
  if (apiKey) process.env.AVNU_PAYMASTER_API_KEY = apiKey;
  else delete process.env.AVNU_PAYMASTER_API_KEY;
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

const call = (base, body, cookie) =>
  fetch(`${base}/api/paymaster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

test('no session: 401, not 503 — this is what a pre-login probe looks like', async () => {
  const { server, base } = await boot();               // no API key either
  try {
    const r = await call(base, { method: 'paymaster_isAvailable', params: {} });
    assert.strictEqual(r.status, 401);
    assert.strictEqual((await r.json()).error, 'wallet login required');
  } finally { server.close(); }
});

test('session but no API key: 503, naming the missing variable', async () => {
  const { server, base } = await boot();
  try {
    const r = await call(base, { method: 'paymaster_isAvailable', params: {} }, sessionCookie(WALLET));
    assert.strictEqual(r.status, 503);
    assert.match((await r.json()).error, /AVNU_PAYMASTER_API_KEY/);
  } finally { server.close(); }
});

test('only paymaster_* methods are proxied', async () => {
  const { server, base } = await boot({ apiKey: 'test-key' });
  try {
    // Rejected before any upstream call, so this makes no network request.
    for (const method of ['starknet_call', 'eth_sendTransaction', '', null]) {
      const r = await call(base, { method, params: {} }, sessionCookie(WALLET));
      assert.strictEqual(r.status, 400, `method ${JSON.stringify(method)} should be refused`);
    }
  } finally { server.close(); }
});

test('the session gate precedes the config gate', async () => {
  // Order matters for diagnosis: with neither a session nor a key, the caller must
  // see 401. A 503 here would wrongly implicate the deployment's env vars.
  const { server, base } = await boot();
  try {
    assert.strictEqual((await call(base, { method: 'paymaster_buildTransaction' })).status, 401);
  } finally { server.close(); }
});
