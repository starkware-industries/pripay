import { hash, type ProviderInterface } from 'starknet';
import type { AuditTx } from './types';
import { TOKENS } from './validators';
import { state, getUnshieldedTxs } from './state';

// Scan the wallet's full ERC20 transfer history (block 0 → latest) on
// the first refresh, then delta-scan from the last block we saw on
// every subsequent refresh. The full-history pass is the only slow one;
// subsequent calls only cover the few new blocks.
const MAX_PAGES_PER_TOKEN = 20;
const CHUNK_SIZE = 1000;

// Starknet v3 STRK fee collector. Every wallet-paid tx emits a
// Transfer(wallet → here) for the gas fee in STRK. Filtered out of
// the audit log so the user doesn't see a 0.03 STRK row tacked onto
// every payment (and every shielded operation, whose actual rows come
// from fetchAuditHistory via the SDK). Same address on mainnet and
// Sepolia — it's deployed as part of the chain bootstrap.
const SEQUENCER_FEE_RECEIVER = BigInt('0x01176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8');
function isSequencerFeeAddr(addr: string | bigint): boolean {
  try {
    const b = typeof addr === 'bigint' ? addr : BigInt(addr);
    return b === SEQUENCER_FEE_RECEIVER;
  } catch { return false; }
}

// Persisted cache keyed by wallet address. First load after a session
// reset pays the full block-0 scan; everything after that is a delta.
type Collected = {
  tokenSymbol: 'USDC' | 'STRK' | 'ETH';
  tokenMetaAddress: string;
  tokenDecimals: number;
  raw: string;             // bigint as decimal string for JSON-safe storage
  to: string;
  txHash: string;
  blockNumber?: number;
  date?: string;           // pre-resolved local YYYY-MM-DD
  time?: string;           // pre-resolved local HH:MM
};
type CachePayload = { wallet: string; lastBlock: number; events: Collected[] };

const CACHE_KEY = 'pripay:unshieldedHistoryCache';
let cache: CachePayload | null = loadCache();
function loadCache(): CachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as CachePayload : null;
  } catch { return null; }
}
function persistCache(): void {
  if (!cache) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
}

type EventResult = {
  events: Array<{
    block_number?: number;
    transaction_hash: string;
    keys: string[];
    data: string[];
  }>;
  continuation_token?: string;
};

// Reads recent ERC20 Transfer events from the connected wallet, builds
// AuditTx entries, and merges the locally-tracked in-app unshielded
// records (so just-submitted txs still surface before the indexer sees
// them). Returns [] when no wallet is connected.
export async function fetchUnshieldedHistory(provider: ProviderInterface): Promise<AuditTx[]> {
  const wallet = state.walletConnected;
  if (!wallet) return collectLocalUnshielded(new Set());

  const walletBig = BigInt(wallet);
  const transferSelector = hash.getSelectorFromName('Transfer');
  // Cairo 1 OZ ERC20s emit Transfer(from, to, value) with `from` and
  // `to` as #[key] (indexed). Including the wallet address at key
  // position 1 turns a full-chain Transfer scan into a wallet-scoped
  // index lookup — orders of magnitude fewer events for the RPC to
  // return, which is the bottleneck on first load.
  const walletKey = '0x' + walletBig.toString(16).padStart(64, '0');
  // First refresh after onboarding (or after wallet switch): scan from
  // chain genesis. Subsequent refreshes only cover blocks newer than
  // the last scan, so the cost goes from "several seconds" to ~RPC
  // roundtrip + the delta's events.
  if (cache && cache.wallet !== wallet) cache = null;
  const fromBlock = cache ? cache.lastBlock + 1 : 0;
  const latest = await provider.getBlock('latest') as unknown as { block_number?: number };
  const latestBlock = typeof latest.block_number === 'number' ? latest.block_number : undefined;

  // Scan the three tokens in parallel so the total wall-clock time is
  // bounded by the slowest token instead of the sum.
  const perTokenResults = await Promise.all(
    (Object.entries(TOKENS) as Array<[keyof typeof TOKENS, typeof TOKENS[keyof typeof TOKENS]]>).map(
      async ([key, meta]) => {
        const symbol = key.toUpperCase() as 'USDC' | 'STRK' | 'ETH';
        const out: Collected[] = [];
        let continuation_token: string | undefined;
        for (let page = 0; page < MAX_PAGES_PER_TOKEN; page++) {
          let res: EventResult;
          try {
            res = await (provider as unknown as { getEvents: (f: unknown) => Promise<EventResult> }).getEvents({
              from_block: { block_number: fromBlock },
              to_block: 'latest',
              address: meta.address,
              keys: [[transferSelector], [walletKey]],
              chunk_size: CHUNK_SIZE,
              continuation_token,
            });
          } catch (err) {
            console.warn('[unshielded-history] getEvents failed for', symbol, err);
            break;
          }
          for (const ev of res.events) {
            const parsed = parseTransferEvent(ev);
            if (!parsed) continue;
            if (parsed.from !== walletBig) continue;
            if (isSequencerFeeAddr(parsed.to)) continue;
            out.push({
              tokenSymbol: symbol,
              tokenMetaAddress: meta.address,
              tokenDecimals: meta.decimals,
              raw: parsed.value.toString(),
              to: '0x' + parsed.to.toString(16).padStart(64, '0'),
              txHash: ev.transaction_hash,
              blockNumber: ev.block_number,
            });
          }
          continuation_token = res.continuation_token;
          if (!continuation_token) break;
        }
        return out;
      },
    ),
  );
  const newEvents: Collected[] = perTokenResults.flat();
  // Merge with cached events from prior refreshes (de-duped by tx hash
  // since a single tx can emit multiple Transfer events when batched).
  const seen = new Set<string>(cache?.events.map((e) => `${e.txHash}|${e.to}|${e.raw}`) ?? []);
  const merged: Collected[] = [...(cache?.events ?? [])];
  for (const ev of newEvents) {
    const k = `${ev.txHash}|${ev.to}|${ev.raw}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(ev);
  }
  if (latestBlock != null) {
    cache = { wallet, lastBlock: latestBlock, events: merged };
  }
  const collected = merged;

  // Resolve block timestamps for events that don't already have one
  // baked into the cache. Each block fetch is one RPC roundtrip, so
  // skipping previously-resolved entries is the big win on a delta scan.
  const unresolved = Array.from(new Set(
    collected.filter((c) => !c.date && typeof c.blockNumber === 'number').map((c) => c.blockNumber as number),
  ));
  const blockTs = new Map<number, { date: string; time: string }>();
  if (unresolved.length > 0) {
    await Promise.all(
      unresolved.map(async (bn) => {
        try {
          const block = await provider.getBlock(bn) as unknown as { timestamp?: number };
          if (typeof block.timestamp === 'number') {
            blockTs.set(bn, formatLocalDateTime(block.timestamp * 1000));
          }
        } catch { /* best-effort */ }
      }),
    );
    // Persist the resolved timestamps back onto cached events so the
    // next refresh skips them entirely.
    for (const ev of collected) {
      if (!ev.date && typeof ev.blockNumber === 'number') {
        const ts = blockTs.get(ev.blockNumber);
        if (ts) { ev.date = ts.date; ev.time = ts.time; }
      }
    }
  }
  persistCache();

  const onChain: AuditTx[] = collected.filter((c) => !isSequencerFeeAddr(c.to)).map((c) => {
    const human = Number(BigInt(c.raw)) / Number(10n ** BigInt(c.tokenDecimals));
    return {
      date: c.date ?? '—',
      time: c.time ?? '',
      amount: human,
      currency: c.tokenSymbol,
      tx: c.txHash,
      addr: c.to,
      type: 'UnshieldedTransfer',
      description: 'Direct wallet transfer',
    };
  });

  // Pull in locally-persisted records that aren't already covered by the
  // on-chain scan (e.g. a tx submitted seconds ago that the indexer
  // hasn't seen yet).
  const onChainHashes = new Set(onChain.map((t) => normalizeHash(t.tx)));
  const localOnly = collectLocalUnshielded(onChainHashes);
  return [...onChain, ...localOnly];
}

function collectLocalUnshielded(skipHashes: Set<string>): AuditTx[] {
  const out: AuditTx[] = [];
  for (const r of getUnshieldedTxs()) {
    if (skipHashes.has(normalizeHash(r.tx))) continue;
    out.push({
      date: r.date,
      time: r.time,
      amount: r.amount,
      currency: r.token,
      tx: r.tx,
      addr: r.addr,
      type: 'UnshieldedTransfer',
      description: r.description ?? 'Direct wallet transfer',
    });
  }
  return out;
}

function normalizeHash(h: string): string {
  try { return '0x' + BigInt(h).toString(16); } catch { return h.toLowerCase(); }
}

// Decodes the Cairo 1 OZ ERC20 Transfer event. Two layouts seen in the
// wild: (a) all three fields indexed → keys = [selector, from, to],
// data = [value.low, value.high]; (b) older Cairo 0 ERC20s emit
// data = [from, to, value.low, value.high] with only the selector
// indexed. We sniff which one based on key length.
function parseTransferEvent(ev: { keys: string[]; data: string[] }): { from: bigint; to: bigint; value: bigint } | null {
  try {
    if (ev.keys.length >= 3 && ev.data.length >= 2) {
      const from = BigInt(ev.keys[1]);
      const to   = BigInt(ev.keys[2]);
      const low  = BigInt(ev.data[0]);
      const high = ev.data.length > 1 ? BigInt(ev.data[1]) : 0n;
      return { from, to, value: low + (high << 128n) };
    }
    if (ev.data.length >= 3) {
      const from = BigInt(ev.data[0]);
      const to   = BigInt(ev.data[1]);
      const low  = BigInt(ev.data[2]);
      const high = ev.data.length > 3 ? BigInt(ev.data[3]) : 0n;
      return { from, to, value: low + (high << 128n) };
    }
    return null;
  } catch {
    return null;
  }
}

function formatLocalDateTime(epochMs: number): { date: string; time: string } {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
