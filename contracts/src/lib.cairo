pub mod contract;
pub mod interface;

// Test-only modules. Gated on `cfg(test)` so they never ship in production
// builds: `mocks` holds mock contracts declared by the suite, `tests` holds the
// snforge tests (kept out of contract.cairo to keep the contract source clean).
#[cfg(test)]
pub mod mocks;
#[cfg(test)]
mod tests;
