import { SetupRequirement, } from "../interfaces.js";
import { toBigInt } from "../utils/crypto.js";
import { toHex } from "../utils/convert.js";
import { AddressMap } from "../utils/maps.js";
import { AbstractDiscoveryProvider } from "./abstract-discovery.js";
import { Channel, Witness } from "./channel.js";
import { OhttpClient } from "./ohttp-client.js";
import { ReorgError } from "./errors.js";
import { buildHistoryCursor, historyCursorToApi, apiResponseToHistoryPage } from "./history.js";
/** HTTP 409 — the discovery service returns this exclusively for block reorgs (BLOCK_REORGED). */
const REORG_STATUS = 409;
export class IndexerDiscoveryProvider extends AbstractDiscoveryProvider {
    apiUrl;
    contractAddress;
    ohttpClient;
    constructor(apiUrl, contractAddress, options) {
        super();
        this.apiUrl = apiUrl;
        this.contractAddress = contractAddress;
        if (options?.ohttp) {
            const ohttpOptions = typeof options.ohttp === "object"
                ? { relayUrl: options.ohttp.relayUrl, publicKeyConfig: options.ohttp.publicKeyConfig }
                : undefined;
            this.ohttpClient = new OhttpClient(apiUrl, ohttpOptions);
        }
    }
    async isHealthy() {
        try {
            const body = await this.get("/health");
            return body.status === "OK";
        }
        catch {
            return false;
        }
    }
    async getHealth() {
        return this.get("/health");
    }
    async discoverNotes(address, viewingKey, params) {
        const tokenFilter = params?.tokens ? new Set(params.tokens.map(toBigInt)) : null;
        const cursor = params?.cursor;
        let apiCursor = cursor ? notesCursorToApiCursor(cursor, tokenFilter) : {};
        // last_known_block is sent once on the first request for reorg detection.
        // block_ref (from the first response) pins subsequent pagination requests.
        const lastKnownBlock = cursor?.blockId;
        let blockRef;
        const allNotes = new AddressMap(() => []);
        const incomingChannels = new AddressMap();
        let complete = false;
        do {
            const body = {
                contract_address: toHex(this.contractAddress),
                recipient_address: toHex(address),
                viewing_key: toHex(viewingKey),
                cursor: apiCursor,
            };
            if (blockRef) {
                body.block_ref = blockRef;
            }
            else if (params?.blockIdentifier !== undefined) {
                body.block_ref = params.blockIdentifier;
            }
            else if (lastKnownBlock) {
                body.last_known_block = lastKnownBlock;
            }
            const resp = await this.post("/v1/sync/incoming_state", body);
            blockRef = resp.block_ref;
            const channelKeyMap = new Map();
            for (const ch of resp.channels) {
                channelKeyMap.set(ch.sender_addr, BigInt(ch.channel_key));
            }
            const notesByToken = convertIncomingNotes(resp.notes, channelKeyMap, incomingChannels, tokenFilter);
            for (const [token, tokenNotes] of notesByToken) {
                allNotes.get(token).push(...tokenNotes);
            }
            const updatedCursor = apiCursorToNotesCursor(resp.cursor, resp.block_ref);
            for (const [sender, icc] of updatedCursor.incomingChannels) {
                incomingChannels.set(sender, icc);
            }
            apiCursor = resp.cursor;
            complete = isApiCursorComplete(resp.cursor);
        } while (!complete);
        // FIXME: The incoming sync API filters out spent notes (nullifier exists).
        // When a note is spent and removed from the response, we lose information
        // about its index. The constructed noteIndexes[token] is
        // max(surviving_note.index) + 1, which may be lower than the true last
        // discovered index if the highest-index notes were spent. This causes
        // suboptimal incremental updates — the next call re-scans already-discovered
        // (but now spent) note indices.
        const blockIdentifier = blockRef;
        return {
            timestamp: blockIdentifier,
            notes: allNotes,
            cursor: { blockId: blockIdentifier, incomingChannels },
        };
    }
    async discoverChannels(address, viewingKey, recipients, params) {
        if (recipients === "total-only") {
            // The service sets `total_n_channels` only once channel discovery reaches
            // the sentinel, and a single request discovers at most `max_channels`.
            // Paginate to completion — pruning complete channels each round frees
            // cursor slots so discovery advances past the cap — then the count is final.
            let apiCursor = { channel_discovery_complete: false };
            let blockRef;
            let complete = false;
            do {
                const body = {
                    contract_address: toHex(this.contractAddress),
                    sender_address: toHex(address),
                    viewing_key: toHex(viewingKey),
                    cursor: apiCursor,
                };
                if (blockRef) {
                    body.block_ref = blockRef;
                }
                else if (params?.blockIdentifier !== undefined) {
                    body.block_ref = params.blockIdentifier;
                }
                const resp = await this.post("/v1/sync/outgoing_state", body);
                blockRef = resp.block_ref;
                apiCursor = resp.cursor;
                complete = isApiCursorComplete(resp.cursor);
                if (!complete)
                    pruneCompleteCursor(apiCursor);
            } while (!complete);
            if (apiCursor.total_n_channels === undefined) {
                throw new Error("outgoing_state reported complete without total_n_channels");
            }
            return {
                timestamp: blockRef,
                total: apiCursor.total_n_channels,
            };
        }
        const cursorMap = params?.cursor?.channels;
        let apiCursor;
        if (recipients === "all") {
            apiCursor = channelMapToApiCursor(cursorMap, false);
        }
        else {
            let allResolved = true;
            const resolved = new Map();
            for (const r of recipients) {
                const rb = toBigInt(r);
                const existing = cursorMap?.get(rb);
                if (existing?.key) {
                    resolved.set(rb, { key: existing.key, publicKey: toBigInt(existing.publicKey) });
                }
                else {
                    allResolved = false;
                }
            }
            if (allResolved) {
                // Targeted scan: skip channel discovery, only refresh subchannels
                apiCursor = { channel_discovery_complete: true, channels: {} };
                for (const [rb, info] of resolved) {
                    const existing = cursorMap?.get(rb);
                    const subchannels = existing
                        ? buildSubchannelCursors([...existing.tokens].map(([token, nonces]) => [token, nonces.noteNonce]), null)
                        : {};
                    apiCursor.channels[toHex(rb)] = {
                        channel_key: toHex(info.key),
                        subchannel_discovery_complete: false,
                        subchannels,
                    };
                }
            }
            else {
                apiCursor = { channel_discovery_complete: false, channels: {} };
            }
        }
        // Accumulate channel/subchannel data across all pagination pages.
        const createdChannelMap = new Map();
        const subchannelsByRecipient = new Map();
        const nonCreatedChannelMap = new Map();
        let blockRef;
        let complete = false;
        do {
            const body = {
                contract_address: toHex(this.contractAddress),
                sender_address: toHex(address),
                viewing_key: toHex(viewingKey),
                cursor: apiCursor,
            };
            if (blockRef) {
                body.block_ref = blockRef;
            }
            else if (params?.blockIdentifier !== undefined) {
                body.block_ref = params.blockIdentifier;
            }
            if (recipients !== "all") {
                body.recipients = recipients.map((r) => toHex(r));
            }
            const resp = await this.post("/v1/sync/outgoing_state", body);
            blockRef = resp.block_ref;
            accumulateOutgoingResponse(resp, createdChannelMap, subchannelsByRecipient, nonCreatedChannelMap);
            apiCursor = resp.cursor;
            complete = isApiCursorComplete(resp.cursor);
            if (!complete)
                pruneCompleteCursor(apiCursor);
        } while (!complete);
        // Build the final channel map from all accumulated data
        const channels = buildChannelMap(createdChannelMap, subchannelsByRecipient, nonCreatedChannelMap);
        if (recipients !== "all") {
            const requested = new Set(recipients.map(toBigInt));
            for (const key of [...channels.keys()]) {
                if (!requested.has(key))
                    channels.delete(key);
            }
        }
        // The loop above runs to the sentinel, so the final cursor carries the
        // authoritative outgoing-channel count. Surface it so callers opening a new
        // channel can reuse it instead of issuing a separate "total-only" query.
        return { timestamp: blockRef, channels, total: apiCursor.total_n_channels };
    }
    async discoverRequirement(address, viewingKey, recipient, token) {
        const resp = await this.post("/v1/sync/preflight_check", {
            contract_address: toHex(this.contractAddress),
            sender_address: toHex(address),
            viewing_key: toHex(viewingKey),
            recipient: toHex(recipient),
            token: toHex(token),
        });
        if (!resp.sender_registered)
            return SetupRequirement.Register;
        if (!resp.channel_exists)
            return SetupRequirement.SetupChannel;
        if (!resp.subchannel_exists)
            return SetupRequirement.SetupToken;
        return SetupRequirement.Ready;
    }
    async fetchHistory(userAddress, notesCursor, channelCursor, options) {
        const cursor = options?.historyCursor ?? buildHistoryCursor(userAddress, notesCursor, channelCursor);
        const body = {
            contract_address: toHex(this.contractAddress),
            user_address: toHex(userAddress),
            max_transactions: options?.maxTransactions ?? 50,
            cursor: historyCursorToApi(cursor),
        };
        if (options?.blockIdentifier !== undefined) {
            body.block_ref = options.blockIdentifier;
        }
        else if (options?.lastKnownBlock) {
            body.last_known_block = options.lastKnownBlock;
        }
        const resp = await this.post("/v1/history", body);
        return apiResponseToHistoryPage(resp);
    }
    async get(path) {
        if (this.ohttpClient) {
            return this.ohttpClient.get(path);
        }
        const resp = await fetch(`${this.apiUrl}${path}`, {
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) {
            throw new Error(`Indexer API ${path} failed (${resp.status})`);
        }
        return resp.json();
    }
    async post(path, body) {
        if (this.ohttpClient) {
            return this.ohttpClient.post(path, body);
        }
        const resp = await fetch(`${this.apiUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            if (resp.status === REORG_STATUS) {
                throw new ReorgError(`Block reorged during ${path}: ${text}`);
            }
            throw new Error(`Indexer API ${path} failed (${resp.status}): ${text}`);
        }
        return resp.json();
    }
}
/** Mirrors Rust `DiscoveryCursor::is_complete()`. */
function isApiCursorComplete(cursor) {
    if (!cursor.channel_discovery_complete)
        return false;
    if (!cursor.channels)
        return true;
    return Object.values(cursor.channels).every((ch) => ch.subchannel_discovery_complete &&
        (!ch.subchannels || Object.values(ch.subchannels).every((sc) => !!sc.note_discovery_complete)));
}
/** Builds `Record<string, ApiSubchannelCursor>` from token→noteIndex pairs, optionally filtered. */
export function buildSubchannelCursors(noteIndexes, tokenFilter, totalNoteCounts) {
    const subchannels = {};
    for (const [token, noteIndex] of noteIndexes) {
        if (tokenFilter && !tokenFilter.has(toBigInt(token)))
            continue;
        const cursor = {
            last_note_index: noteIndex > 0 ? noteIndex - 1 : undefined,
        };
        const noteCount = totalNoteCounts?.get(toBigInt(token));
        if (noteCount != null) {
            cursor.total_n_notes = noteCount;
        }
        subchannels[toHex(token)] = cursor;
    }
    return subchannels;
}
/** Converts SDK `NotesCursor` -> API cursor for an incoming sync request. */
export function notesCursorToApiCursor(cursor, tokenFilter) {
    const apiCursor = {
        channel_discovery_complete: false,
        last_channel_index: cursor.incomingChannels.size > 0 ? cursor.incomingChannels.size - 1 : undefined,
        channels: {},
    };
    for (const [sender, icc] of cursor.incomingChannels) {
        const subchannels = buildSubchannelCursors(icc.noteIndexes, tokenFilter, icc.totalNoteCounts);
        apiCursor.channels[toHex(sender)] = {
            channel_key: toHex(icc.channelKey),
            subchannel_discovery_complete: tokenFilter != null && tokenFilter.size === Object.keys(subchannels).length,
            last_subchannel_index: icc.subchannelIdIndex > 0 ? icc.subchannelIdIndex - 1 : undefined,
            subchannels,
        };
    }
    return apiCursor;
}
/** Converts API cursor from an incoming sync response → SDK `NotesCursor`. */
export function apiCursorToNotesCursor(apiCursor, blockRef) {
    const incomingChannels = new AddressMap();
    if (apiCursor.channels) {
        for (const [senderHex, ch] of Object.entries(apiCursor.channels)) {
            const channelKey = ch.channel_key ? BigInt(ch.channel_key) : 0n;
            const noteIndexes = new AddressMap();
            const totalNoteCounts = new AddressMap();
            if (ch.subchannels) {
                for (const [tokenHex, sc] of Object.entries(ch.subchannels)) {
                    noteIndexes.set(BigInt(tokenHex), (sc.last_note_index ?? -1) + 1);
                    if (sc.total_n_notes != null) {
                        totalNoteCounts.set(BigInt(tokenHex), sc.total_n_notes);
                    }
                }
            }
            incomingChannels.set(BigInt(senderHex), {
                channelKey,
                subchannelIdIndex: (ch.last_subchannel_index ?? -1) + 1,
                noteIndexes,
                totalNoteCounts,
            });
        }
    }
    return { blockId: blockRef, incomingChannels };
}
/** Converts SDK `AddressMap<Channel>` → API cursor for an outgoing sync request. */
export function channelMapToApiCursor(channels, channelDiscoveryComplete) {
    const apiCursor = {
        channel_discovery_complete: channelDiscoveryComplete,
        channels: {},
    };
    if (channels) {
        for (const [recipient, channel] of channels) {
            if (!channel.key)
                continue;
            const subchannels = buildSubchannelCursors([...channel.tokens].map(([token, nonces]) => [token, nonces.noteNonce]), null);
            apiCursor.channels[toHex(recipient)] = {
                channel_key: toHex(channel.key),
                subchannel_discovery_complete: false,
                subchannels,
            };
        }
    }
    return apiCursor;
}
/** Accumulates outgoing sync response data into maps across multiple pages. */
function accumulateOutgoingResponse(resp, createdChannelMap, subchannelsByRecipient, nonCreatedChannelMap) {
    for (const ch of resp.channels) {
        const info = { publicKey: BigInt(ch.recipient_public_key), channelKey: BigInt(ch.channel_key) };
        if (ch.precomputed) {
            // Precomputed channels may duplicate a real channel discovered in a
            // later pagination step. The created map takes precedence.
            if (!createdChannelMap.has(ch.recipient_addr)) {
                nonCreatedChannelMap.set(ch.recipient_addr, info);
            }
        }
        else {
            createdChannelMap.set(ch.recipient_addr, info);
            // Promote: if we previously saw a precomputed entry, the real one wins.
            nonCreatedChannelMap.delete(ch.recipient_addr);
        }
    }
    for (const sc of resp.subchannels) {
        let tokenMap = subchannelsByRecipient.get(sc.recipient_addr);
        if (!tokenMap) {
            tokenMap = new Map();
            subchannelsByRecipient.set(sc.recipient_addr, tokenMap);
        }
        const existing = tokenMap.get(sc.token);
        // Keep the most informative value: non-null overrides null
        if (!existing || sc.last_note_index !== null) {
            tokenMap.set(sc.token, { token: BigInt(sc.token), lastIndex: sc.last_note_index });
        }
    }
}
/** Builds the final SDK channel map from accumulated outgoing sync data. */
function buildChannelMap(createdChannelMap, subchannelsByRecipient, nonCreatedChannelMap) {
    const channels = new AddressMap();
    for (const [recipientHex, info] of createdChannelMap) {
        const tokens = new AddressMap();
        const subs = subchannelsByRecipient.get(recipientHex);
        if (subs) {
            let tokenIndex = 0;
            for (const [, sub] of subs) {
                tokens.set(sub.token, {
                    tokenIndex: tokenIndex++,
                    noteNonce: sub.lastIndex !== null ? sub.lastIndex + 1 : 0,
                });
            }
        }
        channels.set(BigInt(recipientHex), new Channel(info.publicKey, info.channelKey, tokens.entries()));
    }
    for (const [recipientHex, info] of nonCreatedChannelMap) {
        const addr = BigInt(recipientHex);
        if (!channels.has(addr)) {
            channels.set(addr, new Channel(info.publicKey));
        }
    }
    return channels;
}
/** Prunes complete channels/subchannels from an API cursor to reduce payload size. */
function pruneCompleteCursor(cursor) {
    if (!cursor.channels)
        return;
    for (const [addr, ch] of Object.entries(cursor.channels)) {
        if (ch.subchannel_discovery_complete && ch.subchannels) {
            for (const [token, sc] of Object.entries(ch.subchannels)) {
                if (sc.note_discovery_complete) {
                    delete ch.subchannels[token];
                }
            }
            if (Object.keys(ch.subchannels).length === 0) {
                delete cursor.channels[addr];
            }
        }
    }
}
/** Converts API incoming notes → SDK `Note` objects grouped by token. */
export function convertIncomingNotes(apiNotes, channelKeyMap, existingChannels, tokenFilter) {
    const result = new AddressMap(() => []);
    for (const n of apiNotes) {
        const token = BigInt(n.token);
        if (tokenFilter && !tokenFilter.has(token))
            continue;
        const sender = BigInt(n.sender_addr);
        const channelKey = channelKeyMap.get(n.sender_addr) ?? existingChannels.get(sender)?.channelKey;
        if (channelKey == null) {
            throw new Error(`Missing channel_key for sender ${n.sender_addr}: not found in current response or previous pages`);
        }
        result.get(token).push({
            id: n.note_id,
            amount: BigInt(n.amount),
            created: n.block_number,
            witness: new Witness(channelKey, n.index, BigInt(n.salt)),
            sender,
            open: n.salt === "1",
        });
    }
    return result;
}
//# sourceMappingURL=indexer-discovery.js.map