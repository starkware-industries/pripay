export interface Tx {
  date: string;
  type: string;
  amount: number;
  currency: string;
  tx: string;
}

export type TransferMode = 'shielded' | 'unshielded';

export interface Profile {
  id: string;
  name: string;
  addr: string;
  nis: number;
  txs: Tx[];
  type?: string;
  email?: string;
  notes?: string;
  // Default transfer mode for this contact. Falls back to 'shielded' when
  // not set so legacy profiles keep their previous behaviour.
  mode?: TransferMode;
  // Legacy: token preference was removed from the product; kept optional for stored-profile compat.
  token?: 'usdc' | 'strk' | 'eth';
}

export interface RecOrder {
  // Stable id, used as the per-record Firestore document id.
  id: string;
  name: string;
  addr: string;
  nis: number;
  currency: string;
  period: string;
  next: string;
  // YYYY-MM-DD of the most recent successful execution. Undefined = never
  // ran. Drives the "Last ran" column + due-date sort on the recurrent page.
  // `next` is still kept (and advanced on each run) so the profile page's
  // "Future recurrent" view keeps working.
  lastRan?: string;
  description?: string;
  // Transfer mode for this order. 'shielded' (default) goes through the
  // privacy pool via runMultiPay; 'unshielded' is a direct ERC20 transfer
  // from the connected wallet.
  mode?: TransferMode;
  // Undefined treated as active (back-compat for pre-existing persisted orders).
  active?: boolean;
  // Privacy-pool registry pre-check. Undefined = not yet probed (rendered
  // without a badge); 'no' blocks Initiate because today's runMultiPay
  // bricks the whole batch on the first unregistered recipient.
  registered?: 'yes' | 'no' | 'unknown';
  // The unit the operator typed the amount in: 'nis' (default, NIS budget)
  // or a crypto symbol ('usdc'/'strk'/'eth') when entered in crypto mode.
  // When set to a crypto unit, cryptoAmount carries the original value so
  // display can avoid lossy round-tripping through NIS.
  amountUnit?: 'nis' | 'usdc' | 'strk' | 'eth';
  cryptoAmount?: number;
}

export interface CompanyInfo {
  name: string;
  tagline: string;
  email: string;
  legal: string;
  network: string;
  // Accountant(s) for this company. Used to gate who may edit company info
  // (an accountant of this wallet, or an admin). The singular legacy fields
  // are kept for back-compat with previously persisted CompanyInfo; new writes
  // go to the plural arrays.
  //
  // accountantWallets is the enforceable one: the server matches it against the
  // SIWS session, so it works on any deployment. accountantEmails is only honoured
  // behind a real Google IAP (server.js TRUST_IAP_HEADER) — off a host with IAP in
  // front, the email header is caller-supplied and grants nothing.
  accountantEmail?: string;
  accountantEmails?: string[];
  accountantWallets?: string[];
  // Operator(s) who run the payroll for this company (informational).
  operatorEmail?: string;
  operatorEmails?: string[];
}

export interface NISRates {
  usdc: number;
  strk: number;
  eth: number;
}

export interface AuditTx {
  date: string;
  time?: string;
  amount: number;
  currency: string;
  tx: string;
  addr: string;
  name?: string;
  description?: string;
  type?: 'OneTime' | 'Recurrent' | 'Deposit' | 'Onboard' | 'UnshieldedTransfer';
  // True when the row originated from a wallet-direct ERC20 transfer
  // (i.e. didn't go through the privacy pool). Survives type re-labels
  // so an unshielded-recurrent row keeps its "no shield" rendering.
  unshielded?: boolean;
}

export interface CsvRow {
  isShielded: boolean;        // 'is shielded?' column → true (yes/y/1/true) or false
  token: string;              // on-chain currency (USDC / STRK / ETH)
  address: string;
  amount: string;
  currency: 'ils' | 'usd' | string; // the unit the amount was typed in
  note: string;
}
