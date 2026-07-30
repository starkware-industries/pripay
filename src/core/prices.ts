import type { NISRates } from './types';

const DEFAULTS: NISRates = { usdc: 0.272, strk: 0.143, eth: 0.000073 };
let current: NISRates = { ...DEFAULTS };
let lastSource: 'defaults' | 'boi+coingecko' | 'coingecko-only' = 'defaults';
let lastBoiAsOf: string | null = null;     // YYYY-MM-DD per BoI
let lastIlsPerUsd: number | null = null;   // ILS per 1 USD, from BoI when available

export const getNISRates = (): NISRates => current;
export const getNISRatesSource = (): typeof lastSource => lastSource;
export const getBoiAsOf = (): string | null => lastBoiAsOf;
export const getIlsPerUsd = (): number | null => lastIlsPerUsd;

// Updates the in-page FX-rate slots (`.js-fx-rate-line`) from the cached
// rate + source. Hidden while we're still on baked-in defaults (nothing
// yet fetched). Source label distinguishes the official BoI exchange rate
// from the CoinGecko fallback used when BoI is unreachable.
export function renderFxRateChip(): void {
  const slots = document.querySelectorAll<HTMLElement>('.js-fx-rate-line');
  if (lastSource === 'defaults' || lastIlsPerUsd == null) {
    slots.forEach((s) => { s.style.display = 'none'; });
    return;
  }
  const sourceLabel = lastSource === 'boi+coingecko'
    ? (lastBoiAsOf ? `· BoI ${lastBoiAsOf}` : '· BoI')
    : '· CoinGecko (BoI down)';
  // In-page slots get a single-line compact form ("Exchange rate · USD/ILS X · BoI Y").
  slots.forEach((s) => {
    s.style.display = 'block';
    s.textContent = `Exchange rate · USD/ILS ${lastIlsPerUsd!.toFixed(4)} ${sourceLabel}`;
  });
}

// USDC rate comes from the Bank of Israel daily exchange rate so the
// fiat anchor matches what an Israeli accountant will reconcile against.
// STRK and ETH use CoinGecko since BoI doesn't quote crypto. Falls back
// to CoinGecko-only if BoI is down, then to in-memory defaults.
export async function fetchNISRates(): Promise<void> {
  const [boi, coingecko] = await Promise.allSettled([
    fetchBoiUsdILS(),
    fetchCoingeckoILS(),
  ]);

  const boiData = boi.status === 'fulfilled' ? boi.value : null;
  const cg      = coingecko.status === 'fulfilled' ? coingecko.value : null;

  if (boiData && cg) {
    current = { usdc: 1 / boiData.ilsPerUsd, strk: 1 / cg.strkILS, eth: 1 / cg.ethILS };
    lastSource = 'boi+coingecko';
    lastBoiAsOf = boiData.asOf;
    lastIlsPerUsd = boiData.ilsPerUsd;
    return;
  }
  if (cg) {
    // BoI down — fall back to CoinGecko's USDC/ILS quote (close enough but
    // not the official rate; the UI surfaces this distinction via getNISRatesSource).
    const usdcFromCg = cg.usdcILS ?? null;
    current = {
      usdc: usdcFromCg ? 1 / usdcFromCg : DEFAULTS.usdc,
      strk: 1 / cg.strkILS,
      eth:  1 / cg.ethILS,
    };
    lastSource = 'coingecko-only';
    lastBoiAsOf = null;
    lastIlsPerUsd = usdcFromCg ?? null;
  }
}

async function fetchBoiUsdILS(): Promise<{ ilsPerUsd: number; asOf: string } | null> {
  const res = await fetch('/api-boi/usd');
  if (!res.ok) return null;
  const data = await res.json() as { ilsPerUsd?: number; asOf?: string };
  if (typeof data.ilsPerUsd !== 'number' || data.ilsPerUsd <= 0) return null;
  return { ilsPerUsd: data.ilsPerUsd, asOf: typeof data.asOf === 'string' ? data.asOf : '' };
}

async function fetchCoingeckoILS(): Promise<{ usdcILS: number; strkILS: number; ethILS: number } | null> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,starknet,ethereum&vs_currencies=ils',
  );
  if (!res.ok) return null;
  const data = await res.json() as Record<string, Record<string, number>>;
  const usdcILS = data['usd-coin']?.ils;
  const strkILS = data['starknet']?.ils;
  const ethILS  = data['ethereum']?.ils;
  if (!strkILS || !ethILS) return null;
  return { usdcILS, strkILS, ethILS };
}
