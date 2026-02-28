# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Aether Grid** is a serverless, zero-knowledge (ZK) turn-based strategy game on Stellar Soroban. Two players compete on a 7x7 grid to locate a hidden energy core. Players generate client-side UltraHonk ZK proofs in the browser to verify discovery without revealing coordinates on-chain. The player who finds the core using the least energy wins.

## Repository Structure

```
aether-grid/
├── circuits/map_1/          # Noir ZK circuit (Pedersen hash)
├── rs-soroban-ultrahonk/    # Stateless UltraHonk verifier contract (VK baked at compile time)
├── verifiers/map_1/         # Pre-generated verifier keys
├── aether-grid-app/         # Main workspace (Bun)
│   ├── contracts/
│   │   ├── eather-grid/     # Active ZK game contract (Rust/Soroban)
│   │   ├── aether-grid/     # Original non-ZK game contract
│   │   └── mock-game-hub/   # Required game lifecycle hub
│   ├── scripts/             # Bun automation scripts
│   ├── aether-grid-frontend/# Main game UI (React + Vite)
│   │   └── src/games/aether-grid/
│   │       ├── AetherGridGame.tsx      # Top-level game component
│   │       ├── ZkProofSection.tsx      # Proof generation UI
│   │       ├── aetherGridService.ts    # Contract interaction service
│   │       ├── zkProofWorker.ts        # Web Worker — UltraHonk proof generation
│   │       ├── zkLogger.ts             # Color-coded console debug logger
│   │       └── zkbytecode/map_1.json   # Compiled Noir circuit artifact
│   └── eather-grid-frontend/# ZK-specific prototype frontend
└── DEBUG_STRATEGY.md        # ZK proof debugging checklist
```

## Common Commands

All `bun run` commands must be executed from inside `aether-grid-app/`.

### Local Development (full flow)

```bash
# 1. Start Stellar local network (--limits unlimited is required for ZK verifier)
docker run -d -p 8000:8000 stellar/quickstart \
  --local --limits unlimited \
  --enable core,rpc,lab,horizon,friendbot
stellar network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
stellar network use local

# 2. Fund alice identity
stellar keys generate --global alice
stellar keys fund alice --network local

# 3. Build, deploy, run (in order)
cd aether-grid-app
bun run deploy:verifier      # Build Noir circuit → generate VK → deploy rs-soroban-ultrahonk
bun run build:local          # Compile Soroban contracts to WASM
bun run deploy:local         # Deploy contracts + write .env + local-deployment.json
bun run dev:game aether-grid # Start frontend at http://localhost:3000
```

### Contract Development

```bash
bun run build:local [contract-name]      # Build one or all contracts
bun run deploy:local [contract-name]     # Deploy to local network
bun run bindings [contract-name]         # Regenerate TypeScript bindings after ABI changes
bun run bindings:local [contract-name]   # Bindings pointed at local network
```

### Testnet

```bash
bun run setup            # Build + deploy to testnet, generate bindings, write .env
bun run build [name]     # Build for testnet
bun run deploy [name]    # Deploy to testnet
```

### Contract Tests (Rust)

```bash
# Run from aether-grid-app/
cargo test -p eather-grid
cargo test -p aether-grid
cargo test                   # All contracts
```

### Noir Circuit

```bash
cd circuits/map_1
nargo compile                # Compile circuit
nargo execute                # Generate witness (uses Prover.toml inputs)
nargo test                   # Run circuit tests
```

## Architecture: ZK Proof Flow

Understanding this flow is essential for working on this project.

### 1. Game Setup (multi-sig XDR handshake)
`start_game` requires authorization from **both** players. The flow:
1. Player 1 calls `prepareStartGame()` → signs their auth entry → exports XDR string.
2. Player 2 calls `importAndSignAuthEntry()` with the XDR → builds and signs the full transaction.
3. Either player calls `finalizeStartGame()` → restores signed auth entries after simulate → broadcasts.

The `treasure_hash` (`pedersen_hash(x, y, nullifier)`) is committed on-chain at this step.

### 2. ZK Proof Generation (browser Web Worker)
`zkProofWorker.ts` runs off the main thread:
- Inputs: private `x`, `y`, `nullifier`; public `xy_nullifier_hashed`
- Uses `@noir-lang/noir_js` (witness) + `@aztec/bb.js` (UltraHonk proof)
- **Must** pass `{ keccak: true }` to `honk.generateProof()` — the Soroban verifier uses Keccak-256 for Fiat-Shamir; omitting this produces a proof that will always fail on-chain.
- Expected proof size: **14592 bytes**. Any other size means a circuit/Barretenberg mismatch.

### 3. Proof Submission
`submit_zk_proof(session_id, player, proof, public_inputs, energy_used)`:
- `public_inputs` must byte-match `game.treasure_hash` (opaque 32-byte equality — no field parsing).
- Verifier cross-contract call: `verify_proof(public_inputs, proof_bytes)` — **parameter order matters**. Swapping them causes a silent `VerificationFailed` trap.
- On success, `energy_used` (caller-supplied u32) is recorded for tiebreaker.

### 4. Resolution
`resolve_game(session_id)` is permissionless. Winner = lower `energy_used`. Tie goes to player1.

## Key Invariants

- The ZK circuit (`circuits/map_1/`) uses **Pedersen hash** (not Poseidon2 or Keccak) for the coordinate commitment. Do not confuse with the Keccak-256 used for Fiat-Shamir in proof generation.
- The **nullifier** must be derived as `keccak256(session_id_be ‖ player1_bytes ‖ player2_bytes)` to prevent cross-session replay attacks.
- Game state lives in **temporary storage** with a 30-day TTL (`extend_ttl` on every write).
- The verifier contract (`rs-soroban-ultrahonk`) has its VK **baked in at compile time**. Redeploying the verifier after any circuit change requires re-running `bun run deploy:verifier`.
- After regenerating bindings, copy `bindings/<game>/src/index.ts` into the frontend's `bindings.ts`. Do not hand-edit generated bindings.

## Debugging ZK Proof Failures

See `DEBUG_STRATEGY.md` for the full decision tree. The most common causes:
1. **Public input mismatch**: `publicInputsBuffer` from proof ≠ `treasure_hash` stored on-chain → Error #6 (`PublicInputMismatch`).
2. **Fake success path**: `signAndSendViaLaunchtube` returns `getTransactionResponse: undefined` when the SDK misclassifies a state-mutating call as read-only. Check `[TX·Helper]` logs.
3. **VK mismatch**: Deployed verifier VK doesn't match `map_1.json` circuit → all proofs silently fail.
4. **Missing `keccak: true`**: Proof generated with Poseidon challenges; Keccak verifier rejects it.

Filter browser console by `[ZK]` or `[TX·Helper]` to isolate relevant logs from `zkLogger.ts`.

## Tool Versions Required

| Tool         | Version          |
|--------------|------------------|
| Stellar CLI  | 25.1.0           |
| Noir (nargo) | 1.0.0-beta.9     |
| Bun          | latest           |
| Rust target  | wasm32v1-none    |
| @aztec/bb.js | 0.87.0           |

Install Noir: `noirup --version v1.0.0-beta.9`

## Game Studio Pattern (aether-grid-app)

`aether-grid-app/CLAUDE.md` contains full guidance on the game studio scaffold, contract checklist, bindings workflow, and frontend integration patterns for adding new games to this workspace.