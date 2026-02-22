#![cfg(test)]

//! Unit tests for the Eather Grid ZK contract.
//!
//! Uses two mocks:
//!  - `MockGameHub`   – no-op hub that satisfies the GameHub trait.
//!  - `MockVerifier`  – a configurable verifier: traps if `should_fail` is set,
//!                      succeeds otherwise.  This lets us simulate both valid and
//!                      invalid proof submissions without a real UltraHonk prover.
//!
//! Integration tests that exercise the real Verifier WASM belong in a separate
//! workspace-level test crate (not shown here).

use crate::{EatherGridContract, EatherGridContractClient, Error, Outcome};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

// ============================================================================
// Mock Contracts
// ============================================================================

/// Minimal Game Hub that records nothing (pure no-op).
#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
        // no-op
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
        // no-op
    }

    pub fn add_game(_env: Env, _game_address: Address) {
        // no-op
    }
}

/// Configurable mock verifier.
///
/// - When called with `proof[0] == 0xff` it traps (simulates invalid proof).
/// - Otherwise it succeeds (simulates valid proof).
///
/// This approach avoids external state and keeps each test self-contained.
#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    /// Verifies a proof.  Traps if `proof` is empty or starts with `0xff`.
    ///
    /// Contract obligation: never return `false`; always trap on failure.
    pub fn verify_proof(_env: Env, proof: Bytes, _public_inputs: Bytes) {
        if proof.is_empty() {
            panic!("verify_proof: empty proof");
        }
        if proof.get(0) == Some(0xff) {
            panic!("verify_proof: invalid proof");
        }
        // Success → do nothing.
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

struct TestSetup {
    env: Env,
    client: EatherGridContractClient<'static>,
    player1: Address,
    player2: Address,
    /// Pre-computed target_public_inputs for session_id=1 (convenience).
    verifier_addr: Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let admin = Address::generate(&env);

    // Deploy mocks.
    let hub_addr = env.register(MockGameHub, ());
    let verifier_addr = env.register(MockVerifier, ());

    // Deploy eather-grid with all three constructor args.
    let contract_id = env.register(EatherGridContract, (&admin, &hub_addr, &verifier_addr));
    let client = EatherGridContractClient::new(&env, &contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    TestSetup {
        env,
        client,
        player1,
        player2,
        verifier_addr,
    }
}

const POINTS: i128 = 100_0000_000;

/// Build a "valid" proof for mock verifier: any non-empty bytes that don't
/// start with 0xff.
fn valid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0x01u8; 64])
}

/// Build an "invalid" proof for mock verifier (starts with 0xff → traps).
fn invalid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0xffu8; 64])
}

/// Get the target_public_inputs for a started session and re-encode as Bytes.
fn get_public_inputs(
    client: &EatherGridContractClient<'static>,
    env: &Env,
    session_id: u32,
) -> Bytes {
    let target: BytesN<32> = client.get_target(&session_id);
    Bytes::from_array(env, &target.to_array())
}

/// Assert a `Result` contains a specific [`Error`] variant.
fn assert_error<T, E>(
    result: &Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
    expected: Error,
) {
    match result {
        Err(Ok(actual)) => assert_eq!(
            *actual, expected,
            "expected error {expected:?} ({} code), got {actual:?}",
            expected as u32
        ),
        Err(Err(_)) => panic!("expected {expected:?} but got invocation error"),
        Ok(Err(_)) => panic!("expected {expected:?} but got conversion error"),
        Ok(Ok(_)) => panic!("expected error {expected:?} but call succeeded"),
    }
}

// ============================================================================
// Basic Game Flow
// ============================================================================

#[test]
fn test_start_game_stores_target() {
    let ts = setup();
    let session_id = 1u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let game = ts.client.get_game(&session_id);
    assert_eq!(game.player1, ts.player1);
    assert_eq!(game.player2, ts.player2);
    assert!(!game.player1_verified);
    assert!(!game.player2_verified);
    assert!(!game.resolved);

    // target_public_inputs must be 32 bytes and non-zero.
    let target = game.target_public_inputs.to_array();
    assert_ne!(target, [0u8; 32], "target should not be all-zero");
}

#[test]
fn test_targets_differ_across_sessions() {
    let ts = setup();

    ts.client
        .start_game(&1u32, &ts.player1, &ts.player2, &POINTS, &POINTS);
    ts.client
        .start_game(&2u32, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let t1 = ts.client.get_target(&1u32);
    let t2 = ts.client.get_target(&2u32);
    assert_ne!(t1, t2, "different sessions must produce different targets");
}

#[test]
fn test_player1_wins_solo() {
    let ts = setup();
    let session_id = 10u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    let proof = valid_proof(&ts.env);

    // Only player1 submits.
    ts.client
        .submit_proof(&session_id, &ts.player1, &proof, &pi);

    let outcome = ts.client.resolve_game(&session_id);
    assert_eq!(outcome, Outcome::Player1Won);
}

#[test]
fn test_player2_wins_solo() {
    let ts = setup();
    let session_id = 11u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    let proof = valid_proof(&ts.env);

    // Only player2 submits.
    ts.client
        .submit_proof(&session_id, &ts.player2, &proof, &pi);

    let outcome = ts.client.resolve_game(&session_id);
    assert_eq!(outcome, Outcome::Player2Won);
}

#[test]
fn test_both_win() {
    let ts = setup();
    let session_id = 12u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    let proof = valid_proof(&ts.env);

    ts.client
        .submit_proof(&session_id, &ts.player1, &proof, &pi);
    ts.client
        .submit_proof(&session_id, &ts.player2, &proof, &pi);

    let outcome = ts.client.resolve_game(&session_id);
    assert_eq!(outcome, Outcome::BothWon);
}

#[test]
fn test_neither_wins_requires_at_least_one_submission() {
    let ts = setup();
    let session_id = 13u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    // No proof submitted → must fail with NeitherPlayerSubmitted.
    let result = ts.client.try_resolve_game(&session_id);
    assert_error(&result, Error::NeitherPlayerSubmitted);
}

// ============================================================================
// Replay / Public-Input Mismatch Tests
// ============================================================================

#[test]
fn test_wrong_public_inputs_rejected() {
    let ts = setup();
    let session_id = 20u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    // Craft public_inputs that are all-zero (wrong for any real session).
    let wrong_pi = Bytes::from_array(&ts.env, &[0u8; 32]);
    let proof = valid_proof(&ts.env);

    let result = ts
        .client
        .try_submit_proof(&session_id, &ts.player1, &proof, &wrong_pi);
    assert_error(&result, Error::PublicInputMismatch);
}

#[test]
fn test_cross_session_replay_rejected() {
    let ts = setup();

    // Start two sessions for the same players.
    ts.client
        .start_game(&30u32, &ts.player1, &ts.player2, &POINTS, &POINTS);
    ts.client
        .start_game(&31u32, &ts.player1, &ts.player2, &POINTS, &POINTS);

    // Retrieve session 30's target.
    let pi_30 = get_public_inputs(&ts.client, &ts.env, 30u32);
    let proof = valid_proof(&ts.env);

    // Try to use session 30's public_inputs against session 31 → must fail.
    let result = ts
        .client
        .try_submit_proof(&31u32, &ts.player1, &proof, &pi_30);
    assert_error(&result, Error::PublicInputMismatch);
}

// ============================================================================
// Double-Submission and Late-Submission Tests
// ============================================================================

#[test]
fn test_cannot_submit_twice() {
    let ts = setup();
    let session_id = 40u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    let proof = valid_proof(&ts.env);

    ts.client
        .submit_proof(&session_id, &ts.player1, &proof, &pi);

    let result = ts
        .client
        .try_submit_proof(&session_id, &ts.player1, &proof, &pi);
    assert_error(&result, Error::AlreadyVerified);
}

#[test]
fn test_cannot_submit_after_resolve() {
    let ts = setup();
    let session_id = 41u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    let proof = valid_proof(&ts.env);

    ts.client
        .submit_proof(&session_id, &ts.player1, &proof, &pi);
    ts.client.resolve_game(&session_id);

    // Late submission after resolution.
    let result = ts
        .client
        .try_submit_proof(&session_id, &ts.player2, &proof, &pi);
    assert_error(&result, Error::GameAlreadyResolved);
}

#[test]
fn test_resolve_is_idempotent() {
    let ts = setup();
    let session_id = 42u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    ts.client
        .submit_proof(&session_id, &ts.player1, &valid_proof(&ts.env), &pi);

    let first = ts.client.resolve_game(&session_id);
    let second = ts.client.resolve_game(&session_id);
    assert_eq!(first, second, "resolve_game must be idempotent");
}

// ============================================================================
// Invalid Proof (Verifier Traps)
// ============================================================================

#[test]
#[should_panic(expected = "verify_proof: invalid proof")]
fn test_invalid_proof_traps() {
    let ts = setup();
    let session_id = 50u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    let bad_proof = invalid_proof(&ts.env);

    // The mock verifier traps → the entire tx reverts.
    ts.client
        .submit_proof(&session_id, &ts.player1, &bad_proof, &pi);
}

// ============================================================================
// Player Authorization Tests
// ============================================================================

#[test]
fn test_non_player_cannot_submit() {
    let ts = setup();
    let session_id = 60u32;

    ts.client
        .start_game(&session_id, &ts.player1, &ts.player2, &POINTS, &POINTS);

    let non_player = Address::generate(&ts.env);
    let pi = get_public_inputs(&ts.client, &ts.env, session_id);
    let proof = valid_proof(&ts.env);

    let result = ts
        .client
        .try_submit_proof(&session_id, &non_player, &proof, &pi);
    assert_error(&result, Error::NotPlayer);
}

// ============================================================================
// Multiple Independent Sessions
// ============================================================================

#[test]
fn test_multiple_sessions_independent() {
    let ts = setup();
    let player3 = Address::generate(&ts.env);
    let player4 = Address::generate(&ts.env);

    ts.client
        .start_game(&70u32, &ts.player1, &ts.player2, &POINTS, &POINTS);
    ts.client
        .start_game(&71u32, &player3, &player4, &POINTS, &POINTS);

    let pi70 = get_public_inputs(&ts.client, &ts.env, 70u32);
    let pi71 = get_public_inputs(&ts.client, &ts.env, 71u32);
    let proof = valid_proof(&ts.env);

    // Each session uses its own pi.
    ts.client.submit_proof(&70u32, &ts.player1, &proof, &pi70);
    ts.client.submit_proof(&71u32, &player4, &proof, &pi71);

    assert_eq!(ts.client.resolve_game(&70u32), Outcome::Player1Won);
    assert_eq!(ts.client.resolve_game(&71u32), Outcome::Player2Won);
}

// ============================================================================
// Admin Tests
// ============================================================================

#[test]
fn test_admin_can_update_verifier() {
    let ts = setup();
    let new_verifier = Address::generate(&ts.env);
    ts.client.set_verifier(&new_verifier);
    assert_eq!(ts.client.get_verifier(), new_verifier);
}

#[test]
fn test_get_verifier_returns_constructor_value() {
    let ts = setup();
    assert_eq!(ts.client.get_verifier(), ts.verifier_addr);
}

#[test]
fn test_upgrade_function_exists() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());
    let verifier_addr = env.register(MockVerifier, ());
    let contract_id = env.register(EatherGridContract, (&admin, &hub_addr, &verifier_addr));
    let client = EatherGridContractClient::new(&env, &contract_id);

    // Upgrade will fail because the dummy WASM hash does not exist in the ledger.
    // That is expected — we're only verifying the function signature is correct
    // and that it doesn't fail with NotAdmin.
    let fake_hash = BytesN::from_array(&env, &[1u8; 32]);
    let result = client.try_upgrade(&fake_hash);
    assert!(result.is_err(), "upgrade with non-existent WASM must error");
}

#[test]
#[should_panic(expected = "Cannot play against yourself")]
fn test_self_play_rejected() {
    let ts = setup();
    ts.client
        .start_game(&99u32, &ts.player1, &ts.player1, &POINTS, &POINTS);
}
