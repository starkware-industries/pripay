import { state, auditTxs } from '../core/state';
import { fmtToken, buildCopyableValue, SHIELD_SVG } from '../core/utils';
import { pageSlice, renderPager } from '../core/pagination';
import { openM } from '../core/modals';
import { EXPLORER_URL } from '../sdk_integration/network-config';
import type { AuditTx } from '../core/types';

const auditSelected = new Set<number>();

function resolveName(t: AuditTx): string {
  if (t.name) return t.name;
  // BigInt-equality so different zero-padding (chain pads to 64 hex; user
  // might have entered 63-char) still aligns. Prior startsWith-on-prefix
  // approach missed profiles whose address didn't have a leading zero.
  let target: bigint;
  try { target = BigInt(t.addr); } catch { return '—'; }
  // Shield/funding legs both reference the PayrollContract — surface it as
  // the shielded pool rather than a bare '—' or raw hex.
  if (state.payrollAddress) {
    try { if (BigInt(state.payrollAddress) === target) return 'Private balance'; } catch { /* fall through */ }
  }
  if (state.walletConnected) {
    try { if (BigInt(state.walletConnected) === target) return 'Your wallet'; } catch { /* fall through */ }
  }
  return state.profiles.find((p) => {
    try { return BigInt(p.addr) === target; } catch { return false; }
  })?.name ?? '—';
}

// Per-type visual treatment + display label. Keeping the mapping next to
// renderAudit so future additions (e.g. 'Withdraw') just need one entry.
const TYPE_VISUALS: Record<string, { label: string; badgeClass: string; rowAccent?: string }> = {
  Onboard:            { label: 'Activation',    badgeClass: 'b-gray',  rowAccent: 'var(--bg3)' },
  Deposit:            { label: 'Deposit',       badgeClass: 'b-green' },
  OneTime:            { label: 'Sent · one-off', badgeClass: 'b-amber' },
  Recurrent:          { label: 'Payroll',       badgeClass: 'b-blue' },
  // Public (wallet-direct) sends get their own badge so the private/public
  // distinction is visible at a glance, not just via the shield mark.
  UnshieldedTransfer: { label: 'Sent · public', badgeClass: 'b-gray' },
};

// Returns true when the row represents a tx that went through the
// privacy pool (= we should render the shield indicator next to it).
function isShieldedRow(t: AuditTx): boolean {
  if (t.unshielded) return false; // wallet-direct rows never get the shield
  return t.type === 'OneTime' || t.type === 'Recurrent' || t.type === 'Deposit';
}

// Fixed-width shield slot keeps the type column aligned across rows
// whether or not the icon is present (unshielded rows reserve the same
// horizontal space so the badges line up vertically).
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

let typeFilter: string = 'all';
let auditPage = 1;

// Row selection is gone (no more checkboxes), so the toolbar button always
// acts on everything currently in view — generateInvoiceForSelected already
// falls back to the filtered set when nothing is selected.
function syncAuditSelectAll(): void {
  const total = filteredRows().length;
  const btn = document.getElementById('generateInvoiceBtn') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = total === 0;
    btn.style.opacity = total === 0 ? '0.45' : '';
    btn.style.cursor = total === 0 ? 'not-allowed' : '';
    btn.textContent = 'Invoice all';
    btn.title = 'Create one invoice for everything in view';
  }
}

export function toggleAuditSelectAll(checked: boolean): void {
  const rows = filteredRows();
  if (checked) rows.forEach((_, i) => auditSelected.add(i));
  else auditSelected.clear();
  document.querySelectorAll<HTMLInputElement>('.audit-cb').forEach((cb) => {
    cb.checked = auditSelected.has(parseInt(cb.dataset.idx!, 10));
  });
  syncAuditSelectAll();
}

export function toggleAuditRow(idx: number, checked: boolean): void {
  if (checked) auditSelected.add(idx);
  else auditSelected.delete(idx);
  syncAuditSelectAll();
}

function fmtAmountCell(t: AuditTx): string {
  if (t.type === 'Onboard' || !t.currency || t.currency === '—') return '—';
  return fmtToken(t.amount, t.currency.toLowerCase());
}

// Badge text colors, mirrored from styles.css so the direction arrow can
// match the row's type color.
const BADGE_COLOR: Record<string, string> = {
  'b-green': '#16a34a',
  'b-blue':  'var(--accent)',
  'b-amber': '#b45309',
  'b-gray':  'var(--text2)',
};

// Small arrow next to the type badge: inbound (↙) for deposits, outbound (↗)
// for payments, tinted to the row's type color. Onboard rows get no arrow.
function directionIcon(t: AuditTx, color: string): HTMLElement | null {
  if (t.type !== 'Deposit' && t.type !== 'OneTime' && t.type !== 'Recurrent' && t.type !== 'UnshieldedTransfer') return null;
  const isIn = t.type === 'Deposit';
  const span = document.createElement('span');
  span.title = isIn ? 'Incoming · deposit to pool' : 'Outgoing · payment';
  span.textContent = isIn ? '↙' : '↗';
  span.style.cssText = `font-size:14px;font-weight:500;line-height:1;color:${color}`;
  return span;
}

// Builds one <tr> with createElement/textContent so profile names and
// descriptions can't inject markup (avoids the innerHTML XSS surface).
function buildRow(t: AuditTx, idx: number): HTMLTableRowElement {
  const v = TYPE_VISUALS[t.type ?? ''] ?? { label: t.type ?? '—', badgeClass: 'b-gray' };
  const tr = document.createElement('tr');
  if (v.rowAccent) tr.style.background = v.rowAccent;

  const td = (text: string, className?: string) => {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text;
    return cell;
  };

  const dateCell = td(t.time ? `${t.date} ${t.time}` : t.date, 'mono');
  dateCell.style.whiteSpace = 'nowrap';
  tr.appendChild(dateCell);

  // Type badge + a small direction arrow (out = payment, in = deposit)
  // + a shield icon for txs that went through the privacy pool so the
  // operator can tell at a glance which rows were privacy-preserving.
  const typeCell = document.createElement('td');
  const typeInner = document.createElement('span');
  typeInner.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap';
  const typeColor = BADGE_COLOR[v.badgeClass] ?? 'var(--text2)';
  typeInner.appendChild(shieldSlot(t, typeColor));
  const dir = directionIcon(t, typeColor);
  if (dir) typeInner.appendChild(dir);
  const badge = document.createElement('span');
  badge.className = `badge ${v.badgeClass}`;
  badge.textContent = v.label;
  typeInner.appendChild(badge);
  typeCell.appendChild(typeInner);
  tr.appendChild(typeCell);

  const nameCell = td(resolveName(t));
  nameCell.style.fontSize = '13px';
  nameCell.style.fontWeight = '500';
  tr.appendChild(nameCell);
  const addrCell = document.createElement('td');
  addrCell.className = 'masked';
  addrCell.style.whiteSpace = 'nowrap';
  addrCell.appendChild(buildCopyableValue(t.addr));
  tr.appendChild(addrCell);
  // Amount cell already includes the currency symbol via fmtToken
  // (e.g. "2.00 STRK"), so a separate Currency column is redundant.
  // The TX hash is intentionally not shown here — it lives in the expand.
  const amtCell = td(fmtAmountCell(t), 'mono');
  amtCell.style.whiteSpace = 'nowrap';
  tr.appendChild(amtCell);

  // The buttons live in an inner flex div, NOT a flex <td> — a flex table
  // cell drops out of the row's vertical alignment and shifts the line.
  const btnCell = document.createElement('td');
  btnCell.style.whiteSpace = 'nowrap';
  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'display:flex;gap:4px';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'btn btn-xs btn-s';
  expandBtn.style.fontSize = '11px';
  expandBtn.style.padding = '2px 8px';
  expandBtn.dataset.auditExpand = String(idx);
  expandBtn.textContent = 'Details';
  btnWrap.appendChild(expandBtn);

  const invBtn = document.createElement('button');
  invBtn.className = 'btn btn-xs btn-s';
  invBtn.style.fontSize = '11px';
  invBtn.style.padding = '2px 8px';
  invBtn.dataset.auditInvoice = String(idx);
  invBtn.textContent = 'Invoice';
  btnWrap.appendChild(invBtn);

  btnCell.appendChild(btnWrap);
  tr.appendChild(btnCell);

  return tr;
}

export function renderAudit(rows: AuditTx[] = filteredRows()): void {
  const count = document.getElementById('auditCount');
  if (count) count.textContent = rows.length + ' records';

  const tbody = document.getElementById('auditTable');
  if (!tbody) return;
  auditSelected.clear();
  // Paginate the display; row indices stay absolute (offset + j) so the
  // detail/invoice lookups into filteredRows() keep working.
  const { slice, page, pages, offset } = pageSlice(rows, auditPage);
  auditPage = page;
  tbody.replaceChildren(...slice.map((t, j) => buildRow(t, offset + j)));
  renderPager('auditPager', page, pages, (p) => { auditPage = p; renderAudit(); });
  if (rows.length === 0) {
    // Same empty-state row (and row-hover treatment) as the People table.
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.style.cssText = 'text-align:center;color:var(--text3);padding:24px';
    td.textContent = 'No transactions found';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  syncAuditSelectAll();
}

// BigInt-normalized hex so a pasted "0x7b1…" matches a stored "0x07b1…"
// (the indexer pads addresses + tx hashes to 64 hex; user copies are
// often unpadded). Returns null when the input isn't a valid hex.
function normalizeHex(s: string): string | null {
  if (!/^0x[0-9a-f]+$/i.test(s)) return null;
  try { return '0x' + BigInt(s).toString(16); } catch { return null; }
}

function filteredRows(): AuditTx[] {
  const q = ((document.getElementById('auditFilter') as HTMLInputElement | null)?.value ?? '').toLowerCase().trim();
  const qHex = q ? normalizeHex(q) : null;
  const matchesSearch = (t: AuditTx) => {
    if (!q) return true;
    if (resolveName(t).toLowerCase().includes(q)) return true;
    if (t.addr.toLowerCase().includes(q)) return true;
    if (t.tx.toLowerCase().includes(q)) return true;
    if ((t.description || '').toLowerCase().includes(q)) return true;
    if ((t.date || '').includes(q)) return true; // header calendar filters by day (YYYY-MM-DD)
    if (qHex) {
      const txN = normalizeHex(t.tx);
      const addrN = normalizeHex(t.addr);
      if (txN && txN.includes(qHex)) return true;
      if (addrN && addrN.includes(qHex)) return true;
    }
    return false;
  };
  const matchesType = (t: AuditTx) => {
    if (typeFilter === 'all') return true;
    const type = t.type ?? '';
    // 'sent' collapses both shielded one-time + recurrent + direct
    // wallet ERC20 transfers under one filter — they're all "money I
    // sent" from the operator's perspective.
    if (typeFilter === 'sent') {
      return type === 'OneTime' || type === 'Recurrent' || type === 'UnshieldedTransfer';
    }
    // 'OneTime' filter includes the unshielded direct-wallet equivalent.
    if (typeFilter === 'OneTime') {
      return type === 'OneTime' || type === 'UnshieldedTransfer';
    }
    return type === typeFilter;
  };
  return auditTxs.filter((t) => matchesSearch(t) && matchesType(t));
}

export function filterAudit(): void {
  auditPage = 1;
  renderAudit();
}

export function setAuditTypeFilter(value: string): void {
  typeFilter = value;
  auditPage = 1;
  document.querySelectorAll<HTMLElement>('#auditTypeFilter [data-audit-type]')
    .forEach((el) => el.classList.toggle('active', el.dataset.auditType === value));
  renderAudit();
}

export function openAuditDetail(idx: number): void {
  const rows = filteredRows();
  const t = rows[idx];
  if (!t) return;
  showAuditDetail(t);
}

// Opens the audit-detail modal for a specific tx by hash. Used from the
// profile page where the row index isn't the same as the global audit-page
// filtered index.
export function openAuditDetailByTx(txHash: string): void {
  const t = auditTxs.find((row) => row.tx === txHash);
  if (!t) return;
  showAuditDetail(t);
}

function showAuditDetail(t: AuditTx): void {
  const name = resolveName(t);
  const set = (id: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('adName',        name);
  set('adType',        TYPE_VISUALS[t.type ?? '']?.label ?? (t.type ?? '—'));
  set('adDate',        t.date);
  set('adTime',        t.time || '—');
  set('adAmount',      fmtAmountCell(t));
  // The amount cell already includes the currency symbol; clear the
  // standalone currency field so it doesn't render a duplicate.
  set('adCurrency',    '');
  set('adDescription', t.description || '—');
  // Address + tx hash use the dashboard's truncated + hover/copy treatment.
  const addrEl = document.getElementById('adAddr');
  if (addrEl) addrEl.replaceChildren(buildCopyableValue(t.addr));
  const txEl = document.getElementById('adTx');
  if (txEl) txEl.replaceChildren(buildCopyableValue(t.tx));
  const explorer = document.getElementById('adExplorer') as HTMLAnchorElement | null;
  if (explorer) explorer.href = `${EXPLORER_URL}/tx/${t.tx}`;
  openM('auditDetail');
}

export function exportAuditCsv(): void {
  const rows = filteredRows();
  const header = 'Date,Type,Name,Address,Amount,Currency,TX ID,Description';
  const csv = [header, ...rows.map(t =>
    [t.date, t.type ?? '', resolveName(t), t.addr, t.amount, t.currency, t.tx, t.description ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildInvoiceHtml(txs: AuditTx[]): string {
  const company = state.companyInfo;
  const now = new Date();
  const invoiceNum = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getTime()).slice(-5)}`;
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const genDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const rows = txs.map((t, i) => {
    const name = resolveName(t);
    const label = TYPE_VISUALS[t.type ?? '']?.label ?? (t.type ?? '—');
    const amt = fmtAmountCell(t);
    const shortTx = t.tx.length > 18 ? t.tx.slice(0, 10) + '…' + t.tx.slice(-6) : t.tx;
    return `
      <tr style="border-bottom:1px solid #e8e8e8">
        <td style="padding:10px 14px;font-size:13px">${i + 1}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:500">${esc(name)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#555">${esc(t.description || label)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#555">${esc(t.date)}</td>
        <td style="padding:10px 14px;font-size:13px;font-family:monospace;text-align:right">${esc(amt)}</td>
        <td style="padding:10px 14px;font-size:11px;font-family:monospace;color:#888">${esc(shortTx)}</td>
      </tr>`;
  }).join('');

  const summary = txs.reduce<Record<string, number>>((acc, t) => {
    if (t.type === 'Onboard' || !t.currency || t.currency === '—') return acc;
    acc[t.currency.toUpperCase()] = (acc[t.currency.toUpperCase()] ?? 0) + t.amount;
    return acc;
  }, {});
  const summaryRows = Object.entries(summary).map(([cur, amt]) =>
    `<tr><td style="padding:4px 14px;font-size:13px;color:#555">${esc(cur)} subtotal</td><td style="padding:4px 14px;font-size:13px;font-family:monospace;text-align:right">${amt.toFixed(4)} ${esc(cur)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${invoiceNum}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; background: #fff; }
  [style*="monospace"] { font-family: 'Manrope', sans-serif !important; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
  }
  .page { max-width: 800px; margin: 0 auto; padding: 48px 48px 64px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .brand { font-size: 26px; font-weight: 800; font-style: italic; letter-spacing: -0.02em; color: #f2470c; }
  .brand-sub { font-size: 12px; color: #888; margin-top: 4px; }
  .invoice-meta { text-align: right; }
  .invoice-meta .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .invoice-meta .value { font-size: 14px; font-weight:500; margin-top: 2px; }
  .hero { background: #fff4ef; border-radius: 10px; padding: 28px 32px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: center; }
  .hero-left .amount { font-size: 36px; font-weight:500; letter-spacing: -1px; }
  .hero-left .txcount { font-size: 13px; color: #555; margin-top: 6px; }
  .hero-right { text-align: right; }
  .paid-badge { display: inline-block; background: #e6f4ea; color: #2e7d32; border-radius: 20px; padding: 4px 14px; font-size: 12px; font-weight:500; letter-spacing: 0.3px; }
  .paid-date { font-size: 12px; color: #888; margin-top: 6px; }
  .from-to { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
  .ft-box { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 16px 20px; }
  .ft-box .ft-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: #999; margin-bottom: 8px; }
  .ft-box .ft-name { font-size: 14px; font-weight:500; }
  .ft-box .ft-line { font-size: 12px; color: #666; margin-top: 3px; }
  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #999; margin-bottom: 10px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  table.items thead tr { background: #f5f5f5; }
  table.items thead th { padding: 9px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; font-weight:500; text-align: left; }
  table.items thead th:last-child, table.items thead th:nth-child(5) { text-align: right; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 32px; }
  .totals table { min-width: 280px; }
  .totals td { vertical-align: top; }
  .totals tr.total-row td { border-top: 2px solid #f2470c; padding-top: 10px; font-weight:500; font-size: 14px; }
  .footer { border-top: 1px solid #eee; padding-top: 20px; display: flex; justify-content: space-between; align-items: center; }
  .footer .gen { font-size: 11px; color: #bbb; }
  .footer .brand-mark { font-size: 11px; color: #bbb; }
  .print-btn { position: fixed; top: 24px; right: 24px; background: #f2470c; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight:500; cursor: pointer; box-shadow: 0 2px 8px rgba(242,71,12,.3); }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Print / Save PDF</button>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <div class="brand">priPay</div>
      </div>
      <div class="brand-sub">${esc(company.tagline || '')}</div>
    </div>
    <div class="invoice-meta">
      <div class="label">${monthYear} &nbsp;•&nbsp; Invoice</div>
      <div class="value">${invoiceNum}</div>
    </div>
  </div>

  <!-- Hero -->
  <div class="hero">
    <div class="hero-left">
      <div class="amount">${txs.length} transaction${txs.length !== 1 ? 's' : ''}</div>
      <div class="txcount">${Object.entries(summary).map(([c, a]) => `${a.toFixed(4)} ${c}`).join(' · ') || 'No token amounts'}</div>
    </div>
    <div class="hero-right">
      <div class="paid-badge">PAID</div>
      <div class="paid-date">${genDate}</div>
    </div>
  </div>

  <!-- From / To -->
  <div class="from-to">
    <div class="ft-box">
      <div class="ft-label">From</div>
      <div class="ft-name">${esc(company.name || 'PriPay')}</div>
      ${company.legal ? `<div class="ft-line">${esc(company.legal)}</div>` : ''}
      ${company.email ? `<div class="ft-line">${esc(company.email)}</div>` : ''}
      <div class="ft-line">${esc(company.network || 'Starknet')}</div>
    </div>
    <div class="ft-box">
      <div class="ft-label">Payment method</div>
      <div class="ft-name">On-chain transfer</div>
      <div class="ft-line">${esc(company.network || 'Starknet')}</div>
    </div>
  </div>

  <!-- Transactions table -->
  <div class="section-title">Transactions</div>
  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th>Recipient</th>
        <th>Description</th>
        <th>Date</th>
        <th style="text-align:right">Amount</th>
        <th style="text-align:right">TX ID</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals">
    <table>
      ${summaryRows}
      <tr><td style="padding:4px 14px;font-size:12px;color:#999">Tax</td><td style="padding:4px 14px;font-size:12px;color:#999;text-align:right">0%</td></tr>
      <tr class="total-row"><td style="padding:10px 14px">Total transactions</td><td style="padding:10px 14px;text-align:right">${txs.length}</td></tr>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="gen">Generated on ${genDate}</div>
    <div class="brand-mark" style="display:flex;align-items:center;gap:6px">
      <span><span style="color:#f2470c;font-weight:800;font-style:italic">priPay</span> · Starknet Payroll</span>
    </div>
  </div>

</div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateInvoiceForRow(idx: number): void {
  const rows = filteredRows();
  const t = rows[idx];
  if (!t) return;
  openInvoice([t]);
}

// Single-tx invoice keyed by hash (rather than filtered-row index). Used
// from the profile detail page where the audit-page index isn't valid.
export function generateInvoiceForTx(txHash: string): void {
  const t = auditTxs.find((row) => row.tx === txHash);
  if (!t) return;
  openInvoice([t]);
}

export function generateInvoiceForSelected(): void {
  const rows = filteredRows();
  const txs = auditSelected.size > 0
    ? [...auditSelected].sort((a, b) => a - b).map(i => rows[i]).filter(Boolean) as AuditTx[]
    : rows;
  if (txs.length === 0) return;
  openInvoice(txs);
}

// Render the invoice into a hidden iframe and trigger the browser's print /
// "Save as PDF" dialog — no new tab/window; the user saves the PDF in place.
function openInvoice(txs: AuditTx[]): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;opacity:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(buildInvoiceHtml(txs));
  doc.close();
  const cw = iframe.contentWindow!;
  const cleanup = () => { if (iframe.parentNode) iframe.remove(); };
  cw.addEventListener('afterprint', cleanup);
  const print = () => { try { cw.focus(); cw.print(); } catch { cleanup(); } };
  // Let styles/fonts settle before printing.
  if (doc.readyState === 'complete') setTimeout(print, 200);
  else iframe.addEventListener('load', () => setTimeout(print, 200));
  setTimeout(cleanup, 60000); // safety net if afterprint never fires
}
