import type { ExecuteResult } from "@starkware-libs/starknet-privacy-sdk"
import type { Account, ProviderInterface } from "starknet"

// Submit an ExecuteResult to Starknet. Privacy-pool txs require the proof and
// proofFacts to ride in the V3 tx envelope (RPC 0.10.1+), not the calldata —
// without them, the pool reverts with EMPTY_PROOF_FACTS.
//
// This wraps the boilerplate every caller would otherwise repeat:
//   account.execute(result.callAndProof.call, {
//     proofFacts: result.callAndProof.proof.proofFacts,
//     proof: result.callAndProof.proof.data,
//   })
//
// Returns the transaction hash. Does not wait for inclusion — call
// `account.waitForTransaction(hash)` if you need confirmation.
export async function submitExecuteResult(
  account: Account,
  result: ExecuteResult,
): Promise<string> {
  const tx = await account.execute(result.callAndProof.call, {
    proofFacts: result.callAndProof.proof.proofFacts,
    proof: result.callAndProof.proof.data,
  })
  return tx.transaction_hash
}

// Picks a proving block that's safely behind the chain head. The sequencer
// rejects proofs whose base block is too close to the submission block
// ("proof block number is too recent") — must be at least 10 blocks back.
// We use 10 as the minimum margin matching the existing test-flow.
export async function getProvingBlockId(
  provider: ProviderInterface,
  margin = 10,
): Promise<number> {
  const latest = await provider.getBlockNumber()
  return latest - margin
}
