import {
  SetupRequirement,
  type ExecuteResult,
  type PrivateTransfersInterface,
  type StarknetAddress,
} from "@starkware-libs/starknet-privacy-sdk"
import type { BlockIdentifier } from "starknet"

export type DepositOptions = {
  // Block to prove against. The sequencer requires this to be at least
  // 10 blocks behind the submission block; otherwise the chain rejects with
  // "proof block number is too recent". Pass `latestBlock - 10` (or earlier).
  provingBlockId?: BlockIdentifier
}

// Deposits `amount` of `token` from the public account backing `transfers`
// into the privacy pool, creating a private note owned by the same account.
// This is the on-ramp: until at least one deposit has been made, transferToOne
// will fail with "no notes to spend".
//
// Throws if the sender isn't registered in the pool — call registerIdentity
// first.
//
// Prerequisite the caller must satisfy out-of-band: the depositor's wallet
// must have approved the pool contract to transfer `amount` of `token` (ERC20
// allowance). The SDK does not perform the approval — it expects the
// allowance to already exist when the deposit transaction lands.
//
// Submit the returned call/proof via submitExecuteResult, same as the
// transfer helpers.
export async function deposit(
  transfers: PrivateTransfersInterface,
  token: StarknetAddress,
  amount: bigint,
  options?: DepositOptions,
): Promise<ExecuteResult> {
  if (amount <= 0n) {
    throw new Error("deposit: amount must be positive.")
  }

  // We only need to check registration — a deposit creates the user's own
  // note and doesn't require a channel to anyone else. Pass `token` as the
  // recipient sentinel; we only act on the Register signal.
  const requirement = await transfers.discoverRequirement(transfers.user, token)
  if (requirement === SetupRequirement.Register) {
    throw new Error(
      `Cannot deposit: sender ${transfers.user} is not registered in the privacy pool.`,
    )
  }

  return transfers
    .build({
      autoDiscover: { notes: "refresh" },
      provingBlockId: options?.provingBlockId,
    })
    .with(token, (t) => t.deposit({ amount }))
    .execute()
}
