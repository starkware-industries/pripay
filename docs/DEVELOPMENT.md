# Development guide

How to work in this repo without surprising yourself or someone else later.

## Setup

```bash
git clone <repo>
cd private-payroll
npm install
npm run dev
```

That gives you esbuild in watch mode + the Express server, both at once. Open `localhost:8080`.

You don't need a Cairo toolchain unless you're changing the contract — the class is already declared on Sepolia and its hash is hardcoded in `src/sdk_integration/client.ts`.

### Local database (Firestore emulator)

Storage is Firestore, accessed over the REST API by `firestore-rest.js` (no npm
dependency). Locally, run the **Firestore emulator** instead of the cloud:

```bash
npm run dev:db    # esbuild watch + server + emulator, all at once
```

The server talks to the emulator only when `FIRESTORE_EMULATOR_HOST` is set
(`dev:db`/`emulator` set it via `firebase.json`, port **8090**). Without it, the
server targets real Firestore and needs `GOOGLE_CLOUD_PROJECT` + credentials.

The emulator is a **Java** app and `firebase-tools` is intentionally *not* a
project dependency (committed `node_modules` + the private SDK make fresh
installs fragile). So:

- It runs via `npx firebase-tools …` (downloaded to the npx cache, outside the repo).
- You need a JRE (11+) on `PATH`. If you don't have one system-wide, a no-sudo
  local install works: download a Temurin JRE into `~/.local` and prepend its
  `bin` to `PATH` before running `npm run emulator`.

Integration tests (`test/api-*.test.js`) **skip** unless `FIRESTORE_EMULATOR_HOST`
is set; with the emulator running, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 npm test`
runs them. The codec/URL unit tests run with no emulator.

Data model: scalar per-wallet keys live as `kv/{key}` documents; profiles and
orders are per-wallet, per-record under `wallets/{addr}/{profiles|orders}/{id}`
so concurrent sessions on the same wallet don't clobber each other's lists.

## Layout cheatsheet

| Folder | What lives there | When to touch |
|---|---|---|
| `pripay/` | Static web root — HTML, CSS, esbuild bundle | HTML/CSS changes go here. Bundle is regenerated. |
| `src/main.ts` | App entry point | When adding a new event listener / wiring a button |
| `src/pages/` | One module per top-level page | When adding UI logic to an existing page |
| `src/core/` | State, types, utilities, navigation, wallet | When adding cross-cutting helpers |
| `src/sdk_integration/` | Privacy-pool plumbing | When changing the proof/submission pipeline |
| `contracts/` | Cairo `PayrollContract` | Rarely. Already deployed; class hash is sticky. |
| `server.js` | Express server (serves SPA + `/api`, backed by Firestore) | When changing storage shape or adding endpoints |
| `firestore-rest.js` | Zero-dep Firestore REST client (codec + doc ops) | When changing how documents are read/written |
| `docs/` | This and friends | Whenever you change something that contradicts a doc |

## Build / test / run

| What | Command |
|---|---|
| One-shot build | `npm run build` |
| Watch build | `npm run watch` |
| Server alone | `npm run server` |
| Dev (watch + server) | `npm run dev` |
| Type-check only (no emit) | `npx tsc --noEmit` (works only if `typescript` is installed in node_modules; otherwise rely on esbuild's parse step) |
| Test | `npm test` |

The bundle is **committed** so production deploys are "serve the `pripay/` folder". Every commit that touches `src/` should include the rebuilt bundle in the same commit.

## Conventions

The key conventions come up daily:

### Comments

Default to **none**. Only write a comment when the *why* is non-obvious (a hidden constraint, invariant, workaround, or surprising behavior). Don't write *what* comments — the code already says what it does. Don't write multi-paragraph docstrings.

### XSS safety

User-supplied strings (profile names, descriptions, addresses) must be inserted via `textContent` or `createElement`, **never** via `innerHTML` interpolation. The audit-log row builder and the recurrent-table row builder are good patterns. The hook in your IDE will catch new innerHTML-with-user-data writes — fix the offender, don't ignore it.

### Address normalization

Starknet addresses come in two flavors: chain-padded (`0x07b1…`) and user-entered (`0x7b1…`). Compare via `BigInt(a) === BigInt(b)`, **never** `a === b` or `a.startsWith(prefix)`. The `getTxsForAddr`, `monthlyForProfile`, `recOrdersForAddr`, and `isUserRegisteredInPool` functions all do this — copy the pattern.

### Tx hashes

Same problem, same fix. `markRecurrentTx` and `isRecurrentTx` already normalize via `normalizeTxHash` (also BigInt-based). Use them rather than string-comparing raw hashes.

### Secrets

- Never hardcode keys in source files.
- Local-only credentials go in **gitignored** data files (`data/pripay.json`, `pripay/paymaster.local.json`).
- If a tracked file ever ends up with a real key, treat that key as compromised: rotate it on-chain, then `git rm` the file, then update `.gitignore`.

### State writes

Three paths only:
- `saveCompanyInfo()` / `saveProfiles()` / `saveRecOrders()` — for the persisted fields.
- `markRecurrentTx(hash)` — for the multipay tag set.
- `setAuditTxs(next)` — for the audit log (transient).

Every persist call dual-writes localStorage + the Express server. Don't write directly to `localStorage` from a page module — go through the wrappers in `state.ts`.

### Rendering

Pages register a renderer with `registerPage(name, fn)` in `main.ts`. `nav(name)` triggers it. Render functions read from `state`, build DOM, set innerHTML / replaceChildren — they should be **idempotent** and safe to call multiple times.

When a chain action lands, dispatch `audit-updated`:
```ts
document.dispatchEvent(new CustomEvent('audit-updated'));
```
`main.ts` already listens and re-renders the audit page, the recent-transfers panel, and the open profile detail.

### Currency formatting

`fmtToken(amount, currency)` → `"5000.00 USDC"`. `nisToToken(nis, currency, rates)` → numeric crypto equivalent. Don't reinvent these.

NIS rates come from `getNISRates()` — synchronous, cached. `fetchNISRates()` runs once at startup; if it fails, defaults take over silently.

## Adding a feature

A representative recipe — say you want to add **"Profile tags"** (free-text tags on a profile, shown as chips, filterable).

1. **Types first.** Add `tags?: string[]` to `Profile` in `src/core/types.ts`.
2. **Renderer next.** In `profiles.ts` `renderProfiles()`, add a tag-chips cell. Build it via `createElement` (don't interpolate user strings into HTML).
3. **Persistence is free.** `saveProfiles()` already round-trips the whole `Profile` object — no new fields needed in `state.ts`.
4. **Edit form.** Update `src/pages/profiles.ts` `openEditProfile` and the Add Profile modal in `index.html` to read/write a tags input.
5. **Filter.** Extend the search query check in `renderProfiles` to match `p.tags?.includes(query)`.
6. **Bundle + commit.** `npm run build`. Single commit with `src/`, `pripay/index.html`, `pripay/bundle.js`, `pripay/bundle.js.map`.

A good rule of thumb: if a feature touches more than two `src/` files, sketch a one-paragraph plan in the PR description first.

## Working with the SDK layer

This is the part most likely to bite. The privacy pool's invariants:

1. **Authorization is an off-chain SNIP-12 signature.** The wallet signs the typed message `{hash:h}` (via `signMessage`); `sign-invocation.ts` injects the signature into `invocation.signature`. If the wrong wallet is connected (it isn't the contract's `owner`), the proof fails because `owner.is_valid_signature` rejects — reconnect with the deploying wallet. `execute` (deposit's approve) is still owner-only and throws `Caller is not the owner`.
2. **The block the proof targets must be old enough.** `getProvingBlockId(provider, 10)` returns head-minus-10. Going below ~6 causes the prover to return "Block not found"; going above ~20 wastes time. 10 is the sweet spot. (Still needed even without a precommit tx to wait for — it's the STORED_BLOCK_HASH_BUFFER, not a confirmation wait.)
3. **The outer tx must carry `proofFacts`.** Wallets strip it. Only the paymaster path (paste-key Account → `account.execute(call, { proofFacts, proof })`) preserves it.
4. **A multipay groups by token.** `runMultiPay` figures this out — don't manually pre-group.
5. **`is_valid_signature(h, sig)` reconstructs the SNIP-12 message hash for `{hash:h}` and delegates to `owner.is_valid_signature`.** `PayrollContract` stores no key; the wallet account verifies its own signature. The two SNIP-12 type-hash constants are precomputed and unit-tested against starknet.js.

If any of these change (e.g. the SDK ships a wallet-native pool registration), most of `src/sdk_integration/` can be simplified or removed.

## Commits and branches

- `main` is protected (merges via PR).
- Feature branches: small, named, e.g. `feature/recurrent-active-toggle`.
- Commit messages: imperative, short subject + body explaining *why* (the codebase explains *what*). Bundle changes go in the same commit as the source change that produced them.
- Don't force-push to `main`. Force-pushing to a feature branch is fine if you used `--force-with-lease`.

## Wallet behavior to remember

| Wallet | Quirk |
|---|---|
| Ready | Sometimes greys out the Declare button with no error. Use the "Declare with private key" escape hatch. Reports a different class hash than starknet.js computes; the app trusts the chain. |
| Braavos | Works. Its `is_valid_signature` now *does* matter — `PayrollContract` delegates the SNIP-12 check to the wallet account — but as long as the wallet is SNIP-6-compliant the delegation works. Pass the wallet's `signMessage` result through verbatim (`stark.formatSignature`); don't hand-build `[r,s]`, since some wallets append extra felts. |
| ForDefi | Multi-sig flow; each signature step (including the SNIP-12 authorization) requires manual approval in their UI. Starknet support is SNIP-12 typed-message only — no raw/personal-message signing. |
| MetaMask Snap | Not supported for the privacy pool yet — the dashboard will warn. |

## Logging policy

Console logs are sparse on purpose. The ones that *do* exist record successful submissions (so you can grep tx hashes from devtools) and unrecoverable warnings (paymaster down, prover failure). Don't add `console.log` for normal flow — read the code if you need to trace.

## When in doubt

See `docs/ARCHITECTURE.md` for the system layout and code organization.
