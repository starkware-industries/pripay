# PriPay

> **⚠️ Unaudited software.** The code may contain bugs or security vulnerabilities and has not been formally audited. The authors accept **no liability** for any loss, damage, or misuse arising from use of this software. Use at your own risk.

Private payroll dApp on Starknet's privacy pool. Organizations can conduct recurring or one-time cryptocurrency salary payments that remain invisible to block explorers, while maintaining a comprehensive on-chain audit log.

## Quick Start

```bash
npm run dev       # Watch build + serve at http://localhost:8080
```

Visit `http://localhost:8080` and connect a Starknet wallet (Ready, Braavos, Xverse, or Fordefi).

**Note:** `node_modules` is committed. Do not run `npm install` — the private Starknet SDK makes fresh installs fragile.

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

## License

Licensed under the Apache License, Version 2.0. See `LICENSE` for details.

## Disclaimer

This is research-stage software. The privacy pool design and implementation have not been formally audited. Do not use with production secrets or high-value assets without explicit security review.
