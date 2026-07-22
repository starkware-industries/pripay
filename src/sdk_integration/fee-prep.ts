import type { PrivateTransfersInterface } from "@starkware-libs/starknet-privacy-sdk"
import type { FeePreparation, TxSubmitter } from "./submitter.js"
import { getPrivateBalances } from "./balances.js"
import { TOKENS } from "../core/validators.js"

// Pick the pool-fee token by shielded balance for ops that spend existing pool
// funds (transfer/withdraw/swap/multipay): prefer STRK; if shielded STRK can't
// cover the fee, fall back to the first of USDC then ETH that has a shielded
// balance (AVNU oracle-converts the fee into the chosen token). Returns null for
// submitters with no fee step (Local / paste-key). Deposits and onboarding fund
// the fee from the wallet instead, so they don't use this.
export async function prepareOpFee(
  submitter: TxSubmitter,
  transfers: PrivateTransfersInterface,
): Promise<FeePreparation | null> {
  if (!submitter.prepareFee) return null

  const prepStrk = await submitter.prepareFee(TOKENS.strk.address)
  if (!prepStrk) return null

  let balances: Map<bigint, bigint>
  try {
    balances = await getPrivateBalances(transfers)
  } catch {
    return prepStrk // can't read balances (e.g. not registered) → default STRK
  }

  const bal = (addr: string) => balances.get(BigInt(addr)) ?? 0n
  if (prepStrk.feeFri == null || bal(TOKENS.strk.address) >= prepStrk.feeFri) return prepStrk

  for (const token of [TOKENS.usdc.address, TOKENS.eth.address]) {
    if (bal(token) > 0n) return submitter.prepareFee(token)
  }
  return prepStrk // nothing shielded covers it — let the build surface the shortfall
}
