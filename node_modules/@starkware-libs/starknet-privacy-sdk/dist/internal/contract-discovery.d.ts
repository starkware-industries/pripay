import { BlockIdentifier } from "starknet";
import { ViewingKey, Note, Channel, StarknetAddressBigint } from "../interfaces.js";
import { AddressMap } from "../utils/maps.js";
import { AbstractDiscoveryProvider } from "./abstract-discovery.js";
import type { ChannelCursor, NotesCursor, RecipientsFilter } from "./channel.js";
import { type RateLimitOptions } from "../utils/rate-limiter.js";
import type { PoolContractInterface } from "./pool-contract-interface.js";
export type { PoolContractInterface, NoteData } from "./pool-contract-interface.js";
/**
 * Options for ContractDiscoveryProvider.
 */
export type DiscoveryOptions = {
    /** Rate limiting for pool contract RPC calls */
    rateLimit?: RateLimitOptions;
};
export declare class ContractDiscoveryProvider extends AbstractDiscoveryProvider {
    private readonly pool;
    constructor(pool: PoolContractInterface, options?: DiscoveryOptions);
    discoverNotes(address: StarknetAddressBigint, viewingKey: ViewingKey, params?: {
        cursor?: NotesCursor;
        tokens?: StarknetAddressBigint[];
        blockIdentifier?: BlockIdentifier;
    }): Promise<{
        timestamp: BlockIdentifier;
        notes: AddressMap<Note[]>;
        cursor: NotesCursor;
    }>;
    discoverChannels(address: StarknetAddressBigint, viewingKey: ViewingKey, recipients: RecipientsFilter, params?: {
        cursor?: ChannelCursor;
        blockIdentifier?: BlockIdentifier;
    }): Promise<{
        timestamp: BlockIdentifier;
        channels?: AddressMap<Channel>;
        total?: number;
    }>;
}
//# sourceMappingURL=contract-discovery.d.ts.map