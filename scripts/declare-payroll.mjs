#!/usr/bin/env node
// Declares the PayrollContract sierra class on whichever Starknet RPC is
// configured. One-shot setup; the resulting class hash is what
// src/sdk_integration/client.ts hardcodes as PAYROLL_CLASS_HASH.
//
// Run with:
//   STARKNET_RPC_URL=... \
//   STARKNET_ACCOUNT_ADDRESS=0x... \
//   STARKNET_PRIVATE_KEY=0x... \
//     node scripts/declare-payroll.mjs
//
// The key is read from env (never written to disk). Use any account that
// holds STRK on the target network — doesn't have to be the same wallet
// that runs the app.
import { Account, RpcProvider, hash } from '../node_modules/starknet/dist/index.mjs';
import { readFileSync } from 'node:fs';

const NODE_URL = process.env.STARKNET_RPC_URL ?? 'https://starknet-sepolia-rpc.publicnode.com';
const ACCOUNT = process.env.STARKNET_ACCOUNT_ADDRESS;
const PRIVATE_KEY = process.env.STARKNET_PRIVATE_KEY;

if (!ACCOUNT || !PRIVATE_KEY) {
  console.error('Set STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY env vars.');
  process.exit(1);
}

const sierraPath = new URL('../contracts/target/dev/contracts_PayrollContract.contract_class.json', import.meta.url);
const casmPath = new URL('../contracts/target/dev/contracts_PayrollContract.compiled_contract_class.json', import.meta.url);
const sierra = JSON.parse(readFileSync(sierraPath, 'utf8'));
const casm = JSON.parse(readFileSync(casmPath, 'utf8'));

const provider = new RpcProvider({ nodeUrl: NODE_URL });
const account = new Account({ provider, address: ACCOUNT, signer: PRIVATE_KEY });

const computedClassHash = hash.computeContractClassHash(sierra);
const compiledClassHash = hash.computeCompiledClassHash(casm);
console.log('RPC               :', NODE_URL);
console.log('account           :', ACCOUNT);
console.log('sierra class hash :', computedClassHash);
console.log('compiled hash     :', compiledClassHash);

// Skip declare if the class is already on chain.
try {
  await provider.getClass(computedClassHash);
  console.log('class already declared, nothing to do');
  process.exit(0);
} catch {}

console.log('submitting declare tx...');
const { transaction_hash, class_hash } = await account.declare({
  contract: sierra,
  compiledClassHash,
});
console.log('tx                :', transaction_hash);
console.log('declared class    :', class_hash);
await provider.waitForTransaction(transaction_hash);
console.log('declare landed');
console.log();
console.log('paste this into src/sdk_integration/client.ts PAYROLL_CLASS_HASH:');
console.log('  ' + class_hash);
