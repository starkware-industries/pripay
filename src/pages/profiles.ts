import { state, saveProfiles, saveRecOrders, getTxsForAddr, getTxMetadata } from '../core/state';
import { isUserRegisteredInPool } from '../sdk_integration/registration-probe';
import { showAlert, showConfirm } from '../core/dialogs';
import { prefillAddOrderFromProfile, resetAddOrderForm } from './recurrent';
import { downloadTextFile, buildCopyableValue } from '../core/utils';

export function downloadProfilesCsvTemplate(): void {
  const lines = [
    'name,address,email,type,notes',
    'Sample Employee,0xabcd000000000000000000000000000000000000000000000000000000000001,example@example.com,Employee,Replace with a real recipient',
    'Sample Contractor,0xabcd000000000000000000000000000000000000000000000000000000000002,example@example.com,Contractor,',
  ];
  downloadTextFile('pripay-address-book-template.csv', lines.join('\n') + '\n');
}
import { openM, closeM } from '../core/modals';
import { pageSlice, renderPager } from '../core/pagination';
import { nav } from '../core/nav';
import { validAddr, burnAddr } from '../core/validators';
import { initials, fmtToken, fmtTypedAmount, fmtIls, fmtUsd, nisToToken, SHIELD_SVG, flagInvalid } from '../core/utils';
import { animateDetailReveal } from '../core/motion';
import { getNISRates } from '../core/prices';
import { setOtRecipient, setOtMode, calcOT } from './onetime';
import type { AuditTx, RecOrder } from '../core/types';

// BigInt-equality handles leading-zero address variants (chain-padded vs. user-entered).
function monthlyForProfile(addr: string): number {
  let target: bigint;
  try { target = BigInt(addr); } catch { return 0; }
  return state.recOrders.reduce((sum, r) => {
    if (r.active === false) return sum;
    try { return BigInt(r.addr) === target ? sum + r.nis : sum; }
    catch { return sum; }
  }, 0);
}

let pickProfileTarget: ((profileId: string) => void) | null = null;
export function setPickProfileTarget(cb: (profileId: string) => void): void {
  pickProfileTarget = cb;
}
export function invokePickProfileTarget(profileId: string): void {
  const cb = pickProfileTarget;
  pickProfileTarget = null;
  if (cb) cb(profileId);
}

// Bulk-selection set for the address book. Mirrors the recurrent
// page's selectedIndices pattern but keyed by profile id (stable
// across re-renders) rather than array index.
const selectedProfileIds = new Set<string>();

export function toggleProfileSelectAll(checked: boolean): void {
  if (checked) {
    // Match what's currently visible (post-search) rather than the
    // full profile list — selecting "all" with a filter applied
    // shouldn't sweep up hidden rows.
    const q = ((document.getElementById('profileSearch') as HTMLInputElement)?.value || '').toLowerCase();
    for (const p of state.profiles) {
      if (!q || p.name.toLowerCase().includes(q) || p.addr.toLowerCase().includes(q)) {
        selectedProfileIds.add(p.id);
      }
    }
  } else {
    selectedProfileIds.clear();
  }
  renderProfiles();
}

export function toggleProfileRow(id: string, checked: boolean): void {
  if (checked) selectedProfileIds.add(id);
  else selectedProfileIds.delete(id);
  syncProfileBulkButtons();
}

function syncProfileBulkButtons(): void {
  // Header select-all reflects the current selection vs visible rows.
  const head = document.getElementById('profileSelectAll') as HTMLInputElement | null;
  if (head) {
    const q = ((document.getElementById('profileSearch') as HTMLInputElement)?.value || '').toLowerCase();
    const visible = state.profiles.filter((p) =>
      !q || p.name.toLowerCase().includes(q) || p.addr.toLowerCase().includes(q),
    );
    const visibleSelected = visible.filter((p) => selectedProfileIds.has(p.id)).length;
    head.checked       = visible.length > 0 && visibleSelected === visible.length;
    head.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
  }
  const btn = document.getElementById('profileBulkRemoveBtn') as HTMLButtonElement | null;
  if (!btn) return;
  const n = selectedProfileIds.size;
  btn.style.display = n > 0 ? 'inline-flex' : 'none';
  btn.textContent  = `Delete selected (${n})`;
}

export async function bulkRemoveProfiles(): Promise<void> {
  if (selectedProfileIds.size === 0) return;
  const ids = [...selectedProfileIds];
  const targets = state.profiles.filter((p) => ids.includes(p.id));
  let orderCount = 0;
  for (const p of targets) orderCount += countOrdersForAddr(p.addr);
  const orderNote = orderCount > 0
    ? ` This will also delete ${orderCount} matching order${orderCount === 1 ? '' : 's'}.`
    : '';
  const ok = await showConfirm(
    `Delete ${targets.length} selected profile${targets.length === 1 ? '' : 's'}?${orderNote} This can't be undone.`,
    { title: 'Are you sure?', okLabel: 'Delete', danger: true },
  );
  if (!ok) return;
  // Compute BigInt-normalized addresses of every removed profile so we
  // can drop matching recurrent orders in a single pass.
  const removedAddrs = new Set<string>();
  for (const p of targets) {
    try { removedAddrs.add(BigInt(p.addr).toString(16)); } catch { /* skip */ }
  }
  state.profiles = state.profiles.filter((p) => !ids.includes(p.id));
  if (removedAddrs.size > 0) {
    const before = state.recOrders.length;
    state.recOrders = state.recOrders.filter((o) => {
      try { return !removedAddrs.has(BigInt(o.addr).toString(16)); } catch { return true; }
    });
    if (state.recOrders.length !== before) saveRecOrders();
  }
  if (state.selectedProfileId && ids.includes(state.selectedProfileId)) {
    state.selectedProfileId = null;
    closeM('profileDetail');
  }
  selectedProfileIds.clear();
  saveProfiles();
  renderProfiles();
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

// Type pills in the toolbar (All / Employees / Contractors / …), mirroring
// the Transactions page's filter organization.
let profileTypeFilter = 'all';
let profilePage = 1;
export function resetProfilePage(): void { profilePage = 1; }
export function setProfileTypeFilter(v: string): void {
  profileTypeFilter = v;
  profilePage = 1;
  document.querySelectorAll<HTMLElement>('#profileTypeFilter .cur-pill').forEach((p) =>
    p.classList.toggle('active', p.dataset.ptype === v));
  renderProfiles();
}

// Address-book CSV export — same columns the importer accepts.
export function exportPeopleCsv(): void {
  const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
  const lines = ['name,address,email,type,notes',
    ...state.profiles.map((p) => [p.name, p.addr, p.email ?? '', p.type ?? '', p.notes ?? ''].map(esc).join(','))];
  downloadTextFile(`pripay-people-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n') + '\n');
}

export function renderProfiles(): void {
  const count = document.getElementById('ncProfiles');
  if (count) count.textContent = String(state.profiles.length);
  const badge = document.getElementById('profileCountBadge');
  if (badge) badge.textContent = `${state.profiles.length} ${state.profiles.length === 1 ? 'person' : 'people'}`;

  const q = ((document.getElementById('profileSearch') as HTMLInputElement)?.value || '').toLowerCase();
  const filtered = state.profiles.filter(p =>
    (!q || p.name.toLowerCase().includes(q) || p.addr.toLowerCase().includes(q))
    && (profileTypeFilter === 'all' || (p.type ?? '') === profileTypeFilter)
  );
  const selected = state.selectedProfileId;
  const tbody = document.getElementById('profileGrid');
  if (!tbody) return;
  if (filtered.length === 0) {
    tbody.replaceChildren(emptyRow(8, 'No profiles found'));
    renderPager('profilePager', 1, 1, () => {});
    syncProfileBulkButtons();
    return;
  }
  const { slice, page, pages } = pageSlice(filtered, profilePage);
  profilePage = page;
  tbody.replaceChildren(...slice.map((p) => buildProfileRow(p, selected === p.id)));
  renderPager('profilePager', page, pages, (p) => { profilePage = p; renderProfiles(); });
  syncProfileBulkButtons();
}

function buildProfileRow(p: typeof state.profiles[number], isSelected: boolean): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.dataset.profileId = p.id;
  tr.style.cursor = 'pointer';
  if (isSelected) tr.style.background = 'var(--accent-light)';

  // Selection checkbox — the row-click handler skips clicks on .profile-cb.
  const checkCell = document.createElement('td');
  checkCell.className = 'check-col';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'profile-cb row-check';
  cb.dataset.profileId = p.id;
  cb.checked = selectedProfileIds.has(p.id);
  checkCell.appendChild(cb);

  // Name cell with avatar
  const nameCell = document.createElement('td');
  const nameWrap = document.createElement('div');
  nameWrap.style.cssText = 'display:flex;align-items:center;gap:8px';
  const av = document.createElement('div');
  av.className = 'avatar';
  av.style.cssText = 'width:30px;height:30px;font-size:11px;flex-shrink:0';
  av.textContent = initials(p.name);
  const nameSpan = document.createElement('span');
  nameSpan.style.fontWeight = '600';
  nameSpan.textContent = p.name;
  nameWrap.append(av, nameSpan);
  // Shield indicator when this profile defaults to shielded transfers
  // (the cross-page convention — same icon shown next to shielded tx
  // rows in the audit log).
  if ((p.mode ?? 'shielded') === 'shielded') {
    const shield = document.createElement('span');
    shield.innerHTML = SHIELD_SVG;
    shield.title = 'Default: shielded transfers';
    shield.style.cssText = 'font-size:11px;line-height:1;color:var(--accent);margin-left:auto;padding-right:6px';
    nameWrap.appendChild(shield);
  }
  nameCell.appendChild(nameWrap);

  // Address — truncated with hover-tooltip + click-to-copy.
  const addrCell = document.createElement('td');
  const addrText = document.createElement('span');
  addrText.style.cssText = 'font-size:12px;color:var(--text3)';
  addrText.textContent = `${p.addr.slice(0, 6)}...${p.addr.slice(-4)}`;
  addrCell.appendChild(addrText);

  // Type badge
  const typeCell = document.createElement('td');
  if (p.type) {
    const badge = document.createElement('span');
    badge.className = 'badge b-gray';
    badge.textContent = p.type;
    typeCell.appendChild(badge);
  } else {
    typeCell.textContent = '—';
  }

  // Monthly NIS
  const monthlyCell = document.createElement('td');
  monthlyCell.className = 'mono';
  monthlyCell.textContent = fmtUsd(monthlyForProfile(p.addr));

  // Notes
  const notesCell = document.createElement('td');
  notesCell.style.cssText = 'font-size:12px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  notesCell.textContent = p.notes || '—';

  // Tx count badge
  const txCell = document.createElement('td');
  const txBadge = document.createElement('span');
  txBadge.className = 'badge b-gray';
  txBadge.textContent = String(getTxsForAddr(p.addr).length);
  txCell.appendChild(txBadge);

  // Actions — collapsed into a ⋯ menu (the menu itself is a single
  // reusable, body-appended popover built + positioned in main.ts).
  const actionsCell = document.createElement('td');
  actionsCell.style.textAlign = 'right';
  const menuBtn = document.createElement('button');
  menuBtn.className = 'icon-btn row-menu-btn';
  menuBtn.dataset.rowMenu = p.id;
  menuBtn.title = 'Actions';
  menuBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
  actionsCell.appendChild(menuBtn);

  tr.append(checkCell, nameCell, addrCell, typeCell, monthlyCell, notesCell, txCell, actionsCell);
  return tr;
}

function emptyRow(colspan: number, message: string): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colspan;
  td.style.cssText = 'text-align:center;color:var(--text3);padding:24px';
  td.textContent = message;
  tr.appendChild(td);
  return tr;
}

function buildAbCsvPreviewRow(r: { name: string; addr: string; email: string; type: string; notes: string }, idx: number): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const idxCell = document.createElement('td');
  idxCell.className = 'mono';
  idxCell.style.color = 'var(--text3)';
  idxCell.textContent = String(idx + 1);

  const nameCell = document.createElement('td');
  nameCell.style.fontWeight = '500';
  nameCell.textContent = r.name;

  const addrCell = document.createElement('td');
  addrCell.className = 'masked';
  addrCell.style.cssText = 'font-family:monospace;font-size:11px';
  addrCell.textContent = `${r.addr.slice(0, 12)}...`;

  const emailCell = document.createElement('td');
  emailCell.style.cssText = 'font-size:12px;color:var(--text3)';
  emailCell.textContent = r.email || '—';

  const typeCell = document.createElement('td');
  typeCell.style.cssText = 'font-size:12px;color:var(--text3)';
  typeCell.textContent = r.type || '—';

  const notesCell = document.createElement('td');
  notesCell.style.cssText = 'font-size:12px;color:var(--text3)';
  notesCell.textContent = r.notes || '—';

  tr.append(idxCell, nameCell, addrCell, emailCell, typeCell, notesCell);
  return tr;
}

function buildAbMoreRow(extra: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 6;
  td.style.cssText = 'text-align:center;color:var(--text3);font-size:12px;padding:8px';
  td.textContent = `+${extra} more rows`;
  tr.appendChild(td);
  return tr;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeIconSvg(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  return svg;
}

function svgPath(d: string): SVGElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  return path;
}

function makePencilSvg(): SVGElement {
  const svg = makeIconSvg();
  svg.append(
    svgPath('M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'),
    svgPath('M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z'),
  );
  return svg;
}

function makeTrashSvg(): SVGElement {
  const svg = makeIconSvg();
  const poly = document.createElementNS(SVG_NS, 'polyline');
  poly.setAttribute('points', '3 6 5 6 21 6');
  svg.append(
    poly,
    svgPath('M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'),
    svgPath('M10 11v6'),
    svgPath('M14 11v6'),
  );
  return svg;
}

export function closeProfileDetail(): void {
  state.selectedProfileId = null;
  closeM('profileDetail');
  renderProfiles();
}

export function selectProfile(id: string): void {
  state.selectedProfileId = id;
  renderProfiles();
  const p = state.profiles.find(pr => pr.id === id);
  if (!p) return;
  const el = <K extends keyof HTMLElementTagNameMap>(id: string) =>
    document.getElementById(id) as HTMLElementTagNameMap[K] | null;

  const pdName  = el<'div'>('pdName');
  const pdAddr  = el<'div'>('pdAddr');
  const pdType  = el<'div'>('pdType');
  const pdEmail = el<'div'>('pdEmail');
  const pdNotes = el<'div'>('pdNotes');
  if (pdName)  pdName.textContent  = p.name;
  if (pdAddr)  pdAddr.replaceChildren(buildCopyableValue(p.addr));
  if (pdType)  pdType.textContent  = p.type  || '—';
  if (pdEmail) pdEmail.textContent = p.email || '—';
  const pdMode = document.getElementById('pdMode');
  if (pdMode)  pdMode.textContent  = (p.mode ?? 'shielded') === 'shielded' ? 'Private' : 'Public';
  if (pdNotes) pdNotes.textContent = p.notes || '—';

  const txs = getTxsForAddr(p.addr);
  const pdTotal = document.getElementById('pdTotal');
  if (pdTotal) pdTotal.textContent = formatProfileTotal(txs);

  renderPdTxTable(p.addr, txs);

  openM('profileDetail');
}

function txTypeMeta(t: AuditTx): { label: string; badge: string } {
  const base = t.type ?? 'OneTime';
  if (base === 'OneTime')   return { label: 'One time',  badge: 'b-amber' };
  if (base === 'Recurrent') return { label: 'Recurrent', badge: 'b-blue' };
  if (base === 'Deposit')   return { label: 'Shield',    badge: 'b-green' };
  if (base === 'Onboard')   return { label: 'Activation', badge: 'b-gray' };
  if (base === 'UnshieldedTransfer') return { label: 'Sent', badge: 'b-amber' };
  return { label: base, badge: 'b-gray' };
}

function isShieldedRow(t: AuditTx): boolean {
  if (t.unshielded) return false; // wallet-direct rows never get the shield
  return t.type === 'OneTime' || t.type === 'Recurrent' || t.type === 'Deposit';
}

function shieldSlot(t: AuditTx, color: string): HTMLElement {
  const span = document.createElement('span');
  span.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;font-size:12px;line-height:1';
  if (isShieldedRow(t)) {
    span.innerHTML = SHIELD_SVG;
    span.title = 'Private — the amount is hidden on-chain';
    span.style.color = color;
  }
  return span;
}

// Mirrors the audit page's type-badge color → arrow-color mapping.
const BADGE_COLOR: Record<string, string> = {
  'b-green': '#16a34a',
  'b-blue':  'var(--accent)',
  'b-amber': '#b45309',
  'b-gray':  'var(--text2)',
};

function directionIcon(t: AuditTx, color: string): HTMLElement | null {
  if (t.type !== 'Deposit' && t.type !== 'OneTime' && t.type !== 'Recurrent' && t.type !== 'UnshieldedTransfer') return null;
  const isIn = t.type === 'Deposit';
  const span = document.createElement('span');
  span.title = isIn ? 'Incoming · deposit to pool' : 'Outgoing · payment';
  span.textContent = isIn ? '↙' : '↗';
  span.style.cssText = `font-size:14px;font-weight:500;line-height:1;color:${color}`;
  return span;
}

function recOrdersForAddr(addr: string): { order: RecOrder; index: number }[] {
  let target: bigint;
  try { target = BigInt(addr); } catch { return []; }
  const out: { order: RecOrder; index: number }[] = [];
  state.recOrders.forEach((r, i) => {
    if (r.active === false) return;
    try { if (BigInt(r.addr) === target) out.push({ order: r, index: i }); }
    catch { }
  });
  return out;
}

function nisValueFor(amount: number, currency: string): number {
  const rates = getNISRates();
  const rate = rates[currency.toLowerCase() as keyof typeof rates];
  if (!rate) return 0;
  return amount / rate;
}

function renderPdTxTable(addr: string, txs: AuditTx[]): void {
  const tbody = document.getElementById('pdTxTable');
  if (!tbody) return;
  const orders = recOrdersForAddr(addr);
  const upcoming = orders.map(({ order, index }) => buildUpcomingRow(order, index));
  const audit = txs.map((t) => buildAuditTxRow(t));
  const rows = [...upcoming, ...audit];
  if (rows.length === 0) {
    tbody.replaceChildren(emptyRow(6, 'No transactions yet'));
    return;
  }
  tbody.replaceChildren(...rows);
}

function buildAuditTxRow(t: AuditTx): HTMLTableRowElement {
  const meta = txTypeMeta(t);
  const isOnboard = t.type === 'Onboard';

  const tr = document.createElement('tr');

  const dateCell = document.createElement('td');
  dateCell.className = 'mono';
  dateCell.style.whiteSpace = 'nowrap';
  dateCell.textContent = t.time ? `${t.date} ${t.time}` : t.date;

  const typeCell = document.createElement('td');
  const typeInner = document.createElement('span');
  typeInner.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap';
  const typeColor = BADGE_COLOR[meta.badge] ?? 'var(--text2)';
  typeInner.appendChild(shieldSlot(t, typeColor));
  const dir = directionIcon(t, typeColor);
  if (dir) typeInner.appendChild(dir);
  const typeBadge = document.createElement('span');
  typeBadge.className = `badge ${meta.badge}`;
  typeBadge.textContent = meta.label;
  typeInner.appendChild(typeBadge);
  typeCell.appendChild(typeInner);

  const amountCell = document.createElement('td');
  amountCell.className = 'mono';
  amountCell.textContent = isOnboard || !t.currency
    ? '—'
    : fmtToken(t.amount, t.currency.toLowerCase());

  // Value column: prefer the operator's original unit when we stored it
  // (one-time transfers persist amountUnit + cryptoAmount via setTxMetadata),
  // otherwise fall back to the NIS equivalent of the on-chain amount.
  const nisCell = document.createElement('td');
  nisCell.className = 'mono';
  const txMeta = getTxMetadata(t.tx);
  if (isOnboard || !t.amount) {
    nisCell.textContent = '—';
  } else if (txMeta?.amountUnit && txMeta.amountUnit !== 'nis' && txMeta.cryptoAmount != null) {
    nisCell.textContent = fmtTypedAmount(txMeta.cryptoAmount, txMeta.amountUnit);
  } else {
    nisCell.textContent = fmtUsd(nisValueFor(t.amount, t.currency));
  }

  const txCell = document.createElement('td');
  txCell.className = 'masked';
  txCell.appendChild(buildCopyableValue(t.tx));

  const actionsCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:4px';
  actions.append(
    smallBtn('Details', 'pdExpandAudit', t.tx),
    smallBtn('Invoice', 'pdInvoiceAudit', t.tx),
  );
  actionsCell.appendChild(actions);

  tr.append(dateCell, typeCell, amountCell, nisCell, txCell, actionsCell);
  return tr;
}

function buildUpcomingRow(order: RecOrder, index: number): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const dateCell = document.createElement('td');
  dateCell.className = 'mono';
  dateCell.textContent = order.next || '—';

  const typeCell = document.createElement('td');
  const typeBadge = document.createElement('span');
  typeBadge.className = 'badge b-green';
  typeBadge.textContent = 'Future recurrent';
  typeCell.appendChild(typeBadge);

  // Currency lookups are case-sensitive on the NISRates keys (lowercase),
  // so legacy uppercase 'USDC' / 'STRK' / 'ETH' would yield NaN. Normalize.
  const currencyLc = (order.currency ?? 'USDC').toLowerCase();
  const amountCell = document.createElement('td');
  amountCell.className = 'mono';
  amountCell.textContent = fmtToken(nisToToken(order.nis, currencyLc, getNISRates()), currencyLc);

  // Value column: if the order was entered in a non-NIS currency, show that
  // value instead of the (derived) NIS amount.
  const valueCell = document.createElement('td');
  valueCell.className = 'mono';
  if (order.amountUnit && order.amountUnit !== 'nis' && order.cryptoAmount != null) {
    valueCell.textContent = fmtTypedAmount(order.cryptoAmount, order.amountUnit);
  } else {
    valueCell.textContent = fmtUsd(order.nis);
  }

  const scheduledCell = document.createElement('td');
  scheduledCell.style.cssText = 'color:var(--text3);font-size:12px';
  scheduledCell.textContent = 'scheduled';

  const actionsCell = document.createElement('td');
  actionsCell.appendChild(smallBtn('Edit', 'pdExpandOrder', String(index)));

  tr.append(dateCell, typeCell, amountCell, valueCell, scheduledCell, actionsCell);
  return tr;
}

// Thin local alias around the shared fmtIls. Kept so call sites here
// don't need editing if formatting rules diverge later.
function formatNis(n: number): string {
  return fmtIls(n);
}

// Aggregates a profile's outgoing payments by the unit the operator
// originally typed (NIS or a crypto symbol), and an overall NIS estimate
// from the on-chain crypto amounts. Onboard rows and zero-amount rows
// are skipped so they don't poison either total.
function formatProfileTotal(txs: AuditTx[]): string {
  const rates = getNISRates();
  const buckets: Record<string, number> = {};
  let nisEstimate = 0;
  for (const t of txs) {
    if (t.type === 'Onboard' || !t.amount) continue;
    const rate = rates[t.currency.toLowerCase() as keyof typeof rates];
    if (rate) nisEstimate += t.amount / rate;
    const meta = getTxMetadata(t.tx);
    if (meta?.amountUnit && meta.amountUnit !== 'nis' && meta.cryptoAmount != null) {
      buckets[meta.amountUnit] = (buckets[meta.amountUnit] ?? 0) + meta.cryptoAmount;
    } else if (rate) {
      buckets.nis = (buckets.nis ?? 0) + t.amount / rate;
    }
  }
  const parts: string[] = [];
  if (buckets.nis) parts.push(fmtUsd(buckets.nis));
  for (const [unit, sum] of Object.entries(buckets)) {
    if (unit === 'nis') continue;
    parts.push(fmtTypedAmount(sum, unit));
  }
  if (parts.length === 0) return '—';
  const overall = `≈ ${fmtUsd(nisEstimate)}`;
  // When everything was typed in NIS the breakdown is just the same value
  // as the overall estimate, so skip the parenthetical to avoid noise.
  return parts.length === 1 && buckets.nis ? overall : `${overall} (${parts.join(' + ')})`;
}

function smallBtn(label: string, kind: 'pdExpandAudit' | 'pdInvoiceAudit' | 'pdExpandOrder', value: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'btn btn-xs btn-s';
  btn.style.cssText = 'font-size:11px;padding:2px 8px';
  if (kind === 'pdExpandAudit')  btn.dataset.pdExpandAudit  = value;
  if (kind === 'pdInvoiceAudit') btn.dataset.pdInvoiceAudit = value;
  if (kind === 'pdExpandOrder')  btn.dataset.pdExpandOrder  = value;
  btn.textContent = label;
  return btn;
}

export function addToRecurrent(id?: string): void {
  const profileId = id ?? state.selectedProfileId;
  const p = state.profiles.find(pr => pr.id === profileId);
  if (!p) return;
  nav('recurrent');
  resetAddOrderForm();
  prefillAddOrderFromProfile(p.id);
  openM('addOrder');
}

export function goOneTime(): void {
  const p = state.profiles.find(pr => pr.id === state.selectedProfileId);
  if (p) {
    state.otRecipientName = p.name;
    (document.getElementById('otAddr')  as HTMLInputElement).value  = p.addr;
    prefillOneTimeAmount(p.nis);
  }
  nav('onetime');
}

// Seed the one-time amount field with the profile's NIS budget. The unit
// selector handles the conversion to the payment currency live.
function prefillOneTimeAmount(nis: number): void {
  if (!nis || nis <= 0) return;
  const input = document.getElementById('otCryptoAmt') as HTMLInputElement | null;
  const unit = document.getElementById('otAmountUnit') as HTMLSelectElement | null;
  if (input) input.value = String(nis);
  if (unit) unit.value = 'nis';
}

let abRows: { name: string; addr: string; email: string; type: string; notes: string }[] = [];

function showAbFB(type: 'ok' | 'err', msg: string): void {
  const el = document.getElementById('abCsvFeedback');
  if (!el) return;
  el.style.display = 'block';
  const div = document.createElement('div');
  div.className = `alert alert-${type === 'err' ? 'err' : 'success'}`;
  div.textContent = msg;
  el.replaceChildren(div);
}

export function handleAbDrop(e: DragEvent): void {
  e.preventDefault();
  document.getElementById('abDropzone')?.classList.remove('drag');
  const file = e.dataTransfer?.files[0];
  if (file) parseAbCsvFile(file);
}

export function parseAbCsvFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.csv')) { showAbFB('err', 'Not a CSV file'); return; }
  if (file.size > 2 * 1024 * 1024)               { showAbFB('err', 'File too large (max 2 MB)'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines   = (e.target!.result as string).trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const ni = headers.indexOf('name'), ai = headers.indexOf('address');
    const ei = headers.indexOf('email');
    const tyi = headers.indexOf('type');
    const noti = headers.indexOf('notes');
    if (ni < 0 || ai < 0) { showAbFB('err', 'Missing columns: need at least "name" and "address"'); return; }

    const rows: typeof abRows = [], errs: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const name = cols[ni], addr = cols[ai];
      if (!name) { errs.push(`Row ${i + 1}: missing name`); continue; }
      if (!validAddr(addr)) { errs.push(`Row ${i + 1}: invalid address`); continue; }
      rows.push({
        name, addr,
        email:  ei  >= 0 ? (cols[ei] || '') : '',
        type:   tyi >= 0 ? (cols[tyi] || '') : '',
        notes:  noti >= 0 ? (cols[noti] || '') : '',
      });
    }
    abRows = rows;

    const preview = document.getElementById('abCsvPreview');
    if (preview) {
      const nodes: HTMLTableRowElement[] = rows.slice(0, 8).map((r, i) => buildAbCsvPreviewRow(r, i));
      if (rows.length > 8) nodes.push(buildAbMoreRow(rows.length - 8));
      preview.replaceChildren(...nodes);
    }

    const countLabel = document.getElementById('abCsvCountLabel');
    const validNote  = document.getElementById('abCsvValidNote');
    if (countLabel) countLabel.textContent = `(${rows.length} rows)`;
    if (validNote) {
      validNote.textContent = errs.length ? `${errs.length} row(s) skipped` : 'All rows valid';
      (validNote as HTMLElement).style.color = errs.length ? 'var(--danger)' : '#16a34a';
    }
    if (errs.length) showAbFB('err', errs.slice(0, 3).join(' · '));
    else showAbFB('ok', rows.length + ' valid row' + (rows.length !== 1 ? 's' : '') + ' loaded');

    const btn = document.getElementById('abImportDoneBtn') as HTMLButtonElement | null;
    if (btn) btn.disabled = rows.length === 0;
  };
  reader.readAsText(file);
}

export function importAbDone(): void {
  if (abRows.length === 0) { closeM('importProfilesCsv'); return; }
  for (const r of abRows) {
    if (!state.profiles.find(p => p.addr === r.addr)) {
      state.profiles.push({
        id: 'p' + Date.now() + Math.random(), name: r.name, addr: r.addr,
        nis: 0,
        type: r.type || undefined,
        email: r.email || undefined,
        notes: r.notes || undefined,
        txs: [],
      });
    }
  }
  saveProfiles();
  renderProfiles();

  abRows = [];
  const preview = document.getElementById('abCsvPreview');
  if (preview) preview.replaceChildren(emptyRow(6, 'No file loaded'));
  const countLabel = document.getElementById('abCsvCountLabel');
  if (countLabel) countLabel.textContent = '(0 rows)';
  const btn = document.getElementById('abImportDoneBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  closeM('importProfilesCsv');
}

export async function saveProfile(): Promise<void> {
  const name  = (document.getElementById('npName')  as HTMLInputElement).value.trim();
  const addr  = (document.getElementById('npAddr')  as HTMLInputElement).value.trim();
  const type  = (document.getElementById('npType')  as HTMLSelectElement).value || undefined;
  const email = (document.getElementById('npEmail') as HTMLInputElement | null)?.value.trim() || undefined;
  const mode  = ((document.getElementById('npMode') as HTMLSelectElement | null)?.value as 'shielded' | 'unshielded' | undefined) || undefined;
  const notes = (document.getElementById('npNotes') as HTMLTextAreaElement).value.trim() || undefined;
  let invalid = false;
  if (!name)               { flagInvalid('npName'); invalid = true; }
  if (!validAddr(addr))    { flagInvalid('npAddr'); invalid = true; }
  else if (burnAddr(addr)) { flagInvalid('npAddr'); invalid = true; }
  if (invalid) return;

  const editing = state.editingProfileId
    ? state.profiles.find((p) => p.id === state.editingProfileId)
    : null;
  const addressChanged = !editing || editing.addr.toLowerCase() !== addr.toLowerCase();
  if (addressChanged) {
    const registered = await isUserRegisteredInPool(state.provider, addr);
    if (!registered) {
      const proceed = await showConfirm(
        `${name} can't receive private payments yet.\n\n` +
        `You can still save them — private payments to ` +
        `${addr.slice(0, 10)}…${addr.slice(-4)} will fail until they ` +
        `activate PriPay for themselves. Public payments work right away.`,
        { title: 'Can’t receive private payments yet', okLabel: 'Save anyway' },
      );
      if (!proceed) return;
    }
  }

  let previousAddr: string | null = null;
  if (editing) {
    previousAddr = editing.addr;
    editing.name = name;
    editing.addr = addr;
    editing.type = type;
    editing.email = email;
    editing.mode = mode;
    editing.notes = notes;
    state.editingProfileId = null;
  } else {
    state.profiles.push({ id: 'p' + Date.now() + Math.random(), name, addr, nis: 0, type, email, mode, notes, txs: [] });
  }
  saveProfiles();
  // Propagate to matching recurrent orders + tell other pages to re-render.
  // Same forward-sync as saveDetailEdit (inline detail editor) — the two
  // save paths must stay in lockstep or the rec table goes stale.
  if (previousAddr != null) syncRecOrdersName(previousAddr, addr, name);
  renderProfiles();
  if (state.selectedProfileId) selectProfile(state.selectedProfileId);
  closeM('addProfile');
  resetAddProfileForm();
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

// Inline edit on the profile detail card — swaps the static spans for input
// elements and the view action buttons for Save/Cancel, without opening a
// modal. The Edit-profile entry in the address-book grid still uses the
// modal flow (openEditProfile) since there's no inline context there.
let detailEditing = false;

export function isDetailEditing(): boolean {
  return detailEditing;
}

// Surfaces a red note under Save when the operator does something
// incompatible with the open editor (clicking another profile, etc.).
// Auto-clears after a beat so it doesn't linger forever.
let editErrClearTimer: ReturnType<typeof setTimeout> | null = null;
export function flashDetailEditError(msg: string): void {
  const el = document.getElementById('pdEditErr');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  if (editErrClearTimer) clearTimeout(editErrClearTimer);
  editErrClearTimer = setTimeout(() => {
    el.style.display = 'none';
    el.textContent = '';
    editErrClearTimer = null;
  }, 4000);
}

function clearDetailEditError(): void {
  const el = document.getElementById('pdEditErr');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
  if (editErrClearTimer) { clearTimeout(editErrClearTimer); editErrClearTimer = null; }
}

export function enterDetailEdit(): void {
  const p = state.profiles.find((pr) => pr.id === state.selectedProfileId);
  if (!p) return;
  detailEditing = true;
  clearDetailEditError();
  setDetailEditMode(p, true);
}

export function cancelDetailEdit(): void {
  const p = state.profiles.find((pr) => pr.id === state.selectedProfileId);
  if (!p) return;
  detailEditing = false;
  clearDetailEditError();
  setDetailEditMode(p, false);
}

export async function saveDetailEdit(): Promise<void> {
  const p = state.profiles.find((pr) => pr.id === state.selectedProfileId);
  if (!p) return;
  const name  = (document.getElementById('pdNameIn')  as HTMLInputElement)?.value.trim();
  const addr  = (document.getElementById('pdAddrIn')  as HTMLInputElement)?.value.trim();
  const type  = (document.getElementById('pdTypeIn')  as HTMLSelectElement)?.value;
  const email = (document.getElementById('pdEmailIn') as HTMLInputElement)?.value.trim();
  const mode  = (document.getElementById('pdModeIn') as HTMLSelectElement)?.value as 'shielded' | 'unshielded' | undefined;
  const notes = (document.getElementById('pdNotesIn') as HTMLTextAreaElement)?.value.trim();
  let invalid = false;
  if (!name)                     { flagInvalid('pdNameIn'); invalid = true; }
  if (!addr || !validAddr(addr)) { flagInvalid('pdAddrIn'); invalid = true; }
  if (invalid) return;
  const previousAddr = p.addr;
  p.name  = name;
  p.addr  = addr;
  p.type  = type  || undefined;
  p.email = email || undefined;
  p.mode  = mode || undefined;
  p.notes = notes || undefined;
  saveProfiles();
  // Propagate the name + mode to recurrent orders that point at the same
  // wallet (BigInt-normalized so 0x07b1… and 0x7b1… match). Without this,
  // the recurrent table keeps the stale name because r.name is denormalized.
  syncRecOrdersName(previousAddr, p.addr, p.name);
  // If the one-time form was prefilled from this profile, refresh its
  // recipient tag so it doesn't keep showing the old name.
  if (state.otRecipientName != null) {
    try {
      if (BigInt(addr) === BigInt(previousAddr)) state.otRecipientName = p.name;
    } catch { /* malformed addrs — ignore */ }
  }
  detailEditing = false;
  clearDetailEditError();
  setDetailEditMode(p, false);
  // Refresh the address-book row so the new name/type/etc. show there too.
  renderProfiles();
  // Tell other pages to re-render. The audit-updated event already wires
  // audit / recent-transfers / open profile detail re-renders in main.ts.
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

// Propagates name + address changes from the profile to any matching
// recurrent order. Deliberately does NOT touch `order.mode` — once an
// order is created it owns its own transfer mode; changing the profile's
// default never overrides what the operator set on a specific order.
function syncRecOrdersName(oldAddr: string, newAddr: string, name: string): void {
  let normalizedOld: bigint;
  let normalizedNew: bigint;
  try {
    normalizedOld = BigInt(oldAddr);
    normalizedNew = BigInt(newAddr);
  } catch { return; }
  let mutated = false;
  for (const order of state.recOrders) {
    try {
      const orderAddr = BigInt(order.addr);
      if (orderAddr === normalizedOld || orderAddr === normalizedNew) {
        if (order.name !== name || order.addr !== newAddr) {
          order.name = name;
          order.addr = newAddr;
          mutated = true;
        }
      }
    } catch { /* skip malformed */ }
  }
  if (mutated) saveRecOrders();
}

function setDetailEditMode(p: typeof state.profiles[number], on: boolean): void {
  const pdName  = document.getElementById('pdName');
  const pdAddr  = document.getElementById('pdAddr');
  const pdType  = document.getElementById('pdType');
  const pdEmail = document.getElementById('pdEmail');
  const pdMode  = document.getElementById('pdMode');
  const pdNotes = document.getElementById('pdNotes');
  const viewActions = document.getElementById('pdViewActions');
  const editActions = document.getElementById('pdEditActions');
  if (viewActions) viewActions.style.display = on ? 'none' : 'flex';
  if (editActions) editActions.style.display = on ? 'flex' : 'none';

  if (!on) {
    if (pdName)  pdName.textContent  = p.name;
    if (pdAddr)  pdAddr.replaceChildren(buildCopyableValue(p.addr));
    if (pdType)  pdType.textContent  = p.type  || '—';
    if (pdEmail) pdEmail.textContent = p.email || '—';
    if (pdMode)  pdMode.textContent  = (p.mode ?? 'shielded') === 'shielded' ? 'Private' : 'Public';
    if (pdNotes) pdNotes.textContent = p.notes || '—';
    return;
  }

  if (pdName) {
    pdName.replaceChildren(makeInlineInput('pdNameIn', p.name, 'Name', { fontSize: '15px', fontWeight: '600' }));
  }
  if (pdAddr) {
    pdAddr.replaceChildren(makeInlineInput('pdAddrIn', p.addr, '0x...', { fontFamily: 'monospace', fontSize: '11px' }));
  }
  if (pdType) {
    const sel = document.createElement('select');
    sel.id = 'pdTypeIn';
    sel.className = 'sel';
    sel.style.fontSize = '13px';
    for (const opt of ['', 'Employee', 'Contractor', 'Vendor', 'Advisor']) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt || '— Select —';
      if ((p.type || '') === opt) o.selected = true;
      sel.appendChild(o);
    }
    pdType.replaceChildren(sel);
  }
  if (pdEmail) {
    pdEmail.replaceChildren(makeInlineInput('pdEmailIn', p.email || '', 'name@example.com'));
  }
  if (pdMode) {
    const sel = document.createElement('select');
    sel.id = 'pdModeIn';
    sel.className = 'sel';
    sel.style.fontSize = '13px';
    for (const [val, label] of [['shielded', 'Private'], ['unshielded', 'Public']] as const) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      if ((p.mode ?? 'shielded') === val) o.selected = true;
      sel.appendChild(o);
    }
    pdMode.replaceChildren(sel);
  }
  if (pdNotes) {
    const ta = document.createElement('textarea');
    ta.id = 'pdNotesIn';
    ta.className = 'inp';
    ta.rows = 2;
    ta.style.resize = 'vertical';
    ta.value = p.notes || '';
    pdNotes.replaceChildren(ta);
  }
}

function makeInlineInput(id: string, value: string, placeholder: string, styles?: Record<string, string>): HTMLInputElement {
  const inp = document.createElement('input');
  inp.id = id;
  inp.className = 'inp';
  inp.value = value;
  inp.placeholder = placeholder;
  if (styles) for (const [k, v] of Object.entries(styles)) (inp.style as unknown as Record<string, string>)[k] = v;
  return inp;
}

export function openEditProfile(id: string): void {
  const p = state.profiles.find((pr) => pr.id === id);
  if (!p) return;
  state.editingProfileId = id;
  (document.getElementById('npName')  as HTMLInputElement).value = p.name;
  (document.getElementById('npAddr')  as HTMLInputElement).value = p.addr;
  (document.getElementById('npType')  as HTMLSelectElement).value = p.type || '';
  const npEmail = document.getElementById('npEmail') as HTMLInputElement | null;
  if (npEmail) npEmail.value = p.email || '';
  const npMode = document.getElementById('npMode') as HTMLSelectElement | null;
  if (npMode) npMode.value = p.mode ?? 'shielded';
  (document.getElementById('npNotes') as HTMLTextAreaElement).value = p.notes || '';
  setAddProfileTitle('Edit profile');
  openM('addProfile');
}

let pendingRemovalId: string | null = null;
export function removeProfile(id: string): void {
  const p = state.profiles.find((pr) => pr.id === id);
  if (!p) return;
  pendingRemovalId = id;
  const nameEl = document.getElementById('rmProfileName');
  if (nameEl) nameEl.textContent = p.name;
  // Warn when removing this profile will also drop recurrent orders
  // pointing at the same wallet — that's the new behaviour and the
  // operator needs to see how many before clicking Remove.
  const note = document.getElementById('rmProfileOrdersNote');
  if (note) {
    const linked = countOrdersForAddr(p.addr);
    if (linked > 0) {
      note.style.display = 'block';
      note.textContent = `Will also delete ${linked} order${linked === 1 ? '' : 's'} pointing at this address.`;
    } else {
      note.style.display = 'none';
      note.textContent = '';
    }
  }
  openM('removeProfile');
}

function countOrdersForAddr(addr: string): number {
  let target: bigint;
  try { target = BigInt(addr); } catch { return 0; }
  return state.recOrders.filter((o) => {
    try { return BigInt(o.addr) === target; } catch { return false; }
  }).length;
}

export function confirmRemoveProfile(): void {
  const id = pendingRemovalId;
  pendingRemovalId = null;
  if (!id) return;
  const removed = state.profiles.find((pr) => pr.id === id);
  state.profiles = state.profiles.filter((pr) => pr.id !== id);
  // Cascade: drop any recurrent order pointing at the same wallet.
  // BigInt normalization so 0x07b1… and 0x7b1… resolve to the same row.
  if (removed) {
    let target: bigint | null = null;
    try { target = BigInt(removed.addr); } catch { /* malformed addr, skip cascade */ }
    if (target != null) {
      const filtered = state.recOrders.filter((o) => {
        try { return BigInt(o.addr) !== target!; } catch { return true; }
      });
      if (filtered.length !== state.recOrders.length) {
        state.recOrders = filtered;
        saveRecOrders();
      }
    }
  }
  if (state.selectedProfileId === id) {
    state.selectedProfileId = null;
    closeM('profileDetail');
  }
  saveProfiles();
  renderProfiles();
  // Recurrent table on a separate page; re-render it so the cascade
  // is visible the next time the operator visits.
  document.dispatchEvent(new CustomEvent('audit-updated'));
  closeM('removeProfile');
}

function setAddProfileTitle(title: string): void {
  const el = document.querySelector<HTMLElement>('#modal-addProfile .mt');
  if (el) el.textContent = title;
}

export function resetAddProfileForm(): void {
  state.editingProfileId = null;
  ['npName', 'npAddr', 'npEmail', 'npNotes'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && 'value' in el) (el as HTMLInputElement).value = '';
  });
  (document.getElementById('npType')  as HTMLSelectElement).value = '';
  setAddProfileTitle('Add profile');
}

let cipIds: string[] = [];
export function openCompleteImportedProfiles(ids: string[]): void {
  cipIds = ids.slice();
  if (cipIds.length === 0) return;
  const tbody = document.getElementById('cipRows');
  const countEl = document.getElementById('cipCount');
  if (countEl) countEl.textContent = String(cipIds.length);
  if (!tbody) return;

  const TYPES = ['', 'Employee', 'Contractor', 'Vendor', 'Advisor'];
  tbody.replaceChildren(...cipIds.map((id, idx) => {
    const p = state.profiles.find((pr) => pr.id === id);
    if (!p) return document.createElement('tr');
    const tr = document.createElement('tr');
    tr.dataset.cipId = id;

    const tdIdx = document.createElement('td');
    tdIdx.className = 'mono';
    tdIdx.style.color = 'var(--text3)';
    tdIdx.textContent = String(idx + 1);
    tr.appendChild(tdIdx);

    const tdAddr = document.createElement('td');
    tdAddr.className = 'masked';
    tdAddr.style.whiteSpace = 'nowrap';
    tdAddr.appendChild(buildCopyableValue(p.addr));
    tr.appendChild(tdAddr);

    const mkInputCell = (cls: string, placeholder: string, value: string): HTMLTableCellElement => {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.className = 'inp';
      input.dataset.cipField = cls;
      input.placeholder = placeholder;
      input.value = value;
      input.style.padding = '4px 8px';
      input.style.fontSize = '12px';
      cell.appendChild(input);
      return cell;
    };
    tr.appendChild(mkInputCell('name', 'Name', p.name.startsWith('Imported ') ? '' : p.name));
    tr.appendChild(mkInputCell('email', 'email@…', p.email || ''));

    const tdType = document.createElement('td');
    const sel = document.createElement('select');
    sel.className = 'sel';
    sel.dataset.cipField = 'type';
    sel.style.padding = '4px 8px';
    sel.style.fontSize = '12px';
    TYPES.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t || '— Select —';
      if ((p.type || '') === t) opt.selected = true;
      sel.appendChild(opt);
    });
    tdType.appendChild(sel);
    tr.appendChild(tdType);

    // Mode select — pre-filled from the value the import inferred from
    // the CSV row(s) for this address (shielded wins when mixed).
    const tdMode = document.createElement('td');
    const modeSel = document.createElement('select');
    modeSel.className = 'sel';
    modeSel.dataset.cipField = 'mode';
    modeSel.style.padding = '4px 8px';
    modeSel.style.fontSize = '12px';
    for (const [val, label] of [['shielded', 'Private'], ['unshielded', 'Public']] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if ((p.mode ?? 'shielded') === val) opt.selected = true;
      modeSel.appendChild(opt);
    }
    tdMode.appendChild(modeSel);
    tr.appendChild(tdMode);

    tr.appendChild(mkInputCell('notes', 'Notes', p.notes || ''));
    return tr;
  }));
  openM('completeImportedProfiles');
}

export function saveCompleteImportedProfiles(): void {
  const tbody = document.getElementById('cipRows');
  if (!tbody) { closeM('completeImportedProfiles'); return; }
  tbody.querySelectorAll<HTMLElement>('tr[data-cip-id]').forEach((tr) => {
    const id = tr.dataset.cipId!;
    const p = state.profiles.find((pr) => pr.id === id);
    if (!p) return;
    const getField = (name: string): string => {
      const el = tr.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-cip-field="${name}"]`);
      return el?.value.trim() ?? '';
    };
    const newName = getField('name');
    if (newName) p.name = newName;
    p.email = getField('email') || undefined;
    p.type  = getField('type')  || undefined;
    const m = getField('mode');
    p.mode  = m === 'shielded' || m === 'unshielded' ? m : undefined;
    p.notes = getField('notes') || undefined;
    // The imported recurrent orders were created with the placeholder
    // "Imported 0x…" name before the operator got a chance to rename
    // here. Propagate the new name back to any order pointing at the
    // same wallet so the recurrent table reads correctly.
    syncRecOrdersName(p.addr, p.addr, p.name);
  });
  saveProfiles();
  renderProfiles();
  if (state.selectedProfileId) selectProfile(state.selectedProfileId);
  cipIds = [];
  closeM('completeImportedProfiles');
  // Tell other pages (recurrent table, audit) to re-render against the
  // newly-renamed orders.
  document.dispatchEvent(new CustomEvent('audit-updated'));
}

export function populatePickProfile(): void {
  const search = document.getElementById('pickProfileSearch') as HTMLInputElement | null;
  if (search) {
    search.value = '';
    // Focus on next tick so the modal's display change finishes first
    // (autofocus would otherwise compete with the modal's open transition).
    setTimeout(() => search.focus(), 50);
  }
  renderPickProfileList();
}

export function renderPickProfileList(): void {
  const list = document.getElementById('pickProfileList');
  const empty = document.getElementById('pickProfileEmpty');
  if (!list) return;
  const q = ((document.getElementById('pickProfileSearch') as HTMLInputElement | null)?.value ?? '').toLowerCase().trim();
  const matches = q
    ? state.profiles.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.addr.toLowerCase().includes(q))
    : state.profiles;
  list.replaceChildren(...matches.map(buildPickProfileCard));
  if (empty) empty.style.display = matches.length === 0 ? 'block' : 'none';
}

function buildPickProfileCard(p: typeof state.profiles[number]): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'pcard';
  card.dataset.pickProfile = p.id;
  card.style.cssText = 'padding:12px;margin-bottom:6px;cursor:pointer';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px';

  const av = document.createElement('div');
  av.className = 'avatar';
  av.style.cssText = 'width:34px;height:34px;font-size:11px';
  av.textContent = initials(p.name);

  const info = document.createElement('div');
  info.style.flex = '1';
  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:13px;font-weight:500';
  nameEl.textContent = p.name;
  info.append(nameEl);

  row.append(av, info);
  card.appendChild(row);
  return card;
}

export function prefillOneTime(id: string): void {
  const p = state.profiles.find(pr => pr.id === id);
  if (p) {
    state.otRecipientName = p.name;
    (document.getElementById('otAddr')  as HTMLInputElement).value  = p.addr;
    prefillOneTimeAmount(p.nis);
    setOtRecipient(p.name, p.addr);
    setOtMode(p.mode ?? 'shielded');
    calcOT();
  }
  closeM('pickProfile');
}
