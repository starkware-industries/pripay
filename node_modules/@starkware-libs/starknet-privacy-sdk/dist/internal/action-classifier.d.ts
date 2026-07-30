import type { HistoryTransaction } from "./history.js";
export type SwapLeg = {
    token: bigint;
    amount: bigint;
};
export type HistoryAction = {
    type: "deposit";
    fromAddress: bigint;
    token: bigint;
    amount: bigint;
} | {
    type: "withdrawal";
    toAddress: bigint;
    token: bigint;
    amount: bigint;
} | {
    type: "fee";
    toAddress: bigint;
    token: bigint;
    amount: bigint;
} | {
    type: "transferSent";
    toAddress: bigint;
    token: bigint;
    amount: bigint;
    noteCount: number;
} | {
    type: "transferReceived";
    fromAddress: bigint;
    token: bigint;
    amount: bigint;
    noteCount: number;
} | {
    type: "swap";
    executor: bigint;
    sent: SwapLeg[];
    received: SwapLeg[];
} | {
    type: "transferSelf";
    token: bigint;
    amount: bigint;
    noteCount: number;
} | {
    type: "register";
    pubkey: bigint;
};
export type HistoryActionKind = HistoryAction["type"];
export type ClassifiedTransaction = {
    blockNumber: number;
    transactionHash: bigint;
    actions: HistoryAction[];
};
export type ClassifyOptions = {
    /** Addresses that receive fee payments (e.g. paymaster forwarder).
     *  Withdrawals to these addresses won't prevent transferSelf detection. */
    feeRecipients?: bigint[];
};
/** Classifies a history transaction's raw events into user-facing actions. Pure, no I/O. */
export declare function classifyTransaction(transaction: HistoryTransaction, options?: ClassifyOptions): ClassifiedTransaction;
//# sourceMappingURL=action-classifier.d.ts.map