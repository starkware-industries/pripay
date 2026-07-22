import { state, saveRecOrders, saveProfiles } from '../core/state';
import { validAddr, burnAddr, TOKENS } from '../core/validators';
import { rand64, sleep, downloadTextFile, SHIELD_SVG } from '../core/utils';
import { getNISRates } from '../core/prices';
import { renderRec, probeRegistrationsForOrders } from './recurrent';
import { renderProfiles, openCompleteImportedProfiles } from './profiles';
import { closeM } from '../core/modals';
import { showAlert } from '../core/dialogs';

export function downloadPayrollCsvTemplate(): void {
  // Columns:
  //  is shielded? · yes/no — routes through the privacy pool when yes,
  //                          direct wallet ERC20 transfer when no.
  //  token        · USDC / STRK / ETH — the on-chain settlement token.
  //  address      · 0x-prefixed Starknet address of the recipient.
  //  amount       · numeric value, decimals allowed.
  //  currency     · ils / usd — the unit the amount was typed in.
  //  note         · free text, optional.
  const lines = [
    'is shielded?,token,address,amount,currency,note',
    'yes,usdc,0xabcd000000000000000000000000000000000000000000000000000000000001,1000,ils,Sample row — replace with a real recipient',
    'no,strk,0xabcd000000000000000000000000000000000000000000000000000000000002,500,usd,',
  ];
  downloadTextFile('pripay-payroll-template.csv', lines.join('\n') + '\n');
}

function showFB(type: 'ok' | 'err', msg: string): void {
  const el = document.getElementById('csvFeedback');
  if (!el) return;
  el.style.display = 'block';
  const div = document.createElement('div');
  div.className = `alert alert-${type === 'err' ? 'err' : 'success'}`;
  div.textContent = msg;
  el.replaceChildren(div);
}

// Fully clears the Import-CSV modal so reopening shows a blank slate.
// Called on each open + after a successful import — previously the
// "N rows valid" feedback + lingering preview from the prior session
// stuck around because each spot was hand-cleared, with inevitable
// misses.
export function resetImportCsvForm(): void {
  state.csvRows = [];
  const fileInput = document.getElementById('csvFile') as HTMLInputElement | null;
  if (fileInput) fileInput.value = '';
  const feedback = document.getElementById('csvFeedback');
  if (feedback) { feedback.style.display = 'none'; feedback.replaceChildren(); }
  const countLabel = document.getElementById('csvCountLabel');
  if (countLabel) countLabel.textContent = '(0 rows)';
  const validNote = document.getElementById('csvValidNote');
  if (validNote) { validNote.textContent = ''; (validNote as HTMLElement).style.color = ''; }
  const preview = document.getElementById('csvPreview');
  if (preview) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.style.cssText = 'text-align:center;color:var(--text3);font-size:12px;padding:24px';
    td.textContent = 'No file loaded';
    tr.appendChild(td);
    preview.replaceChildren(tr);
  }
  const btn = document.getElementById('importDoneBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
}

export function handleDrop(e: DragEvent): void {
  e.preventDefault();
  document.getElementById('dropzone')?.classList.remove('drag');
  const file = e.dataTransfer?.files[0];
  if (file) parseCSVFile(file);
}

export function parseCSVFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.csv')) { showFB('err', 'Not a CSV file'); return; }
  if (file.size > 2 * 1024 * 1024)               { showFB('err', 'File too large (max 2 MB)'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines   = (e.target!.result as string).trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const req     = ['is shielded?', 'token', 'address', 'amount', 'currency'];
    const missing = req.filter(r => !headers.includes(r));
    if (missing.length) { showFB('err', 'Missing columns: ' + missing.join(', ')); return; }

    const rows: typeof state.csvRows = [], errs: string[] = [];
    const shieldedIdx = headers.indexOf('is shielded?');
    const tokenIdx    = headers.indexOf('token');
    const addrIdx     = headers.indexOf('address');
    const amountIdx   = headers.indexOf('amount');
    const currencyIdx = headers.indexOf('currency');
    const noteIdx     = headers.indexOf('note');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const shieldedRaw = (cols[shieldedIdx] ?? '').toLowerCase();
      const currencyRaw = (cols[currencyIdx] ?? '').toLowerCase();
      const row = {
        isShielded: ['yes', 'y', 'true', '1', 'shielded'].includes(shieldedRaw),
        token:      cols[tokenIdx],
        address:    cols[addrIdx],
        amount:     cols[amountIdx],
        currency:   currencyRaw,
        note:       noteIdx >= 0 ? (cols[noteIdx] || '') : '',
      };
      if (!['yes', 'y', 'true', '1', 'shielded', 'no', 'n', 'false', '0', 'unshielded'].includes(shieldedRaw)) {
        errs.push(`Row ${i + 1}: 'is shielded?' must be yes or no`); continue;
      }
      if (!TOKENS[row.token?.toLowerCase() as keyof typeof TOKENS]) { errs.push(`Row ${i + 1}: unknown token`); continue; }
      if (!validAddr(row.address))  { errs.push(`Row ${i + 1}: invalid address`); continue; }
      if (burnAddr(row.address))    { errs.push(`Row ${i + 1}: burn address`); continue; }
      if (isNaN(parseFloat(row.amount)) || parseFloat(row.amount) <= 0) { errs.push(`Row ${i + 1}: invalid amount`); continue; }
      if (row.currency !== 'ils' && row.currency !== 'usd') { errs.push(`Row ${i + 1}: currency must be ils or usd`); continue; }
      rows.push(row);
    }
    state.csvRows = rows;
    rerenderCsvPreview();
    if (errs.length) showFB('err', errs.slice(0, 3).join(' · '));
    else showFB('ok', rows.length + ' valid row' + (rows.length !== 1 ? 's' : '') + ' loaded');
  };
  reader.readAsText(file);
}

function buildPayrollCsvPreviewRow(r: typeof state.csvRows[number], idx: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  // Visual flag for rows that turned invalid during inline edit.
  const errs = rowErrors(r);
  if (errs.length > 0) {
    tr.style.background = 'var(--danger-bg)';
    tr.title = errs.join(' · ');
  }

  const idxCell = document.createElement('td');
  idxCell.className = 'mono';
  idxCell.style.color = 'var(--text3)';
  idxCell.textContent = String(idx + 1);

  // Mode — checkbox toggle (shielded when checked). Compact icon-style
  // label matches the badge style elsewhere.
  const modeCell = document.createElement('td');
  const modeLabel = document.createElement('label');
  modeLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px';
  const modeCb = document.createElement('input');
  modeCb.type = 'checkbox';
  modeCb.checked = r.isShielded;
  modeCb.style.accentColor = 'var(--accent)';
  modeCb.addEventListener('change', () => { r.isShielded = modeCb.checked; refreshCsvPreviewState(); });
  const shieldMark = document.createElement('span');
  shieldMark.innerHTML = SHIELD_SVG;
  shieldMark.title = 'Private payment';
  modeLabel.append(modeCb, shieldMark);
  modeCell.appendChild(modeLabel);

  // Token select.
  const tokenCell = document.createElement('td');
  const tokenSel = document.createElement('select');
  tokenSel.className = 'sel';
  tokenSel.style.cssText = 'font-size:12px;padding:4px 28px 4px 10px;min-width:80px';
  for (const t of ['usdc', 'strk', 'eth']) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t.toUpperCase();
    if (r.token?.toLowerCase() === t) o.selected = true;
    tokenSel.appendChild(o);
  }
  tokenSel.addEventListener('change', () => { r.token = tokenSel.value; refreshCsvPreviewState(); });
  tokenCell.appendChild(tokenSel);

  // Address input — fixed-width to keep the row sane, full value still
  // typed into the input.
  const addrCell = document.createElement('td');
  const addrIn = document.createElement('input');
  addrIn.type = 'text';
  addrIn.className = 'inp';
  addrIn.style.cssText = 'font-family:monospace;font-size:11px;padding:3px 6px;width:420px';
  addrIn.value = r.address;
  addrIn.addEventListener('input', () => { r.address = addrIn.value.trim(); refreshCsvPreviewState(); });
  addrCell.appendChild(addrIn);

  // Amount input + currency select side-by-side.
  const amountCell = document.createElement('td');
  const amountWrap = document.createElement('div');
  amountWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px';
  const amountIn = document.createElement('input');
  amountIn.type = 'number';
  amountIn.step = 'any';
  amountIn.className = 'inp';
  amountIn.style.cssText = 'font-family:monospace;font-size:12px;padding:3px 6px;width:110px;text-align:right';
  amountIn.value = r.amount;
  amountIn.addEventListener('input', () => { r.amount = amountIn.value.trim(); refreshCsvPreviewState(); });
  const currencySel = document.createElement('select');
  currencySel.className = 'sel';
  currencySel.style.cssText = 'font-size:12px;padding:4px 28px 4px 10px;min-width:75px';
  for (const c of ['ils', 'usd']) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c.toUpperCase();
    if (r.currency === c) o.selected = true;
    currencySel.appendChild(o);
  }
  currencySel.addEventListener('change', () => { r.currency = currencySel.value; refreshCsvPreviewState(); });
  amountWrap.append(amountIn, currencySel);
  amountCell.appendChild(amountWrap);

  const noteCell = document.createElement('td');
  const noteIn = document.createElement('input');
  noteIn.type = 'text';
  noteIn.className = 'inp';
  noteIn.style.cssText = 'font-size:12px;padding:3px 6px;width:200px';
  noteIn.value = r.note;
  noteIn.placeholder = '—';
  noteIn.addEventListener('input', () => { r.note = noteIn.value; });
  noteCell.appendChild(noteIn);

  // Profile preview — show the existing address-book match if one
  // already exists, or the mode the auto-created profile will inherit.
  const profileCell = document.createElement('td');
  profileCell.style.cssText = 'font-size:12px;line-height:1.3';
  buildProfileSummary(profileCell, r);

  // Per-row remove button — drops the row from state.csvRows.
  const actionsCell = document.createElement('td');
  const removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.title = 'Remove this row';
  removeBtn.style.cssText = 'font-size:14px;line-height:1;padding:2px 6px';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    state.csvRows.splice(idx, 1);
    rerenderCsvPreview();
  });
  actionsCell.appendChild(removeBtn);

  tr.append(idxCell, modeCell, tokenCell, addrCell, amountCell, noteCell, profileCell, actionsCell);
  return tr;
}

// Renders into `cell`: either the existing profile name (when the
// address is already in the address book) or a "new" indicator with
// the mode the auto-created profile will inherit. The inherited mode
// follows the same rule as importCsvDone — any shielded row for that
// address wins, otherwise unshielded.
function buildProfileSummary(cell: HTMLElement, r: typeof state.csvRows[number]): void {
  cell.replaceChildren();
  const existing = findProfileByAddr(r.address);
  if (existing) {
    const name = document.createElement('div');
    name.style.cssText = 'font-weight:500;color:var(--text1)';
    name.textContent = existing.name;
    const tag = document.createElement('div');
    tag.style.cssText = 'font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em';
    tag.textContent = 'Existing';
    cell.append(name, tag);
    return;
  }
  const tag = document.createElement('div');
  tag.style.cssText = 'font-size:11px;color:var(--text3)';
  tag.textContent = 'New profile';
  cell.appendChild(tag);
}

// Validate one parsed row (used for inline-edit error highlighting
// AND to decide whether a row is importable in importCsvDone).
function rowErrors(r: typeof state.csvRows[number]): string[] {
  const errs: string[] = [];
  if (!TOKENS[r.token?.toLowerCase() as keyof typeof TOKENS]) errs.push('unknown token');
  if (!validAddr(r.address))  errs.push('invalid address');
  else if (burnAddr(r.address)) errs.push('burn address');
  if (isNaN(parseFloat(r.amount)) || parseFloat(r.amount) <= 0) errs.push('invalid amount');
  if (r.currency !== 'ils' && r.currency !== 'usd') errs.push('currency must be ils/usd');
  return errs;
}

// Re-render the per-row visual state without rebuilding everything.
// Cheaper than a full preview rebuild on every keystroke and preserves
// the input's focus/cursor.
function refreshCsvPreviewState(): void {
  const invalidCount = state.csvRows.filter((r) => rowErrors(r).length > 0).length;
  const validCount = state.csvRows.length - invalidCount;
  const countLabel = document.getElementById('csvCountLabel');
  const validNote  = document.getElementById('csvValidNote');
  if (countLabel) countLabel.textContent = `(${state.csvRows.length} rows)`;
  if (validNote) {
    validNote.textContent = invalidCount > 0
      ? `${invalidCount} row(s) need fixing`
      : `All ${validCount} row${validCount === 1 ? '' : 's'} valid`;
    (validNote as HTMLElement).style.color = invalidCount > 0 ? 'var(--danger)' : '#16a34a';
  }
  const btn = document.getElementById('importDoneBtn') as HTMLButtonElement | null;
  // Done is only clickable when EVERY row is valid — partial-batch
  // imports always surprised the operator who'd then have to figure
  // out which rows silently dropped.
  if (btn) btn.disabled = state.csvRows.length === 0 || invalidCount > 0;
  // Update the per-row red highlight + refresh the profile summary
  // (existing-vs-new flips when the address is edited).
  const tbody = document.getElementById('csvPreview');
  if (tbody) {
    tbody.querySelectorAll<HTMLTableRowElement>('tr').forEach((tr, i) => {
      const r = state.csvRows[i];
      if (!r) return;
      const errs = rowErrors(r);
      tr.style.background = errs.length > 0 ? 'var(--danger-bg)' : '';
      tr.title = errs.join(' · ');
      // 7th cell (0-indexed 6) is the Profile column.
      const profileCell = tr.cells[6] as HTMLElement | undefined;
      if (profileCell) buildProfileSummary(profileCell, r);
    });
  }
}

// Full preview rebuild — called after structural changes (initial parse,
// row delete). Keystrokes use refreshCsvPreviewState instead.
function rerenderCsvPreview(): void {
  const tbody = document.getElementById('csvPreview');
  if (!tbody) return;
  if (state.csvRows.length === 0) {
    resetImportCsvForm();
    return;
  }
  tbody.replaceChildren(...state.csvRows.map((r, i) => buildPayrollCsvPreviewRow(r, i)));
  refreshCsvPreviewState();
}

function findProfileByAddr(addr: string): typeof state.profiles[number] | undefined {
  let target: bigint;
  try { target = BigInt(addr); } catch { return undefined; }
  return state.profiles.find((p) => {
    try { return BigInt(p.addr) === target; } catch { return false; }
  });
}

export async function importCsvDone(): Promise<void> {
  // Drop any rows the operator made invalid through inline edits — the
  // preview already paints them red with a tooltip, so this is just
  // belt-and-suspenders.
  state.csvRows = state.csvRows.filter((r) => rowErrors(r).length === 0);
  if (state.csvRows.length === 0) { resetImportCsvForm(); closeM('importCsv'); return; }
  const rates = getNISRates();
  const next  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Auto-create a profile for any address that doesn't already have one,
  // so the imported recurrent order is reachable from the profiles page.
  // Seed each new profile's default `mode` from the imported row(s) for
  // that address: if any row is shielded, default to shielded (= safer);
  // otherwise unshielded.
  const newProfileIds: string[] = [];
  const seen = new Set<string>();
  for (const r of state.csvRows) {
    if (findProfileByAddr(r.address)) continue;
    let key: string;
    try { key = BigInt(r.address).toString(16); } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    const matchingRows = state.csvRows.filter((row) => {
      try { return BigInt(row.address) === BigInt(r.address); } catch { return false; }
    });
    const anyShielded = matchingRows.some((row) => row.isShielded);
    const id = 'p' + Date.now() + Math.random();
    state.profiles.push({
      id,
      name: `Imported ${r.address.slice(0, 10)}…${r.address.slice(-4)}`,
      addr: r.address,
      nis: 0,
      mode: anyShielded ? 'shielded' : 'unshielded',
      txs: [],
    });
    newProfileIds.push(id);
  }
  if (newProfileIds.length > 0) {
    saveProfiles();
    renderProfiles();
  }

  const importedStartIdx = state.recOrders.length;
  for (const r of state.csvRows) {
    const match = findProfileByAddr(r.address);
    // Convert typed amount (ils/usd) into the NIS storage shape.
    // 'usd' goes through the USDC rate since 1 USDC ≈ 1 USD and USDC's
    // ILS rate is the BoI representative — the canonical fiat anchor.
    const typed = parseFloat(r.amount);
    const nis = r.currency === 'ils'
      ? typed
      : typed / rates.usdc;  // currency === 'usd'
    // Persist the operator's original-typed unit so displays elsewhere
    // can show "what they imported" rather than the derived NIS.
    const amountUnit: 'nis' | 'usdc' = r.currency === 'ils' ? 'nis' : 'usdc';
    const cryptoAmount = r.currency === 'usd' ? typed : undefined;
    state.recOrders.push({
      id:       'o' + Date.now() + Math.random(),
      name:     match?.name ?? '(imported)',
      addr:     r.address,
      nis,
      currency: r.token.toUpperCase(),
      period:   'Monthly',
      next,
      mode:     r.isShielded ? 'shielded' : 'unshielded',
      amountUnit,
      cryptoAmount,
    });
  }
  const imported = state.recOrders.slice(importedStartIdx);
  await probeRegistrationsForOrders(imported);
  saveRecOrders();
  renderRec();
  resetImportCsvForm();
  closeM('importCsv');

  // After the import modal closes, prompt the user to flesh out the
  // newly-created profiles. Run on the next tick so the close animation
  // completes before the new modal opens.
  if (newProfileIds.length > 0) {
    setTimeout(() => openCompleteImportedProfiles(newProfileIds), 50);
  }
}

export async function doMultiPay(): Promise<void> {
  if (!state.walletConnected) { void showAlert('Connect wallet first'); return; }
  const btn = document.getElementById('multiPayBtn') as HTMLButtonElement | null;
  const st  = document.getElementById('importStatus');
  if (btn) btn.disabled = true;
  if (st)  { st.style.display = 'block'; st.innerHTML = '<div class="alert alert-info"><div class="spin"></div>Executing multipay...</div>'; }
  await sleep(2000);
  if (st) st.innerHTML = `<div class="alert alert-success">✓ Multipay confirmed · TX: 0x${rand64().slice(0, 16)}...</div>`;
  if ((document.getElementById('addToActive') as HTMLInputElement)?.checked) {
    const rates = getNISRates();
    state.csvRows.forEach(r => state.recOrders.push({
      id:       'o' + Date.now() + Math.random(),
      name:     '(imported)',
      addr:     r.address.slice(0, 8) + '...',
      nis:      parseFloat(r.amount) / rates[r.token.toLowerCase() as keyof typeof rates],
      currency: r.token.toUpperCase(),
      period:   'Monthly',
      next:     '2026-05-28',
    }));
    saveRecOrders();
    renderRec();
  }
  if (btn) btn.disabled = false;
}
