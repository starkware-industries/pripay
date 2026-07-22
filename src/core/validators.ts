export const validAddr = (a: string): boolean =>
  Boolean(a) && /^0x[0-9a-fA-F]{1,64}$/.test(a.trim());

export const burnAddr = (a: string): boolean =>
  a.trim().slice(2).replace(/^0+/, '') === '';

export const validAmt = (v: string | number): boolean => {
  const n = parseFloat(String(v).trim());
  return !isNaN(n) && n > 0;
};

import { USDC_ADDRESS } from '../sdk_integration/network-config';

// STRK + ETH have unified addresses across Sepolia and Mainnet (deployed by
// Starknet at the same contract address on both). Only USDC differs — its
// per-network value comes from network-config.
export const TOKENS = {
  usdc: { address: USDC_ADDRESS, decimals: 6 },
  strk: { address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', decimals: 18 },
  eth:  { address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7', decimals: 18 },
} as const;
