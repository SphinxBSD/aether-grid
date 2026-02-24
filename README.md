# 🪐 Aether Grid

### 1️⃣ 🚀 Project Summary

**Aether Grid** is a decentralized, zero-knowledge (ZK) turn-based strategy game built on Stellar Soroban. Two players compete on a 7x7 grid to locate a hidden energy core. Instead of revealing coordinates on-chain, players generate client-side ZK proofs to verify their findings without exposing the actual location. Every action (move, radar, drill) consumes energy, and the player who finds the core with the least total energy expenditure wins. This completely serverless architecture eliminates centralized backends while ensuring mathematically provable fairness.

---

### 2️⃣ 🎮 How It Works

1. **Game Initializes**: Players lock their stakes in the Game Hub contract and exchange multi-sig XDRs.
2. **Treasure Position Generated**: A private `(x, y)` coordinate is utilized as a hidden target.
3. **Nullifier Generated**: A session-bound nullifier is derived to prevent replay attacks and secure the session state.
4. **Player Moves on Grid**: Off-chain UI tracks movements, radar pings, and cumulative energy costs.
5. **Player Finds Treasure**: The player drills the correct coordinates based on game logic feedback.
6. **Proof Generated**: A local Web Worker generates an UltraHonk ZK proof right inside the browser.
7. **Smart Contract Verifies**: The Soroban contract cryptographically verifies the proof via an on-chain stateless verifier.
8. **State Updated**: The winner is determined by minimum energy spent, and point stakes are automatically resolved.

---

### 3️⃣ 🧠 Technical Innovation

- **Client-Side ZK Proving**: ZK proofs are generated entirely in the browser via Web Workers using `@noir-lang/noir_js` and `@aztec/bb.js`, bypassing the need for centralized prover servers.
- **Perfect Privacy**: Target coordinate locations `(x, y)` remain perfectly **private** (off-chain). Only the `treasure_hash` and final energy expenditure are **public** on the ledger.
- **Cryptographic Nullifier**: A Keccak-256 session nullifier binds the proof to specific players and matches, rendering double-claims or hijacked proofs mathematically impossible.
- **Stateless Blockchain Resolution**: The Soroban smart contract embraces transient storage with a 30-day TTL to process live game states, which eliminates permanent ledger bloat.

---

### 4️⃣ 🏗️ Architecture

- **Frontend**: React SPA (Vite, Zustand) handling the complex game UI, wallet connectivity, and off-chain execution tracking.
- **Smart Contracts**: Lightweight core game logic (`eather-grid`) and stake management (`mock-game-hub`) compiled in Rust to Wasm.
- **ZK Circuits**: Cryptographic rules encoded in Noir (`circuits/map_1`), safely hashing coordinates and nullifiers via Poseidon2.
- **Blockchain Network**: Stellar Soroban executing the isolated stateless UltraHonk verifier contract.
- **Key Folders**:
  - `aether-grid-app/eather-grid-frontend` (Client UI & ZK Web Workers)
  - `aether-grid-app/contracts` (Soroban core logic & interactions)
  - `circuits/` & `verifiers/` (Noir circuits and verifier keys)

---

### 5️⃣ ⚙️ Tech Stack

- **Blockchain**: Stellar Soroban, Rust, `@stellar/stellar-sdk`
- **Zero-Knowledge**: Noir, Barretenberg (UltraHonk WASM)
- **Frontend**: React, TypeScript, Vite, Zustand, TailwindCSS
- **Toolchain**: Bun, Stellar CLI, Nargo

---

### 6️⃣ 🛠️ Run Locally

#### Requirements

| Tool             | Version                  |
| ---------------- | ------------------------ |
| **Stellar CLI**  | 25.1.0                   |
| **Noir (nargo)** | 1.0.0-beta.9             |
| **Bun**          | [bun.sh](https://bun.sh) |
| **Docker**       | For local network        |

#### Install tools

**Stellar CLI (macOS / Linux):**

```bash
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh
# or: brew install stellar-cli
# or: cargo install --locked stellar-cli@25.1.0
```

**Noir (nargo):**

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup --version v1.0.0-beta.9
```

If `nargo` is not found, open a new terminal or run `source ~/.zshrc`.

**Bun:** [bun.sh](https://bun.sh)

---

#### Steps

**1. Stellar local network**

If port 8000 is already in use:

```bash
docker ps -a
docker stop stellar-local
docker rm stellar-local
```

Start the network (**required**: `--limits unlimited` for the ZK verifier):

```bash
docker run -d -p 8000:8000 stellar/quickstart \
  --local \
  --limits unlimited \
  --enable core,rpc,lab,horizon,friendbot
stellar network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
stellar network use local
```

**2. Wallet (alice)**

```bash
stellar keys generate --global alice
stellar keys fund alice --network local
```

If you just restarted the container, run `stellar keys fund alice --network local` again.

**3. App: verifier, build, deploy, and frontend**

```bash
cd aether-grid-app
bun run deploy:verifier
bun run build:local
bun run deploy:local

# For the generic frontend:
bun run dev:game aether-grid

# Or for the ZK specific frontend:
bun run dev:game eather-grid
```

The game opens at **http://localhost:3000**.

---

### 7️⃣ 💡 Common Errors

| Error                                     | What to do                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `port is already allocated`               | Stop and remove the Stellar container (step 1).                                               |
| `Account not found`                       | Run `stellar keys fund alice --network local`.                                                |
| `Budget, ExceededLimit`                   | Start the network with `--limits unlimited`.                                                  |
| `Failed to resolve import "@aztec/bb.js"` | Go to `aether-grid-app/eather-grid-frontend` or `aether-grid-frontend` and run `bun install`. |
| `Compile error in Noir project`           | Ensure `nargo` version `1.0.0-beta.9` is actively selected via `noirup`.                      |

---

### 8️⃣ 🔮 Future Improvements

- Expand to multiplayer grid arenas beyond standard 1v1 matchmaking.
- Dynamic on-chain circuit loading for varying grid sizes and complexities.
- Native real-time P2P networking (e.g., WebRTC) to eliminate manual XDR handshakes.
- Integration of Soroban SAC (Stellar Asset Contract) tokens for real-value tokenomics.
