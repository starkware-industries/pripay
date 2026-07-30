import {
  Account,
  SignerInterface,
  type DeclareSignerDetails,
  type DeployAccountSignerDetails,
  type InvocationsSignerDetails,
  type ProviderInterface,
  type Signature,
  type Call,
  type TypedData,
} from "starknet"

// SignerInterface implementation that produces empty signatures. Pairs with
// PayrollContract, whose `is_valid_signature(hash, signature)` ignores the
// `signature` argument and only checks `hash == stored_hash`. The privacy
// pool's proof simulates that call inside the ZK proof, so a real ECDSA
// signature would be wasted — and we don't have a private key for the
// contract anyway.
//
// `getPubKey` returns a stub. The SDK doesn't consume the public key for the
// privacy-pool flow; it's only included so the interface remains satisfied.
export class NoOpSigner extends SignerInterface {
  async getPubKey(): Promise<string> {
    return "0x0"
  }
  async signMessage(_typedData: TypedData, _accountAddress: string): Promise<Signature> {
    return []
  }
  async signTransaction(
    _transactions: Call[],
    _transactionsDetail: InvocationsSignerDetails,
  ): Promise<Signature> {
    return []
  }
  async signDeployAccountTransaction(
    _transaction: DeployAccountSignerDetails,
  ): Promise<Signature> {
    return []
  }
  async signDeclareTransaction(_transaction: DeclareSignerDetails): Promise<Signature> {
    return []
  }
}

// Builds the Account the privacy SDK uses to identify the user. Address is
// PayrollContract's, signer is the no-op (signature is enforced via the
// pre-registered hash, not a real key).
//
// This Account is NOT used to send transactions to Starknet — it can't,
// because PayrollContract has no __execute__/__validate__ entrypoints. The
// SDK uses it only as the source of `user` (= contract address) and to embed
// an empty signature into the ProofInvocation. Actual chain submission goes
// through TxSubmitter (paymaster or stub).
export function createPayrollAccount(
  provider: ProviderInterface,
  payrollAddress: string,
): Account {
  return new Account({
    provider,
    address: payrollAddress,
    signer: new NoOpSigner(),
  })
}
