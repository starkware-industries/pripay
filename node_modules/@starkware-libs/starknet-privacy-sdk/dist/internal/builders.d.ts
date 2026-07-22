/**
 * Builder implementations for constructing private transfer operations.
 */
import { type CreateNoteAction, type DepositAction, type ExecuteOptions, type ExecuteResult, type Note, type OpenChannelAction, type OpenTokenChannelAction, type PrivateTransfersBuilder, type ProofInvocationResult, type SetViewingKeyAction, type StarknetAddress, type StarknetAddressBigint, type TokenOperationsBuilder, type UseNoteAction, type WithdrawAction, type WithdrawOutput, type DepositInput, type TransferOutput, type SurplusAction, type InvokeAction, type InvokeCalldataBuilderArgs, type SimulateOptions, PrivateTransfersInterface } from "../interfaces.js";
import type { CallDetails } from "starknet";
export declare class TokenOperationsBuilderImpl implements TokenOperationsBuilder {
    private parentBuilder;
    openTokenChannels: OpenTokenChannelAction[];
    useNotes: UseNoteAction[];
    deposits: DepositAction[];
    createNotes: CreateNoteAction[];
    withdraws: WithdrawAction[];
    surplusAction?: SurplusAction;
    readonly token: StarknetAddressBigint;
    constructor(parentBuilder: PrivateTransfersBuilderImpl, token: StarknetAddress);
    setup(recipient: StarknetAddress): this;
    inputs(...notes: Note[]): this;
    deposit(...inputs: DepositInput[]): this;
    withdraw(...outputs: WithdrawOutput[]): this;
    transfer(...outputs: TransferOutput[]): this;
    surplusTo(recipient: StarknetAddress, withdraw?: boolean): this;
    with(token: StarknetAddress): TokenOperationsBuilder;
    with(token: StarknetAddress, ops: (t: TokenOperationsBuilder) => void): this;
    done(): PrivateTransfersBuilder;
    execute(options?: ExecuteOptions): Promise<ExecuteResult>;
    createProofInvocation(options?: ExecuteOptions): Promise<ProofInvocationResult>;
    simulate(options: SimulateOptions): Promise<ExecuteResult>;
}
export declare class PrivateTransfersBuilderImpl implements PrivateTransfersBuilder {
    private transfers;
    readonly userAddress: StarknetAddress;
    setViewingKey?: SetViewingKeyAction;
    openChannels: OpenChannelAction[];
    invokeExternal?: InvokeAction;
    tokenBuilders: import("../utils/maps.js").BigNumberishMap<TokenOperationsBuilderImpl>;
    defaultSurplusAction?: SurplusAction;
    private buildOptions?;
    constructor(transfers: PrivateTransfersInterface, userAddress: StarknetAddress, options?: ExecuteOptions);
    register(): this;
    setup(recipient: StarknetAddress): this;
    invoke(callBuilder: (args: InvokeCalldataBuilderArgs) => CallDetails): this;
    surplusTo(recipient: StarknetAddress, withdraw?: boolean): this;
    with(token: StarknetAddress): TokenOperationsBuilder;
    with(token: StarknetAddress, ops: (t: TokenOperationsBuilder) => void): this;
    private collectActionsAndOptions;
    execute(options?: ExecuteOptions): Promise<ExecuteResult>;
    createProofInvocation(options?: ExecuteOptions): Promise<ProofInvocationResult>;
    simulate(options: SimulateOptions): Promise<ExecuteResult>;
}
//# sourceMappingURL=builders.d.ts.map