# Debugging Strategy: "Neither player submitted a valid proof"

## The Bug

`resolve_game` returns `NeitherPlayerSubmitted` (Error #4) even after both players see
"ZK proof submitted!" in the UI. This means `player1_energy` and `player2_energy` are
both `None` in the on-chain game state.

---

## Root Cause Hypotheses (ranked by likelihood)

| # | Hypothesis | Evidence needed |
|---|-----------|----------------|
| A | Proof verification fails on-chain, but the error is swallowed and a fake success is displayed | Console errors, tx hash, `getTransactionResponse` |
| B | Proof is submitted to the wrong `session_id` | Compare session IDs across both players |
| C | The `treasury_hash` committed at `start_game` does not match the `public_inputs` in the proof | Compare on-chain hash vs circuit output |
| D | The verifier VK (baked into the contract) does not match the circuit artifact (`map_1.json`) | Proof size, verifier address, deployment logs |
| E | `signAndSendViaLaunchtube` returns a fake success (never submits) | `getTransactionResponse === undefined` |

---

## Step-by-Step Debugging Checklist

### STEP 1 — Add console logs to `submitZkProof` in `eatherGridService.ts`

Open `eatherGridService.ts` and add temporary logs inside `submitZkProof`:

```typescript
console.log('[submit_zk_proof] sessionId:', sessionId);
console.log('[submit_zk_proof] player:', playerAddress);
console.log('[submit_zk_proof] proofBytes length:', proofBytes.length);
console.log('[submit_zk_proof] publicInputsBuffer (hex):', publicInputsBuffer.toString('hex'));
console.log('[submit_zk_proof] energyUsed:', energyUsed);

// After signAndSendViaLaunchtube:
console.log('[submit_zk_proof] sentTx.getTransactionResponse:', sentTx.getTransactionResponse);
console.log('[submit_zk_proof] sentTx.result:', sentTx.result);
```

**What to check:**
- Is `proofBytes.length === 14592`? If not → proof bytes are wrong.
- Is `publicInputsBuffer` (hex) equal to `treasureHashHex` set during `start_game`? If not → public input mismatch.
- Is `getTransactionResponse` defined? If `undefined` → fake success path triggered (hypothesis E).
- Is `getTransactionResponse.status === 'SUCCESS'`? If `'FAILED'` → transaction failed on-chain.

---

### STEP 2 — Add console logs to `handleSubmitProof` in `EatherGridGame.tsx`

```typescript
console.log('[handleSubmitProof] sessionId state:', sessionId);
console.log('[handleSubmitProof] userAddress:', userAddress);
console.log('[handleSubmitProof] pendingProof.proofBytes.length:', pendingProof?.proofBytes.length);
console.log('[handleSubmitProof] pendingProof.publicInputsBuffer (hex):', pendingProof?.publicInputsBuffer.toString('hex'));
console.log('[handleSubmitProof] treasureHashHex:', treasureHashHex);
```

**What to check:**
- Does `pendingProof.publicInputsBuffer` equal `treasureHashHex`?
  - If not → encoding mismatch between proof output and stored hash.
- Is `sessionId` the same value both players are using?

---

### STEP 3 — Verify the on-chain game state after each submission

After Player 1 submits their proof, call `get_game` via the browser console or a script:

```typescript
// Paste in browser console (after the game starts):
const svc = window.__eatherGridService; // or instantiate it manually
const game = await svc.getGame(YOUR_SESSION_ID);
console.log('player1_energy:', game.player1_energy);
console.log('player2_energy:', game.player2_energy);
console.log('treasure_hash:', Buffer.from(game.treasure_hash).toString('hex'));
```

**What to check:**
- After Player 1's submission: is `player1_energy` still `None`?
  - If still `None` after a "success" message → the transaction never actually updated on-chain state (hypothesis A or E).
- Is `treasure_hash` on-chain the same 32-byte value the player used to generate their proof?

---

### STEP 4 — Verify the transaction hash on the Stellar explorer

After submission, log the transaction hash:

```typescript
// In signAndSendViaLaunchtube, after signAndSend() returns:
console.log('[launchtube] sendTransactionResponse:', sentTx.sendTransactionResponse);
console.log('[launchtube] tx hash:', sentTx.sendTransactionResponse?.hash);
```

Go to `https://stellar.expert/explorer/testnet/tx/HASH` and inspect:
- **Status**: SUCCESS or FAILED?
- **Result**: If FAILED, what is the error code?
  - Error #1 → GameNotFound (wrong session ID)
  - Error #2 → NotPlayer (wrong player address)
  - Error #3 → AlreadySubmitted (submitted twice)
  - Error #6 → PublicInputMismatch (hash doesn't match)
  - Verifier Error #3 → VerificationFailed (proof is invalid)

---

### STEP 5 — Compare `publicInputsBuffer` vs on-chain `treasure_hash`

This is the most likely mismatch point. Add this comparison right before calling `submitZkProof`:

```typescript
// In handleSubmitProof, before calling eatherGridService.submitZkProof:
const onChainHash = await eatherGridService.getTreasureHash(sessionId);
console.log('[hash check] On-chain treasure_hash:', onChainHash?.toString('hex'));
console.log('[hash check] Proof publicInputsBuffer:', pendingProof?.publicInputsBuffer.toString('hex'));
console.log('[hash check] Match:', onChainHash?.toString('hex') === pendingProof?.publicInputsBuffer.toString('hex'));
```

**If they don't match:**
- Either the player entered wrong coordinates in the ZK proof form, OR
- The `treasure_hash` stored at `start_game` was computed differently from what the circuit expects.

---

### STEP 6 — Verify the proof byte count

The on-chain verifier rejects proofs where `proof_bytes.len() != PROOF_BYTES (14592)`.

```typescript
// In zkProofWorker.ts, after generateProof:
console.log('[worker] proof.length:', proof.length);       // Must be 14592
console.log('[worker] publicInputs:', publicInputs);       // Must have exactly 1 entry
```

**If `proof.length !== 14592`** → the Barretenberg version or circuit doesn't match.

---

### STEP 7 — Check for the fake success path

In `transactionHelper.ts`, add a log when the fake path triggers:

```typescript
if (isStillReadOnly) {
  console.error('[signAndSendViaLaunchtube] WARNING: fake success returned — transaction was NEVER submitted!');
  // ... existing return
}
```

If this warning appears → the real issue is that `isReadCall = true` during simulation, which means either:
- The simulation of `submit_zk_proof` is failing silently, OR
- The contract has no auth entries in the simulation result.

---

## Quick Decision Tree

```
Did you see the fake success warning (Step 7)?
├─ YES → Simulation is failing. Check for GameNotFound or PublicInputMismatch in simulation.
└─ NO
    ├─ Is getTransactionResponse undefined (Step 1)?
    │   ├─ YES → Fake success path. Same as above.
    │   └─ NO
    │       ├─ Is status 'FAILED' (Step 4 / explorer)?
    │       │   ├─ YES → Transaction failed on-chain. Check error code on explorer.
    │       │   └─ NO (status = SUCCESS)
    │       │       ├─ Is player1_energy still None after success (Step 3)?
    │       │       │   ├─ YES → Session ID mismatch (submitting to wrong game).
    │       │       │   └─ NO → Game state IS updated. resolve_game uses wrong session_id.
    │       └─ Did hashes match (Step 5)?
    │           └─ NO → Fix the hash encoding. Most likely root cause.
```

---

## Most Likely Root Causes (Summary)

### 1. Public input mismatch (most likely)
The `publicInputsBuffer` from the proof generation does not byte-match the `treasure_hash`
stored on-chain. This causes `PublicInputMismatch` (Error #6) → transaction FAILED.
If this error is swallowed, the user still sees "ZK proof submitted!".

**Fix**: Ensure the `treasureHashHex` fed into `ZkProofSection` as `xy_nullifier_hashed`
is exactly the same 32-byte value that was passed to `start_game`.

### 2. Wrong session ID (likely for Player 2)
Player 2's `sessionId` state is not updated to `gameParams.sessionId` before the first
`submitZkProof` call. React state updates are async — if `setSessionId` is called and
the proof submission happens in the same render cycle, the old session ID is used.

**Fix**: Read the session ID from `gameParams.sessionId` directly inside `handleSubmitProof`
rather than depending on the async `sessionId` state.

### 3. Verifier VK mismatch (hard to detect)
The VK embedded in the deployed verifier contract doesn't match the VK used by the
`map_1.json` circuit artifact. All proofs will silently fail verification on-chain.

**Fix**: Redeploy both the verifier and game contracts using the VK from the current
`map_1.json`. Run `bun run deploy eather-grid` and `bun run deploy rs-soroban-ultrahonk`.

### 4. Fake success path triggered (possible)
`signAndSendViaLaunchtube` returns `{ result: simulatedResult, getTransactionResponse: undefined }`
when simulation fails and the SDK misclassifies it as a read call. The service sees no
FAILED status and reports success, but the transaction was never submitted.

**Fix**: Remove or gate the fake success fallback in `transactionHelper.ts` — it should
throw an error instead of silently pretending to succeed.

---

## Files to Instrument

| File | What to log |
|------|-------------|
| `EatherGridGame.tsx` — `handleSubmitProof` | `sessionId`, `userAddress`, proof lengths, hash comparison |
| `eatherGridService.ts` — `submitZkProof` | All call params, `sentTx.getTransactionResponse`, error from diagnostics |
| `transactionHelper.ts` — `signAndSendViaLaunchtube` | Fake success path (add console.error) |
| `zkProofWorker.ts` — after `generateProof` | `proof.length`, `publicInputs` |
| `ZkProofSection.tsx` — `handleGenerate` | `hashDecimal`, `publicInputs[0]` after proof |