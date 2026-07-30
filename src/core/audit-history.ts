import {
  IndexerDiscoveryProvider,
  classifyTransaction,
  type HistoryCursor,
  type HistoryTransaction,
  type PrivateTransfersInterface,
} from '@starkware-libs/starknet-privacy-sdk';
import type { ProviderInterface } from 'starknet';
import type { AuditTx } from './types';
import { TOKENS } from './validators';
import { PAYMASTER_FORWARDER } from '../sdk_integration/network-config';

// Page cap for the history sweep. Hit it and we log loudly rather than quietly
// returning a partial ledger — see the warning below.
const MAX_HISTORY_PAGES = 20;

// classifyTransaction needs to know which addresses are fee recipients: a
// withdrawal to the paymaster forwarder is a fee, not the user moving funds out,
// and without this the SDK cannot recognise a self-transfer that paid a fee
// (see ClassifyOptions in the SDK's action-classifier types). We have the
// forwarder address in network-config, so pass it instead of letting every
// sponsored transaction be misread.
const FEE_RECIPIENTS = PAYMASTER_FORWARDER ? [toBigintSafe(PAYMASTER_FORWARDER)] : [];
function toBigintSafe(v: string): bigint {
  try { return BigInt(v); } catch { return 0n; }
}

export async function fetchAuditHistory(
  transfers: PrivateTransfersInterface,
  starknetProvider: ProviderInterface,
): Promise<AuditTx[]> {
  const discovery = transfers.discoveryProvider;
  if (!(discovery instanceof IndexerDiscoveryProvider)) return [];

  const userAddrBig = toBigint(transfers.user);
  const viewingKey = await transfers.viewingKeyProvider.getViewingKey();

  // Without seeding cursors first, fetchHistory's cursor.subchannels stays empty
  // and the indexer only returns `register` events — no deposits or transfers.
  const notesResult = await discovery.discoverNotes(userAddrBig, viewingKey);
  const channelsResult = await discovery.discoverChannels(userAddrBig, viewingKey, 'all');
  const channelCursor = { channels: channelsResult.channels, total: channelsResult.total };

  const allTxs: HistoryTransaction[] = [];
  let nextCursor: HistoryCursor | undefined;
  let complete = false;
  for (let i = 0; i < MAX_HISTORY_PAGES; i++) {
    const page = await discovery.fetchHistory(
      userAddrBig,
      notesResult.cursor,
      channelCursor as never,
      nextCursor ? { historyCursor: nextCursor } : undefined,
    );
    allTxs.push(...page.transactions);
    nextCursor = page.cursor;
    if (page.cursor.historyComplete) { complete = true; break; }
  }
  // Say so rather than silently showing a partial ledger — a truncated audit log
  // that looks complete is worse than one that admits it is short.
  if (!complete) {
    console.warn(
      `[audit] history still incomplete after ${MAX_HISTORY_PAGES} pages (${allTxs.length} transactions);` +
      ' the audit log is TRUNCATED. Raise MAX_HISTORY_PAGES in audit-history.ts.',
    );
  }

  const blockNumbers = Array.from(new Set(allTxs.map((t) => t.blockNumber)));
  // Local date (YYYY-MM-DD) and time (HH:MM) per block — formatted in the
  // operator's timezone instead of UTC, which matches what they read on
  // their wall clock and avoids "tx happened tomorrow" confusion.
  const localByBlock = new Map<number, { date: string; time: string }>();
  await Promise.all(
    blockNumbers.map(async (bn) => {
      try {
        const block = await starknetProvider.getBlock(bn) as unknown as { timestamp?: number };
        if (typeof block.timestamp === 'number') {
          localByBlock.set(bn, formatLocalDateTime(block.timestamp * 1000));
        }
      } catch {
        // Best-effort; missing timestamp falls back to '—'.
      }
    }),
  );

  const entries: AuditTx[] = [];
  for (const tx of allTxs) {
    const classified = classifyTransaction(tx, FEE_RECIPIENTS.length ? { feeRecipients: FEE_RECIPIENTS } : undefined);
    const txHash = '0x' + tx.transactionHash.toString(16).padStart(64, '0');
    const local = localByBlock.get(tx.blockNumber);
    const date = local?.date ?? '—';
    const time = local?.time ?? '';

    for (const action of classified.actions) {
      switch (action.type) {
        case 'register':
          entries.push({
            date,
            time,
            amount: 0,
            currency: '—',
            tx: txHash,
            // userAddress IS PayrollContract identity; using it instead of
            // the raw pubkey hex makes the row resolvable in the UI.
            addr: '0x' + userAddrBig.toString(16).padStart(64, '0'),
            name: 'PayrollContract',
            description: 'SetViewingKey (privacy-pool registration)',
            type: 'Onboard',
          });
          break;
        case 'deposit': {
          const info = tokenInfo(action.token);
          entries.push({
            date,
            time,
            amount: bigIntToHuman(action.amount, info?.decimals ?? 18),
            currency: info?.symbol ?? 'UNK',
            tx: txHash,
            addr: '0x' + action.fromAddress.toString(16).padStart(64, '0'),
            description: 'Shield to pool',
            type: 'Deposit',
          });
          break;
        }
        case 'transferSent': {
          const info = tokenInfo(action.token);
          entries.push({
            date,
            time,
            amount: bigIntToHuman(action.amount, info?.decimals ?? 18),
            currency: info?.symbol ?? 'UNK',
            tx: txHash,
            addr: '0x' + action.toAddress.toString(16).padStart(64, '0'),
            description: 'Private transfer',
            type: 'OneTime',
          });
          break;
        }
        case 'withdrawal': {
          const info = tokenInfo(action.token);
          entries.push({
            date,
            time,
            amount: bigIntToHuman(action.amount, info?.decimals ?? 18),
            currency: info?.symbol ?? 'UNK',
            tx: txHash,
            addr: '0x' + action.toAddress.toString(16).padStart(64, '0'),
            description: 'Unshield from pool',
            type: 'Withdraw',
          });
          break;
        }
        case 'transferReceived': {
          const info = tokenInfo(action.token);
          entries.push({
            date,
            time,
            amount: bigIntToHuman(action.amount, info?.decimals ?? 18),
            currency: info?.symbol ?? 'UNK',
            tx: txHash,
            addr: '0x' + action.fromAddress.toString(16).padStart(64, '0'),
            description: 'Private transfer received',
            type: 'Received',
          });
          break;
        }
        case 'transferSelf': {
          const info = tokenInfo(action.token);
          entries.push({
            date,
            time,
            amount: bigIntToHuman(action.amount, info?.decimals ?? 18),
            currency: info?.symbol ?? 'UNK',
            tx: txHash,
            addr: '0x' + userAddrBig.toString(16).padStart(64, '0'),
            name: 'PayrollContract',
            description: 'Internal transfer (own notes)',
            type: 'SelfTransfer',
          });
          break;
        }
        case 'swap': {
          // A swap has multiple legs on each side. AuditTx carries one
          // amount/currency, so the row leads with what was received and spells
          // out the full route in the description.
          const legs = (xs: typeof action.sent) => xs.map((l) => {
            const i = tokenInfo(l.token);
            return `${bigIntToHuman(l.amount, i?.decimals ?? 18)} ${i?.symbol ?? 'UNK'}`;
          }).join(' + ');
          const head = action.received[0];
          const headInfo = head ? tokenInfo(head.token) : undefined;
          entries.push({
            date,
            time,
            amount: head ? bigIntToHuman(head.amount, headInfo?.decimals ?? 18) : 0,
            currency: headInfo?.symbol ?? '—',
            tx: txHash,
            addr: '0x' + action.executor.toString(16).padStart(64, '0'),
            description: `Convert ${legs(action.sent)} → ${legs(action.received)}`,
            type: 'Convert',
          });
          break;
        }
        case 'fee': {
          const info = tokenInfo(action.token);
          entries.push({
            date,
            time,
            amount: bigIntToHuman(action.amount, info?.decimals ?? 18),
            currency: info?.symbol ?? 'UNK',
            tx: txHash,
            addr: '0x' + action.toAddress.toString(16).padStart(64, '0'),
            description: 'Network fee (paymaster)',
            type: 'Fee',
          });
          break;
        }
        default: {
          // Every branch above is a HistoryAction kind. If the SDK adds another,
          // shout instead of dropping it — that silence is exactly why
          // withdrawals, receives, swaps, self-transfers and fees were missing
          // from the audit log.
          const unknown: never = action;
          console.warn('[audit] unhandled history action, row omitted:', unknown);
        }
      }
    }
  }

  entries.reverse(); // indexer returns oldest-first

  return entries;
}

// YYYY-MM-DD HH:MM in the operator's local timezone — avoids the
// UTC-vs-wall-clock drift the audit log used to surface (e.g. a
// late-night tx appearing on tomorrow's date).
function formatLocalDateTime(epochMs: number): { date: string; time: string } {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

function toBigint(addr: unknown): bigint {
  if (typeof addr === 'bigint') return addr;
  if (typeof addr === 'string') return BigInt(addr);
  if (addr && typeof addr === 'object' && 'toString' in addr) return BigInt(String(addr));
  return 0n;
}

function tokenInfo(tokenBig: bigint): { symbol: string; decimals: number } | null {
  for (const [key, meta] of Object.entries(TOKENS)) {
    if (BigInt(meta.address) === tokenBig) {
      return { symbol: key.toUpperCase(), decimals: meta.decimals };
    }
  }
  return null;
}

function bigIntToHuman(raw: bigint, decimals: number): number {
  if (decimals === 0) return Number(raw);
  return Number(raw) / Math.pow(10, decimals);
}
