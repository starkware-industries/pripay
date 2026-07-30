// Topbar profile popover: avatar button opens a card with the connected
// wallet's identity — name + icon, address QR, copy, sign out. When no
// wallet is connected the button falls through to the wallet picker.
import { state } from './state';
import { disconnectWallet, renderWalletPicker } from './wallet';
import { openM } from './modals';
import { nav } from './nav';

const $ = (id: string) => document.getElementById(id);
const shortAddr = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);

function isOpen(): boolean {
  return $('profilePop')?.classList.contains('open') ?? false;
}

function setOpen(open: boolean): void {
  $('profilePop')?.classList.toggle('open', open);
  $('profileBtn')?.setAttribute('aria-expanded', String(open));
}

function renderPop(): void {
  const addr = state.walletConnected;
  if (!addr) return;
  const nameEl = $('ppWalletName');
  if (nameEl) nameEl.textContent = state.walletName || 'Wallet';
  const addrEl = $('ppAddr');
  if (addrEl) addrEl.textContent = shortAddr(addr);
}

async function copyAddress(): Promise<void> {
  const addr = state.walletConnected;
  if (!addr) return;
  try {
    await navigator.clipboard.writeText(addr);
  } catch {
    // Clipboard API needs a secure context; fall back for plain-http dev hosts.
    const ta = document.createElement('textarea');
    ta.value = addr;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const btn = $('ppCopyBtn');
  btn?.classList.add('copied');
  setTimeout(() => btn?.classList.remove('copied'), 1400);
}

export function initProfilePop(): void {
  const btn = $('profileBtn');
  const pop = $('profilePop');
  if (!btn || !pop) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.walletConnected) {
      renderWalletPicker();
      openM('walletPicker');
      return;
    }
    if (isOpen()) { setOpen(false); return; }
    renderPop();
    setOpen(true);
  });

  document.addEventListener('click', (e) => {
    if (isOpen() && !pop.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });
  // Disconnect from anywhere (e.g. the wallet picker) closes the popover;
  // an account switch while open re-renders it.
  document.addEventListener('wallet-changed', () => {
    if (!state.walletConnected) setOpen(false);
    else if (isOpen()) renderPop();
  });

  $('ppCopyBtn')?.addEventListener('click', () => void copyAddress());
  $('ppSettingsBtn')?.addEventListener('click', () => { setOpen(false); nav('settings'); });
  // Theme toggle stays open so the user sees the switch happen.
  $('ppThemeBtn')?.addEventListener('click', () => { document.body.classList.toggle('light'); });
  $('ppSignOutBtn')?.addEventListener('click', () => { setOpen(false); disconnectWallet(); });
}
