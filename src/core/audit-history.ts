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
  for (let i = 0; i < 20; i++) {
    const page = await discovery.fetchHistory(
      userAddrBig,
      notesResult.cursor,
      channelCursor as never,
      nextCursor ? { historyCursor: nextCursor } : undefined,
    );
    allTxs.push(...page.transactions);
    nextCursor = page.cursor;
    if (page.cursor.historyComplete) break;
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
    const classified = classifyTransaction(tx);
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
