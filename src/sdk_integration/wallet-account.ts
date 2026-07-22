import { WalletAccount, type ProviderInterface } from 'starknet';

// Wraps a browser-injected wallet (Ready, Braavos, ForDefi) in a
// starknet.js WalletAccount. The returned Account routes execute()/signing
// through the wallet UI — the wallet's own key signs and submits the V3
// invoke tx via wallet_addInvokeTransaction.
//
// Caller supplies the address that's already been requested from the wallet
// (the existing wallet.ts:connectWithWallet flow does that) so we don't pop
// a second permission prompt here.
//
// MetaMask snap is intentionally NOT supported here — its provider shape
// isn't a StarknetWindowObject. Onboarding requires a starknet.js-compatible
// wallet for now; surface a clear error elsewhere if MetaMask is picked.
const WALLET_GLOBALS: Record<string, string[]> = {
  argent: ['starknet_argentX'],
  braavos: ['starknet_braavos'],
  xverse: ['starknet_xverse'],
  fordefi: ['starknet_fordefi', 'fordefi'],
};

export function getInjectedWallet(type: string): unknown | null {
  // Auto-discovered wallets carry their own window key: `injected:<key>`.
  if (type.startsWith('injected:')) {
    return (window as unknown as Record<string, unknown>)[type.slice('injected:'.length)] ?? null;
  }
  const keys = WALLET_GLOBALS[type];
  if (!keys) return null;
  const w = window as unknown as Record<string, unknown>;
  for (const k of keys) {
    if (w[k]) return w[k];
  }
  return null;
}

export function buildWalletAccount(
  provider: ProviderInterface,
  type: string,
  address: string,
): WalletAccount {
  const walletProvider = getInjectedWallet(type);
  if (!walletProvider) {
    throw new Error(
      `Cannot build WalletAccount: ${type} provider not found on window.`,
    );
  }
  return new WalletAccount({
    provider,
    // The starknet.js types expect a StarknetWindowObject; injected wallets
    // satisfy it at runtime even though our `unknown` cast hides that here.
    walletProvider: walletProvider as never,
    address,
  });
}
