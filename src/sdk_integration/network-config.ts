import { constants } from 'starknet';

// Single source of truth for which chain PriPay talks to. Flip this one line to
// switch networks; the runtime sanity check at the bottom refuses to load if any
// active-network field is still a __FILL_ME__ placeholder. NOTE: the prover and
// discovery upstreams are intentionally NOT in this client config — they live
// server-side only (server.js PROVER_UPSTREAM / DISCOVERY_UPSTREAM), so their URLs
// never ship in bundle.js; the browser only ever calls the same-origin /api/* proxies.
const NETWORK: 'sepolia' | 'mainnet' = 'sepolia';

type NetworkConfig = {
  label:                     string;
  walletChainId:             string;
  snip12ChainId:             'SN_SEPOLIA' | 'SN_MAIN';
  sdkChainId:                constants.StarknetChainId;
  rpcUrl:                    string;
  poolAddress:               string;
  // prover/discovery are server-side only (see server.js) — deliberately not here.
  payrollClassHash:          string;
  payrollCompiledClassHash:  string;
  usdcAddress:               string;
  explorerUrl:               string;
  // Optional: address of the swap-anonymizer executor contract. When unset,
  // the Convert action on the dashboard is disabled — the SDK's swap routes
  // (fromToken → executor → toToken) through this contract, so without an
  // address there's nowhere to send the withdrawn funds. Provided by the
  // privacy-pool team per network when ready.
  executorAddress?:          string;
  // Optional: address of the Ekubo router (`ekubo::router::Router`). The
  // executor forwards the swap call to this router; the contract address
  // we pass as the first calldata felt for the executor invocation. Only
  // meaningful when `executorAddress` is the Ekubo executor.
  ekuboRouterAddress?:       string;
  // AVNU paymaster JSON-RPC base URL (the managed service). The browser never
  // calls this directly — it goes through our /api/paymaster proxy, which
  // injects the API key server-side. Kept here as the source of truth for the
  // proxy's AVNU_PAYMASTER_URL env default.
  paymasterUrl:              string;
  // Token the user's proof withdraws to pay the pool fee under SponsoredPrivate
  // (AVNU converts via price oracle). Defaults to STRK.
  poolFeeToken:              string;
  // AVNU's privacy forwarder address — the recipient of the fee_action
  // withdrawal baked into the proof. Provided by AVNU per pool/network once our
  // pool is whitelisted. Left undefined until then; AvnuPaymasterSubmitter stays
  // inactive (falls back to LocalSubmitter / paste-key) while it's missing, so
  // the app still loads. Optional so it doesn't trip the __FILL_ME__ guard.
  paymasterForwarder?:       string;
};

const SEPOLIA: NetworkConfig = {
  label:                    'Starknet Sepolia',
  walletChainId:            '0x534e5f5345504f4c4941',
  snip12ChainId:            'SN_SEPOLIA',
  sdkChainId:               constants.StarknetChainId.SN_SEPOLIA,
  rpcUrl:                   'https://starknet-sepolia-rpc.publicnode.com',
  poolAddress:              '0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91',
  payrollClassHash:         '0x17be2d66359f439b734eafce8eb23df46e2baaa937aa7f67d5ffd2ebf000af6',
  payrollCompiledClassHash: '0x2f1570d2b5f77332662fd07a4c8bf60390e13dc1f4ea52efe7461f35412f784',
  usdcAddress:              '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343',
  explorerUrl:              'https://sepolia.voyager.online',
  paymasterUrl:             'https://sepolia.paymaster.avnu.fi',
  poolFeeToken:             '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', // STRK
  // AVNU's Sepolia privacy forwarder for our pool, returned as fee_action.recipient
  // by paymaster_buildTransaction (verified live 2026-07-22; pool already whitelisted).
  paymasterForwarder:       '0x75a180e18e56da1b1cae181c92a288f586f5fe22c18df21cf97886f1e4b316c',
};

// Endpoints from the privacy-pool team's "Mainnet Env Privacy Details".
// The pool is on real public Starknet mainnet (verified: the pool address
// resolves to class 0x30b8c540… on both publicnode and the team's node).
//
// PayrollContract (ownable + upgradeable class) is declared on mainnet during
// the 2026-06-28 rollout; the class hash is network-independent, so the same
// values are used for both networks. declarePayrollIfNeeded re-declares on
// first use only if the class is absent.
const MAINNET: NetworkConfig = {
  label:                    'Starknet Mainnet',
  walletChainId:            '0x534e5f4d41494e',
  snip12ChainId:            'SN_MAIN',
  sdkChainId:               constants.StarknetChainId.SN_MAIN,
  rpcUrl:                   'https://starknet-rpc.publicnode.com',
  poolAddress:              '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
  payrollClassHash:         '0x17be2d66359f439b734eafce8eb23df46e2baaa937aa7f67d5ffd2ebf000af6',
  payrollCompiledClassHash: '0x2f1570d2b5f77332662fd07a4c8bf60390e13dc1f4ea52efe7461f35412f784',
  usdcAddress:              '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb',
  explorerUrl:              'https://voyager.online',
  executorAddress:          '0x00389e0930f2bcf14221adefb71007ca71cec4cd4f64f321836392d2748a14c6', // Ekubo swap executor
  ekuboRouterAddress:       '0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e',
  paymasterUrl:             'https://starknet.paymaster.avnu.fi',
  poolFeeToken:             '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', // STRK
  // AVNU's forwarder for our pool, returned as fee_action.recipient by
  // buildTransaction (verified live 2026-06-04; pool already whitelisted).
  paymasterForwarder:       '0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f',
};

const active: NetworkConfig = NETWORK === 'mainnet' ? MAINNET : SEPOLIA;

for (const [key, value] of Object.entries(active)) {
  if (typeof value === 'string' && value.startsWith('__FILL_ME__')) {
    throw new Error(`network-config: ${NETWORK} value for "${key}" is not populated yet — see network-config.ts`);
  }
}

export const ACTIVE_NETWORK             = NETWORK;
export const NETWORK_LABEL              = active.label;
export const EXPECTED_WALLET_CHAIN_ID   = active.walletChainId;
export const SNIP12_CHAIN_ID            = active.snip12ChainId;
export const SDK_CHAIN_ID               = active.sdkChainId;
export const RPC_URL                    = active.rpcUrl;
export const POOL_ADDRESS               = active.poolAddress;
export const PAYROLL_CLASS_HASH         = active.payrollClassHash;
export const PAYROLL_COMPILED_CLASS_HASH = active.payrollCompiledClassHash;
export const USDC_ADDRESS               = active.usdcAddress;
export const EXPLORER_URL                = active.explorerUrl;
export const EXECUTOR_ADDRESS            = active.executorAddress;
export const EKUBO_ROUTER_ADDRESS        = active.ekuboRouterAddress;
export const PAYMASTER_URL               = active.paymasterUrl;
export const POOL_FEE_TOKEN              = active.poolFeeToken;
export const PAYMASTER_FORWARDER         = active.paymasterForwarder;
