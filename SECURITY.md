# Security Policy

## Status of this software

PriPay is **research-stage and unaudited**. Neither the application nor the
`PayrollContract` has had a formal security review. The public deployment targets
**Starknet Sepolia** and holds no mainnet funds. Do not run it against mainnet or with
high-value assets without your own review.

## Reporting a vulnerability

Please report privately, not as a public issue.

- Open a [GitHub security advisory](https://github.com/starkware-industries/pripay/security/advisories/new)
  on this repository, or
- email **security@starkware.co** with `pripay` in the subject.

Please include what you need to make it reproducible: affected endpoint or file, the
request or steps, and what an attacker gains. If you have a proof of concept, keep it
against your own wallet and against Sepolia.

We aim to acknowledge within a few business days. Since this is a research project
rather than a funded product, we do not operate a bug bounty and cannot promise fix
timelines.

Please do not run volumetric or denial-of-service testing against the hosted
deployment — the endpoints that cost real resources are documented below, and hammering
them mostly just spends someone's budget.

## Scope

In scope:

- The Express API in `server.js` — authentication, authorization, rate limiting, the
  reverse proxies, and the paymaster proxy.
- `contracts/` — the Cairo `PayrollContract`.
- The client in `src/`, particularly anything that decides what gets signed or which
  contract class gets deployed.

Out of scope, because they are known and documented rather than undiscovered:

- **Viewing keys are stored in plaintext server-side.** A server-backed store holds
  each wallet's viewing key as a hex string. Per-wallet authorization prevents other
  users reading it, but the operator can. See the README's known-limitation note.
- **Abuse via wallet rotation.** Application limits bound consumption per identity;
  creating many wallets is free, so they do not bound aggregate abuse. Only the
  paymaster has a global ceiling.
- Anything requiring a compromised wallet, a malicious browser extension, or physical
  access to a user's device.
- Findings against a self-hosted deployment that has set `TRUST_IAP_HEADER=1` without a
  Google IAP actually in front of it. That variable's documentation says not to.

## What is enforced

Useful context before reporting, so you can tell a bug from a design decision:

| Control | Where |
|---|---|
| Sign-In-With-Starknet: single-use, address-bound nonce; SNIP-12 domain pinned; signature verified against the account contract | `server.js` — `/api/auth/nonce`, `/api/auth/verify` |
| HMAC-signed HttpOnly session cookie; `AUTH_SECRET` required in production | `server.js` — `signToken` / `readSession` |
| Default-deny allowlist on the generic key-value router; global keys are admin-write | `server.js` — `authorizeKv` |
| Session gate + per-wallet rate limit on the prover and indexer proxies | `server.js` — `gateProxy` |
| Per-wallet and global hourly ceilings on sponsored transactions | `server.js` — `/api/paymaster` |
| 500 records per kind per wallet, 64 KiB per record | `server.js` — `MAX_RECORDS_PER_KIND`, `MAX_RECORD_BYTES` |
| Deployed contract class validated against a pinned allowlist, so a poisoned cache entry cannot redirect a deployment | `src/sdk_integration/declare-payroll.ts` |
| Enforcing Content-Security-Policy, no `unsafe-eval` | `server.js` — `CSP` |
| Dependency install scripts disabled | `.npmrc` |

## Credits

We are happy to credit reporters in the advisory unless you would rather stay
anonymous.
