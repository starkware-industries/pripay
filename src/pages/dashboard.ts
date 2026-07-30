import { state, auditTxs, saveCompanyInfo, saveCompanyForWallet, canEditCompany, setAuditTxs, isRecurrentTx } from '../core/state';
import { nav } from '../core/nav';
import type { CompanyInfo } from '../core/types';
import { showAlert, showConfirm } from '../core/dialogs';
import { fetchAuditHistory } from '../core/audit-history';
import { fetchUnshieldedHistory } from '../core/unshielded-history';
import { openM, closeM } from '../core/modals';
import { fetchBalance, fetchRawBalanceOf, formatTokenAmount } from '../core/starknet';
import { fetchAllPrivacyBalances, fetchPrivacyBalance, setCachedWalletAmounts } from '../core/privacy-balance';
import { getIlsPerUsd, getNISRates } from '../core/prices';
import { runOnboarding, buildTransfersClient } from '../sdk_integration/init';
import { LocalSubmitter } from '../sdk_integration/submitter';
import { runDeposit } from '../sdk_integration/run-deposit';
import { runShieldFromContract, buildContractWithdrawCall } from '../sdk_integration/contract-recover';
import { runWithdraw } from '../sdk_integration/run-withdraw';
import { runSwap } from '../sdk_integration/run-swap';
import { EXECUTOR_ADDRESS } from '../sdk_integration/network-config';
import { createOperation, updateOperation, phaseToStatus } from '../core/operations';
import { TOKENS } from '../core/validators';
import { buildCopyableValue, fmtIls, fmtUsd, initials, flagInvalid } from '../core/utils';

export function renderCompanyCard(): void {
  const c = state.companyInfo;
  const addr = state.walletConnected;
  const walletShort = addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : '—';
  const card = document.getElementById('companyCard');
  if (!card) return;

  card.replaceChildren(buildCompanyCardBody(c, walletShort));
  document.getElementById('editCompanyBtn')?.addEventListener('click', openEditCompany);
  renderStats();
  renderBalanceDonut(); // draw the balance donut on dashboard render (updates on balance refresh)
}

function buildCompanyCardBody(c: typeof state.companyInfo, walletShort: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.flex = '1';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px';
  const name = document.createElement('span');
  name.style.cssText = 'font-size:16px;font-weight:500';
  name.textContent = c.name || 'Company profile';
  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.id = 'editCompanyBtn';
  editBtn.title = 'Edit company info';
  editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
  // Only admins / accountants (or anyone during first-time setup) may edit.
  if (canEditCompany()) header.append(name, editBtn);
  else header.append(name);

  const tagline = document.createElement('div');
  tagline.style.cssText = 'font-size:13px;color:var(--accent);font-weight:500;margin-bottom:14px';
  tagline.textContent = c.tagline;

  const walletFull  = state.walletConnected || '';
  const payrollFull = state.payrollAddress || '';
  const payrollShort = payrollFull ? payrollFull.slice(0, 6) + '...' + payrollFull.slice(-4) : '—';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:7px 32px';
  grid.append(
    buildCompanyRow('Company email', c.email),
    buildCompanyRow('Wallet', walletShort, { monospace: true, full: walletFull }),
    buildCompanyRow('Official name', c.legal),
    buildCompanyRow('Private account', payrollShort, { monospace: true, full: payrollFull }),
  );

  // Show the configured accountant / operator contacts when set.
  {
    const accountants = (c.accountantEmails && c.accountantEmails.length
      ? c.accountantEmails
      : (c.accountantEmail ? [c.accountantEmail] : []));
    const operators = (c.operatorEmails && c.operatorEmails.length
      ? c.operatorEmails
      : (c.operatorEmail ? [c.operatorEmail] : []));
    const accountantWallets = c.accountantWallets ?? [];
    const parts: string[] = [];
    if (accountants.length) parts.push(`accountant ${accountants.join(', ')}`);
    // Shortened: these are the wallets that actually hold edit access.
    if (accountantWallets.length) {
      parts.push(`accountant wallet ${accountantWallets.map((w) => `${w.slice(0, 6)}…${w.slice(-4)}`).join(', ')}`);
    }
    if (operators.length)   parts.push(`operator ${operators.join(', ')}`);
    if (parts.length) {
      const row = buildCompanyRow('Team', parts.join(' · '));
      row.style.gridColumn = '1/-1';
      row.style.borderTop = '1px solid var(--border)';
      row.style.paddingTop = '8px';
      row.style.marginTop = '2px';
      grid.append(row);
    }
  }

  wrap.append(header, tagline, grid);
  return wrap;
}

function buildCompanyRow(label: string, value: string, opts?: { monospace?: boolean; full?: string }): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:14px;align-items:center';
  const k = document.createElement('span');
  // Wide enough to fit the longest company-card label ("Private account")
  // so addresses on consecutive rows line up at the same x.
  k.style.cssText = 'font-size:13px;color:var(--text3);min-width:120px';
  k.textContent = label;
  const v = document.createElement('span');
  v.style.cssText = `font-size:13px;font-weight:500${opts?.monospace ? ';font-family:monospace' : ''}`;
  // When a full value is provided (the complete address behind the truncated
  // display), show it in a styled tooltip on hover and copy on click.
  if (opts?.full) {
    v.appendChild(buildCopyableValue(opts.full, value));
  } else {
    v.textContent = value;
  }
  row.append(k, v);
  return row;
}

// null → editing the connected wallet's company; an address → an admin editing
// that wallet's company from the Settings "Registered wallets" list.
let editingCompanyAddr: string | null = null;

function fillCompanyForm(c: CompanyInfo): void {
  (document.getElementById('ec-name')    as HTMLInputElement).value = c.name || '';
  (document.getElementById('ec-tagline') as HTMLInputElement).value = c.tagline || '';
  (document.getElementById('ec-email')   as HTMLInputElement).value = c.email || '';
  (document.getElementById('ec-legal')   as HTMLInputElement).value = c.legal || '';
  // Prefer the plural arrays; fall back to the legacy singular fields.
  const accountants = c.accountantEmails && c.accountantEmails.length
    ? c.accountantEmails : (c.accountantEmail ? [c.accountantEmail] : []);
  const operators = c.operatorEmails && c.operatorEmails.length
    ? c.operatorEmails : (c.operatorEmail ? [c.operatorEmail] : []);
  (document.getElementById('ec-accountant-email') as HTMLInputElement).value = accountants.join(', ');
  (document.getElementById('ec-operator-email')   as HTMLInputElement).value = operators.join(', ');
  (document.getElementById('ec-accountant-wallet') as HTMLInputElement).value = (c.accountantWallets ?? []).join(', ');
}

function openEditCompany(): void {
  editingCompanyAddr = null;
  fillCompanyForm(state.companyInfo);
  openM('editCompany');
}

// Admin entry point (from Settings): edit a specific wallet's company overview.
export function openEditCompanyFor(addr: string, company: CompanyInfo | null): void {
  editingCompanyAddr = addr;
  fillCompanyForm(company ?? { ...state.companyInfo, name: '', tagline: '', email: '', legal: '', accountantEmails: undefined, operatorEmails: undefined, accountantWallets: undefined });
  openM('editCompany');
}

function parseEmailList(raw: string): string[] {
  return raw.split(/[,\n;]+/).map((s) => s.trim()).filter((s) => !!s);
}

// Keeps only well-formed felt addresses — a malformed entry would silently never
// match the session address, reading as "my accountant lost access" instead of a
// typo. parseEmailList's splitting is reused; only the validation differs.
function parseWalletList(raw: string): string[] {
  return parseEmailList(raw).filter((s) => /^0x[0-9a-fA-F]{1,64}$/.test(s));
}

function readCompanyForm(): CompanyInfo {
  const accountantEmails = parseEmailList((document.getElementById('ec-accountant-email') as HTMLInputElement).value);
  const operatorEmails   = parseEmailList((document.getElementById('ec-operator-email')   as HTMLInputElement).value);
  const accountantWallets = parseWalletList((document.getElementById('ec-accountant-wallet') as HTMLInputElement).value);
  return {
    name:    (document.getElementById('ec-name')    as HTMLInputElement).value.trim(),
    tagline: (document.getElementById('ec-tagline') as HTMLInputElement).value.trim(),
    email:   (document.getElementById('ec-email')   as HTMLInputElement).value.trim(),
    legal:   (document.getElementById('ec-legal')   as HTMLInputElement).value.trim(),
    network: state.companyInfo.network,
    accountantEmails: accountantEmails.length ? accountantEmails : undefined,
    operatorEmails:   operatorEmails.length   ? operatorEmails   : undefined,
    accountantWallets: accountantWallets.length ? accountantWallets : undefined,
  };
}

export function saveCompany(): void {
  const company = readCompanyForm();
  if (editingCompanyAddr) {
    // Admin editing another wallet from Settings.
    const addr = editingCompanyAddr;
    editingCompanyAddr = null;
    void saveCompanyForWallet(addr, company).then((ok) => {
      closeM('editCompany');
      if (ok) document.dispatchEvent(new CustomEvent('companies-updated'));
      else void showAlert('Save failed — you may not have permission to edit this wallet.');
    });
    return;
  }
  // Connected wallet.
  Object.assign(state.companyInfo, company);
  // Plural arrays are the source of truth; drop legacy singular fields.
  state.companyInfo.accountantEmail = undefined;
  state.companyInfo.operatorEmail   = undefined;
  saveCompanyInfo();
  state.companyConfigured = true;
  closeM('editCompany');
  renderCompanyCard();
}

type OcVisual = { dot: string; status: string; sub: string; button: 'hidden' | 'enabled' | 'disabled' };

// Plain-language activation copy — the underlying phases are unchanged.
const ONBOARDING_LABELS: Record<typeof state.onboardingStatus, OcVisual> = {
  idle: {
    dot: 'var(--success)',
    status: 'Set up private payments',
    sub: 'One-time activation · takes about a minute',
    button: 'enabled',
  },
  init: {
    dot: 'var(--warn)',
    status: 'Getting things ready…',
    sub: 'Loading your privacy setup',
    button: 'disabled',
  },
  declaring_contract: {
    dot: 'var(--warn)',
    status: 'Publishing your payment contract…',
    sub: 'Approve the request in your wallet',
    button: 'disabled',
  },
  deploying_contract: {
    dot: 'var(--warn)',
    status: 'Creating your private account…',
    sub: 'Approve the request in your wallet',
    button: 'disabled',
  },
  building_proof: {
    dot: 'var(--warn)',
    status: 'Preparing your registration…',
    sub: 'Just a few seconds',
    button: 'disabled',
  },
  signing_message: {
    dot: 'var(--warn)',
    status: 'Waiting for your signature…',
    sub: 'Approve the message in your wallet — it costs nothing',
    button: 'disabled',
  },
  generating_proof: {
    dot: 'var(--warn)',
    status: 'Securing your registration…',
    sub: 'Generating the privacy proof',
    button: 'disabled',
  },
  submitting: {
    dot: 'var(--warn)',
    status: 'Almost done…',
    sub: 'Sending to the network',
    button: 'disabled',
  },
  done: {
    dot: 'var(--success)',
    status: 'Private payments active',
    sub: 'You’re all set',
    button: 'hidden',
  },
  error: {
    dot: 'var(--err)',
    status: 'Activation didn’t go through',
    sub: 'See the message below — you can try again',
    button: 'enabled',
  },
};

// Schedules a second pull after ~12s to absorb indexer ingestion lag.
let auditRefreshPending = false;
export async function refreshAuditLog(opts?: { delayed?: boolean }): Promise<void> {
  if (auditRefreshPending) return;
  auditRefreshPending = true;
  setAuditLoading(true);
  try {
    const shielded = state.transfers
      ? await fetchAuditHistory(state.transfers, state.provider)
      : [];
    // The indexer can't tell a multipay from a single private transfer, so
    // override 'OneTime' → 'Recurrent' for tx hashes we tracked client-side
    // when the user clicked Execute on the recurrent page.
    for (const entry of shielded) {
      if (entry.type === 'OneTime' && isRecurrentTx(entry.tx)) {
        entry.type = 'Recurrent';
        entry.description = 'Recurrent payroll batch';
      }
    }
    // Unshielded wallet ERC20 transfers are sender-side only — pulled from
    // event logs since the privacy-pool indexer doesn't know about them.
    // Only scan once onboarding is done; otherwise the audit refresh
    // would take 5–10 s per pageload waiting on the event scan even
    // when there's no privacy-pool context yet.
    const unshielded = state.transfers
      ? await fetchUnshieldedHistory(state.provider).catch((err) => {
          console.warn('[dashboard] unshielded history fetch failed', err);
          return [];
        })
      : [];
    // The unshielded leg of a mixed recurrent batch is its own wallet tx,
    // tagged client-side as recurrent, so any unshielded row whose hash we
    // tagged should read as Recurrent.
    for (const entry of unshielded) {
      if (entry.type === 'UnshieldedTransfer' && isRecurrentTx(entry.tx)) {
        entry.type = 'Recurrent';
        entry.description = 'Recurrent payroll batch';
        // Keep the "wallet-direct" provenance so the row doesn't get the
        // shield-emoji rendering reserved for privacy-pool rows.
        entry.unshielded = true;
      }
    }
    const merged = [...shielded, ...unshielded].sort((a, b) => {
      // Newest first. Falls back to lexicographic when dates equal (time
      // may be empty for txs we couldn't get a block timestamp for).
      const aKey = `${a.date} ${a.time ?? ''}`;
      const bKey = `${b.date} ${b.time ?? ''}`;
      return bKey.localeCompare(aKey);
    });
    setAuditTxs(merged);
    document.dispatchEvent(new CustomEvent('audit-updated'));
  } catch (err) {
    console.warn('[dashboard] audit refresh failed', err);
  } finally {
    auditRefreshPending = false;
    setAuditLoading(false);
  }
  if (opts?.delayed !== false) {
    // Second pass to absorb indexer ingestion lag. Shorter cadence here
    // catches a freshly-submitted tx faster (the original 12 s wait
    // felt unresponsive after the operator hit Send/Initiate).
    setTimeout(() => { void refreshAuditLog({ delayed: false }); }, 4_000);
  }
}

function setAuditLoading(on: boolean): void {
  const el = document.getElementById('auditLoading');
  if (el) el.style.display = on ? 'inline-flex' : 'none';
}

// Session-only dismiss for the "set up private payments" nudge (× button).
let setupDismissed = false;
export function dismissSetup(): void {
  setupDismissed = true;
  const card = document.getElementById('setupCard');
  if (!card) return;
  // Animate out (slide + fade) before hiding — see .aa-leaving in styles.css.
  card.classList.add('aa-leaving');
  setTimeout(() => card.classList.remove('visible', 'aa-leaving'), 300);
}

export function renderOnchainCard(_walletName?: string): void {
  const card = document.getElementById('setupCard') as HTMLElement | null;
  const dot = document.getElementById('ocDot') as HTMLElement | null;
  const status = document.getElementById('ocStatus') as HTMLElement | null;
  const sub = document.getElementById('ocSub') as HTMLElement | null;
  const btn = document.getElementById('onboardBtn') as HTMLButtonElement | null;
  const errEl = document.getElementById('onboardErr') as HTMLElement | null;
  if (!dot || !status || !sub || !btn || !errEl) return;

  if (!state.walletConnected) {
    card?.classList.remove('visible');
    errEl.style.display = 'none';
    return;
  }

  // The setup card exists to get a new treasury activated; once that's done
  // it disappears. It's also hidden in public mode — activating private
  // payments is only relevant when the Private shield is turned on.
  card?.classList.toggle('visible', !setupDismissed && state.onboardingStatus !== 'done' && state.payMode === 'shielded');

  const v = ONBOARDING_LABELS[state.onboardingStatus];
  dot.style.background = v.dot;
  status.textContent = v.status;
  sub.textContent = v.sub;

  btn.style.display = v.button === 'hidden' ? 'none' : 'inline-block';
  btn.disabled = v.button === 'disabled';
  btn.textContent =
    state.onboardingStatus === 'error' ? 'Try again'
    : 'Activate private payments';

  if (state.onboardingError) {
    errEl.style.display = 'block';
    errEl.textContent = state.onboardingError;
  } else {
    errEl.style.display = 'none';
  }
}

export async function startOnboarding(): Promise<void> {
  if (!state.operatorAccount || state.viewingKey == null) {
    state.onboardingError = 'Privacy client not initialized — reconnect your wallet.';
    state.onboardingStatus = 'error';
    renderOnchainCard();
    return;
  }
  // A LocalSubmitter would burn a real on-chain deploy just to log a fake hash.
  if (state.submitter instanceof LocalSubmitter) {
    openM('paymasterKey');
    return;
  }
  state.onboardingError = null;
  try {
    const result = await runOnboarding(
      state.provider,
      state.operatorAccount,
      state.viewingKey,
      state.storage,
      state.submitter,
      (phase) => {
        state.onboardingStatus = phase;
        renderOnchainCard();
      },
    );
    state.payrollAddress = result.payrollAddress;
    if (state.viewingKey != null) {
      state.transfers = buildTransfersClient(state.provider, result.payrollAddress, state.viewingKey);
    }
    state.onboarded = true;
    state.onboardingStatus = 'done';
    refreshTreasuryBalance();
    void refreshAuditLog();
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    state.onboardingError = msg;
    state.onboardingStatus = 'error';
    console.error('[PriPay] onboarding failed', err);
  }
  renderOnchainCard();
}

// Shows all three pool balances at once. USDC also displays its NIS
// equivalent using the Bank of Israel USD/ILS rate.
// Tokens shown as columns in the treasury grid; order must match the cells
// declared in `index.html` (bal-s-{token} / bal-w-{token}).
const BAL_TOKENS = ['usdc', 'strk', 'eth'] as const;

function fillBalanceCell(cellId: string, formatted: string, amount: number | null, isUsdc: boolean, ilsPerUsd: number | null): void {
  const el = document.getElementById(cellId);
  if (!el) return;
  el.replaceChildren();
  const row = document.createElement('div');
  row.style.cssText = 'font-size:15px;font-weight:500';
  row.textContent = formatted;
  el.appendChild(row);
}

function clearBalanceCells(prefix: 'bal-s' | 'bal-w'): void {
  for (const t of BAL_TOKENS) {
    const el = document.getElementById(`${prefix}-${t}`);
    if (el) el.replaceChildren();
  }
}

export async function refreshTreasuryBalance(): Promise<void> {
  const sub = document.getElementById('dashTreasurySub');
  // Update Shield + Unshield + Refresh button visibility before any awaits — balance discovery can take seconds.
  const depositBtn = document.getElementById('depositBtn') as HTMLButtonElement | null;
  if (depositBtn) depositBtn.style.display = state.transfers ? 'inline-block' : 'none';
  const withdrawBtn = document.getElementById('withdrawBtn') as HTMLButtonElement | null;
  if (withdrawBtn) withdrawBtn.style.display = state.transfers ? 'inline-block' : 'none';
  const convertBtn = document.getElementById('convertBtn') as HTMLButtonElement | null;
  if (convertBtn) {
    // Convert is hidden when no executor is configured for the active network
    // — without it, the SDK swap has no contract to send fromToken to.
    // Use `visibility` instead of `display` so the grid cell it occupies on
    // the Shielded row stays reserved.
    const show = !!(state.transfers && EXECUTOR_ADDRESS);
    convertBtn.style.visibility = show ? 'visible' : 'hidden';
    // Swap shielded is disabled — kept visible but unclickable.
    convertBtn.disabled = true;
    convertBtn.style.pointerEvents = 'none';
    convertBtn.style.opacity = '0.5';
    convertBtn.style.cursor = 'not-allowed';
  }
  const refreshBtn = document.getElementById('refreshTreasuryBtn') as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.style.display = state.transfers ? 'inline-flex' : 'none';
  // Self-guards on wallet + contract presence, so it also hides the row on disconnect.
  void refreshContractBalances();
  if (!state.walletConnected) {
    clearBalanceCells('bal-s');
    clearBalanceCells('bal-w');
    fillTotalBalance(null);
    if (sub) sub.textContent = 'Connect wallet to view';
    return;
  }
  // Fire wallet-balance fetch in parallel so it doesn't block the shielded read.
  void refreshWalletBalances();
  if (!state.transfers) {
    clearBalanceCells('bal-s');
    fillTotalBalance(null);
    if (sub) sub.textContent = 'Activate private payments to see your balance';
    return;
  }
  if (sub) sub.textContent = 'Updating…';
  const balances = await fetchAllPrivacyBalances();
  if (!balances) {
    clearBalanceCells('bal-s');
    fillTotalBalance(null);
    if (sub) sub.textContent = 'Balance unavailable right now';
    return;
  }
  const ilsPerUsd = getIlsPerUsd();
  for (const b of balances) {
    fillBalanceCell(`bal-s-${b.token}`, b.formatted, b.amount, b.token === 'usdc', ilsPerUsd);
  }
  fillTotalBalance(balances);
  if (sub) sub.textContent = '';
}

// Renders "$1,234.56" with the currency symbol in the accent color
// (Metric Flow style). Value strings come from fmtUsd, never user input.
function setMoneyValue(el: HTMLElement, usd: string): void {
  el.replaceChildren();
  const curr = document.createElement('span');
  curr.className = 'curr';
  curr.textContent = '$';
  el.append(curr, document.createTextNode(usd.replace(/^\$/, '')));
}

// ── Balance donut: private vs public split by USD value ────────────────
let lastPrivate: { token: 'usdc' | 'strk' | 'eth'; amount: number }[] | null = null;
let lastWallet: Record<'usdc' | 'strk' | 'eth', number | null> | null = null;


function totalNis(balances: { token: 'usdc' | 'strk' | 'eth'; amount: number }[]): number {
  const rates = getNISRates();
  const ilsPerUsd = getIlsPerUsd();
  let total = 0;
  for (const b of balances) {
    if (!isFinite(b.amount)) continue;
    if (b.token === 'usdc' && ilsPerUsd != null) total += b.amount * ilsPerUsd;
    else if (rates[b.token] > 0) total += b.amount / rates[b.token];
  }
  return total;
}

function renderBalanceDonut(): void {
  const host = document.getElementById('balDonut');
  if (!host) return;
  const privNis = lastPrivate ? totalNis(lastPrivate) : 0;
  const wallet = lastWallet;
  const walletArr = wallet
    ? (['usdc', 'strk', 'eth'] as const).map((t) => ({ token: t, amount: wallet[t] ?? 0 }))
    : [];
  const pubNis = totalNis(walletArr);
  const total = privNis + pubNis;
  // Thin, gapless ring with the total + legend to the right (keeps the donut
  // hole clear so the total isn't cramped inside it).
  const r = 46, C = 2 * Math.PI * r, SW = 16;
  const privFrac = total > 0 ? privNis / total : 0;
  const seg = (frac: number, color: string, startDeg: number): string => {
    if (frac <= 0) return '';
    const len = frac * C;
    return `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="${SW}" stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" transform="rotate(${(startDeg - 90).toFixed(2)} 60 60)"/>`;
  };
  const ring = total <= 0
    ? `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--border)" stroke-width="${SW}"/>`
    : seg(1 - privFrac, 'var(--donut-public)', privFrac * 360) + seg(privFrac, 'var(--donut-private)', 0);
  const leg = (color: string, name: string, nis: number): string =>
    '<li style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2)">' +
      `<span style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.25)"></span>` +
      `<span>${name}</span>` +
      `<b style="margin-left:auto;color:var(--text);font-weight:500">${fmtUsd(nis)}</b>` +
    '</li>';
  host.innerHTML =
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:26px">' +
      '<div style="width:132px;height:132px;flex-shrink:0">' +
        `<svg width="132" height="132" viewBox="0 0 120 120">${ring}</svg>` +
      '</div>' +
      '<div style="flex:1;min-width:168px">' +
        '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em">Total balance</div>' +
        `<div style="font-size:25px;font-weight:600;letter-spacing:-.02em;margin:2px 0 16px"><span style="color:var(--coral)">$</span>${fmtUsd(total).replace(/^\$/, '')}</div>` +
        '<ul style="display:flex;flex-direction:column;gap:12px;list-style:none;margin:0;padding:0">' +
          leg('var(--donut-private)', 'Private', privNis) +
          leg('var(--donut-public)', 'Public', pubNis) +
        '</ul>' +
      '</div>' +
    '</div>';
}

// Hero figure: the private balance summed via the same rates the rest
// of the app uses (BoI for USD, CoinGecko for STRK/ETH), shown in USD.
function fillTotalBalance(balances: { token: 'usdc' | 'strk' | 'eth'; amount: number }[] | null): void {
  lastPrivate = balances;
  renderBalanceDonut();
  const el = document.getElementById('dashTotalNis');
  if (!el) return;
  if (!balances) { el.textContent = '—'; return; }
  const rates = getNISRates();
  const ilsPerUsd = getIlsPerUsd();
  let total = 0;
  for (const b of balances) {
    if (!isFinite(b.amount)) continue;
    if (b.token === 'usdc' && ilsPerUsd != null) total += b.amount * ilsPerUsd;
    else if (rates[b.token] > 0) total += b.amount / rates[b.token];
  }
  setMoneyValue(el, fmtUsd(total));
}

// Renders the on-chain wallet balance for each supported token alongside the
// shielded balance, so the operator can see both unshielded and shielded
// holdings at a glance.
async function refreshWalletBalances(): Promise<void> {
  if (!state.walletConnected) {
    clearBalanceCells('bal-w');
    setCachedWalletAmounts(null);
    lastWallet = null;
    renderBalanceDonut();
    return;
  }
  const formatted = await Promise.all(BAL_TOKENS.map((t) => fetchBalance(t)));
  const ilsPerUsd = getIlsPerUsd();
  const numericByToken: Record<'usdc' | 'strk' | 'eth', number | null> = { usdc: null, strk: null, eth: null };
  for (let i = 0; i < BAL_TOKENS.length; i++) {
    const text = formatted[i];
    const t = BAL_TOKENS[i];
    // Parse the numeric value from the "X.YY TOKEN" string so the USDC row
    // can show the same ILS hint as the shielded row + downstream callers
    // (topbar mini-bar, pre-flight checks) get a number to compare against.
    const num = text !== '—' ? parseFloat(text.split(' ')[0].replace(/,/g, '')) : null;
    numericByToken[t] = num;
    fillBalanceCell(`bal-w-${t}`, text, num, t === 'usdc', ilsPerUsd);
  }
  setCachedWalletAmounts(numericByToken);
  lastWallet = numericByToken;
  renderBalanceDonut();
}

// ── Contract (stranded) balance ─────────────────────────────────────────────
// Tokens left in PayrollContract by a shield that failed between the funding
// hop and the proof submission. The row stays hidden unless something is
// actually stuck there.

const contractBalances: Record<(typeof BAL_TOKENS)[number], bigint> = { usdc: 0n, strk: 0n, eth: 0n };

async function refreshContractBalances(): Promise<void> {
  const row = document.getElementById('balContractRow');
  if (!row) return;
  const payroll = state.payrollAddress;
  if (!state.walletConnected || !payroll) {
    row.style.display = 'none';
    return;
  }
  const raws = await Promise.all(BAL_TOKENS.map((t) => fetchRawBalanceOf(t, payroll)));
  let any = false;
  for (let i = 0; i < BAL_TOKENS.length; i++) {
    const t = BAL_TOKENS[i];
    const raw = raws[i] ?? 0n;
    contractBalances[t] = raw;
    if (raw > 0n) any = true;
    const el = document.getElementById(`bal-c-${t}`);
    if (el) el.textContent = raw > 0n ? formatTokenAmount(raw, t) : '';
  }
  row.style.display = any ? 'contents' : 'none';
}

function pendingContractTokens(): (typeof BAL_TOKENS)[number][] {
  return BAL_TOKENS.filter((t) => contractBalances[t] > 0n);
}

export async function shieldContractBalance(): Promise<void> {
  if (!state.operatorAccount || !state.transfers || !state.payrollAddress) {
    void showAlert('Privacy client not initialized — onboard first.'); return;
  }
  if (state.submitter instanceof LocalSubmitter) {
    void showAlert('No paymaster configured — set the paymaster key first.'); return;
  }
  const pending = pendingContractTokens();
  if (!pending.length) { void showAlert('Nothing to shield — the contract holds no tokens.'); return; }
  const desc = pending.map((t) => formatTokenAmount(contractBalances[t], t)).join(', ');
  const ok = await showConfirm(
    `Shield ${desc} held by the payroll contract into the shielded pool? The paymaster fee is taken out of the shielded amount.`,
    { title: 'Shield contract balance', okLabel: 'Shield' },
  );
  if (!ok) return;

  const operatorAccount = state.operatorAccount;
  const payrollAddress = state.payrollAddress;
  const transfers = state.transfers;
  const submitter = state.submitter;

  for (const t of pending) {
    const amount = contractBalances[t];
    const human = formatTokenAmount(amount, t);
    const op = createOperation({
      kind: 'shield',
      status: 'building_proof',
      summary: `${human} → shielded pool`,
    });
    try {
      const result = await runShieldFromContract(
        operatorAccount, payrollAddress, transfers, submitter,
        TOKENS[t].address, amount,
        (phase) => updateOperation(op.id, { status: phaseToStatus(phase) }),
      );
      updateOperation(op.id, { status: 'done', resultTx: result.submittedTx });
      void refreshAuditLog();
      setTimeout(() => { void refreshTreasuryBalance(); }, 5000);
    } catch (err) {
      console.error('[shield] failed', err);
      updateOperation(op.id, { status: 'error', error: (err as Error)?.message ?? String(err) });
    }
  }
}

export async function withdrawContractBalance(): Promise<void> {
  const operatorAccount = state.operatorAccount;
  const payroll = state.payrollAddress;
  const wallet = state.walletConnected;
  if (!operatorAccount || !payroll || !wallet) {
    void showAlert('Connect your wallet first.'); return;
  }
  const pending = pendingContractTokens();
  if (!pending.length) { void showAlert('Nothing to withdraw — the contract holds no tokens.'); return; }
  const desc = pending.map((t) => formatTokenAmount(contractBalances[t], t)).join(', ');
  const ok = await showConfirm(
    `Return ${desc} from the payroll contract to your wallet?`,
    { title: 'Withdraw to wallet', okLabel: 'Withdraw' },
  );
  if (!ok) return;

  const op = createOperation({
    kind: 'unshield',
    status: 'submitting',
    summary: `${desc} → wallet`,
  });
  try {
    const call = buildContractWithdrawCall(
      payroll,
      pending.map((t) => ({ tokenAddress: TOKENS[t].address, recipient: wallet, amount: contractBalances[t] })),
    );
    const { transaction_hash } = await operatorAccount.execute([call]);
    await operatorAccount.provider.waitForTransaction(transaction_hash);
    updateOperation(op.id, { status: 'done', resultTx: transaction_hash });
    void refreshTreasuryBalance();
  } catch (err) {
    console.error('[contract-withdraw] failed', err);
    updateOperation(op.id, { status: 'error', error: (err as Error)?.message ?? String(err) });
  }
}

export function renderStats(): void {
  const el = (id: string) => document.getElementById(id);
  const orders = state.recOrders;
  const activeOrders = orders.filter((r) => r.active !== false);
  const totalNis = activeOrders.reduce((s, r) => s + r.nis, 0);

  const payrollNis = el('dashPayrollNis');
  if (payrollNis) setMoneyValue(payrollNis, fmtUsd(totalNis));
  const payrollSub = el('dashPayrollSub');
  if (payrollSub) payrollSub.textContent = `${activeOrders.length} active order${activeOrders.length !== 1 ? 's' : ''}`;

  const profileCount = el('dashProfileCount');
  if (profileCount) profileCount.textContent = String(state.profiles.length);
  const recCount = el('dashRecCount');
  if (recCount) recCount.textContent = String(orders.length);

  // "Payments this month" stat + trend vs last month (real counts from the
  // transaction history; the chip hides when there's nothing to compare).
  const now = new Date();
  const monthPrefix = now.toISOString().slice(0, 7);
  const prev = new Date(now); prev.setMonth(prev.getMonth() - 1);
  const prevPrefix = prev.toISOString().slice(0, 7);
  const monthTx = auditTxs.filter((t) => (t.date ?? '').startsWith(monthPrefix)).length;
  const prevTx  = auditTxs.filter((t) => (t.date ?? '').startsWith(prevPrefix)).length;
  const monthEl = el('dashMonthTx');
  if (monthEl) monthEl.textContent = auditTxs.length ? String(monthTx) : '—';
  const trend = el('dashMonthTrend');
  if (trend) {
    if (prevTx > 0 && auditTxs.length) {
      const pct = Math.round(((monthTx - prevTx) / prevTx) * 100);
      trend.style.display = 'inline-flex';
      trend.className = `trend-chip ${pct >= 0 ? 'up' : 'down'}`;
      trend.textContent = `${pct >= 0 ? '+' : ''}${pct}%`;
      trend.title = `vs ${prevTx} last month`;
    } else {
      trend.style.display = 'none';
    }
  }

  renderDashExtras();
}

// The USD value of a history row, via the same NIS-anchored rates as the
// rest of the app.
function usdOf(t: { amount: number; currency?: string }): number {
  const rates = getNISRates();
  const cur = (t.currency ?? '').toLowerCase() as keyof typeof rates;
  if (!t.amount || !isFinite(t.amount) || !rates[cur]) return 0;
  return (t.amount / rates[cur]) * rates.usdc;
}

const PAYMENT_TYPES = new Set(['OneTime', 'Recurrent', 'UnshieldedTransfer']);

function nameForAddr(addr: string | undefined): string {
  if (addr) {
    try {
      const target = BigInt(addr);
      const hit = state.profiles.find((p) => { try { return BigInt(p.addr) === target; } catch { return false; } });
      if (hit) return hit.name;
    } catch { /* not hex — fall through */ }
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }
  return '—';
}

function renderDashExtras(): void {
  renderPayChart();
  renderTeamGrid();
  renderTopRecipients();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// "Payments over time" — outgoing payments summed in USD per month, last six
// months, drawn as a single-series line + soft area (no legend needed: the
// card title names the series). Data comes straight from the history.
// Catmull-Rom → cubic-bézier smoothing so the payments line curves gently
// through each month instead of hard straight segments.
function smoothLinePath(pts: [number, number][], clampMaxY = Infinity): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    // A cubic bézier stays inside the convex hull of its 4 control points, so
    // clamping the control Ys to the baseline stops the spline from
    // overshooting below zero on a flat→rising transition (values are never <0).
    const c1y = Math.min(p1[1] + (p2[1] - p0[1]) / 6, clampMaxY);
    const c2y = Math.min(p2[1] - (p3[1] - p1[1]) / 6, clampMaxY);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function renderPayChart(): void {
  const host = document.getElementById('payChart');
  if (!host) return;
  host.replaceChildren();

  const months: { key: string; label: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }), total: 0 });
  }
  for (const t of auditTxs) {
    if (!PAYMENT_TYPES.has(t.type ?? '')) continue;
    const m = months.find((x) => (t.date ?? '').startsWith(x.key));
    if (m) m.total += usdOf(t);
  }

  if (months.every((m) => m.total === 0)) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = 'No payments yet.';
    host.appendChild(empty);
    return;
  }

  // The endpoint callout text sizes the right gutter so the label sits clear
  // of the line in empty space rather than on top of it.
  const endText = `$${fmtIls(months[months.length - 1].total)}`;
  const endGutter = Math.round(endText.length * 6.6 + 18);
  // Fill the card's full width (measured) so there's no letterbox on the sides.
  const W = Math.max(Math.round(host.clientWidth) || 720, 360), H = 230, L = 44, R = Math.max(16, endGutter), T = 16, B = 30;
  const max = Math.max(...months.map((m) => m.total)) * 1.15;
  const x = (i: number) => L + (i * (W - L - R)) / (months.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.cssText = 'width:100%;display:block';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Payments per month, last six months');

  const styles = getComputedStyle(document.body);
  const cGrid = styles.getPropertyValue('--border').trim() || '#2c2c2c';
  const cText = styles.getPropertyValue('--text3').trim() || '#787571';
  const cAccent = styles.getPropertyValue('--accent').trim() || '#f4602c';

  // Recessive grid: three horizontal lines with $ tick labels.
  for (const f of [0, 0.5, 1]) {
    const v = max * f;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(L)); line.setAttribute('x2', String(W - R));
    line.setAttribute('y1', String(y(v))); line.setAttribute('y2', String(y(v)));
    line.setAttribute('stroke', cGrid); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', String(L - 8)); lbl.setAttribute('y', String(y(v) + 3.5));
    lbl.setAttribute('text-anchor', 'end'); lbl.setAttribute('font-size', '10.5');
    lbl.setAttribute('fill', cText);
    lbl.textContent = v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`;
    svg.appendChild(lbl);
  }

  const P = months.map((m, i) => [x(i), y(m.total)] as [number, number]);
  const smooth = smoothLinePath(P, y(0));
  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', `${smooth} L${x(months.length - 1)},${y(0)} L${x(0)},${y(0)} Z`);
  area.setAttribute('fill', cAccent); area.setAttribute('opacity', '0.13');
  svg.appendChild(area);
  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', smooth);
  line.setAttribute('fill', 'none'); line.setAttribute('stroke', cAccent);
  line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);

  months.forEach((m, i) => {
    // Month label on the x-axis.
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', String(x(i))); lbl.setAttribute('y', String(H - 8));
    lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('font-size', '10.5');
    lbl.setAttribute('fill', cText);
    lbl.textContent = m.label;
    svg.appendChild(lbl);
    // Generous hover target with a native tooltip carrying the value.
    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('cx', String(x(i))); hit.setAttribute('cy', String(y(m.total)));
    hit.setAttribute('r', '11'); hit.setAttribute('fill', 'transparent');
    const tip = document.createElementNS(SVG_NS, 'title');
    tip.textContent = `${m.label}: $${fmtIls(m.total)}`;
    hit.appendChild(tip);
    svg.appendChild(hit);
  });
  // Emphasized endpoint with a direct label in text ink (not series color).
  const last = months.length - 1;
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', String(x(last))); dot.setAttribute('cy', String(y(months[last].total)));
  dot.setAttribute('r', '4'); dot.setAttribute('fill', cAccent);
  svg.appendChild(dot);
  const endLbl = document.createElementNS(SVG_NS, 'text');
  endLbl.setAttribute('x', String(x(last) + 9)); endLbl.setAttribute('y', String(y(months[last].total) + 4));
  endLbl.setAttribute('text-anchor', 'start'); endLbl.setAttribute('font-size', '11.5');
  endLbl.setAttribute('font-weight', '650');
  endLbl.setAttribute('fill', styles.getPropertyValue('--text').trim() || '#f5f4f2');
  endLbl.textContent = endText;
  svg.appendChild(endLbl);

  host.appendChild(svg);
}

// "Your team" tiles — up to six people with their active monthly total.
function renderTeamGrid(): void {
  const host = document.getElementById('teamGrid');
  if (!host) return;
  host.replaceChildren();
  const people = state.profiles.slice(0, 5);
  if (people.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'team-empty';
    empty.textContent = 'No people yet';
    host.appendChild(empty);
    return;
  }
  for (const p of people) {
    let monthly = 0;
    try {
      const target = BigInt(p.addr);
      monthly = state.recOrders.reduce((s, r) => {
        if (r.active === false) return s;
        try { return BigInt(r.addr) === target ? s + r.nis : s; } catch { return s; }
      }, 0);
    } catch { /* bad address — show zero */ }
    const tile = document.createElement('div');
    tile.className = 'team-tile';
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = initials(p.name);
    const name = document.createElement('div');
    name.className = 'tt-name';
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'tt-sub';
    sub.textContent = monthly > 0 ? `${fmtUsd(monthly)} / month` : 'No payroll yet';
    tile.append(av, name, sub);
    host.appendChild(tile);
  }
  // Cap the grid at 5 people; a final tile links to the full People section.
  if (state.profiles.length > 5) {
    const more = document.createElement('div');
    more.className = 'team-tile team-more';
    more.setAttribute('role', 'button');
    more.tabIndex = 0;
    const count = document.createElement('div');
    count.className = 'tt-more-count';
    count.textContent = `+${state.profiles.length - 5}`;
    const txt = document.createElement('div');
    txt.className = 'tt-more-text';
    txt.textContent = 'See all in People';
    more.append(count, txt);
    more.addEventListener('click', () => nav('profiles'));
    host.appendChild(more);
  }
}

// "Top recipients" — outgoing payments aggregated per address, top five.
function renderTopRecipients(): void {
  const tbody = document.getElementById('topRecipients');
  if (!tbody) return;
  tbody.replaceChildren();
  const byAddr = new Map<string, { addr: string; count: number; usd: number }>();
  for (const t of auditTxs) {
    if (!PAYMENT_TYPES.has(t.type ?? '') || !t.addr) continue;
    let key: string;
    try { key = BigInt(t.addr).toString(16); } catch { key = t.addr.toLowerCase(); }
    const entry = byAddr.get(key) ?? { addr: t.addr, count: 0, usd: 0 };
    entry.count += 1;
    entry.usd += usdOf(t);
    byAddr.set(key, entry);
  }
  const top = [...byAddr.values()].sort((a, b) => b.usd - a.usd).slice(0, 5);
  if (top.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.style.cssText = 'text-align:center;padding:26px;color:var(--text3);font-size:12.5px';
    td.textContent = 'No payments yet.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const r of top) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => nav('audit'));
    const nameTd = document.createElement('td');
    nameTd.style.fontWeight = '600';
    nameTd.textContent = nameForAddr(r.addr);
    const countTd = document.createElement('td');
    countTd.textContent = String(r.count);
    const totalTd = document.createElement('td');
    totalTd.className = 'mono';
    totalTd.textContent = `$${fmtIls(r.usd)}`;
    tr.append(nameTd, countTd, totalTd);
    tbody.appendChild(tr);
  }
}

// The active pill's data-currency is the source of truth (replaces the old
// dep-token select), matching the one-time + add-order currency-pill pattern.
function getDepCurrency(): string {
  const active = document.querySelector<HTMLElement>('#depCurrencyPills .cur-pill.active');
  return active?.dataset.currency ?? 'usdc';
}

export function setDepCurrency(currency: string): void {
  document.querySelectorAll<HTMLElement>('#depCurrencyPills .cur-pill')
    .forEach((el) => el.classList.toggle('active', el.dataset.currency === currency));
  void refreshDepositBalance();
}

export async function refreshDepositBalance(): Promise<void> {
  const balEl = document.getElementById('dep-balance');
  if (!balEl) return;
  if (!state.walletConnected) {
    balEl.textContent = 'Wallet balance: —';
    return;
  }
  balEl.textContent = 'Wallet balance: loading…';
  balEl.textContent = `Wallet balance: ${await fetchBalance(getDepCurrency())}`;
}

type DepositView = 'form' | 'progress';
function setDepositView(view: DepositView): void {
  const set = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  };
  set('depFormSection', view === 'form');
  set('depFormFooter',  view === 'form');
}

// Resets the deposit modal to its form state — called whenever the modal opens.
export function prepareDepositModal(): void {
  setDepositView('form');
  const ids = ['dep-status', 'dep-err', 'dep-finalizing'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const btn = document.getElementById('depositConfirmBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = false;
}

export function submitDeposit(): void {
  const amountEl = document.getElementById('dep-amount') as HTMLInputElement | null;
  const errEl = document.getElementById('dep-err') as HTMLElement | null;
  if (!amountEl || !errEl) return;

  const showErr = (msg: string) => { errEl.style.display = 'block'; errEl.textContent = msg; };
  errEl.style.display = 'none';

  if (!state.operatorAccount || !state.transfers || !state.payrollAddress) {
    showErr('Privacy client not initialized — onboard first.'); return;
  }
  if (state.submitter instanceof LocalSubmitter) {
    showErr('No paymaster configured — set the paymaster key first.'); return;
  }

  const tokenKey = getDepCurrency() as keyof typeof TOKENS;
  const meta = TOKENS[tokenKey];
  if (!meta) { showErr(`Unknown token ${tokenKey}`); return; }
  const human = amountEl.value.trim();
  let raw: bigint;
  try {
    raw = parseDecimalAmount(human, meta.decimals);
  } catch (err) { flagInvalid('dep-amount'); showErr((err as Error).message); return; }

  const operatorAccount = state.operatorAccount;
  const payrollAddress = state.payrollAddress;
  const transfers = state.transfers;
  const submitter = state.submitter;

  // Hand the rest off to a background runner — the modal closes immediately
  // and the operator can keep using the app while shielding proceeds. Status
  // updates land in the bottom Operations panel.
  const op = createOperation({
    kind: 'shield',
    status: 'funding_contract',
    summary: `${human} ${tokenKey.toUpperCase()} → shielded pool`,
  });
  amountEl.value = '';
  closeM('deposit');
  prepareDepositModal();

  void (async () => {
    try {
      const result = await runDeposit(
        operatorAccount, payrollAddress, transfers, submitter,
        meta.address, raw,
        (phase) => updateOperation(op.id, { status: phaseToStatus(phase) }),
      );
      updateOperation(op.id, { status: 'done', resultTx: result.submittedTx });
      void refreshAuditLog();
      // Indexer takes a few seconds to ingest — refresh after a short grace.
      setTimeout(() => { void refreshTreasuryBalance(); }, 5000);
    } catch (err) {
      console.error('[shield] failed', err);
      updateOperation(op.id, { status: 'error', error: (err as Error)?.message ?? String(err) });
    }
  })();
}


// ── Withdraw (unshield) ─────────────────────────────────────────────────────
// Mirrors the Shield flow but moves funds the other direction: shielded pool
// → connected wallet. No funding step is needed since the funds are already
// in the pool. Reuses the same paymaster + SNIP-12 signature flow.

function getWdCurrency(): string {
  const active = document.querySelector<HTMLElement>('#wdCurrencyPills .cur-pill.active');
  return active?.dataset.currency ?? 'usdc';
}

export function setWdCurrency(currency: string): void {
  document.querySelectorAll<HTMLElement>('#wdCurrencyPills .cur-pill')
    .forEach((el) => el.classList.toggle('active', el.dataset.currency === currency));
  void refreshWithdrawBalance();
}

export async function refreshWithdrawBalance(): Promise<void> {
  const balEl = document.getElementById('wd-balance');
  if (!balEl) return;
  if (!state.transfers) {
    balEl.textContent = 'Shielded balance: —';
    return;
  }
  balEl.textContent = 'Shielded balance: loading…';
  balEl.textContent = `Shielded balance: ${await fetchPrivacyBalance(getWdCurrency())}`;
}

type WithdrawView = 'form' | 'progress';
function setWithdrawView(view: WithdrawView): void {
  const set = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  };
  set('wdFormSection', view === 'form');
  set('wdFormFooter',  view === 'form');
}

export function prepareWithdrawModal(): void {
  setWithdrawView('form');
  for (const id of ['wd-status', 'wd-err', 'wd-finalizing']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const btn = document.getElementById('withdrawConfirmBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = false;
}

export function submitWithdraw(): void {
  const amountEl = document.getElementById('wd-amount') as HTMLInputElement | null;
  const errEl    = document.getElementById('wd-err') as HTMLElement | null;
  if (!amountEl || !errEl) return;

  const showErr = (msg: string) => { errEl.style.display = 'block'; errEl.textContent = msg; };
  errEl.style.display = 'none';

  if (!state.operatorAccount || !state.transfers || !state.payrollAddress) {
    showErr('Privacy client not initialized — onboard first.'); return;
  }
  if (state.submitter instanceof LocalSubmitter) {
    showErr('No paymaster configured — set the paymaster key first.'); return;
  }
  if (!state.walletConnected) {
    showErr('Connect a wallet — funds are unshielded back to the connected address.'); return;
  }

  const tokenKey = getWdCurrency() as keyof typeof TOKENS;
  const meta = TOKENS[tokenKey];
  if (!meta) { showErr(`Unknown token ${tokenKey}`); return; }
  const human = amountEl.value.trim();
  let raw: bigint;
  try { raw = parseDecimalAmount(human, meta.decimals); }
  catch (err) { flagInvalid('wd-amount'); showErr((err as Error).message); return; }

  const operatorAccount = state.operatorAccount;
  const payrollAddress = state.payrollAddress;
  const transfers = state.transfers;
  const submitter = state.submitter;
  const recipient = state.walletConnected;

  const op = createOperation({
    kind: 'unshield',
    status: 'building_proof',
    summary: `${human} ${tokenKey.toUpperCase()} → wallet`,
  });
  amountEl.value = '';
  closeM('withdraw');
  prepareWithdrawModal();

  void (async () => {
    try {
      const result = await runWithdraw(
        operatorAccount, payrollAddress, transfers, submitter,
        meta.address, recipient, raw,
        (phase) => updateOperation(op.id, { status: phaseToStatus(phase) }),
      );
      updateOperation(op.id, { status: 'done', resultTx: result.submittedTx });
      void refreshAuditLog();
      setTimeout(() => { void refreshTreasuryBalance(); }, 5000);
    } catch (err) {
      console.error('[unshield] failed', err);
      updateOperation(op.id, { status: 'error', error: (err as Error)?.message ?? String(err) });
    }
  })();
}

// ── Convert (in-pool swap) ───────────────────────────────────────────────────
// SDK swap = withdraw fromToken to the executor contract + open a note in
// toToken that the executor fills. Same paymaster + SNIP-12 flow.

function getSwFromCurrency(): string {
  const active = document.querySelector<HTMLElement>('#swFromPills .cur-pill.active');
  return active?.dataset.currency ?? 'usdc';
}

function getSwToCurrency(): string {
  const active = document.querySelector<HTMLElement>('#swToPills .cur-pill.active');
  return active?.dataset.currency ?? 'strk';
}

export function setSwFromCurrency(currency: string): void {
  document.querySelectorAll<HTMLElement>('#swFromPills .cur-pill')
    .forEach((el) => el.classList.toggle('active', el.dataset.currency === currency));
  void refreshSwapBalance();
}

export function setSwToCurrency(currency: string): void {
  document.querySelectorAll<HTMLElement>('#swToPills .cur-pill')
    .forEach((el) => el.classList.toggle('active', el.dataset.currency === currency));
}

export async function refreshSwapBalance(): Promise<void> {
  const balEl = document.getElementById('sw-balance');
  if (!balEl) return;
  if (!state.transfers) {
    balEl.textContent = 'Shielded balance: —';
    return;
  }
  balEl.textContent = 'Shielded balance: loading…';
  balEl.textContent = `Shielded balance: ${await fetchPrivacyBalance(getSwFromCurrency())}`;
}

type SwapView = 'form' | 'progress';
function setSwapView(view: SwapView): void {
  const set = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'flex' : 'none';
  };
  set('swFormSection', view === 'form');
  set('swFormFooter',  view === 'form');
}

export function prepareConvertModal(): void {
  setSwapView('form');
  for (const id of ['sw-status', 'sw-err', 'sw-finalizing']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const btn = document.getElementById('convertConfirmBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = false;
}

export function submitSwap(): void {
  const amountEl = document.getElementById('sw-amount') as HTMLInputElement | null;
  const errEl    = document.getElementById('sw-err') as HTMLElement | null;
  if (!amountEl || !errEl) return;

  const showErr = (msg: string) => { errEl.style.display = 'block'; errEl.textContent = msg; };
  errEl.style.display = 'none';

  if (!EXECUTOR_ADDRESS) {
    showErr('Swap executor not configured for this network. Set EXECUTOR_ADDRESS in network-config.ts.'); return;
  }
  if (!state.operatorAccount || !state.transfers || !state.payrollAddress) {
    showErr('Privacy client not initialized — onboard first.'); return;
  }
  if (state.submitter instanceof LocalSubmitter) {
    showErr('No paymaster configured — set the paymaster key first.'); return;
  }

  const fromKey = getSwFromCurrency() as keyof typeof TOKENS;
  const toKey   = getSwToCurrency()   as keyof typeof TOKENS;
  if (fromKey === toKey) { showErr('Pick a different "To" token than the "From" token.'); return; }
  const fromMeta = TOKENS[fromKey];
  const toMeta   = TOKENS[toKey];
  if (!fromMeta || !toMeta) { showErr('Unknown token selection.'); return; }
  const human = amountEl.value.trim();
  let raw: bigint;
  try { raw = parseDecimalAmount(human, fromMeta.decimals); }
  catch (err) { flagInvalid('sw-amount'); showErr((err as Error).message); return; }

  const operatorAccount = state.operatorAccount;
  const payrollAddress = state.payrollAddress;
  const transfers = state.transfers;
  const submitter = state.submitter;
  const executor = EXECUTOR_ADDRESS;

  const op = createOperation({
    kind: 'convert',
    status: 'building_proof',
    summary: `${human} ${fromKey.toUpperCase()} → ${toKey.toUpperCase()}`,
  });
  amountEl.value = '';
  closeM('convert');
  prepareConvertModal();

  void (async () => {
    try {
      const result = await runSwap(
        operatorAccount, payrollAddress, transfers, submitter,
        fromMeta.address, raw, toMeta.address, executor,
        (phase) => updateOperation(op.id, { status: phaseToStatus(phase) }),
      );
      updateOperation(op.id, { status: 'done', resultTx: result.submittedTx });
      void refreshAuditLog();
      setTimeout(() => { void refreshTreasuryBalance(); }, 5000);
    } catch (err) {
      console.error('[convert] failed', err);
      updateOperation(op.id, { status: 'error', error: (err as Error)?.message ?? String(err) });
    }
  })();
}

// Rejects more fractional digits than the token supports to avoid silent truncation.
function parseDecimalAmount(input: string, decimals: number): bigint {
  if (!input || !/^\d+(\.\d+)?$/.test(input)) {
    throw new Error('Amount must be a positive decimal number.');
  }
  const [whole, frac = ''] = input.split('.');
  if (frac.length > decimals) {
    throw new Error(`Amount has more than ${decimals} fractional digits.`);
  }
  const padded = (frac + '0'.repeat(decimals - frac.length));
  const value = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(padded || '0');
  if (value <= 0n) throw new Error('Amount must be positive.');
  return value;
}
