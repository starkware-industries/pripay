# User manual

This is what to do once you have PriPay running locally. Audience: someone showing the app to a finance person who's never seen it before, or the finance person themselves.

> **Network:** PriPay runs on whichever chain is set in `src/sdk_integration/network-config.ts` (`NETWORK = 'sepolia' | 'mainnet'`). It is **currently on Starknet mainnet** — actions move real funds, and the privacy pool charges a **4 STRK fee per on-chain operation** (onboard / deposit / transfer / batch). Have a mainnet-funded wallet + paymaster ready. To run on testnet instead, flip `NETWORK` to `'sepolia'` and rebuild.

## 1. Setting up

```bash
npm run dev
```

(`node_modules` is vendored in-repo — don't run `npm install`; the private Starknet SDK makes fresh installs fragile.)

Open `http://localhost:8080` in a browser that has Ready, Braavos, Xverse, or Fordefi installed and unlocked.

## 2. Connect a wallet

Click **Connect wallet** in the top-right. Pick your wallet, approve the connection request, and let the dashboard fill in.

What you should see:

- Your wallet address (truncated) in the "Treasury wallet" row.
- "Connected · ready to onboard" with a green dot on the On-chain status card.

## 3. (One-time) Onboard to the privacy pool

Onboarding tells the privacy pool "this treasury wallet is going to send and receive private transfers; here's a viewing key it'll use to decrypt notes". It runs once per wallet, takes ~1 minute, and costs a small amount of STRK.

Click **Onboard** on the dashboard card. The status sub-text walks you through the phases:

| Phase | What's happening | Wallet prompts? |
|---|---|---|
| Initializing privacy client | Loading viewing key + building SDK client | No |
| Declaring PayrollContract class | Publishing contract code (once per network) | **Yes** — Declare |
| Deploying PayrollContract | UDC deploy of your personal contract | **Yes** — Deploy |
| Building proof envelope | Constructing the SetViewingKey invocation | No |
| Awaiting wallet signature | SNIP-12 message — authorizes the proof's tx hash (off-chain, no gas) | **Yes** — Sign |
| Generating SetViewingKey proof | Prover computes the zero-knowledge proof | No |
| Submitting | Paymaster sends the outer transaction | No |
| Onboarded | Done — viewing key is registered | No |

If you see **"Logged via LocalSubmitter (no paymaster yet)"** at the Submitting step, the final submission was a stub and the tx never hit the chain. Configure a paymaster (Step 4) and re-onboard, or use a paymaster.local.json file (see Step 4) to auto-configure.

### Declare with private key (escape hatch)

If your wallet refuses to declare the class (Ready's Confirm button greys out for unclear reasons), click **Declare with private key** on the dashboard, paste your wallet's private key, and the app declares directly via starknet.js. The key isn't persisted.

## 4. Configure a paymaster

The outer transaction that carries the proof can't be submitted by your wallet directly — wallets strip the `proofFacts` field. Something else has to sign and submit that envelope.

> **Default: AVNU paymaster (gasless).** On a network where AVNU's privacy forwarder is configured (mainnet is), PriPay activates the **AVNU paymaster** automatically at startup — no key to paste, no separate account to fund, and the pool fee is withdrawn from your shielded balance via SponsoredPrivate. You'll see **"AVNU paymaster (gasless)"** in green on the Settings/paymaster status. If that's showing, skip the rest of this section.
>
> The paste-key options below are a **fallback** for environments where AVNU isn't available. They put a private key in the browser, so prefer AVNU wherever it's offered.

> **Fallback fee allowance.** When using the paste-key fallback on mainnet, the pool pulls its 4 STRK per-operation fee from the paymaster account via `transferFrom`. The submitter auto-approves the pool for a bounded batch (50 ops) the first time it's needed — so the paymaster must hold enough STRK to cover both gas *and* the fees. Keep a small working balance, not a treasury.

### Option A: paste-key per session (fallback)

Click **Set paymaster key** on the dashboard. Paste:

- **Account address** — 0x-prefixed, of a regular Ready/Braavos account **deployed on the active network** (a counterfactual/undeployed account will fail with "Contract not found"). A Fordefi vault can't be used here — it won't export a private key.
- **Private key** — 0x-prefixed.

The key lives only in the in-memory `Account` closure. Refreshing the page clears it.

### Option B: local file (fallback, local dev)

Create `pripay/paymaster.local.json`:

```json
{
  "address":   "0x...",
  "secretKey": "0x..."
}
```

This file is in `.gitignore`. On every page load, `loadLocalPaymaster()` will read it and auto-configure the submitter so you don't have to re-paste. Same warning — the file is on disk, so treat that machine accordingly.

You'll know the paymaster is configured when the dashboard shows the **paymaster** badge in green next to "Set paymaster key".

## 5. Deposit funds into the privacy pool

You can't send private transfers without a balance in the pool.

1. Click **Deposit** on the dashboard.
2. Pick a token: USDC / STRK / ETH (their addresses are in `src/core/validators.ts`).
3. Enter an amount. The number is in the token's natural units (e.g. `50` for 50 STRK).
4. Click **Confirm deposit**.
5. Your wallet prompts twice — first the funding multicall (`token.transfer` + `payroll.execute([approve(pool, MAX)])`), then a SNIP-12 signature request authorizing the deposit proof.
6. Wait through the same proof/submit phases as onboarding.

The Treasury balance card refreshes immediately after the funding multicall lands; the Private-pool balance card updates once the deposit proof is accepted (and the indexer ingests it, which takes ~10 seconds).


## 6. Build an address book (profiles)

Go to **Profiles** in the sidebar.

### Add one at a time

1. Click **Add profile**.
2. Fill in Name, address, type (Employee/Contractor/Vendor/Advisor), email, notes.
3. The form preflights with the privacy pool: if the recipient isn't onboarded yet, you get a "Save anyway?" warning. You can still save the entry; private transfers will just fail until the recipient onboards themselves.

### Import from CSV

1. Click **Import CSV**.
2. The expected columns are `name,address,email,type,notes`. Header row is required, columns can be in any order.
3. Drag the file in or click to browse.
4. Review the preview, click **Done**.

## 7. One-time private transfer

Sidebar → **One-time**.

1. Click **Pick name** (or paste a recipient address directly).
2. Enter an amount. You can type in shekels (₪) or in the crypto's own units — the toggle below the input flips between the two and the conversion uses live NIS rates.
3. Pick a currency pill (USDC / STRK / ETH).
4. Optionally add a description (shows up in the audit log).
5. Click **Send transfer**. Confirm the wallet prompts.

What success looks like: the status banner goes green, the Recent transfers card adds a row within a few seconds.

What failures look like:
- **"Recipient not onboarded yet"** — the address has no viewing key registered. Ask them to run PriPay's onboard flow.
- **"Paymaster account has insufficient STRK"** — top up the paymaster's STRK balance (paste-key fallback only).
- **"Connect wallet first"** / **"Configure paymaster"** — self-explanatory.

## 8. Recurring payroll

Sidebar → **Recurrent**.

### Add an order

Click **Add order**. Pick a recipient (or type one), set the NIS amount, currency, periodicity (Monthly/Weekly/Bi-weekly), and optional metadata (description, purpose, invoice ref, institution, country).

### Toggle active/inactive

The pause button at the end of each row marks the order inactive — it dims, is excluded from Execute runs, and disappears from the recipient's profile "Active future recurrent" rows. Click again to revive.

### Filter

The card header has **All / Active only** pills. Active-only is the default mental model for a payroll run.

### Import recurring orders from CSV

Click **Import CSV** on the recurrent page. Columns: `token,address,amount,note`. After import, **any address not already in your address book gets a new profile auto-created** with a placeholder name, then a modal pops up asking you to fill in real names + emails on each.

### Execute

Tick the orders you want to run (or none for "all") → click **Execute** (the button label becomes `Execute (N)` or `Execute all`). One proof + one outer transaction covers every selected row. Wallet prompts for one SNIP-12 signature for the whole batch. (Mixed shielded + unshielded batches prompt a second time for the direct ERC20 transfers.)

After confirmation, the orders' "Next run" date advances automatically (Monthly = +30d, Bi-weekly = +14d, Weekly = +7d).

### Export

**Export CSV** dumps the current set (selected or all) for archiving.

## 9. Transaction History + invoices

Sidebar → **Transaction History** (internally still the `audit` page).

Everything that hit the chain shows up here, classified into:
- **Onboard** — SetViewingKey registrations.
- **Deposit** — pool funding actions.
- **Sent** — one-time transfers from your treasury.
- **Recurrent** — multipay batches from your treasury (tagged client-side).

### Filter

Search box matches against name/address/tx hash/description. Type pills filter by class.

### Expand a row

Opens a modal with date, type, address, full tx hash, amount, description.

### Generate an invoice

Per-row **Invoice** button → opens a print-ready invoice in a new tab. Includes your company info (set in the dashboard), the recipient (resolved from your address book if known), and the line items.

Bulk: tick rows → the top-right **Invoice (N)** button generates a single invoice for the selection. Tick all to use the **Invoice all** label.

Profiles also expose the same Invoice button per row in their own transaction history — useful when a specific employee asks for proof of payment.

## 10. Company info

The card at the top of the Dashboard. Click the pencil icon to edit:
- Name + tagline + email + legal name + network.

The company fields show up on the generated invoices, so they're worth keeping accurate. The network label is informational — the actual chain comes from `network-config.ts`.

## Funding the accounts

On **mainnet** there are no faucets — you need real STRK. (On Sepolia, STRK comes from <https://sepolia-faucet.starknet.io/>.) Token addresses are in `src/sdk_integration/network-config.ts` (USDC differs per network; STRK/ETH are the same on both).

You'll need:
- **Treasury wallet**: STRK for class declare (one-time), UDC deploy (one-time), and the deposit funding multicall (`transfer` + `approve`) when you shield. Per-action authorization is now an off-chain SNIP-12 signature, so it costs no gas. Modest.
- **Paymaster account**: a separate **deployed** account whose key you control (Ready/Braavos — *not* a Fordefi vault). On mainnet it pays both the outer-tx gas **and** the privacy pool's **4 STRK per-operation fee** (pulled via the allowance the submitter auto-approves). Budget ~4 STRK × (operations) + gas; keep a small working balance, top up as needed.

> **Note on the PayrollContract class hash:** it's network-independent, so once the class is declared on a network (the onboarding flow does this lazily, or run `scripts/declare-payroll.mjs`), any treasury wallet reuses it by hash.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Ready shows different class hash than the app | ABI re-serialization on the wallet side | The app picks up the chain-returned hash automatically; re-onboard once and it caches |
| `Block not found` warning during proof gen | Prover lagging behind the chain head | Wait 30s, click Execute again |
| `Resource bounds exceed balance` / `Paymaster has insufficient STRK` | Paymaster account out of STRK | Top up the paymaster (remember mainnet's 4 STRK/op fee) |
| `Insufficient ERC20 allowance` / `argent/multicall-failed` on submit | Paymaster hasn't approved the pool for the mainnet fee | The submitter auto-approves on submit; if it persists, the paymaster is likely out of STRK to pay for the approve |
| `Contract not found` for the paymaster address | Paymaster account isn't deployed on the active network | Use an account that's already transacted on that network (deployed); fund + deploy it first |
| `Caller is not the owner` on a deposit's `execute` / proof rejected with no `'VALID'` | Wrong wallet connected (the contract was deployed by — and signature delegates to — a different one) | Disconnect, reconnect with the deploying wallet |
| Transaction History empty after a fresh deposit | Indexer hasn't ingested yet | Wait 10–15 seconds; the page auto-refreshes every 12s |
| Transfer "succeeded" but nothing shows / balance unchanged | Self-transfer (sender == recipient) is balance-neutral and isn't listed | Expected; transfer to a *different* onboarded recipient to see movement |
| Deposit interrupted (page reloaded mid-flow) | The async flow lives in the page; reloading kills it | Funds sit safely in the PayrollContract; re-run the deposit (note: it re-funds, so the earlier amount stays parked until reused) |
