import { hash, stark, type constants } from "starknet"
import type { ProofInvocation } from "@starkware-libs/starknet-privacy-sdk"

// Computes the Starknet V3 invoke transaction hash from a ProofInvocation
// (= INVOKE_TXN_V3). This is the hash `h` that:
//   1) the SDK passes to PayrollContract.is_valid_signature(h, sig) inside the
//      proof's user-signature simulation,
//   2) the treasury wallet SNIP-12-signs (as the typed message `{ hash: h }`)
//      so that simulation returns 'VALID'. See sign-invocation.ts.
//
// The hash is a pure function of the V3 envelope fields — no chain interaction
// needed. As long as the invocation is final (no field changes before
// executeWithInvocation runs), the signed hash will match.
//
// The chainId is passed in because the invocation type doesn't carry it; in
// practice it must match the chain the proof will be submitted to.
export function computeInvocationHash(
  invocation: ProofInvocation,
  chainId: constants.StarknetChainId,
): string {
  return hash.calculateInvokeTransactionHash({
    senderAddress: invocation.sender_address,
    version: invocation.version,
    compiledCalldata: invocation.calldata,
    chainId,
    nonce: invocation.nonce,
    accountDeploymentData: invocation.account_deployment_data,
    nonceDataAvailabilityMode: stark.intDAM(invocation.nonce_data_availability_mode),
    feeDataAvailabilityMode: stark.intDAM(invocation.fee_data_availability_mode),
    resourceBounds: {
      l1_gas: {
        max_amount: BigInt(invocation.resource_bounds.l1_gas.max_amount),
        max_price_per_unit: BigInt(
          invocation.resource_bounds.l1_gas.max_price_per_unit,
        ),
      },
      l1_data_gas: {
        max_amount: BigInt(invocation.resource_bounds.l1_data_gas.max_amount),
        max_price_per_unit: BigInt(
          invocation.resource_bounds.l1_data_gas.max_price_per_unit,
        ),
      },
      l2_gas: {
        max_amount: BigInt(invocation.resource_bounds.l2_gas.max_amount),
        max_price_per_unit: BigInt(
          invocation.resource_bounds.l2_gas.max_price_per_unit,
        ),
      },
    },
    tip: invocation.tip,
    paymasterData: invocation.paymaster_data,
    proofFacts: invocation.proof_facts,
  })
}
