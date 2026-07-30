# PriPay

> **⚠️ Unaudited software.** The code may contain bugs or security vulnerabilities and has not been formally audited. The authors accept **no liability** for any loss, damage, or misuse arising from use of this software. Use at your own risk.

Private payroll dApp on Starknet's privacy pool. Organizations can conduct recurring or one-time cryptocurrency salary payments that remain invisible to block explorers, while maintaining a comprehensive on-chain audit log.

## Quick Start

```bash
npm run dev       # Watch build + serve at http://localhost:8080
```

Visit `http://localhost:8080` and connect a Starknet wallet (Ready, Braavos, Xverse, or Fordefi).

### Installing dependencies

`node_modules` is committed, because `@starkware-libs/starknet-privacy-sdk` is published to
GitHub Packages rather than the public npm registry. To install from scratch you need a
GitHub token with `read:packages` exported as `GITHUB_TOKEN` (see [`.npmrc`](.npmrc));
without one, `npm install` cannot resolve the privacy SDK at all.

Two known rough edges in the committed tree:

- It carries only the **linux-x64** esbuild binary, so `npm run build` fails on Apple
  Silicon and other platforms. Install esbuild for your platform, or run a fresh
  `npm install` with a token.
- `@upstash/redis` is declared but absent, so the KV store path is unavailable locally.
  That is fine for local dev, which uses the JSON file store.

Dependency install scripts are disabled repo-wide (`ignore-scripts=true` in `.npmrc`) —
an install script runs with full privileges before any of our code is reviewed. Nothing
in the tree needs one.

## Configuration

All server configuration is via environment variables. None are required for local
development, where the defaults target Starknet Sepolia and a local JSON store.

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | **Required in production.** HMAC key for SIWS nonces + session cookies. Must be stable across instances — the server refuses to boot on Vercel without it, since a per-boot random value would only validate on the instance that issued it. |
| `ADMIN_WALLETS` | Comma-separated Starknet addresses granted admin (the Settings page, company listing, writes to global keys). Fails closed: unset means nobody is admin. Malformed entries are warned about at boot. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis / Vercel KV. Enables the durable store **and** fleet-wide rate limiting. Without it, rate limits are per-process — fine for one local server, ineffective on serverless. |
| `GOOGLE_CLOUD_PROJECT` | Selects the Firestore-over-REST store. Ignored when KV is configured. |
| `LOCAL_STORE` / `LOCAL_STORE_FILE` | Force the JSON file store, and where it lives. |
| `AVNU_PAYMASTER_API_KEY` | Enables the gasless paymaster proxy. Absent → `/api/paymaster` returns 503 naming this variable. |
| `AVNU_PAYMASTER_URL` | Paymaster endpoint. Must match the active network in `network-config.ts`. |
| `PAYMASTER_EXEC_PER_HOUR_WALLET` | Sponsored transactions per wallet per hour (default 60). |
| `PAYMASTER_EXEC_PER_HOUR_GLOBAL` | Sponsored transactions across all wallets per hour (default 500). This is the ceiling that bounds credit burn — a per-wallet limit alone does not, since wallets are free to create. |
| `PROVER_UPSTREAM` / `DISCOVERY_UPSTREAM` | Upstreams for the same-origin `/api/prover` and `/api/discovery` proxies. Both require a wallet session and are rate limited. |
| `STARKNET_RPC_URL` / `STARKNET_CHAIN_ID` | RPC used for server-side signature verification, and the SNIP-12 chain id accepted at login. |
| `CSP_CONNECT_EXTRA` | Space-separated extra `connect-src` origins, for adding a data source without editing the policy. |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist. Empty (default) disables cross-origin access. |
| `TRUST_IAP_HEADER` | Set to `1` **only** behind a real Google IAP. It makes the server trust `x-goog-authenticated-user-email`, which is caller-supplied anywhere else. Prefer `accountantWallets` on the company record, which is verified against the wallet session. |

## Key Features

- **Private transfers:** Salary payments hidden from public ledgers via privacy pool
- **Recurring payroll:** Set up standing payment orders with configurable frequency (weekly, bi-weekly, monthly)
- **Batch operations:** Single signature authorizes multipay transactions across recipients
- **Multi-token support:** USDC, STRK, ETH (both bridged and native variants)
- **Deposit & withdraw:** Shield funds into the privacy pool and retrieve them
- **Address book:** Manage recipient profiles with transaction history per profile
- **CSV import/export:** Bulk upload recurring orders; archive transaction records
- **Transaction audit log:** Full history of on-chain movements with filtering and export
- **Invoice generation:** Print or export proof of payment per transaction or recipient

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend** | TypeScript, esbuild bundler, vanilla DOM (no framework) |
| **Backend** | Node.js + Express, REST API + static file host |
| **Persistence** | Firestore (production) or local JSON file (development) |
| **Privacy layer** | `@starkware-libs/starknet-privacy-sdk` (proof generation, indexing, event classification) |
| **Wallet support** | Ready, Braavos, Xverse, Fordefi (via Starknet Window API) |
| **Submission** | AVNU paymaster (gasless, SponsoredPrivate) + fallback paste-key account |
| **Chain** | Starknet (mainnet or testnet, configurable) |

## Development

| Command | Effect |
|---------|--------|
| `npm run dev` | Watch build + run server |
| `npm run build` | One-shot esbuild bundle |
| `npm run watch` | Rebuild on file changes |
| `npm run server` | Start Express server only |
| `npm test` | Run test suite |
| `npm run dev:db` | Watch + server + Firestore emulator |

To run against a Firestore emulator, use `npm run dev:db` (requires JRE 11+).

## Architecture

**Frontend** (`src/pages/`) builds a reactive SPA that:
1. Connects a Starknet wallet (treasury account)
2. One-time onboarding: declares + deploys a personal `PayrollContract`, registers a viewing key with the privacy pool
3. For each payment: builds a proof envelope → wallet signs (SNIP-12) → generates proof → paymaster submits

**State** (`src/core/state.ts`) is single source of truth, persisted to server + browser localStorage.

**Privacy plumbing** (`src/sdk_integration/`) wraps the privacy SDK's proof pipeline. Most of this can be removed once wallets support pool registration natively.

**Server** (`server.js`) serves static files, manages a tiny JSON store (or Firestore) for profiles, recurring orders, and viewing keys.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for detailed system design, [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for contribution guidelines, and [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) for end-user documentation.

## Secrets & Storage

- **Viewing keys** & **onboarding state** are stored locally (`data/pripay.json`, gitignored)
- **Paymaster keys** for signing submissions are pasted per-session or loaded from `pripay/paymaster.local.json` (gitignored)
- **Never commit private keys or credentials** to source control

> **Known limitation — viewing keys are stored in plaintext server-side.** When a
> server-backed store is configured, `ServerStorage` persists each wallet's viewing key
> as a hex string. Per-wallet authorization stops other users reading it, but whoever
> operates the server (or reads the database) can decrypt that wallet's entire private
> transaction history. If you deploy this, treat the store as sensitive. Moving to
> client-side encryption is tracked as known work, not yet done.

## Security model

A brief map of what is enforced where, since the API is public:

- **Authentication** is Sign-In-With-Starknet. The client signs a server-issued,
  single-use, address-bound nonce; the server verifies it against the account contract
  and issues an HMAC-signed HttpOnly session cookie. There is no password anywhere.
- **Authorization** is per wallet. Wallet-scoped keys and record collections require a
  session whose address matches the target. The generic `/api/:key` router is
  default-deny against an explicit allowlist — an unlisted key is refused rather than
  created, and global keys are admin-write.
- **Expensive endpoints** (`/api/prover`, `/api/discovery`, `/api/paymaster`) all
  require a session and are rate limited, fleet-wide when KV is configured.
- **Ceilings** bound what one identity can consume: 500 records per kind per wallet,
  64 KiB per record, and hourly caps on sponsored transactions.
- **Not covered:** these controls bound abuse per identity. Nothing here stops an
  attacker creating many wallets — wallets are free, especially on testnet. Rotation
  needs a platform-level control (WAF / global quota), and only the paymaster has a
  global ceiling today.

See [`SECURITY.md`](SECURITY.md) for how to report a vulnerability.

## License

Licensed under the Apache License, Version 2.0. See `LICENSE` for details.

## Disclaimer

This is research-stage software. The privacy pool design and implementation have not been formally audited. Do not use with production secrets or high-value assets without explicit security review.
