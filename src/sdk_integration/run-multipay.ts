import { AddressMap, type Payment } from '@starkware-libs/starknet-privacy-sdk';
import { type Account, type Call } from 'starknet';
import type { PrivateTransfersInterface } from '@starkware-libs/starknet-privacy-sdk';
import { signAndInjectAuth } from './sign-invocation.js';
import { computeInvocationHash } from './tx-hash.js';
import { getProvingBlockId } from './submit.js';
import { SDK_CHAIN_ID } from './network-config.js';
import { injectFeeAction, type TxSubmitter } from './submitter.js';
import { prepareOpFee } from './fee-prep.js';

export type MultiPayPhase =
  | 'building_proof'
  | 'signing_message'
  | 'generating_proof'
  | 'submitting';

export type MultiPayResult = {
  submittedTx: string;
  /** Tx hash of the batched unshielded ERC20 transfers, when extraWalletCalls
   *  were supplied (mixed shielded/unshielded recurrent runs). undefined
   *  otherwise. */
  unshieldedTx?: string;
  paymasterFeeFri: bigint | null;
  paymentCount: number;
};

export async function runMultiPay(
  operatorAccount: Account,
  payrollAddress: string,
  transfers: PrivateTransfersInterface,
  submitter: TxSubmitter,
  payments: Payment[],
  onPhase?: (phase: MultiPayPhase) => void,
  // Extra wallet calls (unshielded ERC20 transfers) for mixed shielded/
  // unshielded recurrent runs. The proof authorization is now an off-chain
  // SNIP-12 signature (no on-chain precommit to batch with), so these are
  // sent as their own wallet multicall; their tx hash comes back as
  // `unshieldedTx`.
  extraWalletCalls?: Call[],
): Promise<MultiPayResult> {
  if (payments.length === 0) throw new Error('multipay: no payments provided');
  const phase = onPhase ?? (() => {});

  const byToken = new AddressMap<Payment[]>();
  for (const p of payments) {
    const list = byToken.get(p.token) ?? [];
    list.push(p);
    byToken.set(p.token, list);
  }

  // AVNU SponsoredPrivate fee_action; fee token picked by shielded balance
  // (STRK → USDC → ETH). null for Local / paste-key submitters.
  const prep = await prepareOpFee(submitter, transfers);

  phase('building_proof');
  let builder = transfers.build({
    autoSelectNotes: 'naive',
    autoDiscover: { notes: 'refresh', channels: 'refresh' },
    autoSetup: true,
  });
  for (const [token, group] of byToken.entries()) {
    builder = builder.with(token, (t) =>
      t.transfer(...group.map(({ recipient, amount }) => ({ recipient, amount }))),
    );
  }
  let invocationResult;
  try {
    invocationResult = await injectFeeAction(builder.surplusTo(transfers.user), prep).createProofInvocation();
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    // One unregistered recipient bricks the whole batch.
    const match = msg.match(/Missing channel context for recipient (0x[0-9a-f]+)/i);
    if (match) {
      const recipient = match[1];
      throw new Error(
        `Recipient ${recipient.slice(0, 10)}…${recipient.slice(-4)} hasn't onboarded the privacy pool yet. ` +
        `Every recipient in a multipay must be registered. Remove or replace this order and retry.`,
      );
    }
    throw err;
  }
  const h = computeInvocationHash(invocationResult.invocation, SDK_CHAIN_ID);
  // Wallet SNIP-12-signs h; the prover verifies it via is_valid_signature.
  phase('signing_message');
  await signAndInjectAuth(operatorAccount, invocationResult.invocation, h);

  // Mixed batch: send the unshielded ERC20 transfers as their own wallet
  // multicall (a second prompt, since there's no on-chain precommit to batch
  // them with anymore). Their tx hash is surfaced for audit tagging.
  let unshieldedTx: string | undefined;
  if (extraWalletCalls && extraWalletCalls.length) {
    const { transaction_hash } = await operatorAccount.execute(extraWalletCalls);
    unshieldedTx = transaction_hash;
  }

  phase('generating_proof');
  const provingBlockId = await getProvingBlockId(operatorAccount.provider, 10);
  const result = await transfers.executeWithInvocation(invocationResult, provingBlockId);

  const paymasterFeeFri = prep ? prep.feeFri : await submitter.estimateFee(result.callAndProof);

  phase('submitting');
  const submittedTx = await submitter.submit(result.callAndProof, prep);

  return {
    submittedTx,
    unshieldedTx,
    paymasterFeeFri,
    paymentCount: payments.length,
  };
}
