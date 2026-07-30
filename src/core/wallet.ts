import { state, loadWalletData, clearWalletData } from './state';
import { closeM } from './modals';
import { renderCompanyCard, refreshTreasuryBalance, renderOnchainCard, refreshAuditLog } from '../pages/dashboard';
import { renderProfiles } from '../pages/profiles';
import { renderRec } from '../pages/recurrent';
import { buildWalletAccount } from '../sdk_integration/wallet-account';
import { bootstrapViewingKey, buildTransfersClient } from '../sdk_integration/init';
import { ACTIVE_NETWORK, EXPECTED_WALLET_CHAIN_ID, NETWORK_LABEL } from '../sdk_integration/network-config';
import { walletSignIn, walletSignOut } from '../sdk_integration/siws';
import { WALLET_LOGOS } from './wallet-logos';

// Short pill label derived from the active network ('Mainnet' / 'Sepolia').
const PILL_LABEL = ACTIVE_NETWORK === 'mainnet' ? 'Mainnet' : 'Sepolia';

const METAMASK_SNAP_ID = 'npm:@consensys/starknet-snap';

// Connection errors surface in whichever chooser is on screen: the wallet
// picker modal and the login gate share the same message.
function setWalletErr(msg: string): void {
  for (const id of ['walletPickerErr', 'lgErr']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.display = msg ? 'block' : 'none';
    el.replaceChildren();
    if (msg) {
      const div = document.createElement('div');
      div.className = 'alert alert-err';
      div.textContent = msg;
      el.appendChild(div);
    }
  }
}

// Renders the network pill with PriPay's configured chain label. We pin it to
// the configured chain rather than the wallet's reported one: wallet_requestChainId
// proved unreliable across wallet versions (esp. Ready post-rebrand),
// and the wallet refuses to sign anyway if its actual chain doesn't match.
// Called at startup (so the pill is right before any wallet connects) and after.
export function renderNetworkPill(): void {
  const pill = document.getElementById('networkPill');
  if (!pill) return;
  pill.replaceChildren();
  const dot = document.createElement('div');
  dot.className = 'dot-live';
  pill.appendChild(dot);
  pill.appendChild(document.createTextNode(PILL_LABEL));
}

// Wallet options for the picker. `windowObj` returns the injected Starknet
// wallet (used both for detection and to read its official `icon`); `logo` is
// the bundled brand icon shown when the wallet isn't installed (or, like the
// MetaMask snap, exposes no Starknet icon); `fill` colours the last-resort
// initial tile if an icon ever fails to load.
const WALLET_OPTS: Array<{ type: string; name: string; logo: string; fill: string; windowObj: () => any }> = [
  { type: 'argent',   name: 'Ready', logo: WALLET_LOGOS.argent,   fill: '#ff875b', windowObj: () => (window as any).starknet_argentX },
  { type: 'braavos',  name: 'Braavos',  logo: WALLET_LOGOS.braavos,  fill: '#f4663a', windowObj: () => (window as any).starknet_braavos },
  { type: 'xverse',   name: 'Xverse',   logo: WALLET_LOGOS.xverse,   fill: '#ee7a30', windowObj: () => (window as any).starknet_xverse },
  { type: 'fordefi',  name: 'ForDefi',  logo: WALLET_LOGOS.fordefi,  fill: '#101a3a', windowObj: () => (window as any).starknet_fordefi || (window as any).fordefi },
  { type: 'metamask', name: 'MetaMask', logo: WALLET_LOGOS.metamask, fill: '#f6851b', windowObj: () => ((window as any).ethereum?.isMetaMask ? (window as any).ethereum : null) },
];

// get-starknet-style discovery: any injected wallet exposing the Starknet
// wallet-standard shape (id/name/request) shows up in the picker automatically
// — no per-wallet code change. This reimplements get-starknet-core's injected
// scan inline; we avoid the npm package because it pulls @module-federation/
// runtime (a remote-code loader) that a financial app shouldn't ship.
function isStarknetWindowObject(o: any): boolean {
  return !!o && typeof o === 'object' && typeof o.id === 'string' && typeof o.name === 'string'
    && (typeof o.request === 'function' || typeof o.enable === 'function');
}
const FEATURED_KEYS = new Set(['starknet_argentX', 'starknet_braavos', 'starknet_xverse', 'starknet_fordefi', 'fordefi']);
function discoverExtraWallets(): Array<{ key: string; obj: any }> {
  const out: Array<{ key: string; obj: any }> = [];
  const seenId = new Set<string>();
  // Seed with the featured wallets' injected ids so aliases (e.g. window.starknet
  // pointing at the default wallet) don't reappear as a duplicate row.
  for (const w of WALLET_OPTS) {
    const o = w.windowObj();
    if (o && typeof o.id === 'string') seenId.add(o.id);
  }
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!key.startsWith('starknet') || FEATURED_KEYS.has(key)) continue;
    const obj = (window as any)[key];
    if (!isStarknetWindowObject(obj) || seenId.has(obj.id)) continue;
    seenId.add(obj.id);
    out.push({ key, obj });
  }
  return out;
}

// The official logo a Starknet wallet injects on its window object. Per the
// wallet standard `icon` is either a data-URI string or a { dark, light } pair.
function injectedIcon(obj: any): string | null {
  const icon = obj?.icon;
  if (!icon) return null;
  if (typeof icon === 'string') return icon;
  return icon.light || icon.dark || null;
}

// Brand-coloured rounded tile with the wallet's initial — the local fallback
// when no official icon is available. Built with createElementNS so no markup
// is parsed from a string.
const SVG_NS = 'http://www.w3.org/2000/svg';
function fallbackIcon(name: string, fill: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '26');
  svg.setAttribute('height', '26');
  svg.setAttribute('viewBox', '0 0 26 26');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.flexShrink = '0';

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('width', '26');
  rect.setAttribute('height', '26');
  rect.setAttribute('rx', '7');
  rect.setAttribute('fill', fill);

  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '13');
  text.setAttribute('y', '14');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('font-family', '-apple-system,Segoe UI,Roboto,sans-serif');
  text.setAttribute('font-size', '13');
  text.setAttribute('font-weight', '700');
  text.setAttribute('fill', '#fff');
  text.textContent = name.charAt(0);

  svg.append(rect, text);
  return svg;
}

// Rebuilds the wallet list, detected-first with a "Detected" pill. Called when
// the picker opens (by then every extension has injected its window object).
export function renderWalletPicker(): void {
  const list = document.getElementById('walletOptList');
  if (list) renderWalletOptionsInto(list);
}

// Shared option-list builder — used by the picker modal and the login gate.
export function renderWalletOptionsInto(list: HTMLElement): void {
  type Row = { type: string; name: string; icon: string; fill: string; detected: boolean };
  const featured: Row[] = WALLET_OPTS.map((w) => {
    const obj = w.windowObj();
    return { type: w.type, name: w.name, icon: injectedIcon(obj) || w.logo, fill: w.fill, detected: !!obj };
  });
  // Auto-discovered injected wallets beyond the featured set (get-starknet style).
  const extras: Row[] = discoverExtraWallets().map(({ key, obj }) => ({
    type: 'injected:' + key, name: obj.name, icon: injectedIcon(obj) || '', fill: '#8a8a8a', detected: true,
  }));
  const rows = [...featured, ...extras].sort((a, b) => Number(b.detected) - Number(a.detected));
  list.replaceChildren(...rows.map((r) => {
    const btn = document.createElement('button');
    btn.className = 'wallet-opt';
    btn.dataset.wallet = r.type;

    const img = document.createElement('img');
    img.src = r.icon;
    img.alt = '';
    img.style.cssText = 'width:26px;height:26px;border-radius:7px;flex-shrink:0';
    img.onerror = () => img.replaceWith(fallbackIcon(r.name, r.fill));
    btn.append(img);

    const main = document.createElement('div');
    main.className = 'wo-main';
    const name = document.createElement('span');
    name.textContent = r.name;
    main.append(name);

    btn.append(main);
    if (r.detected) {
      const pill = document.createElement('span');
      pill.className = 'wo-pill';
      pill.textContent = 'Detected';
      btn.append(pill);
    }
    return btn;
  }));
}

// Display info for a connected wallet type — official injected icon when the
// extension provides one, plus name and brand colour for the fallback tile.
export function walletBrand(type: string): { name: string; icon: string | null; fill: string } | null {
  const w = WALLET_OPTS.find((o) => o.type === type);
  if (!w) return null;
  return { name: w.name, icon: injectedIcon(w.windowObj()) || w.logo, fill: w.fill };
}

// Same info for every supported wallet (login gate's mini-icon row).
export function listWalletBrands(): Array<{ type: string; name: string; icon: string | null; fill: string }> {
  return WALLET_OPTS.map((w) => ({ type: w.type, name: w.name, icon: injectedIcon(w.windowObj()) || w.logo, fill: w.fill }));
}

export function onWalletConnected(addr: string, walletName: string, walletType: string): void {
  state.walletConnected = addr;
  state.walletName = walletName;
  state.walletType = walletType;
  document.dispatchEvent(new CustomEvent('wallet-changed'));
  // Load this wallet's profiles/orders (shared across all sessions on the same
  // address); re-render the lists when they arrive.
  void loadWalletData(addr, () => {
    renderProfiles(); renderRec(); renderCompanyCard();
  });
  closeM('walletPicker');
  const btn = document.getElementById('walletBtn') as HTMLButtonElement | null;
  if (btn) { btn.classList.add('connected'); btn.disabled = false; }
  const label = document.getElementById('walletLabel');
  if (label) label.textContent = addr.slice(0, 6) + '...' + addr.slice(-4) + ' ✓';
  updateWalletPickerState(addr);
  renderCompanyCard();
  refreshTreasuryBalance();
  // Build the starknet.js Account + privacy SDK handles in the background.
  // The on-chain status card surfaces the result; failures are non-fatal
  // (treasury balance still works without privacy wiring).
  bootstrapPrivacy(walletType, walletName).catch((err) => {
    console.error('[PriPay] privacy bootstrap failed', err);
    state.onboardingError = err?.message ?? String(err);
    state.onboardingStatus = 'error';
    renderOnchainCard();
  });
}

async function bootstrapPrivacy(walletType: string, walletName: string): Promise<void> {
  state.onboardingError = null;
  state.onboardingStatus = 'init';
  renderOnchainCard(walletName);

  if (walletType === 'metamask') {
    // MetaMask snap doesn't expose a StarknetWindowObject; starknet.js
    // WalletAccount can't wrap it. Treasury balance reads work, but
    // onboarding needs a starknet-native wallet (Ready/Braavos/ForDefi).
    throw new Error('Onboarding via MetaMask snap is not supported yet — use Ready, Braavos, or ForDefi.');
  }

  const operatorAccount = buildWalletAccount(state.provider, walletType, state.walletConnected);
  state.operatorAccount = operatorAccount;

  // Load (or generate) the viewing key. The PayrollContract + SDK client are
  // built later, inside runOnboarding, because the contract address depends
  // on either a persisted entry or a fresh deploy.
  state.viewingKey = await bootstrapViewingKey(operatorAccount, state.storage);
  state.payrollAddress = await state.storage.getPayrollAddress(operatorAccount.address);
  state.onboarded = await state.storage.isOnboarded(operatorAccount.address);
  // If we already have a deployed PayrollContract for this wallet, wire up
  // the SDK client now so the dashboard's privacy-pool balance + deposit
  // flow work without re-running onboarding.
  if (state.payrollAddress && state.viewingKey != null) {
    state.transfers = buildTransfersClient(state.provider, state.payrollAddress, state.viewingKey);
  }
  state.onboardingStatus = state.onboarded ? 'done' : 'idle';
  renderOnchainCard(walletName);
  // payrollAddress is loaded here (async), after onWalletConnected's initial
  // renderCompanyCard already ran — re-render so the "Private treasury account"
  // row shows the contract address instead of "—".
  renderCompanyCard();
  // bootstrap finishes after onWalletConnected's first refreshTreasuryBalance
  // call returned. Now that state.transfers exists, ask the dashboard to
  // re-render the balance + show the Deposit button, and pull the audit
  // log off the indexer.
  refreshTreasuryBalance();
  void refreshAuditLog({ delayed: false });
}

export function disconnectWallet(): void {
  void walletSignOut();
  state.walletConnected = '';
  state.walletName = '';
  state.walletType = '';
  document.dispatchEvent(new CustomEvent('wallet-changed'));
  clearWalletData();
  renderProfiles();
  renderRec();
  state.operatorAccount = null;
  state.payrollAddress = null;
  state.transfers = null;
  state.viewingKey = null;
  state.onboarded = false;
  state.onboardingStatus = 'idle';
  state.onboardingError = null;
  const btn = document.getElementById('walletBtn') as HTMLButtonElement | null;
  if (btn) { btn.classList.remove('connected'); btn.disabled = false; }
  const label = document.getElementById('walletLabel');
  if (label) label.textContent = 'Connect wallet';
  const v = document.getElementById('treasuryVal');
  if (v) v.textContent = '—';
  updateWalletPickerState('');
  closeM('walletPicker');
  renderCompanyCard();
  renderOnchainCard();
}

function updateWalletPickerState(addr: string): void {
  const section = document.getElementById('walletConnectedSection');
  const addrEl  = document.getElementById('walletConnectedAddr');
  const hint    = document.getElementById('walletSwitchHint');
  if (section) section.style.display = addr ? 'block' : 'none';
  if (addrEl)  addrEl.textContent = addr || '';
  if (hint)    hint.textContent   = addr ? 'Switch to a different wallet' : 'Connect a wallet';
}

// Robust Starknet chain-id equality: ids come back as hex shortstrings
// (e.g. '0x534e5f5345504f4c4941'), but tolerate case / leading zeros / decimal.
function sameChain(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try { return BigInt(a) === BigInt(b); } catch { return a === b; }
}

// Before finishing a connection, make sure the wallet is on PriPay's network.
// We only *block* when we positively read a different chain — if the wallet
// doesn't answer wallet_requestChainId (flaky on some builds, esp. Ready) we let
// the connection through, since the wallet refuses to sign on the wrong chain
// anyway. When it is on the wrong chain we ask it to switch (wallet popup); if
// it stays wrong, we throw a clear message telling the user to switch manually.
async function ensureExpectedChain(w: any, walletName: string): Promise<void> {
  if (typeof w?.request !== 'function') return;
  let chainId: string;
  try {
    chainId = await w.request({ type: 'wallet_requestChainId' });
  } catch {
    return; // chain id unreadable — don't hard-block
  }
  if (sameChain(chainId, EXPECTED_WALLET_CHAIN_ID)) return;

  // Wrong network: ask the wallet to switch to PriPay's chain.
  try {
    await w.request({ type: 'wallet_switchStarknetChain', params: { chainId: EXPECTED_WALLET_CHAIN_ID } });
  } catch { /* rejected or unsupported — fall through to the guard below */ }

  // Re-read; block if it's still not on the expected chain.
  let after = '';
  try { after = await w.request({ type: 'wallet_requestChainId' }); } catch { /* keep '' */ }
  if (!sameChain(after, EXPECTED_WALLET_CHAIN_ID)) {
    throw new Error(`${walletName} is on the wrong network. Please switch it to ${NETWORK_LABEL} and connect again.`);
  }
}

export async function connectWithWallet(type: string): Promise<void> {
  setWalletErr('');
  document.querySelectorAll<HTMLButtonElement>('.wallet-opt').forEach(b => { b.disabled = true; });
  const walletBtn   = document.getElementById('walletBtn')   as HTMLButtonElement | null;
  const walletLabel = document.getElementById('walletLabel');
  if (walletBtn)   walletBtn.disabled = true;
  if (walletLabel) walletLabel.textContent = 'Connecting...';

  try {
    if (type === 'argent' || type === 'braavos' || type === 'xverse') {
      // Standard get-starknet wallets: same connect API, different window key.
      const KEY: Record<string, string> = { argent: 'starknet_argentX', braavos: 'starknet_braavos', xverse: 'starknet_xverse' };
      const NAME: Record<string, string> = { argent: 'Ready', braavos: 'Braavos', xverse: 'Xverse' };
      const w = (window as any)[KEY[type]];
      if (!w) throw new Error(NAME[type] + ' extension not detected. Install it and refresh.');
      let accounts: string[];
      if (typeof w.request === 'function') {
        accounts = await w.request({ type: 'wallet_requestAccounts' });
      } else {
        await w.enable();
        accounts = [w.selectedAddress];
      }
      const addr = accounts?.[0] || w.selectedAddress;
      if (!addr) throw new Error('No address returned');
      await ensureExpectedChain(w, NAME[type]);
      await walletSignIn(w, addr);
      renderNetworkPill();
      onWalletConnected(addr, NAME[type], type);

    } else if (type === 'metamask') {
      const eth = (window as any).ethereum;
      if (!eth?.isMetaMask) throw new Error('MetaMask not detected. Install MetaMask and refresh.');

      try { await eth.request({ method: 'wallet_getSnaps' }); }
      catch { throw new Error('Your MetaMask version does not support Snaps. Update MetaMask to v11 or later.'); }

      let snapResult: any;
      try {
        snapResult = await eth.request({ method: 'wallet_requestSnaps', params: { [METAMASK_SNAP_ID]: {} } });
      } catch (e: any) {
        const rejected = e?.code === 4001 || /denied|rejected|permission/i.test(e?.message || '');
        throw new Error(rejected
          ? 'Snap installation was rejected. Please approve the Starknet snap in the MetaMask popup and try again.'
          : 'Failed to install Starknet snap: ' + (e?.message || e));
      }

      const installed = snapResult?.[METAMASK_SNAP_ID];
      if (installed?.error) throw new Error('Snap error: ' + installed.error.message);

      let result: any;
      try {
        result = await eth.request({
          method: 'wallet_invokeSnap',
          params: { snapId: METAMASK_SNAP_ID, request: { method: 'starkNet_getStoredUserAccounts' } },
        });
      } catch {
        throw new Error('Could not fetch Starknet accounts from snap. Open the MetaMask Starknet snap and create an account first.');
      }

      const addr = Array.isArray(result) ? result[0]?.address : result?.address;
      if (!addr) throw new Error('No Starknet account found. Open the MetaMask Starknet snap and create an account first.');
      onWalletConnected(addr, 'MetaMask', 'metamask');

    } else if (type === 'fordefi') {
      const w = (window as any).starknet_fordefi || (window as any).fordefi;
      if (!w) throw new Error('ForDefi extension not detected. Install it and refresh.');
      let accounts: string[];
      if (typeof w.request === 'function') {
        accounts = await w.request({ type: 'wallet_requestAccounts' });
      } else {
        await w.enable();
        accounts = [w.selectedAddress];
      }
      const addr = accounts?.[0] || w.selectedAddress;
      if (!addr) throw new Error('No address returned');
      await ensureExpectedChain(w, 'ForDefi');
      await walletSignIn(w, addr);
      renderNetworkPill();
      onWalletConnected(addr, 'ForDefi', 'fordefi');

    } else if (type.startsWith('injected:')) {
      // Auto-discovered wallet (get-starknet-style) — connect via its injected object.
      const w = (window as any)[type.slice('injected:'.length)];
      if (!w) throw new Error('Wallet not detected. Refresh and try again.');
      let accounts: string[];
      if (typeof w.request === 'function') {
        accounts = await w.request({ type: 'wallet_requestAccounts' });
      } else {
        await w.enable();
        accounts = [w.selectedAddress];
      }
      const addr = accounts?.[0] || w.selectedAddress;
      if (!addr) throw new Error('No address returned');
      await ensureExpectedChain(w, w.name || 'Wallet');
      await walletSignIn(w, addr);
      renderNetworkPill();
      onWalletConnected(addr, w.name || 'Wallet', type);
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    const isPlainReject = err?.code === 4001 && !msg.includes('snap');
    if (!isPlainReject) setWalletErr(msg);
    if (walletBtn)   walletBtn.disabled = false;
    if (walletLabel) walletLabel.textContent = 'Connect wallet';
  } finally {
    document.querySelectorAll<HTMLButtonElement>('.wallet-opt').forEach(b => { b.disabled = false; });
  }
}
