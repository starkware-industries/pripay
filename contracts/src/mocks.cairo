// Test-only mock contracts used by the snforge suite. Compiled only under
// `cfg(test)` (see lib.cairo), so they never end up in production artifacts.

// Minimal External Initializer Contract. `eic_initialize` is invoked via a
// library call from `PayrollContract::upgrade` (so it runs in the payroll
// contract's context). It panics unconditionally so a test can prove the EIC
// branch actually ran before `replace_class_syscall`.
#[starknet::contract]
pub mod MockEIC {
    use crate::interface::IEIC;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl EICImpl of IEIC<ContractState> {
        fn eic_initialize(ref self: ContractState, data: Span<felt252>) {
            assert(data.len() > 0, 'EIC_NO_DATA');
            // Sentinel panic: reaching here proves the library call fired.
            core::panic_with_felt252('EIC_RAN');
        }
    }
}
