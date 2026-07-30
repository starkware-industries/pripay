import { cairo, hash, type Call } from "starknet"

// Builds the Call the owner submits via their wallet to grant the privacy pool an
// ERC-20 allowance on a token held by PayrollContract. Required once per
// token before the first deposit of that token — without an allowance, the
// pool's TransferFrom server-side action (see paper §7.2) reverts.
//
// Why this routes through PayrollContract.execute: the ERC-20 `approve` must
// be invoked with `caller == owner of the tokens`, and the owner is
// PayrollContract (the owner transferred tokens to it). Only PayrollContract can
// authorize the approval. PayrollContract.execute is owner-only, so the owner's
// wallet signs the outer call and PayrollContract dispatches the approve.
//
// Defaults to max-uint256 ("infinite" allowance) — standard ERC-20 idiom that
// avoids one approve per deposit. Pass a smaller amount if you prefer
// per-deposit allowances.
export function buildApprovePoolCall(
  payrollAddress: string,
  tokenAddress: string,
  poolAddress: string,
  amount: bigint = (1n << 256n) - 1n,
): Call {
  const approveSelector = hash.getSelectorFromName("approve")
  const { low, high } = cairo.uint256(amount)

  // Calldata layout for PayrollContract.execute(calls: Array<Call>) with one
  // inner Call { to, selector, calldata: Array<felt252> }:
  //   [outer_array_len=1,
  //    inner.to,
  //    inner.selector,
  //    inner.calldata.len,
  //    ...inner.calldata]
  // The inner approve takes (spender, amount: u256) → 3 felts.
  const innerCalldata: string[] = [poolAddress, String(low), String(high)]

  return {
    contractAddress: payrollAddress,
    entrypoint: "execute",
    calldata: [
      "1",
      tokenAddress,
      approveSelector,
      String(innerCalldata.length),
      ...innerCalldata,
    ],
  }
}
