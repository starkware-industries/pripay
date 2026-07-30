// The /api/prover and /api/discovery reverse proxies: session gate + rate limit.
//
// These front StarkWare infrastructure (the prover generates proofs) and each request
// can hold a serverless function for up to maxDuration, 300s per vercel.json. Until
// the pre-launch Basic-Auth gate is removed it is the only thing in front of them;
// after, they would be open unmetered compute proxies on a public domain.
//
// PROVER_UPSTREAM/DISCOVERY_UPSTREAM point at a closed local port here, so a request
// that clears the gate fails with 502 rather than reaching the real upstream. That
// 502 is the assertion: it proves the gate passed without making a network call.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const WALLET = '0xabc123';
const DEAD_UPSTREAM = 'http://127.0.0.1:9';   // discard port: nothing listens

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-proxy-'));
  process.env.LOCAL_STORE = '1';
  process.env.LOCAL_STORE_FILE = path.join(dir, 'store.json');
  process.env.AUTH_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
  process.env.ADMIN_WALLETS = '';
  process.env.PROVER_UPSTREAM = DEAD_UPSTREAM;
  process.env.DISCOVERY_UPSTREAM = DEAD_UPSTREAM;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASS;
  // local-store.js resolves its file path at module scope, so it must be evicted
  // too, or every boot() silently reuses the first temp store.
  delete require.cache[require.resolve('../local-store')];
  delete require.cache[require.resolve('../server')];
  delete require.cache[require.resolve('../rate-limit')];
  const app = require('../server');
  require('../rate-limit')._resetLocal();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function sessionCookie(addr) {
  const body = Buffer.from(JSON.stringify({ a: addr, exp: Date.now() + 60000 })).toString('base64url');
  const mac = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('base64url');
  return `pripay_session=${body}.${mac}`;
}

const hit = (base, route, cookie) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ any: 'payload' }),
  });

for (const route of ['/api/prover', '/api/discovery/notes']) {
  test(`${route}: refused without a session`, async () => {
    const { server, base } = await boot();
    try {
      const r = await hit(base, route);
      assert.strictEqual(r.status, 401);
      assert.strictEqual((await r.json()).error, 'wallet login required');
    } finally { server.close(); }
  });

  test(`${route}: a session gets through the gate`, async () => {
    const { server, base } = await boot();
    try {
      // 502 = the gate passed and the proxy tried the (dead) upstream.
      const r = await hit(base, route, sessionCookie(WALLET));
      assert.strictEqual(r.status, 502, 'expected to reach the proxy, not be refused by the gate');
    } finally { server.close(); }
  });
}

test('/api/prover: rate limited per wallet, and the limit is per wallet', async () => {
  const { server, base } = await boot();
  const cookie = sessionCookie(WALLET);
  try {
    // Ceiling is 30/min. Every call clears the gate (502) until the limit trips.
    let sawLimit = false;
    for (let i = 0; i < 34; i++) {
      const r = await hit(base, '/api/prover', cookie);
      if (r.status === 429) { sawLimit = true; break; }
      assert.strictEqual(r.status, 502, `call ${i} should have reached the proxy`);
    }
    assert.ok(sawLimit, 'expected a 429 within 34 calls against a 30/min ceiling');

    // A different wallet has its own bucket and is unaffected.
    const other = await hit(base, '/api/prover', sessionCookie('0xdef456'));
    assert.strictEqual(other.status, 502);
  } finally { server.close(); }
});

test('a forged session cookie does not open the proxy', async () => {
  const { server, base } = await boot();
  try {
    const body = Buffer.from(JSON.stringify({ a: WALLET, exp: Date.now() + 60000 })).toString('base64url');
    const r = await hit(base, '/api/prover', `pripay_session=${body}.forged-mac`);
    assert.strictEqual(r.status, 401);
  } finally { server.close(); }
});

test('an expired session does not open the proxy', async () => {
  const { server, base } = await boot();
  try {
    const body = Buffer.from(JSON.stringify({ a: WALLET, exp: Date.now() - 1000 })).toString('base64url');
    const mac = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('base64url');
    const r = await hit(base, '/api/prover', `pripay_session=${body}.${mac}`);
    assert.strictEqual(r.status, 401);
  } finally { server.close(); }
});
