import { toHex } from "../utils/convert.js";
// Conversion helpers
/** Builds a HistoryCursor from sync cursors (notes + channels). */
export function buildHistoryCursor(userAddress, notesCursor, channelCursor) {
    const subchannels = [];
    // Incoming subchannels from notesCursor
    for (const [sender, incomingChannel] of notesCursor.incomingChannels) {
        for (const [token, noteIndex] of incomingChannel.noteIndexes) {
            subchannels.push({
                channelKey: incomingChannel.channelKey,
                token,
                channelKind: sender === userAddress ? "self_channel" : "incoming",
                counterparty: sender,
                nextIndex: noteIndex > 0 ? noteIndex - 1 : undefined,
            });
        }
    }
    // Outgoing subchannels from channelCursor
    if (channelCursor.channels) {
        for (const [recipient, channel] of channelCursor.channels) {
            if (!channel.key)
                continue;
            if (recipient === userAddress)
                continue;
            const channelKind = "outgoing";
            for (const [token, tokenChannel] of channel.tokens) {
                subchannels.push({
                    channelKey: channel.key,
                    token,
                    channelKind,
                    counterparty: recipient,
                    nextIndex: tokenChannel.noteNonce > 0 ? tokenChannel.noteNonce - 1 : undefined,
                });
            }
        }
    }
    return { subchannels, historyComplete: false };
}
/** Converts SDK HistoryCursor → API wire format. */
export function historyCursorToApi(cursor) {
    return {
        subchannels: cursor.subchannels.map((sc) => ({
            channel_key: toHex(sc.channelKey),
            token: toHex(sc.token),
            channel_kind: sc.channelKind,
            counterparty: toHex(sc.counterparty),
            next_index: sc.nextIndex ?? null,
        })),
        begin_block_number: cursor.beginBlockNumber,
        history_complete: cursor.historyComplete,
    };
}
/** Converts API history response → SDK HistoryPage. */
export function apiResponseToHistoryPage(resp) {
    return {
        blockRef: resp.block_ref,
        transactions: resp.transactions.map((tx) => ({
            blockNumber: tx.block_number,
            transactionHash: BigInt(tx.transaction_hash),
            notes: tx.notes.map((note) => ({
                channelKind: note.channel_kind,
                token: BigInt(note.token),
                noteIndex: note.note_index,
                noteId: BigInt(note.note_id),
                counterparty: BigInt(note.counterparty),
                amount: BigInt(note.amount),
                salt: BigInt(note.salt),
            })),
            deposits: tx.deposits.map((deposit) => ({
                fromAddress: BigInt(deposit.user_address),
                token: BigInt(deposit.token),
                amount: BigInt(deposit.amount),
            })),
            withdrawals: tx.withdrawals.map((withdrawal) => ({
                toAddress: BigInt(withdrawal.to_address),
                token: BigInt(withdrawal.token),
                amount: BigInt(withdrawal.amount),
            })),
            openNoteDeposits: tx.open_note_deposits.map((deposit) => ({
                depositor: BigInt(deposit.depositor),
                token: BigInt(deposit.token),
                noteId: BigInt(deposit.note_id),
                amount: BigInt(deposit.amount),
            })),
            ...(tx.registered_pubkey && { registeredPubkey: BigInt(tx.registered_pubkey) }),
        })),
        cursor: {
            subchannels: resp.cursor.subchannels.map((sc) => ({
                channelKey: BigInt(sc.channel_key),
                token: BigInt(sc.token),
                channelKind: sc.channel_kind,
                counterparty: BigInt(sc.counterparty),
                nextIndex: sc.next_index ?? undefined,
            })),
            beginBlockNumber: resp.cursor.begin_block_number,
            historyComplete: resp.cursor.history_complete,
        },
    };
}
//# sourceMappingURL=history.js.map