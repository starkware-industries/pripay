/**
 * Builds the ProofFacts serialization matching both the blockifier and Cairo contract.
 *
 * The blockifier validates the first two fields as a version+variant header.
 * The Cairo contract deserializes the same array via Serde into ProofFacts struct.
 *
 * Blockifier checks:
 * 1. `proof_facts[0] == PROOF_VERSION` ('PROOF0')
 * 2. `proof_facts[1] == VIRTUAL_SNOS`
 * 3. `proof_facts[3] == VIRTUAL_OS_OUTPUT_VERSION` ('VIRTUAL_SNOS0')
 *
 * Cairo contract `validate_proof` checks:
 * 1. `program_variant == 'VIRTUAL_SNOS'`
 * 2. `starknet_os_output_version == 'VIRTUAL_SNOS0'`
 * 3. `base_block_number` within PROOF_VALIDITY_BLOCK_INTERVAL of current block
 * 4. `message_to_l1_hashes == [poseidon(pool_addr, 0, payload_len, ...serialized_server_actions)]`
 */
import type { BigNumberish } from "starknet";
/**
 * Build the L2-to-L1 message payload matching Cairo's compute_message_hash:
 *   `[class_hash, ...serialized_actions]`
 *
 * This is what the proving service returns in the L2-to-L1 message payload,
 * and what the message hash is computed over (after prepending pool_addr, 0, payload_len).
 */
export declare function buildMessagePayload(poolClassHash: BigNumberish, serverActionsCalldata: string[]): string[];
/**
 * Build the ProofFacts array matching both blockifier wire format and Cairo Serde layout.
 *
 * Layout (shared by blockifier and Cairo Serde):
 *   [0] proof_version: felt252          → PROOF_VERSION ('PROOF0')
 *   [1] program_variant: felt252        → VIRTUAL_SNOS
 *   [2] virtual_program_hash: felt252   → VIRTUAL_PROGRAM_HASH
 *   [3] starknet_os_output_version      → VIRTUAL_SNOS0
 *   [4] base_block_number: u64          → blockNumber
 *   [5] base_block_hash: felt252        → blockHash
 *   [6] starknet_os_config_hash: felt252 → Pedersen(version, chain_id, strk_token)
 *   [7] message_to_l1_hashes length     → 1 (Span serialization)
 *   [8] message_to_l1_hashes[0]         → poseidon(pool_addr, 0, payload_len, ...actions)
 */
export declare function buildProofFacts(poolAddress: BigNumberish, poolClassHash: BigNumberish, serverActionsCalldata: string[], blockNumber: bigint, blockHash: BigNumberish, chainId: BigNumberish): string[];
//# sourceMappingURL=proof-facts.d.ts.map