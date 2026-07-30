// Ekubo pool keys for each token pair we let the operator swap between.
//
// The Ekubo swap executor invocation expects the full pool key inline
// (fee + tick_spacing + extension), so we can't auto-discover a pool —
// each supported pair has to be configured here with the values the
// privacy-pool / Ekubo team supplies.
//
// To populate: ask the privacy-pool team for the pool key of each pair
// we offer (USDC↔STRK, USDC↔ETH, STRK↔ETH on Starknet mainnet). Values
// you'll need per pool:
//   - fee          u128 = round(fee_fraction * 2^128). 30bps ≈
//                  1020847100762815390390123822295304634n
//   - tickSpacing  u128 — usually 100 / 200 / 1000 depending on the fee
//   - extension    ContractAddress — `0` for vanilla Ekubo pools
//   - skipAhead    u128 — usually `0`
//
// token0 / token1 are derived here by sorting the pair: the smaller
// BigInt address is token0. Ekubo orders pool keys this way too.

export type EkuboPoolKey = {
  fee: bigint;
  tickSpacing: bigint;
  extension: bigint;
  skipAhead: bigint;
};

// Keyed by `"<token0Hex>|<token1Hex>"` (sorted ascending). The hex form
// uses BigInt-normalized addresses so leading-zero differences don't
// break the lookup.
// Pool keys for Starknet mainnet, sourced from prod-api.ekubo.org's
// /pair/.../pools endpoint. For each pair we picked the pool with the
// most 24h volume + vanilla extension (extension=0). If a pool's
// liquidity dries up, swap the values below for another entry from the
// same API response.
const POOLS: Record<string, EkuboPoolKey> = {
  // USDC ↔ STRK — pool_id 452541489462215696295207863741055373104110857137882899018744832013953688748
  '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb|0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d': {
    fee:         170141183460469235273462165868118016n,
    tickSpacing: 1000n,
    extension:   0n,
    skipAhead:   0n,
  },
  // USDC ↔ ETH — pool_id 37215149368127060350091376746490619466696766773975985030075920488987336690677
  '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb|0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7': {
    fee:         170141183460469235273462165868118016n,
    tickSpacing: 1000n,
    extension:   0n,
    skipAhead:   0n,
  },
  // STRK ↔ ETH — pool_id 41051620193800206378620514164098215672301960406137642226886642311738671743790
  '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d|0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7': {
    fee:         1020847100762815411640772995208708096n,
    tickSpacing: 5982n,
    extension:   0n,
    skipAhead:   0n,
  },
};

export type ResolvedEkuboPool = {
  token0: bigint;
  token1: bigint;
  fee: bigint;
  tickSpacing: bigint;
  extension: bigint;
  skipAhead: bigint;
};

function pairKey(a: bigint, b: bigint): string {
  const [t0, t1] = a < b ? [a, b] : [b, a];
  return `0x${t0.toString(16)}|0x${t1.toString(16)}`;
}

// Resolves the pool key for the (fromToken → toToken) swap, normalizing
// the pair to token0/token1 order. Throws a friendly error when the
// pair isn't configured — ekubo-pools.ts is the only place to add it.
export function resolveEkuboPool(fromTokenAddress: string, toTokenAddress: string): ResolvedEkuboPool {
  const a = BigInt(fromTokenAddress);
  const b = BigInt(toTokenAddress);
  const [token0, token1] = a < b ? [a, b] : [b, a];
  const key = pairKey(a, b);
  const pool = POOLS[key];
  if (!pool) {
    throw new Error(
      `Ekubo pool not configured for ${shortHex(a)} ↔ ${shortHex(b)}. ` +
      `Add fee, tickSpacing, extension, skipAhead to src/sdk_integration/ekubo-pools.ts at key ${key}.`,
    );
  }
  return {
    token0,
    token1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    extension: pool.extension,
    skipAhead: pool.skipAhead,
  };
}

function shortHex(v: bigint): string {
  const h = '0x' + v.toString(16);
  return h.length > 14 ? h.slice(0, 8) + '…' + h.slice(-4) : h;
}
