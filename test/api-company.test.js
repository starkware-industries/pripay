// Permission-enforced company writes + admin company listing.
// DEFERRED unless FIRESTORE_EMULATOR_HOST is set.
const test = require('node:test');
const assert = require('node:assert');

const SKIP = process.env.FIRESTORE_EMULATOR_HOST ? false : 'set FIRESTORE_EMULATOR_HOST to run';

async function boot() {
  process.env.GOOGLE_CLOUD_PROJECT ||= 'pripay-test';
  process.env.ADMIN_EMAILS = 'admin@example.com';
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const putCompany = (base, addr, body, email) =>
  fetch(`${base}/api/company/${addr}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(email ? { 'X-Goog-Authenticated-User-Email': email } : {}) },
    body: JSON.stringify(body),
  });

test('first-time write allowed for anyone, then locked to admin + accountants', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const addr = '0xco' + process.hrtime.bigint();
    // first-time setup by a plain user (no company yet) → allowed
    assert.strictEqual((await putCompany(base, addr, { name: 'Co', accountantEmails: ['bob@example.com'] }, 'carol@example.com')).status, 200);
    // now an operator (not accountant, not admin) is rejected
    assert.strictEqual((await putCompany(base, addr, { name: 'Hacked' }, 'carol@example.com')).status, 403);
    // the accountant can edit
    assert.strictEqual((await putCompany(base, addr, { name: 'Co2', accountantEmails: ['bob@example.com'] }, 'bob@example.com')).status, 200);
    // an admin can edit
    assert.strictEqual((await putCompany(base, addr, { name: 'Co3', accountantEmails: ['bob@example.com'] }, 'admin@example.com')).status, 200);
  } finally { server.close(); }
});

test('generic kv PUT cannot write a company key', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const r = await fetch(`${base}/api/${encodeURIComponent('pripay:companyInfo:0xabc')}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
    });
    assert.strictEqual(r.status, 403);
  } finally { server.close(); }
});

test('GET /api/companies is admin-only and lists registered wallets', { skip: SKIP }, async () => {
  const { server, base } = await boot();
  try {
    const addr = '0xreg' + process.hrtime.bigint();
    await putCompany(base, addr, { name: 'RegCo' }, 'admin@example.com'); // admin write also registers
    assert.strictEqual((await fetch(`${base}/api/companies`, { headers: { 'X-Goog-Authenticated-User-Email': 'carol@example.com' } })).status, 403);
    const r = await fetch(`${base}/api/companies`, { headers: { 'X-Goog-Authenticated-User-Email': 'admin@example.com' } });
    assert.strictEqual(r.status, 200);
    const found = (await r.json()).find((c) => c.addr === addr.toLowerCase());
    assert.ok(found, 'registered wallet present in list');
    assert.strictEqual(found.company.name, 'RegCo');
  } finally { server.close(); }
});
