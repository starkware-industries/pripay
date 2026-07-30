import type { BlockIdentifier } from "starknet";
import type { StarknetAddressBigint } from "../interfaces.js";
import type { NotesCursor, ChannelCursor } from "./channel.js";
export type ChannelKind = "incoming" | "outgoing" | "self_channel";
export type HistorySubchannel = {
    channelKey: bigint;
    token: bigint;
    channelKind: ChannelKind;
    counterparty: bigint;
    nextIndex: number | undefined;
};
export type HistoryCursor = {
    subchannels: HistorySubchannel[];
    beginBlockNumber?: number;
    historyComplete: boolean;
};
export type HistoryNote = {
    channelKind: ChannelKind;
    token: bigint;
    noteIndex: number;
    noteId: bigint;
    counterparty: bigint;
    amount: bigint;
    salt: bigint;
};
export type HistoryDeposit = {
    fromAddress: bigint;
    token: bigint;
    amount: bigint;
};
export type HistoryWithdrawal = {
    toAddress: bigint;
    token: bigint;
    amount: bigint;
};
export type HistoryOpenNoteDeposit = {
    depositor: bigint;
    token: bigint;
    noteId: bigint;
    amount: bigint;
};
export type HistoryTransaction = {
    blockNumber: number;
    transactionHash: bigint;
    notes: HistoryNote[];
    deposits: HistoryDeposit[];
    withdrawals: HistoryWithdrawal[];
    openNoteDeposits: HistoryOpenNoteDeposit[];
    /** Present only on the synthetic registration transaction (last in history). */
    registeredPubkey?: bigint;
};
export type HistoryPage = {
    blockRef: BlockIdentifier;
    transactions: HistoryTransaction[];
    cursor: HistoryCursor;
};
type ApiHistorySubchannel = {
    channel_key: string;
    token: string;
    channel_kind: string;
    counterparty: string;
    next_index: number | null;
};
type ApiHistoryCursor = {
    subchannels: ApiHistorySubchannel[];
    begin_block_number?: number;
    history_complete: boolean;
};
type ApiHistoryNote = {
    channel_kind: string;
    token: string;
    note_index: number;
    note_id: string;
    counterparty: string;
    amount: string;
    salt: string;
};
type ApiHistoryDeposit = {
    user_address: string;
    token: string;
    amount: string;
};
type ApiHistoryWithdrawal = {
    to_address: string;
    token: string;
    amount: string;
};
type ApiHistoryOpenNoteDeposit = {
    depositor: string;
    token: string;
    note_id: string;
    amount: string;
};
type ApiHistoryTransaction = {
    block_number: number;
    transaction_hash: string;
    notes: ApiHistoryNote[];
    deposits: ApiHistoryDeposit[];
    withdrawals: ApiHistoryWithdrawal[];
    open_note_deposits: ApiHistoryOpenNoteDeposit[];
    registered_pubkey?: string;
};
export type ApiHistoryResponse = {
    block_ref: BlockIdentifier;
    transactions: ApiHistoryTransaction[];
    cursor: ApiHistoryCursor;
};
/** Builds a HistoryCursor from sync cursors (notes + channels). */
export declare function buildHistoryCursor(userAddress: StarknetAddressBigint, notesCursor: NotesCursor, channelCursor: ChannelCursor): HistoryCursor;
/** Converts SDK HistoryCursor → API wire format. */
export declare function historyCursorToApi(cursor: HistoryCursor): ApiHistoryCursor;
/** Converts API history response → SDK HistoryPage. */
export declare function apiResponseToHistoryPage(resp: ApiHistoryResponse): HistoryPage;
export {};
//# sourceMappingURL=history.d.ts.map