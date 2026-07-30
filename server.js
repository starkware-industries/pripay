const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const crypto  = require('crypto');
// Persistence backend, in priority order:
//   1. Upstash Redis / Vercel KV — when KV_REST_API_URL (or UPSTASH_…) is set.
//      The only durable option on serverless (Vercel), where a local file would
//      not survive between invocations.
//   2. Local JSON file — development, when LOCAL_STORE=1 or no GCP project.
//   3. Firestore over REST — production on GCP (GOOGLE_CLOUD_PROJECT set).
const useKv = !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);
const useLocalStore = !useKv && (process.env.LOCAL_STORE === '1' || !process.env.GOOGLE_CLOUD_PROJECT);
const store   = useKv ? require('./kv-store')
  : useLocalStore ? require('./local-store')
  : require('./firestore-rest');

// The app is served over HTTPS but the privacy prover + discovery indexer are
// plain HTTP, which browsers block as mixed content. We forward them through
// same-origin /api/prover and /api/discovery/* — server-side HTTP has no mixed
// content. Upstreams are env-configurable; defaults match network-config's active
// network (sepolia). Mainnet values: transaction-prover / discovery-service at
// .alpha-mainnet.sw-dev.io (override via env when flipping network-config to mainnet).
const PROVER_UPSTREAM    = process.env.PROVER_UPSTREAM    || 'https://transaction-prover.alpha-sepolia.sw-dev.io';
const DISCOVERY_UPSTREAM = process.env.DISCOVERY_UPSTREAM || 'https://discovery-service.alpha-sepolia.sw-dev.io';

// Streaming reverse proxy to a fixed upstream. Mounted with app.use so req.url is
// the path below the mount point. Registered BEFORE express.json so the body
// streams through untouched (proof payloads can be large and non-JSON).
// Never forward the caller's auth material (session cookie, Basic-Auth header)
// to third-party upstreams — the proxy talks to StarkWare services, not us.
function sanitizeUpstreamHeaders(headers, host) {
  const out = { ...headers, host };
  delete out.cookie;
  delete out.authorization;
  delete out['x-goog-authenticated-user-email'];
  return out;
}

function streamProxy(upstreamBase) {
  const target = new URL(upstreamBase);
  const lib = target.protocol === 'https:' ? https : http;
  const basePath = target.pathname === '/' ? '' : target.pathname.replace(/\/$/, '');
  return (req, res) => {
    const upstreamReq = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: basePath + req.url,
        method: req.method,
        headers: sanitizeUpstreamHeaders(req.headers, target.host),
      },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstreamReq.on('error', (e) => {
      console.warn('[proxy] upstream error:', e.message);
      if (!res.headersSent) res.status(502).json({ error: 'upstream error' });
    });
    req.pipe(upstreamReq);
  };
}

const PORT = process.env.PORT || 8080;

// Each /api key is one document in the `kv` collection. The key is encoded so
// colons (e.g. `pripay:vk:0x…`) survive the REST path; Firestore docs are maps,
// so the caller's value (object OR bare array) is wrapped under `value`.
const KV = 'kv';
const kvPath = (key) => `${KV}/${encodeURIComponent(key)}`;

// Bank of Israel's daily representative rate (shaar yatzig). Cached for a
// calendar day since BoI publishes once around 15:30 IST on business days.
let boiUsdCache = null; // { date: 'YYYY-MM-DD', rate: number, fetchedAt: number }
const BOI_URL = 'https://www.boi.org.il/PublicApi/GetExchangeRate?key=USD';

function fetchBoiUsdRate(cb) {
  const today = new Date().toISOString().slice(0, 10);
  if (boiUsdCache && boiUsdCache.date === today) {
    return cb(null, boiUsdCache);
  }
  https.get(BOI_URL, { timeout: 5000 }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return cb(new Error('BoI returned HTTP ' + res.statusCode));
    }
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        const rate = Number(data.currentExchangeRate);
        if (!Number.isFinite(rate) || rate <= 0) {
          return cb(new Error('BoI rate missing or invalid: ' + body.slice(0, 200)));
        }
        boiUsdCache = { date: today, rate, fetchedAt: Date.now() };
        cb(null, boiUsdCache);
      } catch (err) {
        cb(err);
      }
    });
  }).on('error', cb).on('timeout', () => cb(new Error('BoI request timed out')));
}

const app = express();
// CORS: the SPA calls the API same-origin, so cross-origin is disabled by
// default (no ACAO header). Set ALLOWED_ORIGINS (comma-separated) to opt in.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false }));

// Content-Security-Policy. Every directive below was derived by auditing what the
// app actually loads, so it ships enforcing rather than report-only:
//   script-src  'self'  — the only scripts are bundle.js and vendor/gsap.min.js,
//                         both same-origin, and there is no inline <script>. Neither
//                         gsap nor the privacy SDK does dynamic code evaluation or
//                         uses WebAssembly, so no 'unsafe-eval' / 'wasm-unsafe-eval'.
//   style-src   needs 'unsafe-inline': index.html carries ~258 style="…" attributes
//                         and the pages build elements with .cssText. Removing that
//                         is a refactor, not a header change.
//   connect-src both networks' RPC hosts are listed so flipping network-config does
//                         not silently break the app; the prover and indexer are
//                         reached through same-origin /api/* proxies, not directly.
//   img-src     data: for the embedded wallet logos, https: because a wallet
//                         extension may hand us its own icon URL. An icon that is
//                         still blocked degrades to fallbackIcon() via img.onerror.
// Override CSP_CONNECT_EXTRA (space-separated origins) when adding a data source.
const CSP_CONNECT = [
  "'self'",
  'https://starknet-sepolia-rpc.publicnode.com',
  'https://starknet-rpc.publicnode.com',
  'https://api.coingecko.com',
  'https://starknet.api.avnu.fi',
  ...(process.env.CSP_CONNECT_EXTRA || '').split(/\s+/).filter(Boolean),
].join(' ');
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  `connect-src ${CSP_CONNECT}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

// NOTE: the pre-launch HTTP Basic Auth site gate used to live here and was removed
// when the app went public. It gated everything behind a single shared credential
// that had to be passed around in chat — not a mechanism worth keeping in an
// open-source repo — and it was the only thing standing in front of endpoints that
// assumed they were not internet-facing (hence the session gates on /api/prover and
// /api/discovery, and the per-wallet ceilings further down). If a deployment needs to
// be closed off again, use Vercel's own password protection or Trusted IPs rather
// than reintroducing an application-level shared password.

// ── Sign-In-With-Starknet (SIWS) ────────────────────────────────────────────
// Wallet-scoped endpoints are keyed only by address, which a caller could
// otherwise spoof. On login the client signs a server nonce; we verify the
// signature against the account contract and set an HttpOnly session cookie, and
// wallet-scoped endpoints then require a session whose address matches the target.
//
// Stateless: nonce + session are HMAC-signed tokens (no store). AUTH_SECRET must
// be STABLE in deployment — serverless runs many instances and a per-boot random
// secret would only validate on the instance that issued it. A random dev
// fallback is used when unset (fine for a single local process).
if (!process.env.AUTH_SECRET && process.env.VERCEL) {
  // Fail fast: on serverless, every instance must share a stable secret, or
  // sessions validate only on the instance that issued them.
  throw new Error('AUTH_SECRET must be set in production.');
}
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.AUTH_SECRET) {
  console.warn('[auth] AUTH_SECRET not set — using an ephemeral dev secret (local only).');
}
const NONCE_TTL_MS   = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'pripay_session';
const STARKNET_RPC   = process.env.STARKNET_RPC_URL || 'https://starknet-sepolia-rpc.publicnode.com';
const EXPECTED_CHAIN = process.env.STARKNET_CHAIN_ID || 'SN_SEPOLIA'; // SNIP-12 domain.chainId to accept

// Rate limiting, shared across serverless instances when KV is configured.
// See rate-limit.js — async because the shared counter is a network round trip.
const { rateLimited } = require('./rate-limit');
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Preload the (heavy) starknet module at init, so a cold /api/auth/verify doesn't
// pay the import inside the request; cache the RPC provider across invocations.
const starknetReady = import('starknet').catch((e) => {
  console.warn('[auth] starknet preload failed:', e.message);
  return null;
});
let _snProvider = null;
async function verifySignature(typedData, signature, addr) {
  const sn = await starknetReady;
  if (!sn) throw new Error('starknet module unavailable');
  if (!_snProvider) _snProvider = new sn.RpcProvider({ nodeUrl: STARKNET_RPC });
  return _snProvider.verifyMessageInStarknet(typedData, signature, addr);
}

function hmac(data) { return crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url'); }
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function toFelt(x) { return '0x' + BigInt(x).toString(16); }   // canonical; throws on bad input
function feltEq(a, b) { try { return BigInt(a) === BigInt(b); } catch { return false; } }

// token = base64url(JSON).hmac — used for both the login nonce and the session.
function signToken(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return body + '.' + hmac(body);
}
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const i = token.lastIndexOf('.');
  const body = token.slice(0, i);
  if (!safeEq(token.slice(i + 1), hmac(body))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}

function isHttps(req) {
  return !!req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function setSessionCookie(req, res, value, maxAgeSec) {
  const p = [`${SESSION_COOKIE}=${value}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) p.push('Secure');
  res.setHeader('Set-Cookie', p.join('; '));
}
function readSession(req) {
  const c = String(req.headers.cookie || '').split(';').map((s) => s.trim())
    .find((s) => s.startsWith(SESSION_COOKIE + '='));
  if (!c) return null;
  const s = verifyToken(c.slice(SESSION_COOKIE.length + 1));
  if (!s || !s.a || (s.exp && Date.now() > s.exp)) return null;
  return s;
}
// Gate: require a session proving the caller owns `targetAddr`.
function requireWalletOwner(req, res, targetAddr) {
  const s = readSession(req);
  if (!s) { res.status(401).json({ error: 'wallet login required' }); return false; }
  if (!feltEq(s.a, targetAddr)) { res.status(403).json({ error: 'wrong wallet' }); return false; }
  return true;
}
// If a kv key is wallet-scoped (ends with …:0x<addr>), return that address.
function keyOwnerAddr(key) {
  const last = String(key).split(':').pop();
  return /^0x[0-9a-fA-F]{1,64}$/.test(last) ? last : null;
}

// Every kv key the client legitimately touches, by shape. The /api/:key router is
// default-DENY against these lists: a new key has to be added here deliberately,
// rather than being created by whoever calls the endpoint first.
//
// This used to be inferred from the key alone — a `…:0x<addr>` suffix meant
// "check the owner", anything else meant "no check at all". That made every
// non-wallet-scoped key world-writable.
const KV_WALLET_KINDS = ['vk', 'onboarded', 'payroll', 'companyInfo', 'recurrentTxs', 'txMeta', 'unshieldedTxs'];
const KV_WALLET_KEY = new RegExp(`^pripay:(?:${KV_WALLET_KINDS.join('|')}):0x[0-9a-fA-F]{1,64}$`);
// Global keys (no owner to check against). Readable by anyone, writable by admins
// only: whoever sets pripay:payroll_class_hash picks the contract class every new
// operator deploys and funds, so an unauthenticated write here is fund loss.
const KV_GLOBAL_KEYS = new Set(['pripay:payroll_class_hash']);

// Authorize a kv read/write. Returns true when the request may proceed; on false it
// has already sent the response.
function authorizeKv(req, res, key, write) {
  if (KV_GLOBAL_KEYS.has(key)) {
    if (!write) return true;
    if (!isAdminReq(req)) { res.status(403).json({ error: 'admin only' }); return false; }
    return true;
  }
  if (!KV_WALLET_KEY.test(key)) { res.status(403).json({ error: 'unknown key' }); return false; }
  // Company info is permission-gated — force writes through /api/company/:addr so an
  // operator can't bypass the accountant/admin check by writing the kv key directly.
  if (write && key.startsWith('pripay:companyInfo:')) {
    res.status(403).json({ error: 'use PUT /api/company/:addr' });
    return false;
  }
  return requireWalletOwner(req, res, keyOwnerAddr(key));
}

// Both proxies front StarkWare infrastructure and cost real resources — the prover
// generates proofs, and each request can hold a function for up to maxDuration
// (300s, see vercel.json). Until now the only thing in front of them was the
// pre-launch Basic-Auth site gate; without it they would be open, unmetered compute
// proxies on a public domain, reachable by anyone with curl.
//
// Requiring a session costs no legitimate flow: the SDK only builds these providers
// inside createPrivacyClient, which needs a viewing key and a deployed payroll
// contract, so every real caller has already signed in. The SDK sets no `credentials`
// option, so its same-origin fetches send the session cookie by default.
function gateProxy(name, max, windowMs) {
  return async (req, res, next) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: 'wallet login required' });
    if (await rateLimited(`${name}:${s.a}`, max, windowMs)) {
      return res.status(429).json({ error: 'rate limited' });
    }
    next();
  };
}

// Mixed-content proxies — must precede express.json so bodies stream raw.
// Discovery is polled during history sweeps, so it gets a higher ceiling than the
// prover, where each call is expensive.
app.use('/api/discovery', gateProxy('discovery', 300, 60000), streamProxy(DISCOVERY_UPSTREAM));
app.use('/api/prover', gateProxy('prover', 30, 60000), streamProxy(PROVER_UPSTREAM));

app.use(express.json({ limit: '2mb' }));

// Asset revalidation, keyed on the deployment. MUST precede the HTML routes and
// express.static below, or the two files that matter most — index.html and
// bundle.js — keep the default validator.
//
// Vercel normalizes every build file's mtime to a fixed 2018 epoch, and Express
// derives its default ETag from size+mtime — so across two deploys the only thing
// distinguishing an asset is its byte length, with a permanently frozen
// Last-Modified. bundle.js carries no content hash in its name, so nothing else
// breaks the tie: a browser can hold a stale shell against a fresh bundle (or the
// reverse) and never notice. Since showAuditDetail's DOM writes are null-safe
// (`if (el) el.textContent = …`), a stale index.html paired with a fresh bundle.js
// fails completely silently — the modal just renders empty, no console error.
//
// Use the commit SHA as the validator instead: every deploy changes it, so caches
// break deterministically, while within a deploy repeat loads are cheap 304s.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.VERCEL_DEPLOYMENT_ID
  || `dev-${process.pid}-${Date.now()}`;
const BUILD_ETAG = `W/"pripay-${BUILD_ID}"`;

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api')) return next();
  res.setHeader('Cache-Control', 'no-cache');   // revalidate every load, 304 when unchanged
  res.setHeader('ETag', BUILD_ETAG);
  if (req.headers['if-none-match'] === BUILD_ETAG) return res.status(304).end();
  next();
});

// Landing page at the root; the app itself lives at /app. Registered before
// the static middleware, which would otherwise serve index.html at /.
// sendFile sets its own etag/Last-Modified unless told not to — the same frozen-mtime
// validator the middleware above replaced, so it has to be disabled here too.
const SEND_OPTS = { etag: false, lastModified: false };
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pripay', 'landing.html'), SEND_OPTS));
app.get('/app', (req, res) => {
  // Normalize /app/ → /app so index.html's relative asset URLs resolve at the root.
  if (req.path !== '/app') return res.redirect(301, '/app');
  res.sendFile(path.join(__dirname, 'pripay', 'index.html'), SEND_OPTS);
});

// etag/lastModified off so express.static can't reinstate the size+mtime validator
// the middleware above deliberately replaced.
app.use(express.static(path.join(__dirname, 'pripay'), { etag: false, lastModified: false }));

// ── SIWS auth endpoints ──
// 1) issue a short-lived, address-bound nonce for the wallet to sign.
app.post('/api/auth/nonce', async (req, res) => {
  if (await rateLimited('auth:' + clientIp(req), 30, 60000)) return res.status(429).json({ error: 'rate limited' });
  let addr;
  try { addr = toFelt((req.body || {}).address); } catch { return res.status(400).json({ error: 'bad address' }); }
  res.json({ nonce: signToken({ a: addr, t: Date.now(), r: crypto.randomBytes(12).toString('hex') }) });
});

// 2) verify the signed nonce against the account contract; on success set the
// session cookie. The client sends the exact typedData it signed; we trust it
// only after checking the embedded nonce (ours, fresh, address-bound), the
// domain, and the on-chain signature.
app.post('/api/auth/verify', async (req, res) => {
  if (await rateLimited('auth:' + clientIp(req), 30, 60000)) return res.status(429).json({ error: 'rate limited' });
  const { address, signature, typedData } = req.body || {};
  let addr;
  try { addr = toFelt(address); } catch { return res.status(400).json({ error: 'bad address' }); }
  const msg = typedData && typedData.message;
  const dom = typedData && typedData.domain;
  const parsed = verifyToken(msg && msg.nonce);
  if (!parsed || !feltEq(parsed.a, addr)) return res.status(401).json({ error: 'bad nonce' });
  if (Date.now() - Number(parsed.t) > NONCE_TTL_MS) return res.status(401).json({ error: 'nonce expired' });
  // Pin the full SNIP-12 domain + the signed address, to block cross-app /
  // cross-chain signature replay.
  if (!dom || dom.name !== 'PriPay' || String(dom.chainId) !== EXPECTED_CHAIN
      || String(dom.version) !== '1' || String(dom.revision) !== '1') {
    return res.status(401).json({ error: 'bad domain' });
  }
  if (!msg || !feltEq(msg.address, addr)) return res.status(401).json({ error: 'address mismatch' });
  // Single-use: reject a nonce that was already consumed (anti-replay).
  const nonceId = 'noncelog/' + parsed.r;
  try { if (await store.getDoc(nonceId)) return res.status(401).json({ error: 'nonce already used' }); } catch { /* store down → proceed */ }
  try {
    const ok = await verifySignature(typedData, signature, addr);
    if (!ok) return res.status(401).json({ error: 'invalid signature' });
  } catch (e) {
    console.warn('[auth] verify failed:', e.message);
    return res.status(401).json({ error: 'signature verification failed' });
  }
  try { await store.setDoc(nonceId, { usedAt: Date.now() }); } catch { /* best-effort */ }
  setSessionCookie(req, res, signToken({ a: addr, exp: Date.now() + SESSION_TTL_MS }), Math.floor(SESSION_TTL_MS / 1000));
  res.json({ ok: true, address: addr });
});

app.post('/api/auth/logout', (req, res) => {
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

// --- IAP identity ---
// This header is only trustworthy behind a real Google IAP, which overwrites any
// client-supplied copy. Anywhere else (Vercel, plain Node, a container reachable
// without IAP) it is just an attacker-controlled request header, so it is ignored
// unless the deployment explicitly opts in.
//
// Do NOT set TRUST_IAP_HEADER on a host that is not behind IAP: it lets any caller
// claim any email, and with it the accountant permission below. Prefer
// accountantWallets (SIWS-proved) — the email path exists only for the GCP+IAP
// deployment. Hardening it further means verifying the x-goog-iap-jwt-assertion
// signature rather than trusting a plaintext header at all.
const TRUST_IAP_HEADER = process.env.TRUST_IAP_HEADER === '1';
function iapEmail(req) {
  if (!TRUST_IAP_HEADER) return null;
  const raw = req.headers['x-goog-authenticated-user-email'];
  return raw ? String(raw).replace(/^accounts\.google\.com:/, '') : null;
}
// Admin = the authenticated SIWS wallet is in ADMIN_WALLETS (comma-separated
// felts). Fails CLOSED: no session, or an address not in the list, is NOT admin.
// (The old model trusted a client-spoofable IAP header and defaulted to admin
// when it was absent — i.e. every request on Vercel was admin.)
function adminWallets() {
  return (process.env.ADMIN_WALLETS || '').split(',').map((x) => x.trim()).filter(Boolean);
}
function isAdminReq(req) {
  const s = readSession(req);
  if (!s) return false;
  return adminWallets().some((a) => feltEq(a, s.a));
}
// A malformed entry can never match a session address (feltEq parses both as felts),
// so a typo here reads as "admin access silently stopped working" rather than as a
// config error. Say so at boot instead.
for (const a of adminWallets()) {
  try { BigInt(a); } catch {
    console.warn(`[auth] ADMIN_WALLETS entry is not a valid address, it will never match: ${a}`);
  }
}
const companyKvKey = (addr) => 'pripay:companyInfo:' + String(addr).toLowerCase();

// Who is the caller, and are they an admin? (Admins see Settings.) MUST precede
// /api/:key, which would otherwise swallow GET /api/me & /api/companies as kv lookups.
app.get('/api/me', (req, res) => {
  const s = readSession(req);
  res.json({ address: s ? s.a : null, isAdmin: isAdminReq(req) });
});

// Admin-only: every wallet ever connected (registry) + its company info (may be null
// for a wallet that connected but never set up company details).
app.get('/api/companies', async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'admin only' });
  try {
    const regs = await store.listDocs('registry');
    const out = [];
    for (const r of regs) {
      const addr = (r.data && r.data.addr) || r.id;
      const doc = await store.getDoc(kvPath(companyKvKey(addr)));
      out.push({ addr, company: doc ? doc.value : null });
    }
    res.json(out);
  } catch (e) {
    console.warn('[api] companies list failed:', e.message);
    res.status(500).json({ error: 'list failed' });
  }
});

// Read a key
app.get('/api/:key', async (req, res) => {
  if (!authorizeKv(req, res, req.params.key, false)) return;
  try {
    const doc = await store.getDoc(kvPath(req.params.key));
    res.json(doc ? doc.value : null);
  } catch (e) {
    console.warn('[api] get failed:', req.params.key, e.message);
    res.status(500).json({ error: 'read failed' });
  }
});

// Write a key
app.put('/api/:key', async (req, res) => {
  if (!authorizeKv(req, res, req.params.key, true)) return;
  try {
    await store.setDoc(kvPath(req.params.key), { value: req.body });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[api] put failed:', req.params.key, e.message);
    res.status(500).json({ error: 'write failed' });
  }
});

// NOTE: a `GET /api` list-all endpoint was removed for security — it dumped the
// entire kv store (every wallet's company info, tx metadata, and viewing keys),
// bypassing the per-wallet authorization below. The client reads per-wallet only.

// Per-wallet, per-record subcollections: wallets/{addr}/{kind}/{id}. One doc
// per profile/order so concurrent sessions on the same wallet don't clobber
// each other's whole-list writes.
const KINDS = new Set(['profiles', 'orders']);
const collPath = (addr, kind) => `wallets/${encodeURIComponent(addr.toLowerCase())}/${kind}`;
const recPath  = (addr, kind, id) => `${collPath(addr, kind)}/${encodeURIComponent(id)}`;

// Per-wallet ceilings. The record id comes from the caller, so without these one
// signed session can create unlimited documents of up to the whole JSON body limit
// (2mb) each — turning a throwaway wallet into unbounded storage cost. Sepolia makes
// that cheaper to attempt, not harder: testnet accounts are free and unlimited.
//
// Sized well above real use rather than tight:
//   64 KiB  — a Profile is ~330 bytes plus ~130 per embedded Tx, so this holds
//             roughly 25 years of monthly history on one contact.
//   500     — at PAGE_SIZE 8 that is already 63 pages of UI, past the point the
//             list views are usable, and far past any Sepolia pilot.
//
// This bounds damage per identity; it does not stop an attacker rotating wallets.
// The backstop for that is a platform-level (WAF / global) limit, not this check.
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS_PER_KIND = 500;

app.get('/api/wallet/:addr/:kind', async (req, res) => {
  if (!KINDS.has(req.params.kind)) return res.status(400).json({ error: 'unknown kind' });
  if (!requireWalletOwner(req, res, req.params.addr)) return;
  try {
    const docs = await store.listDocs(collPath(req.params.addr, req.params.kind));
    res.json(docs.map((d) => d.data));
  } catch (e) {
    console.warn('[api] record list failed:', e.message);
    res.status(500).json({ error: 'list failed' });
  }
});

app.put('/api/wallet/:addr/:kind/:id', async (req, res) => {
  if (!KINDS.has(req.params.kind)) return res.status(400).json({ error: 'unknown kind' });
  if (!requireWalletOwner(req, res, req.params.addr)) return;
  const { addr, kind, id } = req.params;
  if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > MAX_RECORD_BYTES) {
    return res.status(413).json({ error: `record exceeds ${MAX_RECORD_BYTES} bytes` });
  }
  try {
    // Only count when creating: an update to an existing record can't grow the
    // collection, and this keeps the common path to a single read.
    const docPath = recPath(addr, kind, id);
    if (!(await store.getDoc(docPath))) {
      const existing = await store.listDocs(collPath(addr, kind));
      if (existing.length >= MAX_RECORDS_PER_KIND) {
        return res.status(409).json({ error: `limit of ${MAX_RECORDS_PER_KIND} ${kind} reached` });
      }
    }
    await store.setDoc(docPath, req.body);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[api] record put failed:', e.message);
    res.status(500).json({ error: 'write failed' });
  }
});

app.delete('/api/wallet/:addr/:kind/:id', async (req, res) => {
  if (!KINDS.has(req.params.kind)) return res.status(400).json({ error: 'unknown kind' });
  if (!requireWalletOwner(req, res, req.params.addr)) return;
  try {
    await store.deleteDoc(recPath(req.params.addr, req.params.kind, req.params.id));
    res.json({ ok: true });
  } catch (e) {
    console.warn('[api] record delete failed:', e.message);
    res.status(500).json({ error: 'delete failed' });
  }
});

// Registry of every wallet ever connected — so admins can manage even wallets
// that never finished company setup. Any IAP user may register a wallet.
app.put('/api/registry/:addr', async (req, res) => {
  if (!requireWalletOwner(req, res, req.params.addr)) return;
  try {
    const addr = req.params.addr.toLowerCase();
    await store.setDoc(`registry/${encodeURIComponent(addr)}`, { addr });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[api] registry put failed:', e.message);
    res.status(500).json({ error: 'registry failed' });
  }
});

// Company-info write, permission-enforced: allowed for an admin wallet, the wallet
// that owns the company, or an accountant of THIS wallet. Everyone else is rejected,
// including anonymous callers setting up a company for the first time — proving you
// own the wallet is the entry ticket. (An earlier comment here described a
// first-time-setup exemption; no such clause exists, and the tests now pin that.)
app.put('/api/company/:addr', async (req, res) => {
  const addr = req.params.addr;
  const email = iapEmail(req);
  try {
    const existingDoc = await store.getDoc(kvPath(companyKvKey(addr)));
    const existing = existingDoc ? existingDoc.value : null;
    const accountants = (existing && Array.isArray(existing.accountantEmails) ? existing.accountantEmails : [])
      .map((s) => String(s).toLowerCase());
    const accountantWallets = (existing && Array.isArray(existing.accountantWallets) ? existing.accountantWallets : []);
    const s = readSession(req);
    const ownsWallet = !!s && feltEq(s.a, addr);                 // proved wallet ownership via SIWS
    const allowed = isAdminReq(req)                              // admin wallet (ADMIN_WALLETS)
      || ownsWallet                                              // the owner can manage their own company
      || (!!s && accountantWallets.some((w) => feltEq(w, s.a)))  // accountant by wallet (SIWS-proved)
      || (!!email && accountants.includes(email.toLowerCase())); // accountant by email — TRUST_IAP_HEADER only
    if (!allowed) return res.status(403).json({ error: 'not permitted to edit company info' });
    await store.setDoc(kvPath(companyKvKey(addr)), { value: req.body });
    await store.setDoc(`registry/${encodeURIComponent(addr.toLowerCase())}`, { addr: addr.toLowerCase() });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[api] company put failed:', e.message);
    res.status(500).json({ error: 'write failed' });
  }
});

// Proxy to the AVNU paymaster JSON-RPC. The API key stays server-side (Secret
// Manager → AVNU_PAYMASTER_API_KEY); the browser only ever sees the result.
// Only paymaster_* methods are forwarded. AVNU_PAYMASTER_URL must match the
// active network's paymasterUrl (network-config.ts) — defaults to sepolia.
// Mainnet value: https://starknet.paymaster.avnu.fi (override via env for mainnet).
const AVNU_PAYMASTER_URL = process.env.AVNU_PAYMASTER_URL || 'https://sepolia.paymaster.avnu.fi';

// Spend ceilings. paymaster_executeTransaction is the only method that actually costs
// anything — it draws on our prepaid AVNU credits — so it carries its own limits on
// top of the per-wallet call rate below. A per-wallet limit alone is not enough: a
// wallet costs nothing to create, so an attacker rotating addresses would walk past
// it. The global counter is what bounds total burn, and it is shared fleet-wide via
// rate-limit.js rather than per instance.
//
// Defaults are sized for a Sepolia pilot, where a payroll run is a handful of
// transactions. Raise both before any real volume, and keep the global ceiling below
// what the funded credit balance can absorb in an hour.
const PM_EXEC_PER_HOUR_WALLET = Number(process.env.PAYMASTER_EXEC_PER_HOUR_WALLET || 60);
const PM_EXEC_PER_HOUR_GLOBAL = Number(process.env.PAYMASTER_EXEC_PER_HOUR_GLOBAL || 500);
const HOUR_MS = 60 * 60 * 1000;

app.post('/api/paymaster', async (req, res) => {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'wallet login required' });
  if (await rateLimited('pm:' + s.a, 60, 60000)) return res.status(429).json({ error: 'rate limited' });
  const apiKey = process.env.AVNU_PAYMASTER_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'paymaster not configured (AVNU_PAYMASTER_API_KEY)' });
  const method = req.body && req.body.method;
  if (typeof method !== 'string' || !method.startsWith('paymaster_')) {
    return res.status(400).json({ error: 'only paymaster_* methods are proxied' });
  }
  if (method === 'paymaster_executeTransaction') {
    if (await rateLimited(`pmx:${s.a}`, PM_EXEC_PER_HOUR_WALLET, HOUR_MS)) {
      return res.status(429).json({ error: 'sponsored transaction limit reached for this wallet' });
    }
    if (await rateLimited('pmx:global', PM_EXEC_PER_HOUR_GLOBAL, HOUR_MS)) {
      // Deliberately not a 503: the paymaster is configured and healthy, we are
      // choosing not to spend more this hour. Logged so the ceiling is visible
      // rather than looking like an AVNU outage.
      console.warn('[paymaster] global hourly sponsored-transaction ceiling reached');
      return res.status(429).json({ error: 'sponsored transaction capacity reached, try again later' });
    }
  }
  try {
    const upstream = await fetch(AVNU_PAYMASTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paymaster-api-key': apiKey },
      body: JSON.stringify(req.body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (e) {
    console.warn('[paymaster] proxy failed:', e.message);
    res.status(502).json({ error: 'paymaster upstream error' });
  }
});

// Bank of Israel USD/ILS shaar yatzig. Cached per calendar day.
app.get('/api-boi/usd', (req, res) => {
  fetchBoiUsdRate((err, cached) => {
    if (err) {
      console.warn('[boi] fetch failed:', err.message);
      return res.status(502).json({ error: 'rate unavailable' });
    }
    res.json({ ilsPerUsd: cached.rate, asOf: cached.date, source: 'Bank of Israel' });
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PriPay server  → http://localhost:${PORT}`);
    console.log(`Firestore      → ${store.usingEmulator() ? process.env.FIRESTORE_EMULATOR_HOST + ' (emulator)' : 'firestore.googleapis.com'}`);
  });
}

module.exports = app;
