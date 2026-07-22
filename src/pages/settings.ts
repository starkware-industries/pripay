import { state } from '../core/state';
import { flagInvalid } from '../core/utils';
import { closeM } from '../core/modals';
import { showAlert } from '../core/dialogs';
import { openEditCompanyFor } from './dashboard';
import type { CompanyInfo } from '../core/types';
import { Account, type TypedData } from 'starknet';
import { PrivateKeyPaymasterSubmitter, LocalSubmitter, AvnuPaymasterSubmitter } from '../sdk_integration/submitter';
import { paymasterAvailable } from '../sdk_integration/avnu-paymaster';
import { TOKENS } from '../core/validators';
import { SNIP12_CHAIN_ID, PAYMASTER_FORWARDER, POOL_FEE_TOKEN } from '../sdk_integration/network-config';

export function renderSettings(): void {
  const statusEl = document.getElementById('setPmStatus') as HTMLElement | null;
  const addrEl = document.getElementById('setPmAddr') as HTMLElement | null;
  const btn = document.getElementById('setPmBtn') as HTMLButtonElement | null;
  const clear = document.getElementById('setPmClear') as HTMLElement | null;
  const isAvnu = state.submitter instanceof AvnuPaymasterSubmitter;
  const hasPaymaster = state.submitter instanceof PrivateKeyPaymasterSubmitter;
  if (statusEl) {
    statusEl.textContent = isAvnu
      ? 'AVNU paymaster (gasless)'
      : hasPaymaster ? 'Configured (paste-key fallback)' : 'Not configured';
    statusEl.style.color = (isAvnu || hasPaymaster) ? '#16a34a' : 'var(--text3)';
  }
  if (addrEl) {
    const addr = hasPaymaster ? (state.submitter as PrivateKeyPaymasterSubmitter).address : '';
    addrEl.textContent = addr;
    addrEl.style.display = addr ? 'block' : 'none';
  }
  if (btn) btn.textContent = hasPaymaster ? 'Change paymaster key' : 'Set paymaster key';
  if (clear) clear.style.display = hasPaymaster ? 'inline' : 'none';
  void renderAdminWallets();
}

// Admin-only: list every wallet that has connected and let the admin edit any
// wallet's company overview (the server gates the actual write).
async function renderAdminWallets(): Promise<void> {
  const card = document.getElementById('adminWalletsCard');
  const list = document.getElementById('adminWalletsList');
  if (!card || !list) return;
  card.classList.toggle('hidden', !state.isAdmin);
  if (!state.isAdmin) return;

  let companies: { addr: string; company: CompanyInfo | null }[] = [];
  try {
    const r = await fetch('/api/companies');
    companies = r.ok ? await r.json() : [];
  } catch {
    companies = [];
  }

  list.replaceChildren();
  if (!companies.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--text3)';
    empty.textContent = 'No wallets have connected yet.';
    list.appendChild(empty);
    return;
  }
  for (const { addr, company } of companies) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;justify-content:space-between;border:1px solid var(--border);border-radius:8px;padding:8px 12px';
    const info = document.createElement('div');
    info.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:13px;font-weight:500';
    nameEl.textContent = company && company.name ? company.name : '(company not set up)';
    const addrEl = document.createElement('div');
    addrEl.style.cssText = 'font-size:11px;font-family:monospace;color:var(--text3);word-break:break-all';
    addrEl.textContent = addr;
    info.append(nameEl, addrEl);
    const btn = document.createElement('button');
    btn.className = 'btn btn-p btn-sm';
    btn.textContent = 'Edit';
    btn.addEventListener('click', () => openEditCompanyFor(addr, company));
    row.append(info, btn);
    list.appendChild(row);
  }
}

// The key is not persisted — the user re-enters after reload to avoid leaving it on disk.
export function submitPaymasterKey(): void {
  const addressEl = document.getElementById('pm-address') as HTMLInputElement | null;
  const keyEl = document.getElementById('pm-private-key') as HTMLInputElement | null;
  const statusEl = document.getElementById('pm-status') as HTMLElement | null;
  const errEl = document.getElementById('pm-err') as HTMLElement | null;
  if (!addressEl || !keyEl || !statusEl || !errEl) return;

  const address = addressEl.value.trim();
  const key = keyEl.value.trim();
  if (!address.startsWith('0x') || !key.startsWith('0x')) {
    if (!address.startsWith('0x')) flagInvalid('pm-address');
    if (!key.startsWith('0x')) flagInvalid('pm-private-key');
    errEl.style.display = 'block';
    errEl.textContent = 'Both address and private key must be 0x-prefixed hex.';
    statusEl.style.display = 'none';
    return;
  }

  try {
    const account = new Account({ provider: state.provider, address, signer: key });
    state.submitter = new PrivateKeyPaymasterSubmitter(account, TOKENS.strk.address);
    keyEl.value = '';
    errEl.style.display = 'none';
    statusEl.style.display = 'none';
    renderSettings();
    closeM('paymasterKey');
  } catch (err) {
    errEl.style.display = 'block';
    errEl.textContent = (err as Error)?.message ?? String(err);
    statusEl.style.display = 'none';
  }
}

// Activate the AVNU paymaster (gasless) when this network has a forwarder
// configured — the operator's "AVNU is whitelisted and ready" switch — and the
// service answers. Otherwise leave the existing submitter so the paste-key
// fallback and local dev keep working while AVNU onboarding is still pending.
export async function configureAvnuPaymaster(): Promise<void> {
  if (!PAYMASTER_FORWARDER) return;
  try {
    if (!(await paymasterAvailable())) return;
  } catch {
    return;
  }
  state.submitter = new AvnuPaymasterSubmitter(POOL_FEE_TOKEN, PAYMASTER_FORWARDER);
  renderSettings();
}

// Fetches paymaster.local.json (gitignored) at startup; no-op when absent.
export async function loadLocalPaymaster(): Promise<void> {
  try {
    const res = await fetch('paymaster.local.json');
    if (!res.ok) return;
    const cfg = await res.json() as { address?: string; secretKey?: string };
    if (!cfg.address?.startsWith('0x') || !cfg.secretKey?.startsWith('0x')) return;
    const account = new Account({ provider: state.provider, address: cfg.address, signer: cfg.secretKey });
    state.submitter = new PrivateKeyPaymasterSubmitter(account, TOKENS.strk.address);
    renderSettings();
  } catch { }
}

export function clearPaymaster(): void {
  state.submitter = new LocalSubmitter();
  renderSettings();
}

// SNIP-12 connectivity demo: asks the connected wallet to sign an off-chain
// "hello" typed message. Routes through state.operatorAccount (a WalletAccount),
// whose signMessage maps to wallet_signTypedData. Nothing is submitted on-chain.
export async function signHelloMessage(): Promise<void> {
  const btn = document.getElementById('setSignDemoBtn') as HTMLButtonElement | null;
  const result = document.getElementById('setSignDemoResult') as HTMLElement | null;

  if (!state.operatorAccount) {
    await showAlert('Connect a wallet first.', 'SNIP-12 demo');
    return;
  }

  const typedData: TypedData = {
    types: {
      StarknetDomain: [
        { name: 'name', type: 'shortstring' },
        { name: 'version', type: 'shortstring' },
        { name: 'chainId', type: 'shortstring' },
        { name: 'revision', type: 'shortstring' },
      ],
      Message: [{ name: 'contents', type: 'shortstring' }],
    },
    primaryType: 'Message',
    domain: { name: 'PriPay', version: '1', chainId: SNIP12_CHAIN_ID, revision: '1' },
    message: { contents: 'hello world' },
  };

  if (btn) { btn.disabled = true; btn.textContent = 'Check your wallet…'; }
  if (result) result.style.display = 'none';

  try {
    const sig = await state.operatorAccount.signMessage(typedData);
    const parts = Array.isArray(sig) ? sig.map(String) : [String(sig)];
    if (result) {
      result.style.display = 'block';
      result.textContent = 'Signed ✓\n' + parts.join('\n');
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (err?.code === 4001 || /reject|denied/i.test(msg)) {
      if (result) { result.style.display = 'block'; result.textContent = 'Signature rejected in wallet.'; }
    } else {
      await showAlert(msg, 'SNIP-12 demo failed');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign hello message'; }
  }
}
