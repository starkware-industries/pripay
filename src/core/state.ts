import type { Profile, RecOrder, CompanyInfo, AuditTx, CsvRow } from './types';
import type { Account } from 'starknet';
import { RpcProvider } from 'starknet';
import type { PrivateTransfersInterface } from '@starkware-libs/starknet-privacy-sdk';
import type { Storage } from '../sdk_integration/storage';
import { ServerStorage } from '../sdk_integration/server-storage';
import { LocalSubmitter, type TxSubmitter } from '../sdk_integration/submitter';
import { RPC_URL, NETWORK_LABEL } from '../sdk_integration/network-config';

const API = '/api';

const KEY = {
  company:      'pripay:companyInfo',
  // Tracked client-side: the indexer can't distinguish a multipay from a single
  // private transfer, so we override AuditTx.type after fetchAuditHistory returns.
  recurrentTxs: 'pripay:recurrentTxs',
  // Per-tx metadata: the on-chain transfer only stores the crypto amount that
  // actually moved, not what the operator typed. We side-store the original
  // amount + unit (e.g. "100 USDC for a STRK transfer") keyed by tx hash so
  // the profile detail can show "what the user meant" rather than only NIS.
  txMeta:       'pripay:txMeta',
  // In-app unshielded transfers. The wallet doesn't tag these as PriPay
  // submissions; we persist what we submitted so the audit log can show
  // them alongside chain-discovered ERC20 transfers and surface the
  // intended recipient name, description, etc.
  unshieldedTxs: 'pripay:unshieldedTxs',
};

export type TxMeta = { amountUnit?: 'nis' | 'usdc' | 'strk' | 'eth'; cryptoAmount?: number };

// Blank defaults — real data is per-wallet (loaded on connect). No placeholder
// samples: the dashboard is gated behind a connected wallet, so nothing fake shows.
const DEFAULT_COMPANY: CompanyInfo = {
  name:    '',
  tagline: '',
  email:   '',
  legal:   '',
  network: NETWORK_LABEL,
};

const DEFAULT_PROFILES: Profile[] = [];

const DEFAULT_REC: RecOrder[] = [];

export type UnshieldedRecord = {
  tx: string;       // tx hash
  date: string;     // YYYY-MM-DD (local)
  time: string;     // HH:MM (local)
  addr: string;     // recipient
  token: 'USDC' | 'STRK' | 'ETH';
  amount: number;   // human-decimals
  description?: string;
  // The unit + value the operator typed, so the per-tx Value column can
  // mirror what they entered (e.g. "$5" for a USDC-typed unshielded tx).
  amountUnit?: 'nis' | 'usdc' | 'strk' | 'eth';
  cryptoAmount?: number;
};

export const state = {
  // Per-wallet (loaded on connect). Default until a wallet is connected.
  companyInfo:       { ...DEFAULT_COMPANY },
  // Placeholder samples shown pre-connect; replaced per-wallet by loadWalletData
  // on connect (cloned so in-place mutations don't touch the shared defaults).
  profiles:          DEFAULT_PROFILES.map((p) => ({ ...p })),
  recOrders:         DEFAULT_REC.map((o) => ({ ...o })),
  // Per-wallet (loaded on connect). Empty until a wallet is connected.
  recurrentTxHashes: new Set<string>(),
  txMetadata:        {} as Record<string, TxMeta>,
  unshieldedTxs:     [] as UnshieldedRecord[],
  walletConnected:   '' as string,
  // Display identity of the connected wallet (ephemeral, set by wallet.ts on
  // connect). Drives the topbar profile popover; not persisted.
  walletName:        '' as string,
  walletType:        '' as string,
  // Global default for NEW payments (header Private/Public switch). Each
  // form still carries its own mode control for one-off overrides.
  payMode:           'shielded' as 'shielded' | 'unshielded',
  // Set from GET /api/me (IAP identity). Admins see the Settings page.
  isAdmin:           false,
  userEmail:         '' as string,
  // Whether the connected wallet has a saved company record yet (drives the
  // "first-time setup is open to anyone" rule for editing company info).
  companyConfigured: false,
  selectedProfileId: null as string | null,
  editingProfileId:  null as string | null,
  csvRows:           [] as CsvRow[],
  editingOrderIdx:   null as number | null,
  otRecipientName:   null as string | null,
  otMode:            'nis' as 'nis' | 'crypto',

  operatorAccount:        null as Account | null,
  payrollAddress:    null as string | null,
  viewingKey:        null as bigint | null,
  transfers:         null as PrivateTransfersInterface | null,
  onboarded:         false,
  onboardingError:   null as string | null,

  provider:  new RpcProvider({ nodeUrl: RPC_URL }),
  storage:   new ServerStorage() as Storage,
  submitter: new LocalSubmitter() as TxSubmitter,

  onboardingStatus: 'idle' as
    | 'idle'
    | 'init'
    | 'declaring_contract'
    | 'deploying_contract'
    | 'building_proof'
    | 'signing_message'
    | 'generating_proof'
    | 'submitting'
    | 'done'
    | 'error',
};

export const auditTxs: AuditTx[] = [];

// Mutate in place so existing import references keep pointing at the same array.
export function setAuditTxs(next: AuditTx[]): void {
  auditTxs.length = 0;
  auditTxs.push(...next);
}

// All persisted state is now per-wallet (loaded by loadWalletData on connect),
// so there's nothing global to hydrate. Kept as the startup-render trigger.
export async function hydrateFromDB(onUpdate: () => void): Promise<void> {
  onUpdate();
}

// Per-wallet kv blobs (company info + the transaction-note stores): one document
// per (key, wallet) at `{key}:{addr}`. Loaded on connect by loadWalletData and
// reset on disconnect; saved through saveWalletBlob.
function walletKvUrl(key: string, addr: string): string {
  return `${API}/${encodeURIComponent(key + ':' + addr.toLowerCase())}`;
}
function saveWalletBlob(key: string, value: unknown): void {
  const addr = state.walletConnected;
  if (!addr) return; // per-wallet — nothing to persist without a connected wallet
  void fetch(walletKvUrl(key, addr), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  }).catch(() => {});
}

// Company info is permission-enforced server-side (PUT /api/company/:addr): admin,
// an accountant of the wallet, or first-time setup. Returns true on success.
export async function saveCompanyForWallet(addr: string, company: CompanyInfo): Promise<boolean> {
  try {
    const r = await fetch(`${API}/company/${encodeURIComponent(addr)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(company),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function saveCompanyInfo(): void {
  const addr = state.walletConnected;
  if (!addr) return;
  void saveCompanyForWallet(addr, state.companyInfo).then((ok) => { if (ok) state.companyConfigured = true; });
}

// Who may edit a company overview: an admin, an accountant on the wallet, or
// anyone during first-time setup (before any company record exists).
export function canEditCompany(): boolean {
  // Admin (ADMIN_WALLETS) can edit any company. Otherwise the dashboard's company
  // card belongs to the connected wallet, so its owner may edit it. The server
  // enforces the same rule (admin OR wallet-owner OR IAP accountant).
  if (state.isAdmin) return true;
  return !!state.walletConnected;
}

// Per-wallet, per-record persistence. Profiles/orders live under
// wallets/{addr}/{kind}/{id}, one document per record, so two sessions on the
// same wallet editing different records never clobber each other's whole list.
//
// saveProfiles/saveRecOrders keep their old signatures (callers are unchanged):
// each computes the delta against a shadow snapshot and PUTs only the changed
// records / DELETEs the removed ones. The shadow is updated synchronously, so
// rapid successive saves don't race; network writes are fire-and-forget.
let savedProfiles = new Map<string, string>();
let savedOrders   = new Map<string, string>();

function recordUrl(addr: string, kind: 'profiles' | 'orders', id: string): string {
  return `${API}/wallet/${encodeURIComponent(addr)}/${kind}/${encodeURIComponent(id)}`;
}

function syncRecords(
  kind: 'profiles' | 'orders',
  items: ReadonlyArray<{ id: string }>,
  shadow: Map<string, string>,
): void {
  const addr = state.walletConnected;
  if (!addr) return; // no wallet → nothing to scope the records under
  const seen = new Set<string>();
  const writes: Promise<unknown>[] = [];
  for (const item of items) {
    seen.add(item.id);
    const json = JSON.stringify(item);
    if (shadow.get(item.id) !== json) {
      shadow.set(item.id, json);
      writes.push(fetch(recordUrl(addr, kind, item.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      }));
    }
  }
  for (const id of [...shadow.keys()]) {
    if (!seen.has(id)) {
      shadow.delete(id);
      writes.push(fetch(recordUrl(addr, kind, id), { method: 'DELETE' }));
    }
  }
  void Promise.all(writes).catch(() => {});
}

export function saveProfiles(): void  { syncRecords('profiles', state.profiles, savedProfiles); }
export function saveRecOrders(): void { syncRecords('orders',   state.recOrders, savedOrders); }

// Loads the connected wallet's profiles/orders and seeds the shadow snapshots
// so the next save diffs against what the server actually holds.
export async function loadWalletData(addr: string, onUpdate: () => void): Promise<void> {
  try {
    const [profiles, orders, company, txMeta, unshielded, recurrent] = await Promise.all([
      fetch(`${API}/wallet/${encodeURIComponent(addr)}/profiles`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/wallet/${encodeURIComponent(addr)}/orders`).then((r) => (r.ok ? r.json() : [])),
      fetch(walletKvUrl(KEY.company, addr)).then((r) => (r.ok ? r.json() : null)),
      fetch(walletKvUrl(KEY.txMeta, addr)).then((r) => (r.ok ? r.json() : null)),
      fetch(walletKvUrl(KEY.unshieldedTxs, addr)).then((r) => (r.ok ? r.json() : null)),
      fetch(walletKvUrl(KEY.recurrentTxs, addr)).then((r) => (r.ok ? r.json() : null)),
    ]);
    state.profiles = profiles as Profile[];
    state.recOrders = orders as RecOrder[];
    state.companyConfigured = company != null;
    state.companyInfo = (company as CompanyInfo | null) ?? { ...DEFAULT_COMPANY };
    state.companyInfo.network = NETWORK_LABEL; // keep the network label truthful
    // Record the wallet so admins can manage even wallets that never set up company info.
    void fetch(`${API}/registry/${encodeURIComponent(addr)}`, { method: 'PUT' }).catch(() => {});
    state.txMetadata = (txMeta as Record<string, TxMeta> | null) ?? {};
    state.unshieldedTxs = (unshielded as UnshieldedRecord[] | null) ?? [];
    state.recurrentTxHashes = new Set((recurrent as string[] | null) ?? []);
    savedProfiles = new Map((profiles as Profile[]).map((p) => [p.id, JSON.stringify(p)]));
    savedOrders   = new Map((orders as RecOrder[]).map((o) => [o.id, JSON.stringify(o)]));
    onUpdate();
  } catch {
    // server unreachable — keep whatever's already in memory
  }
}

// Resets to the placeholder samples on disconnect so the next wallet doesn't
// see the previous wallet's data. Shadows cleared so we never persist samples.
export function clearWalletData(): void {
  state.profiles = DEFAULT_PROFILES.map((p) => ({ ...p }));
  state.recOrders = DEFAULT_REC.map((o) => ({ ...o }));
  state.companyInfo = { ...DEFAULT_COMPANY };
  state.txMetadata = {};
  state.unshieldedTxs = [];
  state.recurrentTxHashes = new Set();
  savedProfiles = new Map();
  savedOrders = new Map();
}

export function markRecurrentTx(txHash: string): void {
  state.recurrentTxHashes.add(normalizeTxHash(txHash));
  saveWalletBlob(KEY.recurrentTxs, [...state.recurrentTxHashes]);
}

export function isRecurrentTx(txHash: string): boolean {
  return state.recurrentTxHashes.has(normalizeTxHash(txHash));
}

export function setTxMetadata(txHash: string, meta: TxMeta): void {
  state.txMetadata[normalizeTxHash(txHash)] = meta;
  saveWalletBlob(KEY.txMeta, state.txMetadata);
}

// Records an in-app unshielded transfer so the audit log can surface it
// even if the on-chain ERC20 Transfer event sweep misses (e.g. brand-new
// tx not yet indexed). Deduplicates by normalized tx hash.
export function addUnshieldedTx(rec: UnshieldedRecord): void {
  const normalized = normalizeTxHash(rec.tx);
  const existing = state.unshieldedTxs.find((r) => normalizeTxHash(r.tx) === normalized);
  if (existing) return;
  state.unshieldedTxs.push({ ...rec, tx: normalized });
  saveWalletBlob(KEY.unshieldedTxs, state.unshieldedTxs);
}

export function getUnshieldedTxs(): UnshieldedRecord[] {
  return state.unshieldedTxs;
}

export function getTxMetadata(txHash: string): TxMeta | undefined {
  return state.txMetadata[normalizeTxHash(txHash)];
}

function normalizeTxHash(h: string): string {
  try { return '0x' + BigInt(h).toString(16); } catch { return h.toLowerCase(); }
}

export function getTxsForAddr(addr: string): AuditTx[] {
  const target = normalizeAddr(addr);
  return auditTxs.filter((t) => normalizeAddr(t.addr) === target);
}

function normalizeAddr(addr: string): string {
  try {
    return '0x' + BigInt(addr).toString(16);
  } catch {
    return addr.toLowerCase();
  }
}
