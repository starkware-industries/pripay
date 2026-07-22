import { state, auditTxs, setTxMetadata, addUnshieldedTx } from '../core/state';
import { createOperation, updateOperation, phaseToStatus } from '../core/operations';
import { refreshAuditLog } from './dashboard';
import { showAlert } from '../core/dialogs';
import { validAddr, TOKENS } from '../core/validators';
import { fmtToken, fmtUsd, initials, nisToToken, buildCopyableValue, SHIELD_SVG, flagInvalid } from '../core/utils';
import { getCachedPoolAmount, getCachedWalletAmount } from '../core/privacy-balance';
import { getNISRates } from '../core/prices';
import { runTransferToOne, TransferCancelledError } from '../sdk_integration/run-transfer';
import { runUnshieldedTransfer } from '../sdk_integration/run-unshielded';
import { LocalSubmitter } from '../sdk_integration/submitter';
import { refreshTreasuryBalance } from './dashboard';
import type { AuditTx, NISRates, TransferMode } from '../core/types';

export function renderOnetime(): void {
  if (state.otRecipientName) {
    const addr = (document.getElementById('otAddr') as HTMLInputElement)?.value || '';
    setOtRecipient(state.otRecipientName, addr);
  }
  calcOT();
  renderRecentTransfers();
  void refreshRoughFeeEstimate();
}

// Rolling-baseline paymaster fee. Updated after each successful transfer
// (with the real estimate the paymaster reported). null on first ever
// transfer in this session — the Summary card shows "—" until we have a
// paymaster sample. The wallet's own authorization is now an off-chain
// SNIP-12 signature, which costs no gas, so the paymaster fee is the only
// cost to surface.
let lastPaymasterFeeFri: bigint | null = null;

// Render fri (10^-18 STRK) as a human-readable STRK string trimmed to 6 dp.
function formatStrk(fri: bigint): string {
  const whole = fri / 10n ** 18n;
  const frac = fri % 10n ** 18n;
  if (frac === 0n) return `${whole} STRK`;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr} STRK` : `${whole} STRK`;
}

function setSummaryFee(text: string): void {
  const el = document.getElementById('otSumGas');
  if (el) el.textContent = text;
}

function refreshRoughFeeEstimate(): void {
  if (!state.operatorAccount || !state.payrollAddress) {
    setSummaryFee('—');
    return;
  }
  // Authorization is a gas-free SNIP-12 signature; the paymaster fee (sampled
  // from the last successful transfer) is the only on-chain cost.
  setSummaryFee(lastPaymasterFeeFri != null ? `≈ ${formatStrk(lastPaymasterFeeFri)}` : '—');
}

// Builds the "Recent transfers" table from the chain-backed audit log,
// scoped to outgoing payments (shielded sent + unshielded sent). The
// audit log is refreshed after every successful run-transfer and again
// 12s later (indexer-lag absorption), and emits an 'audit-updated'
// event that main.ts uses to re-call renderOnetime. Single render path.
export function renderRecentTransfers(): void {
  const tbody = document.getElementById('otHistory');
  if (!tbody) return;
  const rows = auditTxs.filter((t) => t.type === 'OneTime' || t.type === 'UnshieldedTransfer');
  tbody.replaceChildren(...rows.map(buildRecentRow));
}

function buildRecentRow(t: AuditTx): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const tdDate = document.createElement('td');
  tdDate.className = 'mono';
  tdDate.style.whiteSpace = 'nowrap';
  tdDate.textContent = t.time ? `${t.date} ${t.time}` : t.date;
  const tdName = document.createElement('td');
  tdName.style.fontSize = '12px';
  tdName.style.fontWeight = '500';
  // Fixed-width shield slot so unshielded rows line up under shielded
  // ones (same alignment trick the audit + profile tx tables use).
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:5px';
  const slot = document.createElement('span');
  slot.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;font-size:11px;line-height:1';
  if (t.type === 'OneTime') {
    slot.innerHTML = SHIELD_SVG;
    slot.title = 'Private — the amount is hidden on-chain';
    slot.style.color = '#b45309';  // matches the 'Sent' badge color
  }
  wrap.appendChild(slot);
  const name = document.createElement('span');
  name.textContent = resolveDisplayName(t);
  wrap.appendChild(name);
  tdName.appendChild(wrap);
  const tdAmount = document.createElement('td');
  tdAmount.className = 'mono';
  tdAmount.textContent = fmtToken(t.amount, t.currency.toLowerCase());
  tr.append(tdDate, tdName, tdAmount);
  return tr;
}

// Profile name for a raw 0x address, BigInt-normalized so zero-padding
// differences (chain vs user input) still resolve to the same profile.
function lookupNameByAddr(addr: string): string | null {
  let target: bigint;
  try { target = BigInt(addr); } catch { return null; }
  const match = state.profiles.find((p) => {
    try { return BigInt(p.addr) === target; } catch { return false; }
  });
  return match?.name ?? null;
}

function resolveDisplayName(t: AuditTx): string {
  if (t.name) return t.name;
  // BigInt equality normalizes zero-padding — `0x07b1…` (chain-padded) and
  // `0x7b1…` (user-typed, no leading zero) match the same profile.
  let target: bigint;
  try { target = BigInt(t.addr); } catch { return t.addr.slice(0, 8) + '…'; }
  const match = state.profiles.find((p) => {
    try { return BigInt(p.addr) === target; } catch { return false; }
  });
  if (match) return match.name;
  return t.addr.slice(0, 8) + '…';
}

// The "Transferred amount" rectangle's currency dropdown is the source of
// truth for the payment currency (replaces the old pill row).
export function getOtCurrency(): string {
  const sel = document.getElementById('otSendCurrency') as HTMLSelectElement | null;
  return sel?.value ?? 'usdc';
}
export function setOtCurrency(currency: string): void {
  const sel = document.getElementById('otSendCurrency') as HTMLSelectElement | null;
  if (sel) sel.value = currency;
  calcOT();
}

// Active mode pill on the one-time page. Default 'shielded' to preserve
// the legacy single-pill UI's behaviour.
export function getOtMode(): TransferMode {
  const active = document.querySelector<HTMLElement>('#otModePills .cur-pill.active');
  return (active?.dataset.mode as TransferMode | undefined) ?? 'shielded';
}
export function setOtMode(mode: TransferMode): void {
  document.querySelectorAll<HTMLElement>('#otModePills .cur-pill')
    .forEach((el) => el.classList.toggle('active', el.dataset.mode === mode));
  calcOT();
}

export function setOtRecipient(name: string, addr: string): void {
  state.otRecipientName = name;
  // Hide the manual address-input row — the picked recipient card already
  // shows the address; keeping the textbox open invites confusion about
  // which value is authoritative.
  const manual = document.getElementById('otManualAddr');
  if (manual) manual.style.display = 'none';
  const tag = document.getElementById('otRecipientTag');
  if (!tag) return;

  tag.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:10px';

  const av = document.createElement('div');
  av.className = 'avatar';
  av.style.cssText = 'width:34px;height:34px;font-size:12px;flex-shrink:0';
  av.textContent = initials(name);

  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0';
  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:13px;font-weight:500;color:var(--text1);margin-bottom:2px';
  nameEl.textContent = name;
  const addrEl = document.createElement('div');
  addrEl.style.cssText = 'font-family:monospace;font-size:11px;color:var(--text3);word-break:break-all';
  addrEl.textContent = addr.length > 22 ? addr.slice(0, 12) + '…' + addr.slice(-6) : addr;
  info.append(nameEl, addrEl);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'icon-btn';
  clearBtn.id = 'clearOtRecipientBtn';
  clearBtn.style.cssText = 'flex-shrink:0;font-size:18px;line-height:1';
  clearBtn.title = 'Choose someone else';
  clearBtn.textContent = '×';
  clearBtn.addEventListener('click', clearOtRecipient);

  tag.replaceChildren(av, info, clearBtn);
}

export function clearOtRecipient(): void {
  state.otRecipientName = null;
  const tag = document.getElementById('otRecipientTag');
  if (tag) tag.style.display = 'none';
  // Re-show the manual address row in its original flex layout (input + button
  // side-by-side); an empty display value falls back to block and stacks them.
  const manual = document.getElementById('otManualAddr');
  if (manual) manual.style.display = 'flex';
  (document.getElementById('otAddr') as HTMLInputElement).value = '';
  calcOT();
}

export function onOtAddrInput(): void {
  const addr  = (document.getElementById('otAddr') as HTMLInputElement).value.trim();
  const match = state.profiles.find(p => p.addr.toLowerCase() === addr.toLowerCase());
  if (match) setOtRecipient(match.name, match.addr);
  else {
    state.otRecipientName = null;
    const tag = document.getElementById('otRecipientTag');
    if (tag) tag.style.display = 'none';
  }
  calcOT();
}

// Converts the typed amount + its unit (₪/USDC/STRK/ETH) to the payment
// currency. NIS is the universal bridge: any unit goes through NIS to get to
// any other unit. When unit === paymentCurrency, no conversion is needed.
function convertAmount(input: number, inputUnit: string, paymentCurrency: string, rates: NISRates): { nis: number; crypto: number } {
  const nis = inputUnit === 'nis'
    ? input
    : input / rates[inputUnit as keyof NISRates];
  const crypto = inputUnit === paymentCurrency
    ? input
    : nisToToken(nis, paymentCurrency, rates);
  return { nis, crypto };
}

function getInputUnit(): string {
  return (document.getElementById('otAmountUnit') as HTMLSelectElement | null)?.value ?? 'nis';
}

export function calcOT(): void {
  const rates  = getNISRates();
  const payment = getOtCurrency();
  const inputUnit = getInputUnit();
  const addr = (document.getElementById('otAddr') as HTMLInputElement)?.value.trim() || '';

  const input = parseFloat((document.getElementById('otCryptoAmt') as HTMLInputElement)?.value) || 0;
  const { nis, crypto } = convertAmount(input, inputUnit, payment, rates);

  // Mirror the converted amount into the readonly "Transferred amount" box.
  // fmtToken returns "1.2345 STRK"; strip the trailing symbol since the
  // dropdown to the right already shows the currency.
  const sendAmt = document.getElementById('otSendAmt') as HTMLInputElement | null;
  if (sendAmt) {
    sendAmt.value = crypto > 0 ? fmtToken(crypto, payment).replace(/\s+[A-Za-z₪]+$/, '') : '';
  }

  const sumAddr  = document.getElementById('otSumAddr');
  const sumNis   = document.getElementById('otSumNis');
  const sumCrypto = document.getElementById('otSumCrypto');
  const sumDesc  = document.getElementById('otSumDesc');
  if (sumAddr) {
    if (addr) {
      // Show the recipient's name when known; fall back to a plain truncated
      // address (no hover reveal, no monospace) when they're not saved.
      const name = state.otRecipientName ?? lookupNameByAddr(addr);
      const el = document.createElement('span');
      if (name) {
        el.style.cssText = 'font-size:13px;font-weight:500;color:var(--text)';
        el.textContent = name;
      } else {
        el.style.cssText = 'font-size:12px;color:var(--text3)';
        el.textContent = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      }
      sumAddr.replaceChildren(el);
    } else {
      sumAddr.textContent = '—';
    }
  }
  if (sumNis) { sumNis.textContent = nis > 0 ? '(≈ ' + fmtUsd(nis) + ')' : ''; sumNis.style.display = nis > 0 ? 'inline' : 'none'; }
  if (sumCrypto) {
    sumCrypto.textContent  = crypto > 0 ? fmtToken(crypto, payment) : '—';
    sumCrypto.style.cssText = crypto > 0 ? 'font-weight:500;color:var(--accent)' : 'color:var(--text3)';
  }
  if (sumDesc)   sumDesc.textContent   = (document.getElementById('otDesc') as HTMLInputElement)?.value.trim() || '—';
  const sumMode = document.getElementById('otSumMode');
  if (sumMode) {
    const m = getOtMode();
    sumMode.textContent = m === 'shielded' ? 'Private' : 'Public';
    sumMode.style.color = m === 'shielded' ? 'var(--accent)' : 'var(--text1)';
  }

  updateShieldedBalanceHint(payment, crypto);
}

// Shows the relevant balance (shielded pool or wallet) for the chosen
// transfer mode + currency, and turns red + disables the Send button
// when the typed amount exceeds it. Pre-flight catch for "not enough
// funds" before the operator hits Send. Mirrors the shortfall message
// under the button as a red box so the operator sees it next to the CTA.
function updateShieldedBalanceHint(payment: string, crypto: number): void {
  const el = document.getElementById('otShieldedBal');
  const summary = document.getElementById('otShieldedBalSummary');
  const btn = document.getElementById('otBtn') as HTMLButtonElement | null;
  const mode = getOtMode();
  const available = mode === 'shielded' ? getCachedPoolAmount(payment) : getCachedWalletAmount(payment);
  const label = mode === 'shielded' ? 'Private balance' : 'Wallet';
  const enableBtn = (enable: boolean) => {
    if (!btn) return;
    btn.disabled = !enable;
    btn.style.opacity = enable ? '' : '0.45';
    btn.style.cursor  = enable ? '' : 'not-allowed';
  };
  const hideSummary = () => { if (summary) summary.style.display = 'none'; };
  if (!el) return;
  if (available == null) {
    el.style.display = 'none';
    hideSummary();
    enableBtn(true);
    return;
  }
  const symbol = payment.toUpperCase();
  const balStr = fmtToken(available, payment).replace(/\s+[A-Za-z₪]+$/, '');
  const insufficient = crypto > available;
  // Public mode: hide the informational "Wallet: X available" note — only
  // surface the red shortfall warning when funds are actually insufficient.
  if (!insufficient && mode === 'unshielded') {
    el.style.display = 'none';
  } else {
    el.style.display = 'block';
    el.style.color = insufficient ? 'var(--danger)' : 'var(--text3)';
    el.textContent = insufficient
      ? `${label} has ${balStr} ${symbol} — short ${fmtToken(crypto - available, payment).replace(/\s+[A-Za-z₪]+$/, '')} ${symbol}`
      : `${label}: ${balStr} ${symbol} available`;
  }
  enableBtn(!insufficient);
  if (summary) {
    if (insufficient) {
      summary.style.display = 'block';
      summary.textContent = `${label} short on ${symbol} — ${label.toLowerCase()} has ${balStr}, transfer needs ${fmtToken(crypto, payment).replace(/\s+[A-Za-z₪]+$/, '')} (short ${fmtToken(crypto - available, payment).replace(/\s+[A-Za-z₪]+$/, '')}). ${mode === 'shielded' ? 'Deposit more before sending.' : 'Top up the wallet or switch to a private payment.'}`;
    } else {
      summary.style.display = 'none';
    }
  }
}

export function doOneTime(): void {
  const addr = (document.getElementById('otAddr') as HTMLInputElement).value.trim();
  const errEl = document.getElementById('otAddrErr');
  if (!validAddr(addr)) { flagInvalid('otAddr'); if (errEl) errEl.style.display = 'block'; return; }
  if (errEl) errEl.style.display = 'none';

  const token = getOtCurrency();
  const meta = TOKENS[token as keyof typeof TOKENS];
  if (!meta) { void showAlert(`Unknown token: ${token}`); return; }
  const input = parseFloat((document.getElementById('otCryptoAmt') as HTMLInputElement).value);
  if (!input || input <= 0) { flagInvalid('otCryptoAmt'); return; }
  // The amount input may be in NIS or another currency; convert to the
  // payment currency before submitting.
  const { crypto } = convertAmount(input, getInputUnit(), token, getNISRates());
  if (!isFinite(crypto) || crypto <= 0) { void showAlert('Conversion failed — check the unit selector and amount.'); return; }
  if (!state.walletConnected) { void showAlert('Connect wallet first'); return; }

  const mode = getOtMode();
  if (mode === 'shielded' && (!state.operatorAccount || !state.transfers || !state.payrollAddress)) {
    void showAlert('Activate private payments first — press “Activate private payments” on the Dashboard.'); return;
  }
  if (mode === 'shielded' && state.submitter instanceof LocalSubmitter) {
    void showAlert('Payments can’t be sent yet — the fee account isn’t set up. Ask your admin to configure it in Settings.'); return;
  }
  // Unshielded only needs the connected wallet — it signs and sends a
  // direct ERC20 transfer.
  if (mode === 'unshielded' && !state.operatorAccount) {
    void showAlert('Connect a wallet first.'); return;
  }

  const rawAmount = toRawAmount(crypto, meta.decimals);
  if (rawAmount <= 0n) { void showAlert('Amount rounds to zero — pick a larger amount.'); return; }

  // Belt-and-suspenders: the Send button is already disabled when the
  // relevant source can't cover the amount (see updateShieldedBalanceHint),
  // but a stale cache could race; refuse the tx silently to keep doomed
  // proofs / signatures out of the queue.
  const available = mode === 'shielded' ? getCachedPoolAmount(token) : getCachedWalletAmount(token);
  if (available != null && crypto > available) return;

  const recipientName = state.otRecipientName ?? state.profiles.find((p) => {
    try { return BigInt(p.addr) === BigInt(addr); } catch { return false; }
  })?.name ?? addr.slice(0, 10) + '…';
  const inputUnit = getInputUnit() as 'nis' | 'usdc' | 'strk' | 'eth';
  (document.getElementById('otCryptoAmt') as HTMLInputElement).value = '';

  if (mode === 'unshielded') {
    runUnshieldedOneTime(addr, token, meta, rawAmount, crypto, recipientName, inputUnit, input);
  } else {
    runShieldedOneTime(addr, token, meta, rawAmount, crypto, recipientName, inputUnit, input);
  }
}

function runShieldedOneTime(
  addr: string,
  token: string,
  meta: typeof TOKENS[keyof typeof TOKENS],
  rawAmount: bigint,
  crypto: number,
  recipientName: string,
  inputUnit: 'nis' | 'usdc' | 'strk' | 'eth',
  input: number,
): void {
  const operatorAccount = state.operatorAccount!;
  const payrollAddress = state.payrollAddress!;
  const transfers = state.transfers!;
  const submitter = state.submitter;

  const op = createOperation({
    kind: 'transfer',
    status: 'building_proof',
    summary: `${crypto} ${token.toUpperCase()} → ${recipientName}`,
  });
  showStatus('Queued — track progress in the Operations panel below.', 'info');
  setTimeout(() => {
    const st = document.getElementById('otStatus');
    if (st) st.style.display = 'none';
  }, 5000);

  void (async () => {
    try {
      const result = await runTransferToOne(
        operatorAccount, payrollAddress, transfers, submitter,
        addr, meta.address, rawAmount,
        (phase) => updateOperation(op.id, { status: phaseToStatus(phase) }),
        undefined,
      );

      setTxMetadata(result.submittedTx, { amountUnit: inputUnit, cryptoAmount: input });
      if (result.paymasterFeeFri != null) lastPaymasterFeeFri = result.paymasterFeeFri;

      updateOperation(op.id, { status: 'done', resultTx: result.submittedTx, onConfirmFee: undefined });
      refreshTreasuryBalance();
      void refreshAuditLog();
      void refreshRoughFeeEstimate();
    } catch (err) {
      if (err instanceof TransferCancelledError) {
        updateOperation(op.id, { status: 'cancelled', onConfirmFee: undefined });
      } else {
        const msg = (err as Error)?.message ?? String(err);
        console.error('[onetime] transfer failed', err);
        updateOperation(op.id, { status: 'error', error: msg, onConfirmFee: undefined });
      }
    }
  })();
}

function runUnshieldedOneTime(
  addr: string,
  token: string,
  meta: typeof TOKENS[keyof typeof TOKENS],
  rawAmount: bigint,
  crypto: number,
  recipientName: string,
  inputUnit: 'nis' | 'usdc' | 'strk' | 'eth',
  input: number,
): void {
  const operatorAccount = state.operatorAccount!;
  const description = (document.getElementById('otDesc') as HTMLInputElement)?.value.trim() || undefined;

  const op = createOperation({
    kind: 'transfer',
    status: 'building_proof',
    summary: `${crypto} ${token.toUpperCase()} → ${recipientName} · unshielded`,
  });
  showStatus('Queued — wallet signature required.', 'info');
  setTimeout(() => {
    const st = document.getElementById('otStatus');
    if (st) st.style.display = 'none';
  }, 5000);

  void (async () => {
    try {
      const result = await runUnshieldedTransfer(
        operatorAccount,
        { recipient: addr, tokenAddress: meta.address, amount: rawAmount },
        (_phase) => updateOperation(op.id, { status: 'submitting' }),
      );

      // Record locally so the audit log surfaces it before the indexer
      // catches up (and to keep description/recipient-name context).
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      addUnshieldedTx({
        tx: result.submittedTx,
        date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        addr,
        token: token.toUpperCase() as 'USDC' | 'STRK' | 'ETH',
        amount: crypto,
        description,
        amountUnit: inputUnit,
        cryptoAmount: input,
      });
      setTxMetadata(result.submittedTx, { amountUnit: inputUnit, cryptoAmount: input });

      updateOperation(op.id, { status: 'done', resultTx: result.submittedTx, onConfirmFee: undefined });
      refreshTreasuryBalance();
      void refreshAuditLog();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      // User-rejected wallet sign = cancellation; everything else is error.
      const cancelled = /reject|cancel|denied|user abort/i.test(msg);
      if (cancelled) {
        updateOperation(op.id, { status: 'cancelled', onConfirmFee: undefined });
      } else {
        console.error('[onetime] unshielded transfer failed', err);
        updateOperation(op.id, { status: 'error', error: msg, onConfirmFee: undefined });
      }
    }
  })();
}

// Status alert helper. Uses textContent for the message (preventing HTML
// injection from error strings) and replaceChildren to avoid leaving prior
// status nodes attached.
function showStatus(message: string, type: 'info' | 'success' | 'err'): void {
  const st = document.getElementById('otStatus');
  if (!st) return;
  st.style.display = 'block';
  st.replaceChildren();
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  if (type === 'info') {
    const spin = document.createElement('div');
    spin.className = 'spin';
    div.appendChild(spin);
  }
  div.appendChild(document.createTextNode(message));
  st.appendChild(div);
}


// Opens the confirm-fee modal and resolves once the user picks. true →
function toRawAmount(human: number, decimals: number): bigint {
  const scaled = Math.round(human * Math.pow(10, decimals));
  return BigInt(scaled);
}
