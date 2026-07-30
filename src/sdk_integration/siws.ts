import { SNIP12_CHAIN_ID } from './network-config.js';

// Sign-In With Starknet (SIWS). The wallet-scoped APIs are keyed only by
// address, so without proof of ownership anyone could read/write another
// wallet's data by supplying its address. On login the wallet signs a
// server-issued nonce; the server verifies the signature against the account
// contract and sets an HttpOnly session cookie that authorizes the subsequent
// same-origin API calls. The cookie is never readable by JS.

function loginTypedData(address: string, nonce: string) {
  return {
    types: {
      StarknetDomain: [
        { name: 'name', type: 'shortstring' },
        { name: 'version', type: 'shortstring' },
        { name: 'chainId', type: 'shortstring' },
        { name: 'revision', type: 'shortstring' },
      ],
      Login: [
        { name: 'statement', type: 'string' },
        { name: 'address', type: 'felt' },
        { name: 'nonce', type: 'string' },
      ],
    },
    primaryType: 'Login',
    domain: { name: 'PriPay', version: '1', chainId: SNIP12_CHAIN_ID, revision: '1' },
    message: {
      statement: 'Sign in to PriPay to prove you own this wallet. This does not submit a transaction.',
      address,
      nonce,
    },
  };
}

// POST JSON with a timeout and one automatic retry. The first call after a cold
// serverless start can be slow (loading the on-chain verifier), and a plain
// fetch would hang until the user gives up; the retry hits the now-warm
// instance. Both payloads here are idempotent, so retrying needs no new signature.
async function postJsonRetry(
  url: string,
  body: unknown,
  { timeoutMs = 25000, attempts = 2 }: { timeoutMs?: number; attempts?: number } = {},
): Promise<Response> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      // aborted (timeout) or network error — fall through to retry once
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Wallet login timed out — please try connecting again.');
}

// Prove ownership of `address` with the injected wallet object `w`. Throws on
// failure (including user rejection) so the caller can abort the connection.
export async function walletSignIn(w: any, address: string): Promise<void> {
  const nRes = await postJsonRetry('/api/auth/nonce', { address });
  if (!nRes.ok) throw new Error('Could not start wallet login (HTTP ' + nRes.status + ')');
  const { nonce } = (await nRes.json()) as { nonce: string };

  const typedData = loginTypedData(address, nonce);
  let signature: unknown;
  if (typeof w?.request === 'function') {
    signature = await w.request({ type: 'wallet_signTypedData', params: typedData });
  } else if (typeof w?.account?.signMessage === 'function') {
    signature = await w.account.signMessage(typedData);
  } else {
    throw new Error('This wallet cannot sign the login message.');
  }

  // Single attempt: the nonce is single-use server-side, so retrying the same
  // signed payload would be rejected as a replay. Generous timeout instead, to
  // ride out a cold-start verify (starknet is preloaded server-side).
  const vRes = await postJsonRetry('/api/auth/verify', { address, signature, typedData }, { attempts: 1, timeoutMs: 35000 });
  if (!vRes.ok) {
    let msg = 'Wallet login failed';
    try { msg = ((await vRes.json()) as { error?: string }).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
}

// Clear the session cookie server-side (best-effort).
export async function walletSignOut(): Promise<void> {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
}
