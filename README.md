# AETHER — Strategic Energy Optimization Game

Turn-based strategy on a 7×7 grid: you locate a hidden energy core. Every action (move, radar, drill) costs energy; **the player who finds it with the least total energy wins**. Uses zero-knowledge (ZK) proofs for fair verification and runs on Stellar.

---

## How to run locally

### Requirements

| Tool           | Version      |
|----------------|--------------|
| **Stellar CLI**| 25.1.0       |
| **Noir (nargo)** | 1.0.0-beta.9 |
| **Bun**        | [bun.sh](https://bun.sh) |
| **Docker**     | For local network |

### Install tools

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

### Steps

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
bun run dev:game aether-grid
```

The game opens at **http://localhost:3000**.

---

### Common errors

| Error | What to do |
|-------|------------|
| `port is already allocated` | Stop and remove the Stellar container (step 1). |
| `Account not found` | Run `stellar keys fund alice --network local`. |
| `Budget, ExceededLimit` | Start the network with `--limits unlimited`. |
| `Failed to resolve import "@aztec/bb.js"` | From `aether-grid-app/aether-grid-frontend`: `bun install`. |
