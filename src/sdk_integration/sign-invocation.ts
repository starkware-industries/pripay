import { stark, type Account, type Signature, type TypedData } from 'starknet';
import type { ProofInvocation } from '@starkware-libs/starknet-privacy-sdk';
import { SNIP12_CHAIN_ID } from './network-config.js';

// SNIP-12 (revision 1) typed message the treasury wallet signs to authorize a
// privacy-pool proof. The single field `hash` is the V3 proof-invocation tx
// hash the pool simulates `is_valid_signature` against. PayrollContract
// reconstructs this exact message hash on-chain (bound to the owner address +
// chain id) and delegates the ECDSA check to the owner wallet account — which
// replaces the old `register_hash` on-chain precommit.
//
// `chainId` must be the shortstring form ('SN_MAIN' / 'SN_SEPOLIA'), matching
// what the contract reads from `get_tx_info().chain_id`. That's
// SNIP12_CHAIN_ID, NOT SDK_CHAIN_ID (which is the 0x… felt form).
export function buildAuthTypedData(h: string): TypedData {
  return {
    types: {
      StarknetDomain: [
        { name: 'name', type: 'shortstring' },
        { name: 'version', type: 'shortstring' },
        { name: 'chainId', type: 'shortstring' },
        { name: 'revision', type: 'shortstring' },
      ],
      Message: [{ name: 'hash', type: 'felt' }],
    },
    primaryType: 'Message',
    domain: { name: 'PriPay', version: '1', chainId: SNIP12_CHAIN_ID, revision: '1' },
    message: { hash: h },
  };
}

// Asks the connected wallet to SNIP-12-sign the invocation hash and injects the
// resulting signature into the proof invocation in place. The prover passes
// this signature to PayrollContract.is_valid_signature(h, sig) at the proving
// block — no on-chain precommit needed. Mutating `invocation.signature` is
// honored: executeWithInvocation serializes the invocation (signature included)
// straight to the proving service; it does not re-derive the signature.
export async function signAndInjectAuth(
  operatorAccount: Account,
  invocation: ProofInvocation,
  h: string,
): Promise<Signature> {
  const sig = await operatorAccount.signMessage(buildAuthTypedData(h));
  (invocation as { signature: string[] }).signature = stark.formatSignature(sig);
  return sig;
}
