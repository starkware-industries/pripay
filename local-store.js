// Zero-dependency local file store — a drop-in for firestore-rest's document
// API (getDoc / setDoc / deleteDoc / listDocs / usingEmulator), backed by a
// single JSON file. Used for local dev when no GCP project is configured, so
// onboarding state survives reloads without Firestore or the emulator.
//
// The doc tree is a flat map keyed by full document path — 'kv/<enc-key>',
// 'registry/<addr>', 'wallets/<addr>/orders/<id>' — matching the paths
// server.js builds. Holds the viewing key, so the file lives under gitignored
// data/.
const fs = require('fs');
const path = require('path');

const FILE = process.env.LOCAL_STORE_FILE || path.join(__dirname, 'data', 'store.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Atomic write (temp + rename) so a crash mid-write can't truncate the store.
// Each op is fully synchronous between load and save, so concurrent request
// handlers can't interleave a read-modify-write against the same file.
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

async function getDoc(docPath) {
  const db = load();
  return Object.prototype.hasOwnProperty.call(db, docPath) ? db[docPath] : null;
}

async function setDoc(docPath, obj) {
  const db = load();
  db[docPath] = obj;
  save(db);
}

async function deleteDoc(docPath) {
  const db = load();
  if (Object.prototype.hasOwnProperty.call(db, docPath)) {
    delete db[docPath];
    save(db);
  }
}

// Direct children of a collection: paths 'collectionPath/<id>' with no further
// '/'. id = that last segment, mirroring firestore-rest.listDocs.
async function listDocs(collectionPath) {
  const db = load();
  const prefix = `${collectionPath}/`;
  const out = [];
  for (const key of Object.keys(db)) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!id.includes('/')) out.push({ id, data: db[key] });
  }
  return out;
}

function usingEmulator() {
  return false;
}

module.exports = { getDoc, setDoc, deleteDoc, listDocs, usingEmulator };
