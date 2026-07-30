import type { ProviderInterface } from 'starknet';

// Block timestamps, cached permanently in localStorage.
//
// Both history sweeps (audit-history and unshielded-history) resolved timestamps by
// firing one getBlock per distinct block, uncached, on every single load. Measured
// against the public Sepolia RPC that is ~230ms for one call and ~0.7–1.3s for a
// burst of 40–80, paid again on every reload and duplicated between the two modules
// whenever their blocks overlap.
//
// A block's timestamp never changes once mined, so it is safe to cache forever —
// this is the rare case where an unbounded-lifetime cache is simply correct. Only
// the RPC fan-out for blocks we have never seen survives.
const CACHE_KEY = 'pripay:blockTimeCache';
// Roughly 8k blocks at ~20 bytes of JSON each. Well inside a 5MB localStorage quota,
// and bounded so a long-lived browser profile can't grow it without limit.
const MAX_ENTRIES = 8000;
// The public RPC handled an 80-wide burst without throttling when measured, but
// there is no reason to fan out unboundedly on a first load with a lot of history.
const CONCURRENCY = 16;

let mem: Map<number, number> | null = null;

function load(): Map<number, number> {
  if (mem) return mem;
  mem = new Map();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, number>)) {
      mem.set(Number(k), v);
    }
  } catch { /* corrupt or unavailable — start empty */ }
  return mem;
}

function persist(): void {
  if (!mem) return;
  try {
    // Keep the newest blocks when trimming: history is browsed most recent first.
    const entries = [...mem.entries()].sort((a, b) => b[0] - a[0]).slice(0, MAX_ENTRIES);
    mem = new Map(entries);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* quota — the in-memory map still serves this session */ }
}

// Resolves `blockNumber -> unix seconds` for every block given, hitting the RPC only
// for the ones not already known. Blocks whose lookup fails are simply absent from
// the returned map; callers already fall back to '—'.
export async function getBlockTimestamps(
  provider: ProviderInterface,
  blockNumbers: readonly number[],
): Promise<Map<number, number>> {
  const cache = load();
  const missing = [...new Set(blockNumbers)].filter((bn) => !cache.has(bn));

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (bn) => {
      try {
        const block = await provider.getBlock(bn) as unknown as { timestamp?: number };
        if (typeof block.timestamp === 'number') cache.set(bn, block.timestamp);
      } catch { /* best-effort; caller renders '—' */ }
    }));
  }

  if (missing.length) persist();

  const out = new Map<number, number>();
  for (const bn of blockNumbers) {
    const ts = cache.get(bn);
    if (ts !== undefined) out.set(bn, ts);
  }
  return out;
}
