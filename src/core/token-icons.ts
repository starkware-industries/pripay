// Token logos pulled from AVNU's public Starknet token list. Purely
// cosmetic — shown in the currency dropdowns. Every failure is swallowed:
// if the list can't be fetched the dropdowns just render without icons.
// Endpoint + shape: https://docs.avnu.fi/api/tokens/get-tokens

const ICONS: Record<string, string> = {};
let started = false;
const listeners: Array<() => void> = [];

/** Register a callback fired once the icon map is populated. */
export function onIconsLoaded(cb: () => void): void {
  listeners.push(cb);
}

/** logoUri for a token symbol (case-insensitive), or null when unknown. */
export function tokenIcon(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  return ICONS[symbol.toLowerCase()] ?? null;
}

/** Fetch the AVNU token list once and cache symbol → logoUri. */
export async function loadTokenIcons(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const res = await fetch('https://starknet.api.avnu.fi/v1/starknet/tokens?size=100&sort=lastDailyVolumeUsd,desc');
    if (!res.ok) return;
    const data = await res.json();
    for (const t of data?.content ?? []) {
      if (t?.symbol && t?.logoUri) ICONS[String(t.symbol).toLowerCase()] = String(t.logoUri);
    }
    for (const cb of listeners) { try { cb(); } catch { /* ignore */ } }
  } catch {
    /* icons are cosmetic — ignore network/parse failures */
  }
}
