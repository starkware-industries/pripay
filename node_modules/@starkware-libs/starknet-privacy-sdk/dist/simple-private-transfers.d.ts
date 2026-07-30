import { SimplePrivateTransfersInterface, PrivateTransfersInterface, Amount, PrivateRegistry, StarknetAddress, All, ExecuteResult } from "./interfaces.js";
export declare class SimplePrivateTransfersImpl implements SimplePrivateTransfersInterface {
    private inner;
    constructor(inner: PrivateTransfersInterface);
    get user(): StarknetAddress;
    readonly registry: PrivateRegistry;
    deposit(token: StarknetAddress, amount: Amount): Promise<ExecuteResult>;
    withdraw(token: StarknetAddress, recipient: StarknetAddress, amount: Amount | All): Promise<ExecuteResult>;
    transfer(token: StarknetAddress, recipient: StarknetAddress, amount: Amount | All): Promise<ExecuteResult>;
    swap(fromToken: StarknetAddress, fromAmount: Amount, toToken: StarknetAddress, executor: StarknetAddress): Promise<ExecuteResult>;
    private build;
}
//# sourceMappingURL=simple-private-transfers.d.ts.map