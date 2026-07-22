import { state } from './state';
import { TOKENS } from './validators';

// Mainnet USDC only exposes the canonical snake_case `balance_of`, while OZ
// Cairo-1 ERC-20s (STRK / ETH) expose both `balance_of` and `balanceOf`. Try
// the canonical name first and fall back to the legacy camelCase if needed.
async function callBalance(contractAddress: string, owner: string, entrypoint: string): Promise<string[] | null> {
  try {
    const result = await state.provider.callContract({ contractAddress, entrypoint, calldata: [owner] });
    return result as string[];
  } catch {
    return null;
  }
}

export async function fetchRawBalanceOf(token: string, owner: string): Promise<bigint | null> {
  const contract = TOKENS[token as keyof typeof TOKENS];
  if (!contract) return null;
  try {
    let result = await callBalance(contract.address, owner, 'balance_of');
    if (!result) result = await callBalance(contract.address, owner, 'balanceOf');
    if (!result) {
      console.warn('[PriPay] balance lookup failed for', token);
      return null;
    }
    return result.length >= 2
      ? BigInt(result[0]) + BigInt(result[1]) * (2n ** 128n)
      : BigInt(result[0]);
  } catch (e) {
    console.error('[PriPay] fetchRawBalanceOf exception for', token, e);
    return null;
  }
}

export function formatTokenAmount(raw: bigint, token: string): string {
  const contract = TOKENS[token as keyof typeof TOKENS];
  if (!contract) return '—';
  const dec = BigInt(contract.decimals);
  const whole = raw / (10n ** dec);
  const frac  = (raw % (10n ** dec)).toString().padStart(Number(dec), '0').slice(0, 2);
  return `${Number(whole).toLocaleString()}.${frac} ${token.toUpperCase()}`;
}

export async function fetchBalance(token: string): Promise<string> {
  const addr = state.walletConnected;
  if (!addr) return '—';
  const raw = await fetchRawBalanceOf(token, addr);
  return raw == null ? '—' : formatTokenAmount(raw, token);
}
