// Full-screen login gate: the app stays hidden behind a dark overlay until a
// wallet is connected. It opens straight on the wallet chooser ("Choose your
// wallet"); selecting a wallet moves to a "sign on your wallet" waiting state.
// Sign-out brings the gate back.
import { state } from './state';
import { connectWithWallet, renderWalletOptionsInto } from './wallet';

const $ = (id: string) => document.getElementById(id);

type View = 'wallets' | 'connecting';

function showView(view: View): void {
  $('lgViewWallets')?.toggleAttribute('hidden', view !== 'wallets');
  $('lgViewConnecting')?.toggleAttribute('hidden', view !== 'connecting');
}

// Render the wallet options and show the chooser. Re-rendering re-triggers the
// staggered entrance animation each time the gate is shown.
function showWalletChooser(): void {
  const list = $('lgWalletList');
  if (list) renderWalletOptionsInto(list);
  showView('wallets');
}

function syncGate(): void {
  const gate = $('loginGate');
  if (!gate) return;
  const connected = !!state.walletConnected;
  gate.classList.toggle('lg-hidden', connected);
  if (!connected) showWalletChooser();
}

export function initLoginGate(): void {
  const gate = $('loginGate');
  if (!gate) return;

  $('lgBackToWallets')?.addEventListener('click', () => showView('wallets'));

  // Same delegated pattern as the picker modal in main.ts.
  $('lgWalletList')?.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-wallet]');
    if (!btn) return;
    showView('connecting');
    await connectWithWallet(btn.dataset.wallet!); // never throws; errors land in #lgErr
    // Success hides the gate via wallet-changed; on failure fall back to the
    // chooser so the error (if any) is visible.
    if (!state.walletConnected) showView('wallets');
  });

  document.addEventListener('wallet-changed', syncGate);
  syncGate();
}
