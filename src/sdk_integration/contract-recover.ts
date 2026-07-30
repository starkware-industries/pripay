import { cairo, hash, type Account, type Call } from 'starknet';
import type { PrivateTransfersInterface } from '@starkware-libs/starknet-privacy-sdk';
import { POOL_ADDRESS } from './client.js';
import { SDK_CHAIN_ID } from './network-config.js';
import { buildApprovePoolCall } from './approve-pool.js';
import { signAndInjectAuth } from './sign-invocation.js';
import { computeInvocationHash } from './tx-hash.js';
import { getProvingBlockId } from './submit.js';
import { injectFeeAction, type TxSubmitter } from './submitter.js';
import type { DepositPhase } from './run-deposit.js';

// Recovery paths for tokens stranded in PayrollContract by a shield that
// failed between the funding hop and the proof submission.

export type ContractTransferSpec = { tokenAddress: string; recipient: string; amount: bigint };

// PayrollContract.execute(calls) dispatching one ERC-20 `transfer` per spec.
// Same calldata layout as buildApprovePoolCall; owner-only, so the wallet
// signs the outer invoke.
export function buildContractWithdrawCall(payrollAddress: string, specs: ContractTransferSpec[]): Call {
  const transferSelector = hash.getSelectorFromName('transfer');
  const calldata: string[] = [String(specs.length)];
  for (const s of specs) {
    const { low, high } = cairo.uint256(s.amount);
    calldata.push(s.tokenAddress, transferSelector, '3', s.recipient, String(low), String(high));
  }
  return { contractAddress: payrollAddress, entrypoint: 'execute', calldata };
}

async function poolAllowance(operatorAccount: Account, tokenAddress: string, payrollAddress: string): Promise<bigint> {
  try {
    const result = (await operatorAccount.provider.callContract({
      contractAddress: tokenAddress,
      entrypoint: 'allowance',
      calldata: [payrollAddress, POOL_ADDRESS],
    })) as string[];
    return result.length >= 2
      ? BigInt(result[0]) + BigInt(result[1]) * (2n ** 128n)
      : BigInt(result[0]);
  } catch {
    return 0n;
  }
}

// runDeposit without the wallet→contract funding hop — the tokens are already
// in PayrollContract. The paymaster fee comes out of the deposited amount, so
// shielding `amount` nets amount − fee in the pool.
export async function runShieldFromContract(
  operatorAccount: Account,
  payrollAddress: string,
  transfers: PrivateTransfersInterface,
  submitter: TxSubmitter,
  tokenAddress: string,
  amount: bigint,
  onPhase?: (phase: DepositPhase) => void,
): Promise<{ submittedTx: string }> {
  const phase = onPhase ?? (() => {});

  const prep = (await submitter.prepareFee?.(tokenAddress)) ?? null;
  if (prep && BigInt(prep.feeAction.amount) >= amount) {
    throw new Error('Contract balance is smaller than the paymaster fee — withdraw it to the wallet instead.');
  }

  // The failed shield's funding multicall normally left a max-uint allowance
  // behind; re-approve only when it's missing (e.g. tokens sent directly).
  if ((await poolAllowance(operatorAccount, tokenAddress, payrollAddress)) < amount) {
    phase('funding_contract');
    const approveCall = buildApprovePoolCall(payrollAddress, tokenAddress, POOL_ADDRESS);
    const { transaction_hash } = await operatorAccount.execute([approveCall]);
    await operatorAccount.provider.waitForTransaction(transaction_hash);
  }

  phase('building_proof');
  const invocationResult = await injectFeeAction(
    transfers
      .build({ autoDiscover: { notes: 'refresh' }, autoSetup: true })
      .with(tokenAddress, (t) => t.deposit({ amount })),
    prep,
  ).createProofInvocation();
  const h = computeInvocationHash(invocationResult.invocation, SDK_CHAIN_ID);

  phase('signing_message');
  await signAndInjectAuth(operatorAccount, invocationResult.invocation, h);

  phase('generating_proof');
  const provingBlockId = await getProvingBlockId(operatorAccount.provider, 10);
  const result = await transfers.executeWithInvocation(invocationResult, provingBlockId);

  phase('submitting');
  const submittedTx = await submitter.submit(result.callAndProof, prep);

  return { submittedTx };
}
