import { state } from './state';
import { TOKENS } from './validators';
import { getPrivateBalances } from '../sdk_integration/balances';

// Reads the PayrollContract's private-pool balance for one token (USDC/ETH/
// STRK) and formats it for display. Returns '—' when the SDK client isn't
// built yet (wallet not connected, or onboarding hasn't been done).
//
// Discovery hits the indexer at DISCOVERY_URL, decodes notes addressed to
// PayrollContract (via the viewing key), sums their amounts. Notes spent in
// prior transfers are excluded automatically.
export async function fetchPrivacyBalance(token: string): Promise<string> {
  if (!state.transfers) return '—';
  const meta = TOKENS[token as keyof typeof TOKENS];
  if (!meta) return '—';
  try {
    const balances = await getPrivateBalances(state.transfers, {
      tokens: [BigInt(meta.address)],
    });
    const raw = balances.get(BigInt(meta.address)) ?? 0n;
    return formatTokenAmount(raw, meta.decimals, token.toUpperCase());
  } catch (err) {
    console.warn('[privacy-balance] fetch failed for', token, err);
    return '—';
  }
}

function formatTokenAmount(raw: bigint, decimals: number, symbol: string): string {
  const denom = 10n ** BigInt(decimals);
  const whole = raw / denom;
  const frac = (raw % denom).toString().padStart(decimals, '0').slice(0, 2);
  return `${Number(whole).toLocaleString()}.${frac} ${symbol}`;
}

export type PoolBalance = { token: 'usdc' | 'strk' | 'eth'; formatted: string; amount: number };

// Reads all three token balances in a single indexer discovery pass. `amount`
// is the human value (for fiat conversion); `formatted` is display-ready.
// Returns null when the SDK client isn't built yet.
export async function fetchAllPrivacyBalances(): Promise<PoolBalance[] | null> {
  if (!state.transfers) return null;
  const tokens: PoolBalance['token'][] = ['usdc', 'strk', 'eth'];
  try {
    const balances = await getPrivateBalances(state.transfers, {
      tokens: tokens.map((t) => BigInt(TOKENS[t].address)),
    });
    const out = tokens.map((t) => {
      const meta = TOKENS[t];
      const raw = balances.get(BigInt(meta.address)) ?? 0n;
      return {
        token: t,
        formatted: formatTokenAmount(raw, meta.decimals, t.toUpperCase()),
        amount: Number(raw) / Number(10n ** BigInt(meta.decimals)),
      };
    });
    cachedBalances = out;
    return out;
  } catch (err) {
    console.warn('[privacy-balance] fetchAll failed', err);
    return null;
  }
}

// Last successful fetch from `fetchAllPrivacyBalances`. Pages other than
// dashboard (e.g. one-time, topbar mini-bar) read this synchronously so
// they don't trigger a fresh indexer discovery per render. Refreshed on
// every page switch by setOnNavigate in main.ts.
let cachedBalances: PoolBalance[] | null = null;
export function getCachedPrivacyBalances(): PoolBalance[] | null {
  return cachedBalances;
}
export function getCachedPoolAmount(token: string): number | null {
  if (!cachedBalances) return null;
  const t = token.toLowerCase();
  const hit = cachedBalances.find((b) => b.token === t);
  return hit ? hit.amount : null;
}

// Unshielded (wallet) balances, set by dashboard.refreshWalletBalances.
// Same cache pattern as the shielded side so consumers (topbar, Shield
// pre-flight) can compare against the operator's wallet without a fresh
// callContract per check.
type WalletAmounts = Record<'usdc' | 'strk' | 'eth', number | null>;
let cachedWallet: WalletAmounts | null = null;
export function setCachedWalletAmounts(amounts: WalletAmounts | null): void {
  cachedWallet = amounts;
}
export function getCachedWalletAmount(token: string): number | null {
  if (!cachedWallet) return null;
  const t = token.toLowerCase() as keyof WalletAmounts;
  return cachedWallet[t] ?? null;
}
