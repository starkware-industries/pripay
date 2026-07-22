import type { BlockIdentifier } from "starknet";
import type { Channel, DiscoveryProviderInterface, Note, StarknetAddressBigint, ViewingKey } from "../interfaces.js";
import { SetupRequirement } from "../interfaces.js";
import { AddressMap } from "../utils/maps.js";
import type { ChannelCursor, NotesCursor, RecipientsFilter } from "./channel.js";
export declare abstract class AbstractDiscoveryProvider implements DiscoveryProviderInterface {
    abstract discoverNotes(address: StarknetAddressBigint, viewingKey: ViewingKey, params?: {
        since?: BlockIdentifier;
        known?: AddressMap<Note[]>;
        tokens?: StarknetAddressBigint[];
        blockIdentifier?: BlockIdentifier;
    }): Promise<{
        timestamp: BlockIdentifier;
        notes: AddressMap<Note[]>;
        cursor: NotesCursor;
    }>;
    abstract discoverChannels(address: StarknetAddressBigint, viewingKey: ViewingKey, recipients: RecipientsFilter, params?: {
        cursor?: ChannelCursor;
        blockIdentifier?: BlockIdentifier;
    }): Promise<{
        timestamp: BlockIdentifier;
        channels?: AddressMap<Channel>;
        total?: number;
    }>;
    discoverRequirement(address: StarknetAddressBigint, viewingKey: ViewingKey, recipient: StarknetAddressBigint, token: StarknetAddressBigint): Promise<SetupRequirement>;
}
//# sourceMappingURL=abstract-discovery.d.ts.map