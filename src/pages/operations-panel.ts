import {
  dismissOperation,
  dismissTerminal,
  getOperations,
  isTerminal,
  statusLabel,
  subscribeOperations,
  updateOperation,
  type Operation,
  type OperationStatus,
} from '../core/operations';
import { nav } from '../core/nav';

// Pauses the op at "awaiting_fee" until the operator clicks the Confirm fee
// button on the op card, then opens the supplied confirm-fee dialog and
// resolves with the operator's choice (true = submit, false = cancel).
export function awaitFeeViaPanel(
  op: Operation,
  estimatedFeeFri: bigint | null,
  openConfirmFee: (estimatedFeeFri: bigint | null) => Promise<boolean>,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    updateOperation(op.id, {
      status: 'awaiting_fee',
      onConfirmFee: () => {
        openConfirmFee(estimatedFeeFri).then(resolve).catch(reject);
      },
    });
  });
}

let collapsed = false;

export function initOperationsPanel(): void {
  subscribeOperations(renderOperationsPanel);
  document.getElementById('opsHeader')?.addEventListener('click', () => {
    collapsed = !collapsed;
    renderOperationsPanel();
  });
  document.getElementById('opsClearBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissTerminal();
  });
  renderOperationsPanel();
}

function renderOperationsPanel(): void {
  const root = document.getElementById('opsPanel');
  const list = document.getElementById('opsList');
  const headerLabel = document.getElementById('opsHeaderLabel');
  const headerSub = document.getElementById('opsHeaderSub');
  const headerArrow = document.getElementById('opsHeaderArrow');
  const clearBtn = document.getElementById('opsClearBtn');
  if (!root || !list) return;

  const ops = getOperations();
  if (ops.length === 0) {
    root.style.display = 'none';
    return;
  }
  root.style.display = 'flex';

  const active = ops.filter((o) => !isTerminal(o.status)).length;
  const terminal = ops.length - active;
  if (headerLabel) headerLabel.textContent = active > 0
    ? `${active} operation${active === 1 ? '' : 's'} running`
    : `${ops.length} recent operation${ops.length === 1 ? '' : 's'}`;
  if (headerSub) headerSub.textContent = active > 0 && terminal > 0
    ? `· ${terminal} finished`
    : '';
  if (headerArrow) headerArrow.textContent = collapsed ? '▲' : '▼';
  if (clearBtn) clearBtn.style.display = terminal > 0 ? 'inline-block' : 'none';

  list.style.display = collapsed ? 'none' : 'flex';
  if (collapsed) return;

  list.replaceChildren();
  for (const op of ops) list.appendChild(buildOpCard(op));
}

const KIND_DOT: Record<OperationKind, string> = {
  shield:    '#16a34a',
  unshield:  '#b45309',
  transfer:  '#1a6fd4',
  recurrent: '#1a6fd4',
  convert:   '#7c3aed',
};

const KIND_LABEL: Record<OperationKind, string> = {
  shield:    'Deposit',
  unshield:  'Withdraw',
  transfer:  'Send',
  recurrent: 'Payroll',
  convert:   'Swap',
};

type OperationKind = Operation['kind'];

function buildOpCard(op: Operation): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = 'display:flex;align-items:center;gap:14px;padding:16px 24px;border-bottom:1px solid var(--border);font-size:14px';

  const dot = document.createElement('span');
  dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${KIND_DOT[op.kind]};flex-shrink:0`;
  card.appendChild(dot);

  const kind = document.createElement('span');
  kind.style.cssText = 'font-weight:500;color:var(--text2);min-width:86px;font-size:14px';
  kind.textContent = KIND_LABEL[op.kind];
  card.appendChild(kind);

  const summary = document.createElement('span');
  summary.style.cssText = 'flex:1;min-width:0;color:var(--text);font-weight:500;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  summary.textContent = op.summary;
  card.appendChild(summary);

  card.appendChild(buildStatus(op.status));

  // Per-status actions
  if (op.status === 'done' && op.resultTx) {
    const isMultipay = op.kind === 'recurrent';
    card.appendChild(actionButton(isMultipay ? 'View in history' : 'View', 'secondary', () => openInHistory(op.resultTx!)));
  } else if (op.status === 'error' && op.error) {
    card.appendChild(buildErrorBlock(op.error));
  }

  if (isTerminal(op.status)) {
    const dismiss = document.createElement('button');
    dismiss.title = 'Dismiss';
    dismiss.style.cssText = 'background:none;border:none;color:var(--text3);cursor:pointer;padding:6px 10px;font-size:18px;line-height:1';
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => dismissOperation(op.id));
    card.appendChild(dismiss);
  }

  return card;
}

// Navigates to the Transaction History page and filters by the operation's
// tx hash so the operator can drill into the rows it produced. For multipay
// this lists every recipient row in the batch; for a single transfer it's
// one row.
function openInHistory(txHash: string): void {
  nav('audit');
  const filterEl = document.getElementById('auditFilter') as HTMLInputElement | null;
  if (filterEl) {
    filterEl.value = txHash;
    filterEl.dispatchEvent(new Event('input'));
  }
}

// Inline-collapsed error with a "Details" toggle that expands to show the
// full message (often a multi-line RPC reason) and offers Copy.
function buildErrorBlock(message: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;flex-direction:column;align-items:flex-start;gap:4px;max-width:360px';

  const row = document.createElement('span');
  row.style.cssText = 'display:inline-flex;align-items:center;gap:8px';

  const preview = document.createElement('span');
  preview.style.cssText = 'font-size:12px;color:var(--err);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  preview.textContent = message;
  row.appendChild(preview);

  const toggle = document.createElement('button');
  toggle.style.cssText = 'background:none;border:none;color:var(--accent);font-size:11px;font-weight:500;cursor:pointer;padding:0;text-decoration:underline';
  toggle.textContent = 'Details';
  row.appendChild(toggle);

  const copyBtn = document.createElement('button');
  copyBtn.style.cssText = 'background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;padding:0';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(message).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });
  row.appendChild(copyBtn);

  const full = document.createElement('div');
  full.style.cssText = 'display:none;font-size:12px;color:var(--err);background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 10px;white-space:pre-wrap;word-break:break-word;max-width:360px;font-family:var(--mono,monospace);line-height:1.4';
  full.textContent = message;

  toggle.addEventListener('click', () => {
    const showing = full.style.display !== 'none';
    full.style.display = showing ? 'none' : 'block';
    preview.style.display = showing ? '' : 'none';
    toggle.textContent = showing ? 'Details' : 'Hide';
  });

  wrap.append(row, full);
  return wrap;
}

function buildStatus(s: OperationStatus): HTMLElement {
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;white-space:nowrap';
  if (!isTerminal(s) && s !== 'awaiting_fee') {
    const spin = document.createElement('span');
    spin.className = 'spin';
    spin.style.cssText = 'width:13px;height:13px;border-width:2px';
    wrap.appendChild(spin);
  }
  const label = document.createElement('span');
  label.textContent = statusLabel(s);
  if (s === 'awaiting_fee') {
    wrap.style.color = '#b45309';
  } else if (s === 'done') {
    wrap.style.color = '#16a34a';
  } else if (s === 'error') {
    wrap.style.color = 'var(--err)';
  } else if (s === 'cancelled') {
    wrap.style.color = 'var(--text3)';
  } else {
    wrap.style.color = 'var(--text3)';
  }
  wrap.appendChild(label);
  return wrap;
}

function actionButton(label: string, variant: 'primary' | 'secondary', onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = variant === 'primary'
    ? 'padding:8px 18px;font-size:13px;font-weight:500;background:var(--accent);color:#fff;border:1px solid var(--accent);border-radius:6px;cursor:pointer;white-space:nowrap'
    : 'padding:8px 18px;font-size:13px;font-weight:500;background:#fff;color:var(--accent);border:1px solid var(--accent);border-radius:6px;cursor:pointer;white-space:nowrap';
  btn.addEventListener('click', onClick);
  return btn;
}
