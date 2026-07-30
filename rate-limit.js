// Shared rate limiting.
//
// The previous limiter was a per-process Map, which on Vercel bounded one instance
// rather than the fleet: a "30 per minute" limit was really "30 per minute per
// lambda instance, times however many instances Vercel happened to spin up". Behind
// the pre-launch Basic-Auth gate that hardly mattered. On a public deployment it is
// the difference between a limit and a decoration.
//
// Uses Upstash INCR + EXPIRE (atomic, shared across instances) when the KV env vars
// are set — the same backend kv-store.js already uses on Vercel — and falls back to
// the per-process Map for local dev, where one process really is the whole fleet.
//
// Fixed-window counters: cheap (one round trip), at the cost of allowing up to 2x
// burst across a window boundary. Fine for abuse control; not a precise quota.
const useKv = !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL);

let redis = null;
if (useKv) {
  try {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (e) {
    console.warn('[ratelimit] @upstash/redis unavailable, falling back to per-process limits:', e.message);
  }
}

const _local = new Map();

function localLimited(key, max, windowMs) {
  const now = Date.now();
  const b = _local.get(key);
  if (!b || now > b.resetAt) { _local.set(key, { n: 1, resetAt: now + windowMs }); return false; }
  if (b.n >= max) return true;
  b.n++;
  return false;
}

// True when the caller has exceeded `max` requests in the current window.
async function rateLimited(key, max, windowMs) {
  if (!redis) return localLimited(key, max, windowMs);
  const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const n = await redis.incr(bucket);
    // Set the TTL without blocking on it. Awaiting it put a second sequential
    // round trip on the first request of every window, and /api/discovery is called
    // repeatedly during a history sweep — that latency lands in page-load time.
    // Retried for the first few calls so a single failure can't leak the key: the
    // bucket name carries the window index, so it is never written to again once
    // the window passes.
    if (n <= 3) {
      void Promise.resolve(redis.expire(bucket, Math.ceil(windowMs / 1000) + 1)).catch(() => {});
    }
    return n > max;
  } catch (e) {
    // Degrade to the per-process limit rather than locking everyone out on a KV
    // blip — but say so, so an outage is visible instead of silently unlimited.
    console.warn('[ratelimit] shared counter failed, using per-process limit:', e.message);
    return localLimited(key, max, windowMs);
  }
}

// Test seam: drops the per-process counters so cases don't leak into each other.
function _resetLocal() { _local.clear(); }

module.exports = { rateLimited, usingSharedCounters: () => !!redis, _resetLocal };
