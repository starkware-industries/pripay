import { state, saveProfiles, saveRecOrders, markRecurrentTx, addUnshieldedTx } from '../core/state';
import { pageSlice, renderPager } from '../core/pagination';
import { showAlert, showConfirm } from '../core/dialogs';
import { createOperation, updateOperation, phaseToStatus } from '../core/operations';
import { openM, closeM } from '../core/modals';
import { validAddr, burnAddr, TOKENS } from '../core/validators';
import { fmtToken, nisToToken, fmtIls, fmtUsd, initials, flagInvalid } from '../core/utils';
import { getNISRates } from '../core/prices';
import { getCachedPoolAmount, getCachedWalletAmount } from '../core/privacy-balance';
import { runMultiPay } from '../sdk_integration/run-multipay';
import { runUnshieldedMultipay, buildUnshieldedTransferCalls } from '../sdk_integration/run-unshielded';
import { LocalSubmitter } from '../sdk_integration/submitter';
import { isUserRegisteredInPool } from '../sdk_integration/registration-probe';
import { refreshTreasuryBalance, refreshAuditLog } from './dashboard';
import type { RecOrder, Profile } from '../core/types';

const selectedIndices = new Set<number>();
let recStatusFilter: 'all' | 'active' | 'inactive' = 'all';
let recPage = 1;

// The order's amount in its settlement currency. When the operator typed the
// amount directly in that crypto currency, use it verbatim: reconstituting it
// from the stored NIS budget round-trips through a live FX rate that may have
// moved since the order was saved, drifting e.g. 2 STRK to 1.97. NIS-budget
// orders (and the rare case where the typed unit differs from the settlement
// currency) still convert through the live rate.
function orderCryptoAmount(r: RecOrder, rates: ReturnType<typeof getNISRates>): number {
  if (r.amountUnit && r.amountUnit !== 'nis' && r.cryptoAmount != null
      && r.amountUnit === r.currency.toLowerCase()) {
    return r.cryptoAmount;
  }
  return nisToToken(r.nis, r.currency.toLowerCase(), rates);
}

// 3s per address — long enough for a slow RPC, short enough that an
// unreachable node doesn't stall the whole batch import.
const PROBE_TIMEOUT_MS = 3000;

// Probes the privacy-pool registry for each unique address in the given
// orders and writes the result onto order.registered. Idempotent for orders
// already marked 'yes' or 'no'; re-probes anything still undefined or 'unknown'.
// On timeout / RPC error, marks 'unknown' (rendered without a badge).
export async function probeRegistrationsForOrders(orders: RecOrder[]): Promise<void> {
  const needsProbe = orders.filter((o) => o.registered === undefined || o.registered === 'unknown');
  if (needsProbe.length === 0) return;
  const uniqueAddrs = Array.from(new Set(needsProbe.map((o) => o.addr).filter(validAddr)));
  const probe = (addr: string): Promise<'yes' | 'no' | 'unknown'> => {
    const timeout = new Promise<'unknown'>((res) => setTimeout(() => res('unknown'), PROBE_TIMEOUT_MS));
    const call = isUserRegisteredInPool(state.provider, addr)
      .then((ok) => (ok ? 'yes' : 'no') as 'yes' | 'no')
      .catch(() => 'unknown' as const);
    return Promise.race([call, timeout]);
  };
  const settled = await Promise.allSettled(uniqueAddrs.map(probe));
  const byAddr = new Map<string, 'yes' | 'no' | 'unknown'>();
  uniqueAddrs.forEach((a, i) => {
    const r = settled[i];
    byAddr.set(a, r.status === 'fulfilled' ? r.value : 'unknown');
  });
  for (const o of orders) {
    const v = byAddr.get(o.addr);
    if (v) o.registered = v;
  }
}

function isActive(r: { active?: boolean }): boolean {
  return r.active !== false;
}

// BigInt-normalized profile lookup by Starknet address. Returns the first
// profile that shares the address, or null when no profile exists.
function findProfileForAddr(addr: string): Profile | null {
  let target: bigint;
  try { target = BigInt(addr); } catch { return null; }
  for (const p of state.profiles) {
    try { if (BigInt(p.addr) === target) return p; } catch { }
  }
  return null;
}

// Feather "user" icon, built via createElementNS so the XSS-hook leaves it
// alone (the equivalent innerHTML SVG strings on the other row buttons
// pre-date the hook).
function userIconSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '7');
  circle.setAttribute('r', '4');
  svg.append(path, circle);
  return svg;
}

export function setRecStatusFilter(value: 'all' | 'active' | 'inactive'): void {
  recStatusFilter = value;
  recPage = 1;
  document.querySelectorAll<HTMLElement>('#recStatusFilter [data-rec-status]')
    .forEach((el) => el.classList.toggle('active', el.dataset.recStatus === value));
  renderRec();
}

// Builds a row via createElement/textContent so user-supplied fields
// (name, description, etc.) can't inject markup. SVG icons are the only
// HTML literals — they're static so innerHTML is safe.
function buildRecRow(r: import('../core/types').RecOrder, i: number, rates: ReturnType<typeof getNISRates>): HTMLTableRowElement {
  const active = isActive(r);
  const tr = document.createElement('tr');
  if (!active) tr.style.opacity = '0.55';

  const td = (text: string, className?: string, fontSize?: string, color?: string, family?: string): HTMLTableCellElement => {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (fontSize) cell.style.fontSize = fontSize;
    if (color) cell.style.color = color;
    if (family) cell.style.fontFamily = family;
    cell.textContent = text;
    return cell;
  };
  const tdBadge = (text: string, cls: string): HTMLTableCellElement => {
    const cell = document.createElement('td');
    const span = document.createElement('span');
    span.className = `badge ${cls}`;
    span.textContent = text;
    cell.appendChild(span);
    return cell;
  };
  const tdBoldName = (name: string): HTMLTableCellElement => {
    const cell = document.createElement('td');
    cell.style.fontWeight = '600';
    cell.textContent = name;
    return cell;
  };

  // Checkbox — always selectable so the operator can re-activate or
  // delete inactive orders in bulk. The Initiate path still filters
  // inactive rows out, so a selection of inactive rows can't trigger
  // an accidental run.
  const checkCell = document.createElement('td');
  checkCell.className = 'check-col';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'rec-cb row-check';
  cb.dataset.idx = String(i);
  cb.checked = selectedIndices.has(i);
  checkCell.appendChild(cb);
  tr.appendChild(checkCell);
  // Trimmed to essentials — Address, ≈ Crypto, Type, Last paid and
  // Description live in the order's Edit modal.
  tr.appendChild(tdBoldName(r.name));
  tr.appendChild(td(fmtUsd(Number(r.nis)), 'mono'));
  tr.appendChild(tdBadge(r.period, 'b-gray'));
  tr.appendChild(td(nextDueDate(r) || '—', 'mono'));
  tr.appendChild(tdBadge(active ? 'Active' : 'Inactive', active ? 'b-green' : 'b-gray'));

  // Action buttons
  const actionsCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '4px';

  // View-profile shortcut. Only rendered when a profile exists for the
  // order's address — orders entered manually can pre-date the profile.
  const profile = findProfileForAddr(r.addr);
  if (profile) {
    const viewBtn = document.createElement('button');
    viewBtn.className = 'icon-btn';
    viewBtn.dataset.viewProfile = profile.id;
    viewBtn.title = 'View profile';
    viewBtn.appendChild(userIconSvg());
    actions.appendChild(viewBtn);
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'icon-btn';
  toggleBtn.dataset.toggleOrder = String(i);
  toggleBtn.title = active ? 'Mark inactive' : 'Activate';
  toggleBtn.innerHTML = active
    ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  actions.appendChild(toggleBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.dataset.editOrder = String(i);
  editBtn.title = 'Edit';
  editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
  actions.appendChild(editBtn);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.dataset.removeOrder = String(i);
  removeBtn.title = 'Remove';
  removeBtn.style.color = 'var(--danger)';
  removeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  actions.appendChild(removeBtn);

  actionsCell.appendChild(actions);
  tr.appendChild(actionsCell);
  return tr;
}

export function renderRec(): void {
  const count = document.getElementById('recCount');
  if (count) count.textContent = `(${state.recOrders.length})`;
  const nc = document.getElementById('ncRec');
  if (nc) nc.textContent = String(state.recOrders.length);

  const rates = getNISRates();
  const tbody = document.getElementById('recTable');
  if (!tbody) return;
  const visible = state.recOrders
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      if (recStatusFilter === 'all')      return true;
      if (recStatusFilter === 'active')   return isActive(r);
      return !isActive(r); // 'inactive'
    })
    // Active rows first; within each group, orders that have run at
    // least once come before never-run ones, sorted by most-overdue
    // first (daysUntilDue ascending). Never-run orders preserve
    // insertion order at the tail of the group.
    .sort((a, b) => {
      const aA = isActive(a.r), bA = isActive(b.r);
      if (aA !== bA) return Number(bA) - Number(aA);
      const aHas = !!a.r.lastRan, bHas = !!b.r.lastRan;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (!aHas) return 0;
      return daysUntilDue(a.r) - daysUntilDue(b.r);
    });
  const { slice, page, pages } = pageSlice(visible, recPage);
  recPage = page;
  tbody.replaceChildren(...slice.map(({ r, i }) => buildRecRow(r, i, rates)));
  renderPager('recPager', page, pages, (p) => { recPage = p; renderRec(); });
  if (visible.length === 0) {
    // Empty state with the two ways to get started, instead of a bare table.
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.cssText = 'text-align:center;padding:48px 20px;color:var(--text3);font-size:13px';
    td.textContent = state.recOrders.length === 0
      ? 'No payroll yet.'
      : 'Nothing matches this filter.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  syncSelectAll();
}

export function toggleOrderActive(i: number): void {
  const r = state.recOrders[i];
  if (!r) return;
  r.active = !isActive(r);
  // Inactive rows used to lose their selection automatically because
  // checkboxes were disabled. They're now selectable so the operator
  // can re-activate or delete them in bulk — keep the selection.
  saveRecOrders();
  renderRec();
  // Re-render an open profile detail so the monthly total + upcoming
  // recurrent rows reflect the toggle. The main.ts handler for this
  // event also re-runs selectProfile when one is selected.
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

// Indices of orders currently visible under the active status filter.
// Both Select-all (set/unset) and the header checkbox's tri-state read
// from this so the operator's "select everything I can see" intuition
// matches what they're looking at.
function visibleOrderIndices(): number[] {
  const out: number[] = [];
  state.recOrders.forEach((r, i) => {
    if (recStatusFilter === 'all') out.push(i);
    else if (recStatusFilter === 'active' && isActive(r)) out.push(i);
    else if (recStatusFilter === 'inactive' && !isActive(r)) out.push(i);
  });
  return out;
}

function syncSelectAll(): void {
  const el = document.getElementById('recSelectAll') as HTMLInputElement | null;
  if (!el) return;
  // Denominator is the visible-under-filter set, not the whole list —
  // matches the "select what's on screen" behaviour of the header
  // checkbox (clicking it bulk-toggles only the visible rows).
  const visible = visibleOrderIndices();
  const selectedVisible = visible.filter((i) => selectedIndices.has(i)).length;
  const total = visible.length;
  el.checked       = total > 0 && selectedVisible === total;
  el.indeterminate = selectedVisible > 0 && selectedVisible < total;
  syncBulkButtons();

  const execBtn   = document.getElementById('executeAllBtn') as HTMLButtonElement | null;
  const execLabel = document.getElementById('executeAllLabel');
  if (!execBtn || !execLabel) return;

  // Selection can include inactive rows (so they can be bulk
  // reactivated/deleted) but Execute is all-or-nothing: refuse to run
  // when any selected row is inactive. The operator should explicitly
  // reactivate or de-select those rows first. Surface the reason as
  // the red shortfall banner so the gating isn't hidden in a tooltip.
  const inactiveSelected = [...selectedIndices].filter((i) => !isActive(state.recOrders[i]));
  if (inactiveSelected.length > 0) {
    execBtn.disabled      = true;
    execBtn.style.opacity = '0.45';
    execBtn.style.cursor  = 'not-allowed';
    execBtn.title         = `${inactiveSelected.length} selected row${inactiveSelected.length === 1 ? ' is' : 's are'} inactive — reactivate or deselect before executing.`;
    execLabel.textContent = 'Execute';
    setExecuteError(`${inactiveSelected.length} selected order${inactiveSelected.length === 1 ? ' is' : 's are'} inactive. Reactivate or deselect ${inactiveSelected.length === 1 ? 'it' : 'them'} before executing.`);
    setShortfallNote(null);
    return;
  }
  setExecuteError(null);

  // No row selection UI anymore: an empty selection means "run everything
  // active" — the same fallback executeAll() itself applies.
  const activeSelected = selectedIndices.size > 0
    ? [...selectedIndices]
    : state.recOrders.map((r, i) => (isActive(r) ? i : -1)).filter((i) => i >= 0);
  const unregisteredCount = activeSelected
    .map((i) => state.recOrders[i])
    .filter((o) => o && o.registered === 'no').length;

  if (activeSelected.length === 0) {
    execBtn.disabled      = true;
    execBtn.style.opacity = '0.45';
    execBtn.style.cursor  = 'not-allowed';
    execBtn.title         = 'No active orders to run';
    execLabel.textContent = 'Execute';
    return;
  }
  if (unregisteredCount > 0) {
    execBtn.disabled      = true;
    execBtn.style.opacity = '0.45';
    execBtn.style.cursor  = 'not-allowed';
    execBtn.title         = `${unregisteredCount} selected recipient${unregisteredCount === 1 ? ' can’t' : 's can’t'} receive private payments yet. Remove or replace the highlighted row${unregisteredCount === 1 ? '' : 's'}.`;
    execLabel.textContent = unregisteredCount === activeSelected.length
      ? 'Recipients not ready'
      : `Not ready (${unregisteredCount}/${activeSelected.length})`;
    setShortfallNote(null);
    return;
  }

  // Pre-flight: insufficient shielded funds for the selected batch.
  // Same comparison as the runtime check; surfaces it as a red note +
  // disabled button instead of a popup so the operator sees it before
  // committing. Active-only — inactive rows can't contribute to a run.
  const { payments } = buildPaymentsFromOrders(new Set(activeSelected));
  const shortfalls = computeShortfalls(payments);
  if (shortfalls.length > 0) {
    execBtn.disabled      = true;
    execBtn.style.opacity = '0.45';
    execBtn.style.cursor  = 'not-allowed';
    execBtn.title         = 'Your private balance can\'t cover this run — see the message above.';
    execLabel.textContent = 'Not enough funds';
    setShortfallNote(shortfalls);
    return;
  }

  const activeTotal = state.recOrders.filter(isActive).length;
  execBtn.disabled      = false;
  execBtn.style.opacity = '';
  execBtn.style.cursor  = '';
  execBtn.title         = '';
  execLabel.textContent = activeSelected.length === activeTotal
    ? 'Execute all'
    : `Execute (${activeSelected.length})`;
  setShortfallNote(null);
  setExecuteError(null);
}

// Plain-text red error in the shortfall banner slot. Used for
// non-shortfall gating reasons (e.g. inactive-row in selection) so the
// operator sees the disabled-Execute explanation without hunting for a
// tooltip.
function setExecuteError(message: string | null): void {
  const note = document.getElementById('executeShortfall');
  if (!note) return;
  if (!message) {
    note.style.display = 'none';
    note.textContent = '';
    return;
  }
  note.replaceChildren();
  const span = document.createElement('div');
  span.style.cssText = 'font-weight:500';
  span.textContent = message;
  note.appendChild(span);
  note.style.display = 'block';
}

function setShortfallNote(shortfalls: ReturnType<typeof computeShortfalls> | null): void {
  const note = document.getElementById('executeShortfall');
  if (!note) return;
  if (!shortfalls || shortfalls.length === 0) {
    note.style.display = 'none';
    note.textContent = '';
    return;
  }
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const lines = shortfalls.map(s => {
    const source = s.mode === 'shielded' ? 'private balance' : 'wallet';
    return `${s.symbol} (${s.mode}): ${source} has ${fmt(s.have)}, batch needs ${fmt(s.need)} (short ${fmt(s.need - s.have)})`;
  });
  note.replaceChildren();
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:500;margin-bottom:4px';
  title.textContent = 'Not enough funds for this batch:';
  note.appendChild(title);
  for (const line of lines) {
    const li = document.createElement('div');
    li.style.cssText = 'font-family:monospace;font-size:11px;color:var(--text2);margin-left:8px';
    li.textContent = `• ${line}`;
    note.appendChild(li);
  }
  note.style.display = 'block';
}

// Bulk Deactivate / Delete buttons that operate on every currently
// selected row. Selection survives the in-place toggle (deactivate
// keeps the row visible just disabled); delete drops them outright.
export function bulkToggleSelected(): void {
  if (selectedIndices.size === 0) return;
  // Snapshot before mutation — Set indices reference the array we're
  // about to rewrite by index.
  const indices = [...selectedIndices].sort((a, b) => a - b);
  // If ANY selected row is currently active, the bulk action
  // deactivates everything; otherwise it activates everything.
  const anyActive = indices.some((i) => isActive(state.recOrders[i]));
  for (const i of indices) {
    const o = state.recOrders[i];
    if (!o) continue;
    o.active = !anyActive;
    if (o.active === false) selectedIndices.delete(i);
  }
  saveRecOrders();
  renderRec();
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

export async function bulkRemoveSelected(): Promise<void> {
  if (selectedIndices.size === 0) return;
  const count = selectedIndices.size;
  const ok = await showConfirm(
    `Delete ${count} selected order${count === 1 ? '' : 's'}? This can't be undone.`,
    { title: 'Are you sure?', okLabel: 'Delete', danger: true },
  );
  if (!ok) return;
  // Build the keep-list in original order; deleting in reverse-index
  // order would also work but the indices in selectedIndices would
  // shift mid-loop, so the filter approach is cleaner.
  const toDrop = new Set(selectedIndices);
  state.recOrders = state.recOrders.filter((_, i) => !toDrop.has(i));
  selectedIndices.clear();
  saveRecOrders();
  renderRec();
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

function syncBulkButtons(): void {
  const toggleBtn = document.getElementById('recBulkToggleBtn') as HTMLButtonElement | null;
  const removeBtn = document.getElementById('recBulkRemoveBtn') as HTMLButtonElement | null;
  const enabled = selectedIndices.size > 0;
  const apply = (btn: HTMLButtonElement | null) => {
    if (!btn) return;
    btn.style.display = enabled ? 'inline-flex' : 'none';
  };
  apply(toggleBtn);
  apply(removeBtn);
  // Label flips based on whether the selection is all-active or
  // has any inactive rows (in which case bulk = reactivate).
  if (toggleBtn) {
    const anyActive = [...selectedIndices].some((i) => isActive(state.recOrders[i]));
    const label = anyActive ? 'Deactivate selected' : 'Activate selected';
    toggleBtn.textContent = enabled ? `${label} (${selectedIndices.size})` : 'Deactivate selected';
  }
  if (removeBtn) {
    removeBtn.textContent = enabled ? `Delete selected (${selectedIndices.size})` : 'Delete selected';
  }
}

export function toggleSelectAll(checked: boolean): void {
  // Scope to the visible-under-filter rows. Selections of currently
  // hidden rows are left alone so flipping the filter doesn't silently
  // drop them.
  const visible = visibleOrderIndices();
  if (checked) {
    for (const i of visible) selectedIndices.add(i);
  } else {
    for (const i of visible) selectedIndices.delete(i);
  }
  renderRec();
}

export function toggleOrderRow(idx: number, checked: boolean): void {
  if (checked) selectedIndices.add(idx);
  else selectedIndices.delete(idx);
  syncSelectAll();
}

export function exportCsv(): void {
  const orders = selectedIndices.size > 0
    ? state.recOrders.filter((_, i) => selectedIndices.has(i))
    : state.recOrders;
  const header = 'Name,Address,Amount (ILS),Currency,Period,Next Run,Description';
  const csv = [header, ...orders.map(r =>
    [r.name, r.addr, r.nis, r.currency, r.period, r.next, r.description ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `recurrent-payroll-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openEditOrder(i: number): void {
  state.editingOrderIdx = i;
  const r = state.recOrders[i];
  (document.getElementById('eoName') as HTMLInputElement).value  = r.name;
  (document.getElementById('eoAddr') as HTMLInputElement).value  = r.addr;
  showEditOrderRecipientCard(r.name, r.addr);
  // Seed the amount selector from the order's original-typed unit when
  // we have it, otherwise fall back to NIS (the storage shape).
  const amountInput = document.getElementById('eoAmount') as HTMLInputElement;
  const unitSel    = document.getElementById('eoAmountUnit') as HTMLSelectElement;
  if (r.amountUnit && r.amountUnit !== 'nis' && r.cryptoAmount != null) {
    amountInput.value = String(r.cryptoAmount);
    unitSel.value     = r.amountUnit;
  } else {
    amountInput.value = String(r.nis);
    unitSel.value     = 'nis';
  }
  (document.getElementById('eoSendCurrency') as HTMLSelectElement).value = r.currency.toLowerCase();
  (document.getElementById('eoPeriod')       as HTMLSelectElement).value = r.period;
  (document.getElementById('eoDescription')  as HTMLInputElement).value  = r.description  || '';
  (document.getElementById('eoMode')         as HTMLSelectElement).value = r.mode ?? 'shielded';
  recomputeEoTransferred();
  openM('editOrder');
}

function getEoInputUnit(): 'nis' | 'usdc' | 'strk' | 'eth' {
  return ((document.getElementById('eoAmountUnit') as HTMLSelectElement | null)?.value
    ?? 'nis') as 'nis' | 'usdc' | 'strk' | 'eth';
}

export function getEoCurrency(): string {
  return (document.getElementById('eoSendCurrency') as HTMLSelectElement | null)?.value ?? 'usdc';
}
export function setEoCurrency(currency: string): void {
  const sel = document.getElementById('eoSendCurrency') as HTMLSelectElement | null;
  if (sel) sel.value = currency;
  recomputeEoTransferred();
}

// Mirrors recomputeAoTransferred: convert the typed amount through NIS
// to land in the chosen on-chain currency, then write into the
// readonly preview box.
export function recomputeEoTransferred(): void {
  const sendAmt = document.getElementById('eoSendAmt') as HTMLInputElement | null;
  if (!sendAmt) return;
  const rates = getNISRates();
  const input = parseFloat((document.getElementById('eoAmount') as HTMLInputElement | null)?.value ?? '') || 0;
  const inputUnit = getEoInputUnit();
  const payment = getEoCurrency();
  if (input <= 0) { sendAmt.value = ''; return; }
  const nis = inputUnit === 'nis' ? input : input / rates[inputUnit as keyof typeof rates];
  const crypto = inputUnit === payment ? input : nisToToken(nis, payment, rates);
  sendAmt.value = fmtToken(crypto, payment).replace(/\s+[A-Za-z₪]+$/, '');
}

export function saveOrder(): void {
  if (state.editingOrderIdx === null) return;
  const rates  = getNISRates();
  const token  = getEoCurrency();
  // Same conversion model as the one-time form: any input unit goes
  // through NIS to land in the storage shape (r.nis = NIS budget).
  // amountUnit/cryptoAmount preserve the operator's original intent.
  const input = parseFloat((document.getElementById('eoAmount') as HTMLInputElement).value) || 0;
  const inputUnit = getEoInputUnit();
  const nis = inputUnit === 'nis' ? input : input / rates[inputUnit as keyof typeof rates];
  const amountUnit: 'nis' | 'usdc' | 'strk' | 'eth' = inputUnit;
  const cryptoAmount = inputUnit === 'nis' ? undefined : input;
  const name = (document.getElementById('eoName') as HTMLInputElement).value.trim();
  const addr = (document.getElementById('eoAddr') as HTMLInputElement).value.trim();
  let invalid = false;
  if (!name)               { flagInvalid('eoName'); invalid = true; }
  if (!validAddr(addr))    { flagInvalid('eoAddr'); invalid = true; }
  else if (burnAddr(addr)) { flagInvalid('eoAddr'); invalid = true; }
  if (invalid) return;
  const order = state.recOrders[state.editingOrderIdx];
  const previousAddr = order.addr;
  order.name        = name;
  order.addr        = addr;
  order.nis         = nis;
  order.currency    = token.toUpperCase();
  order.amountUnit   = amountUnit;
  order.cryptoAmount = cryptoAmount;
  order.period      = (document.getElementById('eoPeriod')      as HTMLSelectElement).value;
  order.description = (document.getElementById('eoDescription') as HTMLInputElement).value.trim() || undefined;
  order.mode        = ((document.getElementById('eoMode') as HTMLSelectElement | null)?.value as 'shielded' | 'unshielded' | undefined) || undefined;
  saveRecOrders();
  // Propagate name + address change to a matching address-book profile so
  // the other pages (audit, recent transfers, profile detail, one-time
  // recipient tag) see the same name. BigInt-normalized match handles
  // leading-zero differences between profile and order address.
  syncProfileFromOrder(previousAddr, addr, name);
  renderRec();
  closeM('editOrder');
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

// Propagates name + address changes back to the matching address-book
// profile. Order `mode` is intentionally NOT synced — each order owns
// its own transfer mode independent of the profile's default, so an
// operator can have a contact whose default is shielded but a specific
// recurrent order set to unshielded (or vice versa).
function syncProfileFromOrder(oldAddr: string, newAddr: string, name: string): void {
  let normalizedOld: bigint;
  let normalizedNew: bigint;
  try {
    normalizedOld = BigInt(oldAddr);
    normalizedNew = BigInt(newAddr);
  } catch { return; }
  let mutated = false;
  for (const p of state.profiles) {
    try {
      const pAddr = BigInt(p.addr);
      if (pAddr === normalizedOld || pAddr === normalizedNew) {
        if (p.name !== name || p.addr !== newAddr) {
          p.name = name;
          p.addr = newAddr;
          mutated = true;
        }
      }
    } catch { /* skip malformed */ }
  }
  if (mutated) saveProfiles();
}

export function prefillEditOrderFromProfile(id: string): void {
  const p = state.profiles.find((pr) => pr.id === id);
  if (!p) return;
  showEditOrderRecipientCard(p.name, p.addr);
  (document.getElementById('eoName') as HTMLInputElement).value = p.name;
  (document.getElementById('eoAddr') as HTMLInputElement).value = p.addr;
  const eoMode = document.getElementById('eoMode') as HTMLSelectElement | null;
  if (eoMode && p.mode) eoMode.value = p.mode;
  closeM('pickProfile');
}

function showEditOrderRecipientCard(name: string, addr: string): void {
  const picker = document.getElementById('eoPickerSection');
  const card = document.getElementById('eoRecipientCard');
  const av = document.getElementById('eoRecipientAv');
  const nameEl = document.getElementById('eoRecipientName');
  const addrEl = document.getElementById('eoRecipientAddr');
  if (picker) picker.style.display = 'none';
  if (card) card.style.display = 'block';
  if (av) av.textContent = initials(name);
  if (nameEl) nameEl.textContent = name;
  if (addrEl) addrEl.textContent = addr.length > 22 ? `${addr.slice(0, 12)}…${addr.slice(-6)}` : addr;
}

// Reverts to the picker UI when the user wants to switch recipients
// (mirrors clearAddOrderRecipient).
export function clearEditOrderRecipient(): void {
  const picker = document.getElementById('eoPickerSection');
  const card = document.getElementById('eoRecipientCard');
  if (picker) picker.style.display = '';
  if (card) card.style.display = 'none';
  (document.getElementById('eoName') as HTMLInputElement).value = '';
  (document.getElementById('eoAddr') as HTMLInputElement).value = '';
}

export async function removeOrder(i: number): Promise<void> {
  const o = state.recOrders[i];
  if (!o) return;
  const ok = await showConfirm(
    `Delete the recurrent order for ${o.name}? This can't be undone.`,
    { title: 'Are you sure?', okLabel: 'Delete', danger: true },
  );
  if (!ok) return;
  state.recOrders.splice(i, 1);
  saveRecOrders();
  renderRec();
}

// Add Order amount selector — mirrors the one-time form's two-rectangle
// design. Left rectangle: editable amount + input-unit dropdown
// (NIS / USD / STRK / ETH). Right rectangle: readonly converted value
// in the transferred currency, with a USDC/STRK/ETH dropdown that
// drives the on-chain token.

function getAoInputUnit(): 'nis' | 'usdc' | 'strk' | 'eth' {
  return ((document.getElementById('aoAmountUnit') as HTMLSelectElement | null)?.value
    ?? 'nis') as 'nis' | 'usdc' | 'strk' | 'eth';
}

export function getAoCurrency(): string {
  return (document.getElementById('aoSendCurrency') as HTMLSelectElement | null)?.value ?? 'usdc';
}
export function setAoCurrency(currency: string): void {
  const sel = document.getElementById('aoSendCurrency') as HTMLSelectElement | null;
  if (sel) sel.value = currency;
  recomputeAoTransferred();
}

// Re-derives the readonly "Transferred amount" from the typed value +
// the on-chain currency dropdown. NIS is the universal bridge: any
// input unit goes through NIS to get to any other unit.
export function recomputeAoTransferred(): void {
  const sendAmt = document.getElementById('aoSendAmt') as HTMLInputElement | null;
  if (!sendAmt) return;
  const rates = getNISRates();
  const input = parseFloat((document.getElementById('aoAmount') as HTMLInputElement | null)?.value ?? '') || 0;
  const inputUnit = getAoInputUnit();
  const payment = getAoCurrency();
  if (input <= 0) { sendAmt.value = ''; return; }
  const nis = inputUnit === 'nis' ? input : input / rates[inputUnit as keyof typeof rates];
  const crypto = inputUnit === payment ? input : nisToToken(nis, payment, rates);
  // Strip the trailing token symbol — the dropdown already labels it.
  sendAmt.value = fmtToken(crypto, payment).replace(/\s+[A-Za-z₪]+$/, '');
}

// Called by the pick-profile modal when the user picks a row while the
// Add Order modal is open. Hides the manual picker section, shows the
// chosen-recipient card with avatar + name + truncated address, and
// fills the hidden inputs (aoName/aoAddr) so saveNewOrder reads them
// transparently.
export function prefillAddOrderFromProfile(id: string): void {
  const p = state.profiles.find((pr) => pr.id === id);
  if (!p) return;
  showAddOrderRecipientCard(p.name, p.addr);
  (document.getElementById('aoName')     as HTMLInputElement).value  = p.name;
  (document.getElementById('aoAddr')     as HTMLInputElement).value  = p.addr;
  // Currency dropdown is intentionally NOT overwritten — profiles no
  // longer carry a default token. Whatever the operator has selected in
  // the Transferred currency dropdown stays selected. Legacy profiles
  // with p.token still set get honored for continuity.
  if (p.token) setAoCurrency(p.token);
  // Seed the typed amount as NIS (the profile's budget is stored in
  // NIS) — operator can change the unit dropdown afterward.
  (document.getElementById('aoAmount')      as HTMLInputElement).value = String(p.nis);
  const unitSel = document.getElementById('aoAmountUnit') as HTMLSelectElement | null;
  if (unitSel) unitSel.value = 'nis';
  const aoTransferMode = document.getElementById('aoTransferMode') as HTMLSelectElement | null;
  if (aoTransferMode && p.mode) aoTransferMode.value = p.mode;
  recomputeAoTransferred();
  closeM('pickProfile');
}

// Populates the slick "recipient picked" card and hides the manual
// picker/inputs section. The inputs themselves stay in the DOM with
// their values so save logic doesn't need to branch on pick state.
function showAddOrderRecipientCard(name: string, addr: string): void {
  const picker = document.getElementById('aoPickerSection');
  const card = document.getElementById('aoRecipientCard');
  const av = document.getElementById('aoRecipientAv');
  const nameEl = document.getElementById('aoRecipientName');
  const addrEl = document.getElementById('aoRecipientAddr');
  if (picker) picker.style.display = 'none';
  if (card) card.style.display = 'block';
  if (av) av.textContent = initials(name);
  if (nameEl) nameEl.textContent = name;
  if (addrEl) addrEl.textContent = addr.length > 22 ? `${addr.slice(0, 12)}…${addr.slice(-6)}` : addr;
}

// Reverts to the picker UI — invoked by the X button on the recipient
// card and by resetAddOrderForm so a fresh open of the modal always
// starts on the picker. Clears the underlying inputs too so a stale
// name/addr doesn't sneak into the next save.
export function clearAddOrderRecipient(): void {
  const picker = document.getElementById('aoPickerSection');
  const card = document.getElementById('aoRecipientCard');
  if (picker) picker.style.display = '';
  if (card) card.style.display = 'none';
  (document.getElementById('aoName') as HTMLInputElement).value = '';
  (document.getElementById('aoAddr') as HTMLInputElement).value = '';
}

// Resets the Add Order modal to a clean state. Used both when opening
// fresh from the page-level "Add order" button and just before pre-filling
// from a profile — keeps a previous draft from bleeding into the new one.
export function resetAddOrderForm(): void {
  ['aoName', 'aoAddr', 'aoAmount', 'aoSendAmt', 'aoDescription'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && 'value' in el) (el as HTMLInputElement).value = '';
  });
  const unitSel = document.getElementById('aoAmountUnit') as HTMLSelectElement | null;
  if (unitSel) unitSel.value = 'usdc';
  setAoCurrency('usdc');
  (document.getElementById('aoPeriod')   as HTMLSelectElement).value = 'Monthly';
  clearAddOrderRecipient();
}

export function saveNewOrder(): void {
  const name   = (document.getElementById('aoName')     as HTMLInputElement).value.trim();
  const addr   = (document.getElementById('aoAddr')     as HTMLInputElement).value.trim();
  const token  = getAoCurrency();
  const period = (document.getElementById('aoPeriod')   as HTMLSelectElement).value;
  let invalid = false;
  if (!name)               { flagInvalid('aoName'); invalid = true; }
  if (!validAddr(addr))    { flagInvalid('aoAddr'); invalid = true; }
  else if (burnAddr(addr)) { flagInvalid('aoAddr'); invalid = true; }
  if (invalid) return;
  const rates = getNISRates();
  // Same conversion model as the one-time form: any input unit goes
  // through NIS to land in the storage shape (r.nis = NIS budget).
  // amountUnit/cryptoAmount preserve the operator's original intent so
  // displays elsewhere can show "what they typed".
  const input = parseFloat((document.getElementById('aoAmount') as HTMLInputElement).value) || 0;
  const inputUnit = getAoInputUnit();
  const nis = inputUnit === 'nis' ? input : input / rates[inputUnit as keyof typeof rates];
  const amountUnit: 'nis' | 'usdc' | 'strk' | 'eth' = inputUnit;
  const cryptoAmount = inputUnit === 'nis' ? undefined : input;
  if (nis <= 0) { flagInvalid('aoAmount'); void showAlert('Enter a valid amount'); return; }
  const description = (document.getElementById('aoDescription') as HTMLInputElement).value.trim() || undefined;
  const mode = ((document.getElementById('aoTransferMode') as HTMLSelectElement | null)?.value as 'shielded' | 'unshielded' | undefined) || undefined;
  // Store the full address — `addr.slice(0,8)+'...'` was only good for
  // display, but executeAll needs the real address to dispatch the multipay.
  state.recOrders.push({ id: 'o' + Date.now() + Math.random(), name, addr, nis, currency: token.toUpperCase(), period, next: '2026-05-28', description, mode, amountUnit, cryptoAmount });
  saveRecOrders();
  renderRec();
  closeM('addOrder');
  resetAddOrderForm();
}

function shortenAddr(addr: string): string {
  if (addr.length <= 14) return addr; // already truncated (legacy data)
  return addr.slice(0, 10) + '...' + addr.slice(-4);
}

function buildAddrCell(r: RecOrder): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'masked';
  cell.style.whiteSpace = 'nowrap';
  cell.append(document.createTextNode(shortenAddr(r.addr)));
  if (r.registered === 'no') {
    const badge = document.createElement('span');
    badge.className = 'badge b-red';
    badge.style.cssText = 'margin-left:6px;font-size:11px;background:#fee2e2;color:#991b1b;border-radius:4px;padding:2px 6px;cursor:help';
    badge.textContent = 'can’t receive private';
    badge.title = 'This person hasn’t activated private payments yet. Ask them to activate PriPay, or pay them publicly.';
    cell.appendChild(badge);
  }
  return cell;
}

// Days in one period. Weekly 7, Bi-weekly 14, Monthly (or anything else) 30.
function periodDays(period: string): number {
  const p = period.toLowerCase();
  return p.includes('week') ? (p.includes('bi') ? 14 : 7) : 30;
}

// Pushes the next-run date forward by one period.
function advanceNext(current: string, period: string): string {
  const base = new Date(current);
  if (isNaN(base.getTime())) return current;
  base.setDate(base.getDate() + periodDays(period));
  return base.toISOString().slice(0, 10);
}

// YYYY-MM-DD for today in the operator's local timezone (matches the
// audit-log format).
function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// YYYY-MM-DD of the next due run: lastRan + periodDays. Undefined for
// never-run orders. Drives both the "Next run" column and the due-date
// sort below.
function nextDueDate(r: RecOrder): string | undefined {
  if (!r.lastRan) return undefined;
  const last = new Date(r.lastRan);
  if (isNaN(last.getTime())) return undefined;
  last.setDate(last.getDate() + periodDays(r.period));
  return last.toISOString().slice(0, 10);
}

// Days from today until this order is next due. Negative = overdue.
// Never-run orders sort as most-overdue so they bubble to the top.
function daysUntilDue(r: RecOrder): number {
  const due = nextDueDate(r);
  if (!due) return -Infinity;
  const dueT = new Date(due).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((dueT - today.getTime()) / 86_400_000);
}

// Converts a human float amount (e.g. NIS-derived crypto units like 0.5)
// to raw token units (bigint). Rounded — JS floats can't represent some
// decimals exactly, but rounding to the token's lowest unit is fine.
function toRawAmount(human: number, decimals: number): bigint {
  return BigInt(Math.round(human * Math.pow(10, decimals)));
}

// Builds the SDK Payment[] from current recOrders + live NIS rates. Each
// order has a NIS amount + currency; we convert through the live rate to
// the token's raw units (wei/fri for 18-dec tokens, micro-USDC for USDC).
// Skips entries with truncated or invalid addresses so a single bad row
// doesn't poison the whole batch.
type PaymentRecord = {
  recipient: string;
  token: string;
  amount: bigint;
  name: string;
  nisAmount: number;
  currency: string;
  mode: 'shielded' | 'unshielded';
  // Index into state.recOrders for the order that produced this payment.
  // Threaded through so the post-execute lastRan/next stamp lands on the
  // exact order, not whichever one happens to share the recipient address.
  orderIndex: number;
};

function buildPaymentsFromOrders(indices?: Set<number>): { payments: PaymentRecord[]; skipped: string[] } {
  const rates = getNISRates();
  const payments: PaymentRecord[] = [];
  const skipped: string[] = [];
  // Iterate with the original state.recOrders index in hand so each
  // payment carries the identity of the order that produced it.
  for (let i = 0; i < state.recOrders.length; i++) {
    if (indices && indices.size > 0 && !indices.has(i)) continue;
    const order = state.recOrders[i];
    if (order.active === false) {
      skipped.push(`${order.name} (inactive)`);
      continue;
    }
    if (!validAddr(order.addr) || order.addr.includes('...')) {
      skipped.push(`${order.name} (invalid address: ${order.addr})`);
      continue;
    }
    const tokenKey = order.currency.toLowerCase() as keyof typeof TOKENS;
    const tokenMeta = TOKENS[tokenKey];
    if (!tokenMeta) {
      skipped.push(`${order.name} (unknown token ${order.currency})`);
      continue;
    }
    const cryptoAmount = orderCryptoAmount(order, rates);
    const rawAmount = toRawAmount(cryptoAmount, tokenMeta.decimals);
    if (rawAmount <= 0n) {
      skipped.push(`${order.name} (zero amount)`);
      continue;
    }
    payments.push({
      recipient: order.addr,
      token: tokenMeta.address,
      amount: rawAmount,
      name: order.name,
      nisAmount: order.nis,
      currency: order.currency.toUpperCase(),
      mode: (order.mode ?? 'shielded'),
      orderIndex: i,
    });
  }
  return { payments, skipped };
}

// Runs the full recurring payroll via the privacy pool's multipay action:
// one proof + one SNIP-12 signature + one paymaster submit covers all rows.
// Refuses to run if the SDK client isn't initialized or paymaster isn't
// configured — surfaces a clear alert instead of silently fake-completing.
export function executeAll(): void {
  if (!state.walletConnected) { void showAlert('Connect wallet first'); return; }
  if (!state.operatorAccount) { void showAlert('Connect a wallet first.'); return; }

  const runIndices = selectedIndices.size > 0 ? new Set(selectedIndices) : undefined;
  const { payments, skipped } = buildPaymentsFromOrders(runIndices);
  if (payments.length === 0) {
    void showAlert('No executable orders — all rows skipped (likely truncated addresses from legacy data).');
    return;
  }

  const shielded = payments.filter((p) => p.mode === 'shielded');
  const unshielded = payments.filter((p) => p.mode === 'unshielded');

  if (shielded.length > 0) {
    if (!state.transfers || !state.payrollAddress) {
      void showAlert('Activate private payments first — press “Activate private payments” on the Dashboard.'); return;
    }
    if (state.submitter instanceof LocalSubmitter) {
      void showAlert('Configure the paymaster key (Dashboard → Set paymaster key).'); return;
    }
  }

  // Belt-and-suspenders: the Initiate button is already disabled when
  // the batch can't be covered, but if the cache races a balance fetch
  // we double-check here so a stale cache can't slip a doomed run through.
  if (computeShortfalls(payments).length > 0) return;

  const operatorAccount = state.operatorAccount;
  const payrollAddress = state.payrollAddress;
  const transfers = state.transfers;
  const submitter = state.submitter;

  // Combined-op label. When only one mode is present we keep the legacy
  // single-line wording; the mixed case spells out the split so the
  // operations-panel card makes the dual-leg behaviour explicit.
  const opSummary = (() => {
    const skipNote = skipped.length ? ` (${skipped.length} skipped)` : '';
    if (shielded.length && unshielded.length) {
      return `${shielded.length} shielded + ${unshielded.length} unshielded payment${payments.length === 1 ? '' : 's'}${skipNote}`;
    }
    if (shielded.length) {
      return `${shielded.length} shielded payment${shielded.length === 1 ? '' : 's'}${skipNote}`;
    }
    return `${unshielded.length} unshielded payment${unshielded.length === 1 ? '' : 's'}${skipNote}`;
  })();

  const op = createOperation({
    kind: 'recurrent',
    status: shielded.length > 0 ? 'building_proof' : 'submitting',
    summary: opSummary,
  });
  showExecuteStatus(`Queued — track progress in the Operations panel below.`, 'info');
  setTimeout(() => {
    const st = document.getElementById('executeStatus');
    if (st) st.style.display = 'none';
  }, 5000);

  void (async () => {
    try {
      if (shielded.length > 0) {
        // Mixed batches: the proof authorization is now an off-chain SNIP-12
        // signature, so the unshielded ERC20 transfers can't ride along in a
        // precommit multicall — they're sent as their own wallet tx inside
        // runMultiPay (a second prompt). The paymaster then submits the
        // shielded apply_actions as usual.
        const extraCalls = unshielded.length > 0
          ? buildUnshieldedTransferCalls(unshielded.map((p) => ({
              recipient: p.recipient,
              tokenAddress: p.token,
              amount: p.amount,
            })))
          : undefined;

        const result = await runMultiPay(
          operatorAccount!, payrollAddress!, transfers!, submitter,
          shielded.map(({ recipient, token, amount }) => ({ recipient, token, amount })),
          (phase) => updateOperation(op.id, { status: phaseToStatus(phase) }),
          extraCalls,
        );
        markRecurrentTx(result.submittedTx);

        // Persist a local record per unshielded recipient — the on-chain
        // ERC20 transfers all share the unshielded multicall's tx hash, so
        // use it here so the audit log can group them once the indexer
        // catches up. Tag that tx as recurrent too so the audit re-label
        // (UnshieldedTransfer → Recurrent) catches the ERC20 events emitted
        // from that multicall.
        if (unshielded.length > 0 && result.unshieldedTx) {
          markRecurrentTx(result.unshieldedTx);
          recordUnshieldedFromBatch(result.unshieldedTx, unshielded);
        }

        updateOperation(op.id, { status: 'done', resultTx: result.submittedTx });
      } else {
        // Unshielded-only: skip the proof path entirely; wallet signs a
        // plain ERC20 multicall.
        updateOperation(op.id, { status: 'submitting' });
        const result = await runUnshieldedMultipay(
          operatorAccount!,
          unshielded.map(({ recipient, token, amount }) => ({ recipient, tokenAddress: token, amount })),
        );
        markRecurrentTx(result.submittedTx);
        recordUnshieldedFromBatch(result.submittedTx, unshielded);
        updateOperation(op.id, { status: 'done', resultTx: result.submittedTx });
      }

      // Stamp last-ran + advance next-run on each executed order (both legs).
      // Use the threaded orderIndex so duplicate / address-twin orders don't
      // misroute the update.
      const today = todayYmd();
      for (const payment of payments) {
        const order = state.recOrders[payment.orderIndex];
        if (order) {
          order.lastRan = today;
          order.next = advanceNext(order.next, order.period);
        }
      }
      saveRecOrders();
      renderRec();
      refreshTreasuryBalance();
      void refreshAuditLog();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      console.error('[recurrent] mixed-batch failed', err);
      updateOperation(op.id, { status: 'error', error: msg });
    }
  })();
}

function recordUnshieldedFromBatch(txHash: string, payments: PaymentRecord[]): void {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  for (const p of payments) {
    const meta = TOKENS[p.currency.toLowerCase() as keyof typeof TOKENS];
    const human = Number(p.amount) / Number(10n ** BigInt(meta?.decimals ?? 18));
    addUnshieldedTx({
      tx: txHash,
      date, time,
      addr: p.recipient,
      token: p.currency as 'USDC' | 'STRK' | 'ETH',
      amount: human,
      description: undefined,
    });
  }
}

type PaymentWithMeta = ReturnType<typeof buildPaymentsFromOrders>['payments'][number];

// Sums batch payments per (currency, mode) and compares against the
// appropriate cached balance (pool for shielded, wallet for unshielded).
// Returns one entry per (mode, currency) pair that exceeds availability.
// Pairs with no cached balance are skipped (rather than blocked) — the
// topbar hasn't seen a balance yet, so we can't make a claim.
function computeShortfalls(payments: PaymentWithMeta[]): { symbol: string; have: number; need: number; mode: 'shielded' | 'unshielded' }[] {
  type Key = `${'shielded' | 'unshielded'}:${string}`;
  const needByKey = new Map<Key, bigint>();
  for (const p of payments) {
    const key: Key = `${p.mode}:${p.currency}`;
    const cur = needByKey.get(key) ?? 0n;
    needByKey.set(key, cur + p.amount);
  }
  const out: { symbol: string; have: number; need: number; mode: 'shielded' | 'unshielded' }[] = [];
  for (const [key, rawNeed] of needByKey) {
    const [mode, symbol] = key.split(':') as ['shielded' | 'unshielded', string];
    const tokenKey = symbol.toLowerCase() as keyof typeof TOKENS;
    const meta = TOKENS[tokenKey];
    if (!meta) continue;
    const need = Number(rawNeed) / Number(10n ** BigInt(meta.decimals));
    const have = mode === 'shielded' ? getCachedPoolAmount(symbol) : getCachedWalletAmount(symbol);
    if (have == null) continue;
    if (need > have) out.push({ symbol, have, need, mode });
  }
  return out;
}

// Same DOM-safe alert helper pattern as the onetime page.
function showExecuteStatus(message: string, type: 'info' | 'success' | 'err'): void {
  const st = document.getElementById('executeStatus');
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
