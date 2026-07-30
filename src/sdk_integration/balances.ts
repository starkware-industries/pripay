import type {
  PrivateTransfersInterface,
  StarknetAddressBigint,
} from "@starkware-libs/starknet-privacy-sdk"
import type { BlockIdentifier } from "starknet"

export type GetPrivateBalancesOptions = {
  // Restrict the scan to specific tokens. Omit to discover all tokens.
  tokens?: StarknetAddressBigint[]
  // Snapshot at a specific block. Defaults to latest.
  blockIdentifier?: BlockIdentifier
}

// Returns the user's spendable private balance per token, summed across all
// unspent notes. Keys are token addresses normalized to bigint (the same form
// the SDK's AddressMap uses internally).
//
// Tokens with zero balance are omitted from the result. Call discoverNotes
// directly if you need note-level detail.
//
// Throws if the user isn't registered.
export async function getPrivateBalances(
  transfers: PrivateTransfersInterface,
  options?: GetPrivateBalancesOptions,
): Promise<Map<bigint, bigint>> {
  const { notes } = await transfers.discoverNotes({
    tokens: options?.tokens,
    blockIdentifier: options?.blockIdentifier,
  })

  const balances = new Map<bigint, bigint>()
  for (const [tokenAddr, noteList] of notes.entries()) {
    let total = 0n
    for (const note of noteList) total += note.amount
    if (total > 0n) balances.set(tokenAddr, total)
  }
  return balances
}
