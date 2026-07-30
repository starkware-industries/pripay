import {
  createPrivateTransfers,
  IndexerDiscoveryProvider,
  ProvingServiceProofProvider,
  type PrivateTransfersInterface,
  type ViewingKey,
} from "@starkware-libs/starknet-privacy-sdk"
import { type Account } from "starknet"
import {
  POOL_ADDRESS,
  PAYROLL_CLASS_HASH,
  PAYROLL_COMPILED_CLASS_HASH,
  SDK_CHAIN_ID,
  SNIP12_CHAIN_ID,
  EXPECTED_WALLET_CHAIN_ID,
  NETWORK_LABEL,
} from "./network-config"

// Re-export chain-bound constants so the existing import sites keep working.
// network-config.ts is the source of truth; flipping mainnet/sepolia happens
// there, not here.
export {
  POOL_ADDRESS,
  PAYROLL_CLASS_HASH,
  PAYROLL_COMPILED_CLASS_HASH,
  SNIP12_CHAIN_ID,
  EXPECTED_WALLET_CHAIN_ID,
}

// Back-compat alias for the renamed NETWORK_LABEL.
export const EXPECTED_NETWORK_NAME = NETWORK_LABEL

export type PrivacyClientConfig = {
  account: Account
  viewingKey: ViewingKey
}

export function createPrivacyClient({
  account,
  viewingKey,
}: PrivacyClientConfig): PrivateTransfersInterface {
  // Same-origin proxy paths (see server.js): the prover + indexer are plain HTTP
  // and the app is HTTPS, so the browser can't hit them directly (mixed content).
  // server.js forwards /api/prover and /api/discovery/* to the real upstreams.
  const provingProvider = new ProvingServiceProofProvider('/api/prover', SDK_CHAIN_ID)
  const discoveryProvider = new IndexerDiscoveryProvider('/api/discovery', POOL_ADDRESS)

  return createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider,
    discoveryProvider,
    poolContractAddress: POOL_ADDRESS,
  })
}
