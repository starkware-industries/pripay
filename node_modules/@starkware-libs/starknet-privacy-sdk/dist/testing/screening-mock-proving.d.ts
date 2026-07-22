/**
 * A mock proving provider that also fabricates a screening attestation for
 * regular-pool deposits, so the devnet suite can exercise the screening-capable
 * pool's deposit path end to end.
 *
 * The real proving service screens a deposit's depositor and relays the
 * screener's signature in the proof's `additional_data`; the screening-capable
 * contract rejects a deposit whose attestation is missing or invalid. This
 * provider mirrors that: when the proven actions contain a `Deposit`, it signs
 * an attestation over the depositor with the canonical test screener key (whose
 * public key the pool is deployed with) and attaches it. Non-deposit actions
 * carry no attestation — the contract requires `Option::None` for those.
 */
import { type BlockIdentifier } from "starknet";
import type { Proof, ProofInvocation } from "../interfaces.js";
import { CallMockProofProvider } from "../internal/mock-proving.js";
export declare class ScreeningCallMockProofProvider extends CallMockProofProvider {
    private readonly actionsDecoder;
    prove(invocation: ProofInvocation, blockIdentifier?: BlockIdentifier): Promise<Proof>;
    /**
     * The depositor to attest, or `undefined` when the invocation carries no
     * regular-pool deposit. Inner calldata is `[user_addr, user_private_key,
     * ...client actions]`; the depositor is `user_addr`, matching the
     * `TransferFrom.from_addr` a self-funded deposit proves on-chain.
     */
    private depositorToScreen;
}
//# sourceMappingURL=screening-mock-proving.d.ts.map