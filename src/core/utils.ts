import type { NISRates } from './types';
import { getNISRates } from './prices';

// Lights an input red when validation fails; clears as soon as the user
// edits the field OR clicks away from it. Amount inputs sit inside
// .nis-group boxes, so the whole group is flagged for those. Any inline
// error text (element id `${id}Err`, e.g. otAddrErr) is hidden on clear too.
export function flagInvalid(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const group = el.closest('.nis-group');
  const errEl = document.getElementById(id + 'Err');
  el.classList.add('inp-error');
  group?.classList.add('inp-error');
  const clear = () => {
    el.classList.remove('inp-error');
    group?.classList.remove('inp-error');
    if (errEl) errEl.style.display = 'none';
    el.removeEventListener('input', clear);
    el.removeEventListener('blur', clear);
  };
  el.addEventListener('input', clear);
  el.addEventListener('blur', clear);
}

// Small monochrome shield mark for "private" indicators (emoji-free UI).
export const SHIELD_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

export const initials = (n: string): string =>
  n.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

export const rand64 = (): string =>
  Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

export const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

// A truncated 0x value (0x1234...abcd) that reveals the full value in a dark
// tooltip on hover and copies it on click. Shared by the dashboard company
// card and the transaction-history page so the treatment stays identical.
export function buildCopyableValue(full: string, short?: string): HTMLElement {
  const display = short ?? (full.length > 14 ? full.slice(0, 6) + '...' + full.slice(-4) : full);
  const wrap = document.createElement('span');
  wrap.style.position = 'relative';
  const text = document.createElement('span');
  text.textContent = display;
  text.style.cssText = 'cursor:pointer';
  const tip = document.createElement('span');
  tip.textContent = full;
  tip.style.cssText = 'position:absolute;bottom:calc(100% + 6px);left:0;display:none;background:#1e293b;color:#fff;font-family:monospace;font-weight:400;font-size:11px;padding:6px 9px;border-radius:6px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:50;pointer-events:none';
  wrap.append(text, tip);
  wrap.addEventListener('mouseenter', () => { tip.style.display = 'block'; });
  wrap.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  text.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(full);
      text.textContent = 'Copied ✓';
      setTimeout(() => { text.textContent = display; }, 1000);
    } catch { /* clipboard blocked — tooltip still shows the full value */ }
  });
  return wrap;
}

export function fmtToken(v: number, token: string): string {
  const c = (d: number) => v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  if (token === 'eth')  return c(5) + ' ETH';
  if (token === 'strk') return c(2) + ' STRK';
  return c(2) + ' USDC';
}

// Same value formatting as fmtToken, but renders USDC as "$X.XX" — used in
// "what the operator typed" contexts (one-time amount unit, profile totals,
// per-tx Value column) where USDC functions as a USD stand-in. Stays
// distinct from fmtToken so on-chain settlement displays keep the USDC
// label.
export function fmtTypedAmount(v: number, unit: string): string {
  if (unit === 'nis')  return '₪ ' + fmtIls(v);
  if (unit === 'usdc') return '$ ' + fmtIls(v);
  return fmtToken(v, unit);
}

// Locale-formatted ILS amount with up to 2 fractional digits. Used in
// every "₪X" display so non-integer NIS amounts (e.g. monthly totals
// derived from rate-converted crypto) don't get rounded to whole shekels.
// Formats a NIS-anchored amount as US dollars via the live USDC rate
// (USDC ≈ USD). The stored model stays NIS; only the display is dollars.
export function fmtUsd(nis: number): string {
  return '$ ' + fmtIls(nis * getNISRates().usdc);
}

export function fmtIls(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function nisToToken(nis: number, token: string, rates: NISRates): number {
  return (parseFloat(String(nis)) || 0) * rates[token as keyof NISRates];
}

// Triggers a browser download of `contents` as `filename`. Used by the CSV
// export buttons and the import-modal template downloads.
export function downloadTextFile(filename: string, contents: string, mime = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
