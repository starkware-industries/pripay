const test = require('node:test');
const assert = require('node:assert');

async function boot() {
  process.env.GOOGLE_CLOUD_PROJECT ||= 'pripay-test';
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const me = (base, headers) => fetch(`${base}/api/me`, { headers }).then((r) => r.json());

test('GET /api/me: allow-listed IAP email is admin (IAP prefix stripped)', async () => {
  process.env.ADMIN_EMAILS = 'admin@example.com';
  const { server, base } = await boot();
  try {
    const r = await me(base, { 'X-Goog-Authenticated-User-Email': 'accounts.google.com:admin@example.com' });
    assert.deepStrictEqual(r, { email: 'admin@example.com', isAdmin: true });
  } finally { server.close(); }
});

test('GET /api/me: non-allow-listed IAP email is not admin', async () => {
  process.env.ADMIN_EMAILS = 'admin@example.com';
  const { server, base } = await boot();
  try {
    const r = await me(base, { 'X-Goog-Authenticated-User-Email': 'someone@example.com' });
    assert.strictEqual(r.email, 'someone@example.com');
    assert.strictEqual(r.isAdmin, false);
  } finally { server.close(); }
});

test('GET /api/me: no IAP header (local dev) is admin so Settings stays reachable', async () => {
  process.env.ADMIN_EMAILS = 'admin@example.com';
  const { server, base } = await boot();
  try {
    const r = await me(base, {});
    assert.strictEqual(r.email, null);
    assert.strictEqual(r.isAdmin, true);
  } finally { server.close(); }
});
