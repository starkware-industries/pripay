// Permission-enforced company writes + admin company listing.
//
// Rewritten for the wallet-based model and moved onto the local JSON store (no
// Firestore emulator, so it runs in CI by default). The old version was
// emulator-gated and asserted the replaced model: ADMIN_EMAILS for admin, and an
// accountant identified purely by the x-goog-authenticated-user-email header — which
// off a real IAP is caller-supplied, so it granted edit access to anyone willing to
// set it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ADMIN_WALLET = '0x1a2b3c';
const OWNER_WALLET = '0x4d5e6f';
const ACCT_WALLET  = '0x7a8b9c';
const RANDO_WALLET = '0xdeadbe';

async function boot({ trustIap = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pripay-co-'));
  process.env.LOCAL_STORE = '1';
  process.env.LOCAL_STORE_FILE = path.join(dir, 'store.json');
  process.env.AUTH_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
  process.env.ADMIN_WALLETS = ADMIN_WALLET;
  if (trustIap) process.env.TRUST_IAP_HEADER = '1';
  else delete process.env.TRUST_IAP_HEADER;
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

const putCompany = (base, addr, body, { cookie, email } = {}) =>
  fetch(`${base}/api/company/${addr}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(email ? { 'X-Goog-Authenticated-User-Email': email } : {}),
    },
    body: JSON.stringify(body),
  });

test('company writes are limited to owner / admin / accountant wallet', async () => {
  const { server, base } = await boot();
  try {
    // Even first-time setup needs a session proving ownership of the wallet — there
    // is no "no record yet, so anyone may write" exemption.
    assert.strictEqual((await putCompany(base, OWNER_WALLET, { name: 'Co' })).status, 403);

    // The wallet owner sets it up, nominating an accountant wallet.
    let r = await putCompany(base, OWNER_WALLET, { name: 'Co', accountantWallets: [ACCT_WALLET] }, { cookie: sessionCookie(OWNER_WALLET) });
    assert.strictEqual(r.status, 200);

    // An unrelated wallet is refused.
    r = await putCompany(base, OWNER_WALLET, { name: 'Hacked' }, { cookie: sessionCookie(RANDO_WALLET) });
    assert.strictEqual(r.status, 403);

    // ...as is an anonymous caller.
    assert.strictEqual((await putCompany(base, OWNER_WALLET, { name: 'Hacked' })).status, 403);

    // The owner may keep editing.
    r = await putCompany(base, OWNER_WALLET, { name: 'Co2', accountantWallets: [ACCT_WALLET] }, { cookie: sessionCookie(OWNER_WALLET) });
    assert.strictEqual(r.status, 200);

    // The nominated accountant wallet may edit.
    r = await putCompany(base, OWNER_WALLET, { name: 'Co3', accountantWallets: [ACCT_WALLET] }, { cookie: sessionCookie(ACCT_WALLET) });
    assert.strictEqual(r.status, 200);

    // An admin wallet may edit.
    r = await putCompany(base, OWNER_WALLET, { name: 'Co4', accountantWallets: [ACCT_WALLET] }, { cookie: sessionCookie(ADMIN_WALLET) });
    assert.strictEqual(r.status, 200);
  } finally { server.close(); }
});

test('a spoofed accountant email header grants nothing by default', async () => {
  const { server, base } = await boot();                       // TRUST_IAP_HEADER unset
  try {
    await putCompany(base, OWNER_WALLET, { name: 'Co', accountantEmails: ['bob@example.com'] }, { cookie: sessionCookie(OWNER_WALLET) });
    // Exactly the pre-fix attack: claim to be the listed accountant via a header.
    const r = await putCompany(base, OWNER_WALLET, { name: 'Hacked' }, { email: 'bob@example.com' });
    assert.strictEqual(r.status, 403);
  } finally { server.close(); }
});

test('the accountant email path works only when TRUST_IAP_HEADER is set', async () => {
  const { server, base } = await boot({ trustIap: true });     // i.e. genuinely behind IAP
  try {
    await putCompany(base, OWNER_WALLET, { name: 'Co', accountantEmails: ['bob@example.com'] }, { cookie: sessionCookie(OWNER_WALLET) });
    assert.strictEqual((await putCompany(base, OWNER_WALLET, { name: 'Co2', accountantEmails: ['bob@example.com'] }, { email: 'bob@example.com' })).status, 200);
    // A non-accountant email is still refused.
    assert.strictEqual((await putCompany(base, OWNER_WALLET, { name: 'Nope' }, { email: 'carol@example.com' })).status, 403);
  } finally { server.close(); }
});

test('a malformed accountant wallet entry does not match anyone', async () => {
  const { server, base } = await boot();
  try {
    await putCompany(base, OWNER_WALLET, { name: 'Co', accountantWallets: ['not-an-address'] }, { cookie: sessionCookie(OWNER_WALLET) });
    assert.strictEqual((await putCompany(base, OWNER_WALLET, { name: 'Hacked' }, { cookie: sessionCookie(RANDO_WALLET) })).status, 403);
  } finally { server.close(); }
});

test('GET /api/companies is admin-only and lists registered wallets', async () => {
  const { server, base } = await boot();
  try {
    await putCompany(base, OWNER_WALLET, { name: 'RegCo' }, { cookie: sessionCookie(ADMIN_WALLET) });

    assert.strictEqual((await fetch(`${base}/api/companies`)).status, 403);
    assert.strictEqual((await fetch(`${base}/api/companies`, { headers: { cookie: sessionCookie(RANDO_WALLET) } })).status, 403);
    // The replaced model would have accepted this.
    assert.strictEqual((await fetch(`${base}/api/companies`, { headers: { 'X-Goog-Authenticated-User-Email': 'admin@example.com' } })).status, 403);

    const r = await fetch(`${base}/api/companies`, { headers: { cookie: sessionCookie(ADMIN_WALLET) } });
    assert.strictEqual(r.status, 200);
    const found = (await r.json()).find((c) => c.addr === OWNER_WALLET.toLowerCase());
    assert.ok(found, 'registered wallet present in list');
    assert.strictEqual(found.company.name, 'RegCo');
  } finally { server.close(); }
});
