#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MAP1_CIRCUIT_DIR="$ROOT/circuits/map_1"
CONTRACT_DIR="$ROOT/rs-soroban-ultrahonk"

echo "==> 0) Clean artifacts"
rm -rf "$MAP1_CIRCUIT_DIR/target"
rm -rf "$CONTRACT_DIR/target"

echo "==> 1) cd $MAP1_CIRCUIT_DIR"
cd "$MAP1_CIRCUIT_DIR"

echo "==> 2) Build circuit + witness"
npm i -D @aztec/bb.js@0.87.0 source-map-support
nargo compile
nargo execute

echo "==> 3) Generate Ultrahonk (keccak) VK + proof"
BBJS="./node_modules/@aztec/bb.js/dest/node/main.js"

node "$BBJS" write_vk_ultra_keccak_honk \
  -b ./target/map_1.json \
  -o ./target/vk.keccak

node "$BBJS" prove_ultra_keccak_honk \
  -b ./target/map_1.json \
  -w ./target/map_1.gz \
  -o ./target/proof.with_public_inputs

echo "==> 4) Split proof into public_inputs + proof bytes"
PUB_COUNT="$(node -e "
  const c = require('./target/map_1.json');
  let n = 0;
  for (const p of c.abi.parameters.filter(p => p.visibility === 'public')) {
    if (p.type.kind === 'array') n += p.type.length;
    else n += 1;
  }
  process.stdout.write(String(n));
")"
PUB_BYTES=$((PUB_COUNT * 32))

head -c "$PUB_BYTES" target/proof.with_public_inputs > target/public_inputs
tail -c +$((PUB_BYTES + 1)) target/proof.with_public_inputs > target/proof
cp target/vk.keccak target/vk

echo "    PUB_COUNT=$PUB_COUNT"
echo "    PUB_BYTES=$PUB_BYTES"

echo "==> 5) cd $CONTRACT_DIR"
cd "$CONTRACT_DIR"

echo "==> Build + deploy contract with VK bytes"
stellar contract build --optimize

CID="$(
  stellar contract deploy \
    --wasm target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm \
    --network local \
    --source alice \
    -- \
    --vk_bytes-file-path "$MAP1_CIRCUIT_DIR/target/vk" \
  | tail -n1
)"

echo "==> Deployed CID: $CID"

echo "==> 6) Verify proof (simulation, --send no)"
stellar contract invoke \
  --id "$CID" \
  --network local \
  --source alice \
  --send no \
  -- \
  verify_proof \
  --public_inputs-file-path "$MAP1_CIRCUIT_DIR/target/public_inputs" \
  --proof_bytes-file-path "$MAP1_CIRCUIT_DIR/target/proof"

echo "==> 7) Verify proof on-chain (--send yes)"
stellar contract invoke \
  --id "$CID" \
  --network local \
  --source alice \
  --send yes \
  -- \
  verify_proof \
  --public_inputs-file-path "$MAP1_CIRCUIT_DIR/target/public_inputs" \
  --proof_bytes-file-path "$MAP1_CIRCUIT_DIR/target/proof"

echo "==> Done! On-chain verification succeeded."