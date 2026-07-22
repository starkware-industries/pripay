# Architecture

PriPay is a single-page TypeScript app that drives the Starknet privacy pool from a treasury wallet's perspective. This doc walks the major pieces in order: page → state → SDK plumbing → on-chain.

## Picture in one paragraph

The browser holds the operator's wallet account (Ready/Braavos/Xverse/Fordefi) and a per-wallet `viewingKey` cached in browser-side storage. The user goes through a one-time onboarding that declares + deploys a `PayrollContract`, then registers its viewing key on the privacy pool. After that, every payment runs through the same four-phase pipeline: **build proof envelope → wallet SNIP-12-signs the invocation hash → generate proof → paymaster submits the V3 invoke with `proofFacts`**. The signature rides inside the proof invocation; `PayrollContract.is_valid_signature` verifies it (delegating to the wallet account) when the pool simulates the call. Outputs are observed via the privacy-pool indexer's history API, classified into the audit log, and rendered on each page.

## Frontend layout

`src/main.ts` is the entry. It registers page renderers with `nav.ts`, hydrates state from the Express server, wires every event listener on the document, then performs the initial render.

```
src/pages/
├── dashboard.ts     Company card, on-chain status, balances, deposit modal
├── profiles.ts      Address book CRUD, per-profile tx history & invoice
├── recurrent.ts     Standing orders, batch execute, active/inactive toggle
├── onetime.ts       Single private transfer
├── audit.ts         Indexer-derived audit log, filter, expand modal, invoices
└── import.ts        Recurrent-page CSV import (token,address,amount,note)
```

Each page exposes `render*()` plus action functions. There is no framework — the renderers build DOM via `innerHTML` for static content and `createElement` / `textContent` for any user-supplied strings (names, descriptions, addresses). The split is deliberate; it avoids XSS where the value could be poisoned by a CSV row or a free-text field.

## State

A single `state` object in `src/core/state.ts` is the source of truth for everything UI-side:

```
companyInfo, profiles, recOrders, recurrentTxHashes  ← persisted (server + localStorage)
walletConnected, selectedProfileId, editing*, otMode ← UI-only
operatorAccount, payrollAddress, viewingKey, transfers ← privacy-pool wiring (in-memory)
provider, storage, submitter                         ← singletons
onboardingStatus                                     ← orchestrator phase
```

The persisted parts are written through `persist(key, value)`, which dual-writes to `localStorage` + `PUT /api/:key` on the server. `hydrateFromDB()` runs at startup and overlays server state on top of localStorage. The server is the authority on reload from another machine; localStorage gives instant first paint.

The audit log is the exception: it's not persisted client-side. `auditTxs` is rebuilt from the indexer on every `refreshAuditLog()` call (dashboard.ts) — initial load, after each chain action, and on a 12-second timer to absorb indexer lag.

## SDK integration layer

Everything privacy-pool-related lives in `src/sdk_integration/`. The single most important module is **`run-transfer.ts`** — the others are variations on the same pipeline. Read it once and the rest follow.

The pipeline:

```
buildInvocation ──► computeInvocationHash(h)
       │                     │
       │                     ▼
       │            wallet signMessage(SNIP-12 {hash:h})   ◄── wallet popup
       │                     │
       │                     ▼
       │            inject sig → invocation.signature
       │                     │
       │                     ▼
       │              getProvingBlockId
       │                     │
       ▼                     ▼
       └──── proof.generate ────► call+proof
                                      │
                                      ▼
                                 submitter.submit
```

Each step is its own file:

| File | Purpose |
|---|---|
| `init.ts` | Top-level orchestrator: declare → deploy → onboard |
| `viewing-key.ts` | Load or randomly generate a 200-bit viewing key, keyed by wallet address |
| `client.ts` | SDK client factory + the pool/prover/indexer addresses |
| `declare-payroll.ts` | Declare `PayrollContract` class if not already on-chain (caches actual on-chain hash, which differs from the locally-computed one due to wallet ABI re-serialization) |
| `deploy-payroll.ts` | UDC deploy of a per-wallet `PayrollContract` instance, with post-deploy `owner()` check |
| `onboard.ts` | The sign-and-prove flow for SetViewingKey |
| `run-transfer.ts` | Same flow for a single private transfer |
| `run-multipay.ts` | Same flow for N recipients (recurrent batch) |
| `run-deposit.ts` | Funding multicall + same flow to register the deposit note |
| `sign-invocation.ts` | Build the SNIP-12 typed message `{hash:h}`, ask the wallet to sign it, inject the signature into the invocation |
| `tx-hash.ts` | Compute the V3 invoke tx hash `h` the wallet signs |
| `submit.ts` | `getProvingBlockId` — block selection with confirmations |
| `submitter.ts` | `TxSubmitter` interface + `LocalSubmitter` (dev) + `AvnuPaymasterSubmitter` (production, gasless) + `PrivateKeyPaymasterSubmitter` (paste-key fallback) |
| `payroll-account.ts` | SDK-compatible Account wrapper around the `PayrollContract` (NoOpSigner at build time; the real signature is injected post-build, then verified by `is_valid_signature`) |
| `wallet-account.ts` | Wraps a Ready/Braavos/Xverse/Fordefi `StarknetWindowObject` into a `WalletAccount` |
| `storage.ts` / `server-storage.ts` | Persistence interface + HTTP-backed implementation |
| `audit-history.ts` (in `core/`) | Indexer history fetch + classifier → `AuditTx[]` |
| `registration-probe.ts` | "Is this address registered in the pool?" preflight |
| `channel.ts`, `ensure-channel.ts`, `balances.ts`, `approve-pool.ts` | Helpers used by deposit / transfer |

### Why so much code for "send a private transfer"?

Because the privacy pool requires that:

1. The sender is registered (a viewing key is published for an on-chain identity that knows how to verify proofs).
2. The outer V3 invoke carries `proofFacts` — a field RPC ≥ 0.10.1 supports but most wallets currently strip.
3. The proof must be computed against a block recent enough that the prover has its data, but old enough that the chain accepts the tx (typically: head minus 10 blocks).

Wallets can't satisfy all three: their connect-and-sign API doesn't pass `proofFacts` through, and the pool calls `is_valid_signature(hash, sig)` on the sender account — which a stock wallet account would interpret as a raw tx-hash signature, not the SNIP-12 typed message a wallet will actually produce. So we shim with a contract (`PayrollContract`) that bridges the two — it reconstructs the SNIP-12 message hash from the pool's `hash` argument and delegates the ECDSA check back to the wallet account — plus a separate signing account (the paymaster) for the outer `proofFacts` submit. Once wallets support pool registration directly, most of `src/sdk_integration/` can be simplified to thin wrappers around the SDK's `.transfer()` and `.deposit()` calls.

## The Cairo contract

`contracts/src/contract.cairo` is the smallest possible thing that lets the pool accept proofs that came from a wallet:

```cairo
fn is_valid_signature(self, hash, sig) -> felt252 // reconstructs the SNIP-12
    // message hash for {hash}, bound to owner + get_tx_info().chain_id, then
    // delegates to owner.is_valid_signature(snip12_hash, sig). 'VALID' iff that passes.
fn execute(ref self, calls: Array<Call>)    // owner-only multicall (for approvals)
fn owner(self) -> ContractAddress           // post-deploy verification + signature delegate
```

Plain `owner` storage instead of OZ's `OwnableComponent` — the OZ-version failed `assert_only_owner` under Cairo 2.16. The two SNIP-12 type-hash constants are precomputed off-chain and asserted against starknet.js in `contracts/`'s tests. Class hashes are hard-coded in `network-config.ts`.

## Server

`server.js` is ~50 lines:

- `GET /api` returns the entire JSON store (used on hydrate).
- `GET /api/:key` returns one key.
- `PUT /api/:key` writes one key. Atomic via `.tmp` + rename.
- Everything else falls through to `express.static(pripay/)`.

Storage shape is flat (`pripay:companyInfo`, `pripay:profiles`, `pripay:vk:<wallet>`, `pripay:onboarded:<wallet>`, `pripay:payroll:<wallet>`, …). Viewing keys are namespaced by wallet so the file works across multiple onboardings on the same machine.

## Build & runtime

- esbuild bundles `src/main.ts` → `pripay/bundle.js`. ESM, sourcemap-on. Bundle is **committed** so the static deploy step is just "serve the pripay/ folder".
- `npm run dev` runs the watch-build and the server in parallel via `concurrently`.
- The Express server doubles as the static file host. There's no separate build step for the HTML/CSS.

## What the indexer gives us

`fetchAuditHistory()` (in `core/audit-history.ts`):

1. Calls `discoverNotes()` + `discoverChannels()` on the SDK's indexer client to seed cursors. Without this, the cursor's `subchannels` array is empty and the only events that come back are `register` events — no deposits, no transfers.
2. Pages through `fetchHistory()` until `historyComplete`. Typical volume fits in one page; the loop is cheap.
3. Resolves block timestamps in parallel against the Starknet provider.
4. Runs `classifyTransaction()` on each indexer entry and emits one `AuditTx` per relevant action: `register` → `Onboard`, `deposit` → `Deposit`, `transferSent` → `OneTime`.

There's no on-chain marker that distinguishes a multipay from a single private transfer — they look identical to the indexer. PriPay stores the tx hashes of its own multipay calls in `state.recurrentTxHashes` (persisted) and `dashboard.ts:refreshAuditLog` rewrites `OneTime → Recurrent` for any hash in the set.

## Submitter abstraction

`TxSubmitter` has two production-relevant implementations and one dev stub:

| Class | Behavior |
|---|---|
| `LocalSubmitter` | Logs payload, returns a deterministic fake tx hash. UI works end-to-end without ever hitting the chain. Used when no paymaster is configured. |
| `AvnuPaymasterSubmitter` | **Production default.** AVNU paymaster (SponsoredPrivate, gasless) — no client-side key; the pool fee is withdrawn from the shielded balance via a fee-action baked into the proof. Auto-activated at startup when the network has a configured forwarder and the service is reachable. |
| `PrivateKeyPaymasterSubmitter` | Paste-key fallback: a separate Account whose private key signs and submits the V3 invoke with `proofFacts`. Includes a pre-flight balance check so the chain doesn't reject for resource bounds. |

When AVNU isn't available, the address + key for `PrivateKeyPaymasterSubmitter` come either from the dashboard's "Set paymaster key" modal (paste once per reload) or from `pripay/paymaster.local.json` (gitignored; local-dev convenience).

## Browser-side surfaces

- **`document` event `audit-updated`** — fired by `refreshAuditLog()` and by `toggleOrderActive()`. Routed in `main.ts` to re-render the audit page, the one-time "recent" panel, and the open profile detail (if any).
- **`localStorage`** mirror of every persisted key — fast first paint, then `hydrateFromDB()` overlays server state.
- **No web workers, no service worker.** The proving step is a network call to the prover service.

## Where data flows on a single multipay

1. User clicks Execute on `recurrent.ts`. Selected rows → `buildPaymentsFromOrders` → `Payment[]`.
2. `runMultiPay(operatorAccount, payrollAddress, transfers, submitter, payments)` builds the SDK proof invocation.
3. `computeInvocationHash` produces the V3 hash `h`.
4. `signAndInjectAuth` asks the operator's wallet to SNIP-12-sign `{hash:h}` (Ready/Braavos/Xverse/Fordefi popup) and writes the signature onto `invocation.signature`. No on-chain tx.
5. `getProvingBlockId` resolves the block the proof targets (still head−10 for STORED_BLOCK_HASH_BUFFER).
6. `transfers.executeWithInvocation(...)` produces a proof against that block; the prover verifies the signature via `PayrollContract.is_valid_signature`.
7. `submitter.submit(callAndProof)` sends the outer V3 invoke. Returns the submitted tx hash.
8. `markRecurrentTx(hash)` records it client-side so the next audit refresh re-labels.
9. `refreshTreasuryBalance()` + `refreshAuditLog()` redraw the dashboard.

The deposit path is the same shape with one extra step at the start — the operator's wallet first does a multicall that transfers tokens into the contract and approves the pool to pull from it.

## Things that look unusual at first glance

- **No bundler config file.** Esbuild gets its full config from the `npm` script.
- **`pripay/bundle.js` is checked in.** Reduces deploy to "serve the static folder". Don't hand-edit it; it's regenerated on every `npm run build`.
- **`data/pripay.json` is gitignored** but the directory exists. The server creates the file on first write.
- **Modals are part of `index.html`**, hidden by default. `openM(id)` / `closeM(id)` toggle visibility — no React-style mount/unmount.
- **`Profile.token` and `Profile.nis`** are legacy. New code ignores `token`. `nis` is no longer surfaced in the UI (the value comes from `monthlyForProfile` summing recurrent orders) but is left optional so older persisted profiles still load.
