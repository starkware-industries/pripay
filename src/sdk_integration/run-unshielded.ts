import { cairo, type Account, type Call } from 'starknet';

// Direct ERC20 transfers from the connected wallet — no privacy pool,
// no proof, no paymaster. The wallet signs (Ready/Braavos prompt) and
// pays gas itself. Used by:
//   - One-time transfer when the operator picks "Unshielded".
//   - Recurrent payroll for any order whose mode is 'unshielded',
//     possibly mixed with shielded orders in the same Initiate batch.
//
// The single-payment helper packs one call; the batch helper packs N
// calls into a native Starknet multicall so the operator signs once.

export type UnshieldedPayment = {
  recipient: string;     // 0x-prefixed Starknet address
  tokenAddress: string;  // ERC20 contract address
  amount: bigint;        // raw u256, decimals already applied
};

export type UnshieldedPhase = 'building_calls' | 'signing' | 'submitting';

export type UnshieldedResult = {
  submittedTx: string;
};

// Exported so callers can compose the ERC20 calls into a larger
// multicall (e.g. mixed recurrent runs sending the unshielded transfers
// as their own wallet multicall alongside the shielded proof).
export function buildUnshieldedTransferCalls(payments: UnshieldedPayment[]): Call[] {
  return payments.map(transferCall);
}

function transferCall({ recipient, tokenAddress, amount }: UnshieldedPayment): Call {
  const { low, high } = cairo.uint256(amount);
  return {
    contractAddress: tokenAddress,
    entrypoint: 'transfer',
    calldata: [recipient, String(low), String(high)],
  };
}

export async function runUnshieldedTransfer(
  walletAccount: Account,
  payment: UnshieldedPayment,
  onPhase?: (phase: UnshieldedPhase) => void,
): Promise<UnshieldedResult> {
  const phase = onPhase ?? (() => {});
  phase('building_calls');
  const call = transferCall(payment);
  phase('signing');
  const { transaction_hash } = await walletAccount.execute(call);
  phase('submitting');
  return { submittedTx: transaction_hash };
}

export async function runUnshieldedMultipay(
  walletAccount: Account,
  payments: UnshieldedPayment[],
  onPhase?: (phase: UnshieldedPhase) => void,
): Promise<UnshieldedResult> {
  const phase = onPhase ?? (() => {});
  phase('building_calls');
  const calls = payments.map(transferCall);
  phase('signing');
  const { transaction_hash } = await walletAccount.execute(calls);
  phase('submitting');
  return { submittedTx: transaction_hash };
}
