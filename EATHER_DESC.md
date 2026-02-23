# Technical Report: Eather Grid Project

## 1. Executive Summary & Purpose

The **Eather Grid** project is a two-player, decentralized "treasure-hunt" game built on the Stellar Soroban smart contract platform. Its primary purpose is to showcase advanced cross-contract interactions and Zero-Knowledge (ZK) cryptography. Players search for a hidden treasure using private coordinates (`x`, `y`). Instead of revealing these coordinates on-chain, players generate client-side ZK proofs demonstrating their knowledge of the coordinates. The game natively prevents replay attacks and resolves ties via a competitive energy-expenditure mechanic, without relying on any centralized backend server.

_Note: The system operates entirely via client-side web application and on-chain smart contracts. There is no traditional backend or centralized server-side component._

## 2. System Architecture

The architecture relies entirely on a decentralized paradigm involving client-side applications, ZK circuits, and on-chain Soroban smart contracts:

- **Frontend Application (`aether-grid-app/eather-grid-frontend`)**: A React-based Single Page Application (SPA). It acts as the game client interface, manages wallet connections, and importantly, hosts Web Workers that run ZK prover logic locally inside the user's browser.
- **Game Smart Contract (`aether-grid-app/contracts/eather-grid`)**: The core Rust-based Soroban contract. It holds per-session transient game states, handles proof submissions, and calculates game outcomes.
- **ZK Circuits (`./circuits`)**: Written in Noir. These circuits encode the game's core logic rule: knowledge of a specific `x` and `y` coordinate that, alongside a session-specific salt (nullifier), hashes to a publicized `treasure_hash`.
- **Verifier Contract (`./verifiers` & `UltraHonkVerifier`)**: A stateless Soroban contract containing the verification key (VK) baked in at compile time. It cryptographically authenticates the proofs submitted by players.
- **Mock Game Hub (`aether-grid-app/contracts/mock-game-hub`)**: An auxiliary module integrated by `eather-grid` to manage player stakes and point commitments.
- **Automation Scripts (Bun Scripts)**: A suite of TypeScript scripts executed via Bun, responsible for contract builds, deployments, and generating TypeScript bindings for the frontend.

## 3. Implemented Features

- **Decentralized ZK Proving:** Full client-side UltraHonk proof generation avoiding any centralized prover reliance, utilizing `@noir-lang/noir_js` and `@aztec/bb.js` via browser Web Workers.
- **Cryptographic Replay Protection:** A session-bound `nullifier` derived from `keccak256(session_id ‖ player1 ‖ player2)` prevents proofs from being hijacked or reused across different matches.
- **Opaque Proof Verification:** The core game contract avoids direct manual proof byte inspections. It securely invokes a dedicated, stateless `UltraHonkVerifier` via cross-contract calls.
- **Energy-based Winner Resolution:** In scenarios where both players uncover the treasure, the contract evaluates the `energy_spent` value (distance or moves taken), awarding victory to the most efficient player. Tie-cases and losses are gracefully reported to the `mock-game-hub`.
- **Stateless Game Lifecycle:** Uses Soroban’s transient storage capabilities (30-day TTL bounds) mitigating state-bloat effectively.

## 4. Interaction Flow Between Components

The execution naturally spans the physical boundaries between the browser and the blockchain:

1. **Initialization**: The frontend derives the session nullifier and uses Poseidon2 to hash the desired private `(x, y)` coordinates alongside the nullifier. This outputs the `treasure_hash`.
2. **Game Registration**: The frontend calls `start_game` on the `eather-grid` smart contract, providing the `treasure_hash` as well as player point commitments. The `eather-grid` contract delegates state locking to the `mock-game-hub`.
3. **Witness & Proof Generation (Off-chain)**: Once a player locates the target in the UI, a Web Worker spins up via the frontend. It inputs the private coordinates and constructs an UltraHonk proof.
4. **On-chain Submission**: The player sends the raw bytes of the generated proof to the `submit_zk_proof` contract endpoint, alongside the `treasure_hash` public input.
5. **Cross-Contract Verification**: The `eather-grid` contract intercepts the call, validates the `treasure_hash`, and delegates the byte array to the `UltraHonkVerifier`. A valid interaction simply returns; an invalid proof traps the transaction.
6. **Game Conclusion (resolve_game)**: Anyone can trigger the resolution. The contract measures points/energy matrices and emits the conclusion to the `mock-game-hub`.

## 5. Folder Structure & Key Components

- `aether-grid-app/contracts/eather-grid/`: Main Soroban Rust smart contract containing the life-cycle flows (`lib.rs`).
- `aether-grid-app/eather-grid-frontend/`: The robust Vite + React web client.
  - `src/games/eather-grid/zkProofWorker.ts`: Off-main-thread mechanism handling Aztec/Barretenberg proof generations.
- `./circuits/map_1`: Contains exactly the Noir cryptographic logic rules (`main.nr`), verifying the integrity of the Poseidon2 Hash.
- `./verifiers/map_1`: Artifacts containing parameters and the UltraHonk verifier components.
- `aether-grid-app/scripts/`: Tooling utilizing Bun. Houses deployment workflows (`deploy-local.ts`, `deploy-verifier.ts`, `bindings-local.ts`).
- `test_proof.ts`: Sandbox script to test or benchmark ZK proofs using the compiled JSON bytecode without invoking the frontend.

## 6. Technologies and Frameworks

- **Languages:** Rust (Contracts), TypeScript (Frontend & Scripts), Noir (Zero-Knowledge Circuits).
- **Frontend Ecosystem:** React (via Vite), TailwindCSS for styling, `zustand` for state management.
- **Blockchain Connectivity:** `@stellar/stellar-sdk`, `@stellar/freighter-api`, and `stellar-wallets-kit` for chain abstractions to Web3.
- **Cryptography Frameworks:** `@noir-lang/noir_js` and `@aztec/bb.js` for constructing Barretenberg (UltraHonk) proofs securely via WebAssembly (WASM).
- **Scripting & Toolchain:** Bun runtime for streamlined setup and local testing environments.

## 7. Important Architectural Decisions

- **Complete Backend Elimination:** By pairing Soroban’s cross-contract capabilities and Aztec’s Barretenberg WASM port, a centralized server is skipped. Proving exists structurally on the frontend; verifications inherently exist on-chain.
- **Verifier Segregation:** The validation logic executes in a separate, decoupled `UltraHonkVerifier` contract rather than merging inside the game contract. This enforces robust modularity; game limits on computation are decoupled from the heavy arithmetic checks within the verifier.
- **Keccak-256 for Fiat-Shamir:** Specifically configured Barretenberg logic in the Web Worker uses Keccak instead of Poseidon for transcript challenges explicitly to map perfectly to the limitations and expectations of the Soroban deterministic rust verifier logic.
- **Asynchronous UI Rendering in Proving:** Running heavy recursive mathematical proofs client-side freezes rendering loops. Emulating threads through pure Web Worker configurations scales smoothly over user devices.
