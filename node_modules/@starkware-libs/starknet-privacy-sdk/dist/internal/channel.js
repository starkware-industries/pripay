import { SetupRequirement, } from "../interfaces.js";
import { AddressMap } from "../utils/maps.js";
import { jsonStringify, jsonParse } from "../utils/json.js";
/** Type guard for non-negative integers */
function isUint(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
/** Assertion helper with type narrowing */
function assert(condition, message) {
    if (!condition)
        throw new Error(message());
}
export function cloneNotesCursor(cursor) {
    if (!cursor) {
        return {
            blockId: 0,
            incomingChannels: new AddressMap(),
        };
    }
    const cloneIncomingChannelCursor = (sc) => ({
        channelKey: sc.channelKey,
        subchannelIdIndex: sc.subchannelIdIndex,
        noteIndexes: new AddressMap(sc.noteIndexes.entries()),
        totalNoteCounts: new AddressMap(sc.totalNoteCounts.entries()),
    });
    const incomingChannels = new AddressMap([...cursor.incomingChannels.entries()].map(([k, v]) => [k, cloneIncomingChannelCursor(v)]));
    return {
        blockId: cursor.blockId,
        incomingChannels: incomingChannels,
    };
}
export function cloneChannelCursor(cursor) {
    if (!cursor) {
        return {
            channels: new AddressMap(),
            total: undefined,
        };
    }
    return {
        channels: cursor.channels
            ? new AddressMap([...cursor.channels.entries()].map(([k, v]) => [
                k,
                v.clone(),
            ]))
            : undefined,
        total: cursor.total,
    };
}
/** Channel containing nonces for token and note creation. */
export class Channel {
    publicKey;
    key;
    tokens; // for the next note for each token
    constructor(publicKey, key, tokens) {
        this.publicKey = publicKey;
        this.key = key;
        this.tokens = new AddressMap(() => {
            return { tokenIndex: 0, noteNonce: 0 };
        });
        if (tokens) {
            for (const [k, v] of tokens) {
                this.tokens.set(k, v);
            }
        }
    }
    incrementNoteNonce(token) {
        const current = this.tokens.get(token);
        current.noteNonce += 1;
        this.tokens.set(token, current);
        return current.noteNonce;
    }
    /** Create a deep clone of this channel */
    clone() {
        return new Channel(this.publicKey, this.key, this.tokens.entries());
    }
    toSetupRequirement(token) {
        if (!this.publicKey) {
            return SetupRequirement.Register;
        }
        if (!this.key) {
            return SetupRequirement.SetupChannel;
        }
        if (!this.tokens.has(token)) {
            return SetupRequirement.SetupToken;
        }
        return SetupRequirement.Ready;
    }
}
export const channelSerde = {
    encode(channel) {
        // jsonStringify handles bigint keys automatically
        const json = jsonStringify({
            v: 1,
            key: channel.key,
            recipientPublicKey: channel.publicKey,
            tokens: Array.from(channel.tokens.entries()).map(([k, v]) => [
                k,
                {
                    tokenIndex: v.tokenIndex,
                    noteNonce: v.noteNonce,
                },
            ]),
        });
        return json;
    },
    decode(blob) {
        // jsonParse restores bigints automatically
        const parsed = jsonParse(blob);
        if (parsed === null || typeof parsed !== "object") {
            throw new Error("Invalid channel payload");
        }
        const { key, recipientPublicKey, tokens } = parsed;
        const decodedKey = assertOptionalChannelKey(key);
        const decodedPublicKey = assertChannelKey(recipientPublicKey);
        const decodedTokens = assertTokenEntries(tokens);
        return new Channel(decodedPublicKey, decodedKey, decodedTokens);
    },
};
/** Witness for a note, containing channel key and nonce. */
export class Witness {
    channelKey;
    nonce;
    r;
    constructor(channelKey, nonce, r) {
        this.channelKey = channelKey;
        this.nonce = nonce;
        this.r = r;
    }
}
export const witnessSerde = {
    encode(witness) {
        const json = jsonStringify({
            v: 1,
            channelKey: witness.channelKey,
            nonce: { sequence: witness.nonce },
            r: witness.r,
        });
        return json;
    },
    decode(blob) {
        const parsed = jsonParse(blob);
        if (parsed === null || typeof parsed !== "object") {
            throw new Error("Invalid witness payload");
        }
        const { channelKey, nonce, r } = parsed;
        const decodedChannelKey = assertChannelKey(channelKey);
        const decodedNonce = assertNoteNonce(nonce);
        const decodedR = assertBigInt(r);
        return new Witness(decodedChannelKey, decodedNonce, decodedR);
    },
};
function assertChannelKey(value) {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" || typeof value === "string") {
        return BigInt(value);
    }
    throw new Error("Invalid channel key");
}
function assertOptionalChannelKey(value) {
    if (value === undefined || value === null) {
        return undefined;
    }
    return assertChannelKey(value);
}
function assertBigInt(value) {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" || typeof value === "string") {
        return BigInt(value);
    }
    throw new Error("Invalid bigint");
}
function assertNoteNonce(value) {
    if (typeof value === "number") {
        assert(isUint(value), () => "Invalid nonce: must be a non-negative integer");
        return value;
    }
    // Backwards compatibility or object handling if strictly needed, but let's stick to simple number
    assert(value !== null && typeof value === "object", () => "Invalid nonce: expected number or object");
    const { sequence } = value;
    assert(isUint(sequence), () => "Invalid nonce: sequence must be a non-negative integer");
    return sequence;
}
function assertTokenEntries(value) {
    if (!Array.isArray(value)) {
        throw new Error("Invalid tokens");
    }
    const entries = value.map((entry) => {
        if (!Array.isArray(entry) || entry.length !== 2) {
            throw new Error("Invalid token entry");
        }
        const [token, nonces] = entry;
        const { tokenIndex, noteNonce } = nonces;
        return [
            token,
            {
                tokenIndex: assertTokenIndex(tokenIndex),
                noteNonce: assertNoteNonce(noteNonce),
            },
        ];
    });
    return new Map(entries);
}
function assertTokenIndex(value) {
    if (typeof value === "number") {
        assert(isUint(value), () => "Invalid token index: must be a non-negative integer");
        return value;
    }
    assert(value !== null && typeof value === "object", () => "Invalid nonce: expected number or object");
    const { sequence } = value;
    assert(isUint(sequence), () => "Invalid nonce: sequence must be a non-negative integer");
    return sequence;
}
//# sourceMappingURL=channel.js.map