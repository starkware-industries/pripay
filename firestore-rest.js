// Zero-dependency Firestore access over the REST API. No npm package — the
// committed node_modules + private SDK make fresh installs fragile, and the
// emulator speaks the same REST protocol as production.
//
// This file currently exposes the value <-> Firestore wire-format codec.
// Document operations (get/set/delete/list) are added in the deployment
// plan's Phase 1, driven by the emulator integration tests.

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`unsupported Firestore value: ${typeof v}`);
}

function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields);
  throw new Error(`unsupported Firestore value type: ${Object.keys(v).join(',')}`);
}

// Plain JS object -> Firestore `fields` map.
function toFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) fields[k] = encodeValue(val);
  return fields;
}

// Firestore `fields` map -> plain JS object. Tolerates undefined/empty docs.
function fromFields(fields) {
  if (!fields) return {};
  const obj = {};
  for (const [k, val] of Object.entries(fields)) obj[k] = decodeValue(val);
  return obj;
}

function usingEmulator() {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}

function projectId() {
  const p = process.env.GOOGLE_CLOUD_PROJECT;
  if (!p) throw new Error('GOOGLE_CLOUD_PROJECT is not set');
  return p;
}

// REST base for the (default) database's documents, emulator or prod.
function documentsBase() {
  const root = usingEmulator()
    ? `http://${process.env.FIRESTORE_EMULATOR_HOST}`
    : 'https://firestore.googleapis.com';
  return `${root}/v1/projects/${projectId()}/databases/(default)/documents`;
}

// Full URL for a document/collection path like 'kv/foo' or 'wallets/0x/orders'.
function documentUrl(path) {
  return `${documentsBase()}/${path}`;
}

// Access token from the metadata server (Cloud Run). Cached until ~60s before
// expiry. Returns null under the emulator (no auth needed).
// Local dev against real Firestore: no metadata server on a laptop, so pass
// FIRESTORE_ACCESS_TOKEN=$(gcloud auth print-access-token) instead (~1h TTL).
let _token = null; // { value, expiresAt }
async function authHeader() {
  if (usingEmulator()) return {};
  if (process.env.FIRESTORE_ACCESS_TOKEN) {
    return { Authorization: `Bearer ${process.env.FIRESTORE_ACCESS_TOKEN}` };
  }
  const now = Date.now();
  if (!_token || _token.expiresAt - 60_000 < now) {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } }
    );
    if (!res.ok) throw new Error(`metadata token fetch failed: HTTP ${res.status}`);
    const body = await res.json();
    _token = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
  }
  return { Authorization: `Bearer ${_token.value}` };
}

async function getDoc(path) {
  const res = await fetch(documentUrl(path), { headers: await authHeader() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path}: HTTP ${res.status}`);
  const doc = await res.json();
  return fromFields(doc.fields);
}

async function setDoc(path, obj) {
  const res = await fetch(documentUrl(path), {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(obj) }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${path}: HTTP ${res.status} ${await res.text()}`);
}

async function deleteDoc(path) {
  const res = await fetch(documentUrl(path), { method: 'DELETE', headers: await authHeader() });
  if (!res.ok && res.status !== 404) throw new Error(`Firestore DELETE ${path}: HTTP ${res.status}`);
}

// List a collection. Returns [{ id, data }] with id = the last path segment.
// Paginates via pageToken. Returns [] when the collection is empty (404/empty).
async function listDocs(collectionPath) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(documentUrl(collectionPath));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: await authHeader() });
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Firestore LIST ${collectionPath}: HTTP ${res.status}`);
    const body = await res.json();
    for (const doc of body.documents || []) {
      out.push({ id: doc.name.split('/').pop(), data: fromFields(doc.fields) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

module.exports = {
  toFields, fromFields, encodeValue, decodeValue,
  usingEmulator, documentUrl, documentsBase,
  getDoc, setDoc, deleteDoc, listDocs,
};
