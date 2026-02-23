#![no_std]

//! # Eather Grid Game — ZK Coordinates Edition
//!
//! A two-player treasure-hunt game backed by a Zero-Knowledge coordinate circuit.
//!
//! ## Circuit (Noir)
//! ```noir
//! use dep::poseidon::poseidon2::Poseidon2;
//! fn main(x: Field, y: Field, nullifier: Field, xy_nullifier_hashed: pub Field) {
//!     let h: Field = Poseidon2::hash([x, y, nullifier], 3);
//!     assert(h == xy_nullifier_hashed);
//! }
//! ```
//! - `x`, `y`        → private treasure coordinates known only to the player.
//! - `nullifier`     → private session-binding salt (see Nullifier Design below).
//! - `xy_nullifier_hashed` → public output: `Poseidon2(x, y, nullifier)`.
//!
//! ## Nullifier Design
//! To prevent cross-session replay, the frontend MUST derive the nullifier as:
//!   `nullifier = keccak256(session_id ‖ player1_address ‖ player2_address)`
//! This binds each proof cryptographically to a single session.
//! The resulting `xy_nullifier_hashed` is therefore unique per session.
//!
//! ## Flow
//! 1. Admin deploys UltraHonk verifier (VK embedded at compile time).
//! 2. Admin deploys this contract with (`admin`, `game_hub`, `verifier`).
//! 3. Frontend calls `start_game` and supplies `treasure_hash` =
//!    the Poseidon2 hash that the treasure's canonical coordinates produce.
//! 4. Each player calls `submit_zk_proof(session_id, player, proof, public_inputs, energy_used)`.
//!    - `public_inputs` must equal `game.treasure_hash`.
//!    - `verifier.verify_proof` traps on failure; success records `energy_used`.
//! 5. Caller invokes `resolve_game` → winner determined by energy efficiency:
//!    - One verified  → that player wins.
//!    - Both verified → lower `energy_used` wins; tie goes to player1.
//!    - Neither       → both lose; GameHub notified with `player1_won = false`.
//!
//! ## Trust Boundaries
//! - Verifier is stateless and decoupled; VK is baked in at deploy.
//! - Contract never inspects proof bytes or slices public_input fields.
//! - `energy_used` is caller-supplied and NOT circuit-constrained in this version.
//!   A future circuit version should include it as a public output.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, vec, Address, Bytes,
    BytesN, Env, IntoVal,
};

// ============================================================================
// External Contract Interfaces
// ============================================================================

/// Interface for the mock-game-hub contract.
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );
    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

/// Interface for the UltraHonk verifier contract.
///
/// Contract: the verifier MUST trap on failure. It MUST NOT return `false`.
/// A call returning normally signals a valid proof.
#[contractclient(name = "UltraHonkVerifierClient")]
pub trait UltraHonkVerifier {
    fn verify_proof(env: Env, proof: Bytes, public_inputs: Bytes);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No game exists for the given session ID.
    GameNotFound = 1,
    /// Caller is not player1 or player2 for this session.
    NotPlayer = 2,
    /// Player has already submitted a valid proof in this session.
    AlreadySubmitted = 3,
    /// `resolve_game` was called before any player submitted a proof.
    NeitherPlayerSubmitted = 4,
    /// The game has already been resolved; no further submissions accepted.
    GameAlreadyResolved = 5,
    /// `public_inputs` bytes do not match `game.treasure_hash`.
    /// Prevents cross-session replay attacks.
    PublicInputMismatch = 6,
}

// ============================================================================
// Data Types
// ============================================================================

/// Outcome returned by `resolve_game`.
///
/// Stored as a return value only — NOT stored inside `Game` to avoid nested
/// `#[contracttype]` enum serialisation issues with Soroban SDK.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Outcome {
    /// Player 1 found the treasure and used less (or equal) energy.
    Player1Won,
    /// Player 2 found the treasure and used less energy.
    Player2Won,
    /// Both found the treasure, but neither wins outright via energy (tie resolved to Player1).
    BothFoundTreasure,
    /// Neither player provided a valid proof.
    NeitherFound,
}

/// Per-session game state stored in temporary storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    /// Poseidon2(x, y, nullifier) — the expected public input for this session.
    ///
    /// Set at `start_game` by the frontend (which knows the canonical treasure
    /// coordinates and the session-specific nullifier).  Players must supply this
    /// exact 32-byte value as `public_inputs` when calling `submit_zk_proof`.
    pub treasure_hash: BytesN<32>,
    /// Energy spent by player 1 to reach the treasure; `None` if not yet submitted.
    pub player1_energy: Option<u32>,
    /// Energy spent by player 2 to reach the treasure; `None` if not yet submitted.
    pub player2_energy: Option<u32>,
    /// True after `resolve_game` has been called.  Blocks late submissions.
    pub resolved: bool,
}

/// Storage keys.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-session game state (temporary storage, 30-day TTL).
    Game(u32),
    /// Address of the mock-game-hub contract (instance storage).
    GameHubAddress,
    /// Address of the UltraHonk verifier contract (instance storage).
    VerifierAddress,
    /// Admin address (instance storage).
    Admin,
}

/// 30 days = 30 × 24 × 3600 / 5 ≈ 518 400 ledgers (5-second ledger close).
const GAME_TTL_LEDGERS: u32 = 518_400;

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct EatherGridContract;

#[contractimpl]
impl EatherGridContract {
    // ========================================================================
    // Lifecycle
    // ========================================================================

    /// Deploy and configure the contract.
    ///
    /// # Arguments
    /// * `admin`    – Admin address (`set_*` + `upgrade`).
    /// * `game_hub` – Address of the mock-game-hub contract.
    /// * `verifier` – Address of the deployed UltraHonk verifier.
    pub fn __constructor(env: Env, admin: Address, game_hub: Address, verifier: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, &verifier);
    }

    // ========================================================================
    // Game Flow
    // ========================================================================

    /// Start a new game between two players.
    ///
    /// The frontend must supply `treasure_hash` = `Poseidon2(x, y, nullifier)`
    /// where `nullifier` is derived from session identity to prevent replay.
    ///
    /// Recommended nullifier construction (off-chain):
    ///   `nullifier = keccak256(session_id_be ‖ player1_bytes ‖ player2_bytes)`
    ///
    /// # Arguments
    /// * `session_id`     – Unique session identifier (u32).
    /// * `player1`        – First player's address.
    /// * `player2`        – Second player's address.
    /// * `player1_points` – Points committed by player 1.
    /// * `player2_points` – Points committed by player 2.
    /// * `treasure_hash`  – Poseidon2 hash of the session's canonical coordinates.
    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
        treasure_hash: BytesN<32>,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Cannot play against yourself");
        }

        // Both players must authorise their point commitment for this session.
        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        // Register the session with the Game Hub (locks points).
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let game = Game {
            player1,
            player2,
            player1_points,
            player2_points,
            treasure_hash,
            player1_energy: None,
            player2_energy: None,
            resolved: false,
        };

        let key = DataKey::Game(session_id);
        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Submit a ZK proof of treasure discovery.
    ///
    /// # Responsibilities
    /// 1. Validates `public_inputs == game.treasure_hash` (opaque 32-byte
    ///    comparison — no byte slicing, no field parsing).
    /// 2. Cross-contract call to the UltraHonk verifier.  If the proof is
    ///    invalid the verifier traps, reverting the entire transaction.
    /// 3. Records `energy_used` for the player on success.
    ///
    /// # Replay Protection
    /// - `AlreadySubmitted` prevents a player from submitting twice.
    /// - `PublicInputMismatch` blocks cross-session proof reuse because each
    ///   session's `treasure_hash` embeds a unique session-bound nullifier.
    /// - `GameAlreadyResolved` blocks late submissions.
    ///
    /// # Security Note (energy_used)
    /// `energy_used` is a caller-supplied `u32` in this version.  A dishonest
    /// player can underreport it.  Future circuit versions should include
    /// `energy_used` as a verified public output of the Noir circuit.
    ///
    /// # Arguments
    /// * `session_id`    – Session being submitted to.
    /// * `player`        – Submitting player (must be player1 or player2).
    /// * `proof`         – Raw UltraHonk proof bytes (opaque).
    /// * `public_inputs` – Must equal `game.treasure_hash`.
    /// * `energy_used`   – Energy the player claims to have spent reaching the
    ///                     treasure (lower = better for the tiebreaker).
    pub fn submit_zk_proof(
        env: Env,
        session_id: u32,
        player: Address,
        proof: Bytes,
        public_inputs: Bytes,
        energy_used: u32,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.resolved {
            return Err(Error::GameAlreadyResolved);
        }

        let is_player1 = player == game.player1;
        let is_player2 = player == game.player2;

        if !is_player1 && !is_player2 {
            return Err(Error::NotPlayer);
        }
        if is_player1 && game.player1_energy.is_some() {
            return Err(Error::AlreadySubmitted);
        }
        if is_player2 && game.player2_energy.is_some() {
            return Err(Error::AlreadySubmitted);
        }

        // Validate public_inputs against the session's treasure hash.
        // This is the sole on-chain binding: an opaque byte equality check.
        // No field parsing, no byte-offset slicing.
        let expected = Bytes::from_array(&env, &game.treasure_hash.to_array());
        if public_inputs != expected {
            return Err(Error::PublicInputMismatch);
        }

        // Cross-contract call: decoupled, stateless UltraHonk verifier.
        // If the proof is invalid the verifier MUST trap — the whole tx reverts.
        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier not set");
        let verifier = UltraHonkVerifierClient::new(&env, &verifier_addr);
        verifier.verify_proof(&proof, &public_inputs);

        // Proof accepted — record player's energy expenditure.
        if is_player1 {
            game.player1_energy = Some(energy_used);
        } else {
            game.player2_energy = Some(energy_used);
        }
        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Resolve the game and report the outcome to the Game Hub.
    ///
    /// Can be called by anyone (permissionless).  Idempotent after first call.
    /// Requires at least one player to have submitted a proof.
    ///
    /// ## Winner Resolution
    ///
    /// | p1_energy     | p2_energy     | Outcome            | GameHub            |
    /// |---------------|---------------|--------------------|--------------------|
    /// | Some(e1)      | None          | Player1Won         | player1_won = true |
    /// | None          | Some(e2)      | Player2Won         | player1_won = false|
    /// | Some(e1)      | Some(e2), e1 < e2 | Player1Won    | player1_won = true |
    /// | Some(e1)      | Some(e2), e2 < e1 | Player2Won    | player1_won = false|
    /// | Some(e1)      | Some(e2), e1 == e2 | BothFoundTreasure | player1_won = true |
    /// | None          | None          | Error: NeitherPlayerSubmitted | – |
    ///
    /// # Arguments
    /// * `session_id` – The session to resolve.
    pub fn resolve_game(env: Env, session_id: u32) -> Result<Outcome, Error> {
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        // Idempotent: recompute from stored energy values without re-calling GameHub.
        if game.resolved {
            return Ok(Self::compute_outcome(
                game.player1_energy,
                game.player2_energy,
            ));
        }

        // Need at least one verified player before resolving.
        if game.player1_energy.is_none() && game.player2_energy.is_none() {
            return Err(Error::NeitherPlayerSubmitted);
        }

        let outcome = Self::compute_outcome(game.player1_energy, game.player2_energy);
        let player1_won = matches!(outcome, Outcome::Player1Won | Outcome::BothFoundTreasure);

        game.resolved = true;
        env.storage().temporary().set(&key, &game);

        // Notify Game Hub — maintains mandatory mock-game-hub integration.
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.end_game(&session_id, &player1_won);

        Ok(outcome)
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /// Retrieve full game state for a session.
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        env.storage()
            .temporary()
            .get(&DataKey::Game(session_id))
            .ok_or(Error::GameNotFound)
    }

    /// Return the treasure hash (public input) for a session.
    ///
    /// Frontends should use this as the `xy_nullifier_hashed` circuit input.
    pub fn get_treasure_hash(env: Env, session_id: u32) -> Result<BytesN<32>, Error> {
        let game: Game = env
            .storage()
            .temporary()
            .get(&DataKey::Game(session_id))
            .ok_or(Error::GameNotFound)?;
        Ok(game.treasure_hash)
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set")
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    pub fn get_verifier(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier not set")
    }

    /// Update the verifier contract address.
    ///
    /// ⚠ Verifier Upgrade Warning: if the new verifier embeds a different VK,
    /// all proofs generated against the old VK will fail.  Coordinate upgrades
    /// carefully with all active players.
    pub fn set_verifier(env: Env, new_verifier: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, &new_verifier);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /// Determine the outcome from energy values.
    ///
    /// Rules:
    /// - Only p1 submitted → `Player1Won`.
    /// - Only p2 submitted → `Player2Won`.
    /// - Both submitted, e1 < e2  → `Player1Won`.
    /// - Both submitted, e2 < e1  → `Player2Won`.
    /// - Both submitted, e1 == e2 → `BothFoundTreasure` (tie, GameHub gets player1_won = true).
    /// - Neither submitted        → `NeitherFound` (should be unreachable from resolve_game).
    fn compute_outcome(p1_energy: Option<u32>, p2_energy: Option<u32>) -> Outcome {
        match (p1_energy, p2_energy) {
            (Some(_), None) => Outcome::Player1Won,
            (None, Some(_)) => Outcome::Player2Won,
            (Some(e1), Some(e2)) => {
                if e1 <= e2 {
                    if e1 == e2 {
                        Outcome::BothFoundTreasure
                    } else {
                        Outcome::Player1Won
                    }
                } else {
                    Outcome::Player2Won
                }
            }
            (None, None) => Outcome::NeitherFound,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
