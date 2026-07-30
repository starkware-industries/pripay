// Durable document store for serverless (Vercel), backed by Upstash Redis /
// Vercel KV. A drop-in for firestore-rest's API (getDoc / setDoc / deleteDoc /
// listDocs / usingEmulator). Selected by server.js when the KV env vars are
// present — the only durable option on Vercel, where functions are stateless
// and the local file store would not persist between invocations.
//
// The doc tree is a flat map keyed by full document path — 'kv/<enc-key>',
// 'registry/<addr>', 'wallets/<addr>/orders/<id>' — matching what server.js
// builds. Values are JSON objects; @upstash/redis serializes them on set and
// parses them on get.
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function getDoc(docPath) {
  const v = await redis.get(docPath);
  return v ?? null;
}

async function setDoc(docPath, obj) {
  await redis.set(docPath, obj);
}

async function deleteDoc(docPath) {
  await redis.del(docPath);
}

// Direct children of a collection: keys 'collectionPath/<id>' with no further
// '/'. id = that last segment, mirroring firestore-rest.listDocs. keys() is a
// SCAN under the hood — fine for the app's small per-wallet collections.
async function listDocs(collectionPath) {
  const prefix = `${collectionPath}/`;
  const keys = await redis.keys(`${prefix}*`);
  const direct = keys.filter((k) => !k.slice(prefix.length).includes('/'));
  if (direct.length === 0) return [];
  const values = await redis.mget(...direct);
  return direct.map((k, i) => ({ id: k.slice(prefix.length), data: values[i] }));
}

function usingEmulator() {
  return false;
}

module.exports = { getDoc, setDoc, deleteDoc, listDocs, usingEmulator };
