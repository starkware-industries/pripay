// What the app looks like from the internet now that the pre-launch Basic Auth gate
// is gone: no shared-password challenge, an enforcing CSP, and spend ceilings on the
// one paymaster method that costs money.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const WALLET = '0xabc123';

async function boot(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-pub-'));
  process.env.LOCAL_STORE = '1';
  process.env.LOCAL_STORE_FILE = path.join(dir, 'store.json');
  process.env.AUTH_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
  process.env.ADMIN_WALLETS = '';
  // Deliberately SET these: they used to switch on a site-wide password gate. Nothing
  // should read them any more, so their presence must not change behaviour.
  process.env.BASIC_AUTH_USER = 'pripay';
  process.env.BASIC_AUTH_PASS = 'whatever';
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_DEPLOYMENT_ID;
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
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

test('the landing page is served without any password challenge', async () => {
  const { server, base } = await boot();
  try {
    const r = await fetch(`${base}/`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('www-authenticate'), null, 'no Basic Auth challenge');
  } finally { server.close(); }
});

test('BASIC_AUTH_USER/PASS being set no longer gates anything', async () => {
  const { server, base } = await boot();
  try {
    // Both env vars are set by boot(); the old code would have answered 401 here.
    for (const route of ['/', '/app', '/api/me']) {
      const r = await fetch(`${base}${route}`, { redirect: 'manual' });
      assert.notStrictEqual(r.status, 401, `${route} must not be password-gated`);
    }
  } finally { server.close(); }
});

test('an enforcing CSP is sent, with no dynamic-eval permission', async () => {
  const { server, base } = await boot();
  try {
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.ok(csp, 'CSP header present');
    // Not report-only, and not the old frame-ancestors-only stub.
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-eval/.test(csp), 'must not permit dynamic code evaluation');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    // Origins the app genuinely needs.
    assert.match(csp, /connect-src [^;]*starknet-sepolia-rpc\.publicnode\.com/);
    assert.match(csp, /font-src [^;]*fonts\.gstatic\.com/);
    // Inline styles are required by ~258 style="..." attributes in index.html.
    assert.match(csp, /style-src [^;]*'unsafe-inline'/);
  } finally { server.close(); }
});

test('CSP_CONNECT_EXTRA appends origins without editing the policy', async () => {
  const { server, base } = await boot({ CSP_CONNECT_EXTRA: 'https://example.test https://two.test' });
  try {
    const csp = (await fetch(`${base}/`)).headers.get('content-security-policy');
    assert.match(csp, /connect-src [^;]*https:\/\/example\.test/);
    assert.match(csp, /connect-src [^;]*https:\/\/two\.test/);
  } finally { server.close(); }
});

test('the other baseline security headers are still set', async () => {
  const { server, base } = await boot();
  try {
    const h = (await fetch(`${base}/`)).headers;
    assert.strictEqual(h.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(h.get('x-frame-options'), 'DENY');
    assert.strictEqual(h.get('referrer-policy'), 'no-referrer');
  } finally { server.close(); }
});

// ── paymaster spend ceilings ────────────────────────────────────────────────
// paymaster_executeTransaction is the only method that draws on prepaid AVNU credits.
const sponsoredTx = (base, cookie) =>
  fetch(`${base}/api/paymaster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ method: 'paymaster_executeTransaction', params: {} }),
  });

test('the per-wallet sponsored-transaction ceiling applies', async () => {
  // Ceiling of 2/hour for this wallet; global left high so it is not what trips.
  const { server, base } = await boot({
    AVNU_PAYMASTER_API_KEY: 'test-key',
    AVNU_PAYMASTER_URL: 'http://127.0.0.1:9',      // dead: cleared calls 502
    PAYMASTER_EXEC_PER_HOUR_WALLET: '2',
    PAYMASTER_EXEC_PER_HOUR_GLOBAL: '1000',
  });
  const cookie = sessionCookie(WALLET);
  try {
    assert.strictEqual((await sponsoredTx(base, cookie)).status, 502, 'call 1 should reach upstream');
    assert.strictEqual((await sponsoredTx(base, cookie)).status, 502, 'call 2 should reach upstream');
    const blocked = await sponsoredTx(base, cookie);
    assert.strictEqual(blocked.status, 429);
    assert.match((await blocked.json()).error, /limit reached for this wallet/);

    // A different wallet still has its own allowance.
    assert.strictEqual((await sponsoredTx(base, sessionCookie('0xdef456'))).status, 502);
  } finally { server.close(); }
});

test('the global ceiling bounds burn across wallets — rotation does not evade it', async () => {
  const { server, base } = await boot({
    AVNU_PAYMASTER_API_KEY: 'test-key',
    AVNU_PAYMASTER_URL: 'http://127.0.0.1:9',
    PAYMASTER_EXEC_PER_HOUR_WALLET: '1000',        // per-wallet is not what trips
    PAYMASTER_EXEC_PER_HOUR_GLOBAL: '3',
  });
  try {
    // A fresh wallet per call, i.e. exactly the rotation attack.
    for (let i = 0; i < 3; i++) {
      const r = await sponsoredTx(base, sessionCookie('0xaaa' + i));
      assert.strictEqual(r.status, 502, `call ${i} should reach upstream`);
    }
    const blocked = await sponsoredTx(base, sessionCookie('0xaaa99'));
    assert.strictEqual(blocked.status, 429);
    assert.match((await blocked.json()).error, /capacity reached/);
  } finally { server.close(); }
});

test('the ceilings apply only to the method that spends credits', async () => {
  const { server, base } = await boot({
    AVNU_PAYMASTER_API_KEY: 'test-key',
    AVNU_PAYMASTER_URL: 'http://127.0.0.1:9',
    PAYMASTER_EXEC_PER_HOUR_WALLET: '1',
    PAYMASTER_EXEC_PER_HOUR_GLOBAL: '1',
  });
  const cookie = sessionCookie(WALLET);
  try {
    // Burn the execute allowance.
    await sponsoredTx(base, cookie);
    assert.strictEqual((await sponsoredTx(base, cookie)).status, 429);
    // Read-only methods are unaffected — they cost nothing.
    for (const method of ['paymaster_isAvailable', 'paymaster_buildTransaction']) {
      const r = await fetch(`${base}/api/paymaster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ method, params: {} }),
      });
      assert.strictEqual(r.status, 502, `${method} must not be blocked by the spend ceiling`);
    }
  } finally { server.close(); }
});

// ── asset revalidation ──────────────────────────────────────────────────────
// Vercel freezes every build file's mtime to a fixed 2018 epoch, and Express derives
// its default ETag from size+mtime — so two deploys are distinguishable to a browser
// only by byte length, and bundle.js has no content hash in its name. A stale
// index.html paired with a fresh bundle.js fails silently, because showAuditDetail's
// DOM writes are null-safe: the detail modal just renders empty, with no error.
// The validator is keyed on the deployment instead.
test('HTML and assets are served with no-cache and a deployment-keyed ETag', async () => {
  const { server, base } = await boot({ VERCEL_GIT_COMMIT_SHA: 'deadbeefcafe' });
  try {
    for (const p of ['/', '/app', '/bundle.js', '/styles.css']) {
      const r = await fetch(`${base}${p}`);
      assert.strictEqual(r.headers.get('cache-control'), 'no-cache', `${p} must revalidate`);
      assert.strictEqual(r.headers.get('etag'), 'W/"pripay-deadbeefcafe"', `${p} ETag keyed on the build`);
      // The frozen mtime validator must not come back via express.static.
      assert.strictEqual(r.headers.get('last-modified'), null, `${p} must not send Last-Modified`);
    }
  } finally { server.close(); }
});

test('a matching ETag gets a cheap 304, a stale one gets fresh content', async () => {
  const { server, base } = await boot({ VERCEL_GIT_COMMIT_SHA: 'sha-one' });
  try {
    const current = 'W/"pripay-sha-one"';
    const hit = await fetch(`${base}/app`, { headers: { 'If-None-Match': current } });
    assert.strictEqual(hit.status, 304, 'unchanged deployment revalidates cheaply');

    // An ETag from a previous deployment must NOT be honoured — this is the case the
    // size+mtime validator got wrong.
    const stale = await fetch(`${base}/app`, { headers: { 'If-None-Match': 'W/"pripay-sha-zero"' } });
    assert.strictEqual(stale.status, 200, 'a previous deployment must be re-fetched');
    assert.ok((await stale.text()).includes('Transaction detail'), 'and must return the real HTML');
  } finally { server.close(); }
});

test('API responses are left out of the asset caching rules', async () => {
  const { server, base } = await boot({ VERCEL_GIT_COMMIT_SHA: 'sha-one' });
  try {
    const r = await fetch(`${base}/api/me`);
    assert.strictEqual(r.status, 200);
    assert.notStrictEqual(r.headers.get('etag'), 'W/"pripay-sha-one"', 'API must not share the build ETag');
  } finally { server.close(); }
});
