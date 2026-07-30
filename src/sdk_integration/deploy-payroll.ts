import { cairo, defaultDeployer, type Account, type Call, type ProviderInterface } from 'starknet';
import { buildApprovePoolCall } from './approve-pool.js';

// Optional pool-fee funding to batch into the deploy tx (keeps onboarding to one
// wallet prompt for fresh wallets): transfer the fee token to the contract and
// approve the pool, both after the deploy call in the same atomic multicall.
export type DeployFunding = { token: string; amount: bigint; poolAddress: string };

function buildTransferCall(tokenAddress: string, recipient: string, amount: bigint): Call {
  const { low, high } = cairo.uint256(amount);
  return { contractAddress: tokenAddress, entrypoint: 'transfer', calldata: [recipient, String(low), String(high)] };
}

export async function deployPayrollContract(
  operatorAccount: Account,
  classHash: string,
  funding?: DeployFunding,
): Promise<{
  contractAddress: string;
  transactionHash: string;
}> {
  // buildDeployerCall computes the deployed address with the SAME logic the
  // account uses to deploy, so we can fund that address in the same tx. The
  // funding calls run after the deploy call; if the address were ever wrong the
  // approve (which calls the just-deployed contract) reverts the whole atomic
  // tx, so no funds can be missent.
  const salt = '0x' + Math.floor(Math.random() * 2 ** 48).toString(16);
  const { calls, addresses } = defaultDeployer.buildDeployerCall(
    { classHash, salt, unique: true, constructorCalldata: [operatorAccount.address] },
    operatorAccount.address,
  );
  const addr = addresses[0];

  const allCalls: Call[] = [...calls];
  if (funding) {
    allCalls.push(buildTransferCall(funding.token, addr, funding.amount));
    allCalls.push(buildApprovePoolCall(addr, funding.token, funding.poolAddress));
  }

  const { transaction_hash } = await operatorAccount.execute(allCalls);
  await operatorAccount.provider.waitForTransaction(transaction_hash);
  await assertDeployedOwner(operatorAccount.provider, addr, operatorAccount.address);

  return {
    contractAddress: addr,
    transactionHash: transaction_hash,
  };
}

async function assertDeployedOwner(
  provider: ProviderInterface,
  contractAddress: string,
  expectedOwner: string,
): Promise<void> {
  const result = await provider.callContract({
    contractAddress,
    entrypoint: 'owner',
    calldata: [],
  });
  const onChainOwner = Array.isArray(result) ? result[0] : (result as { result?: string[] }).result?.[0];
  if (BigInt(onChainOwner ?? 0) !== BigInt(expectedOwner)) {
    throw new Error(
      `Deployed contract owner mismatch — on-chain ${onChainOwner}, expected ${expectedOwner}. ` +
        `Likely the deploy used a stale class or constructor calldata; redeploy.`,
    );
  }
}
