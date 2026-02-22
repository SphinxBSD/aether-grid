#!/usr/bin/env bun

/**
 * Deploy script for Soroban contracts to local network
 *
 * Deploys Soroban contracts to local Quickstart node
 * Returns the deployed contract IDs
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile, getEnvValue } from './utils/env';
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

type StellarKeypair = {
  publicKey(): string;
  secret(): string;
};

type StellarKeypairFactory = {
  random(): StellarKeypair;
  fromSecret(secret: string): StellarKeypair;
};

async function loadKeypairFactory(): Promise<StellarKeypairFactory> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    return sdk.Keypair;
  } catch (error) {
    console.warn("⚠️  @stellar/stellar-sdk is not installed. Running `bun install`...");
    try {
      await $`bun install`;
      const sdk = await import("@stellar/stellar-sdk");
      return sdk.Keypair;
    } catch (installError) {
      console.error("❌ Failed to load @stellar/stellar-sdk.");
      console.error("Run `bun install` in the repository root, then retry.");
      process.exit(1);
    }
  }
}

function usage() {
  console.log(`
Usage: bun run deploy:local [contract-name...]

Examples:
  bun run deploy:local
  bun run deploy:local number-guess
  bun run deploy:local twenty-one number-guess
`);
}

// ── Prerequisites & Network details ───────────────────────────────────────────
const NETWORK = 'local';
const RPC_URL = 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE = 'Standalone Network ; February 2017';
const SIGNER = 'alice';

console.log(`🚀 Deploying contracts to Stellar local network (${RPC_URL})...\n`);

// Ensure local network is reachable
try {
  const ping = await fetch(RPC_URL.replace('/soroban/rpc', ''));
  if (!ping.ok) {
    throw new Error(`Received HTTP ${ping.status}`);
  }
  console.log("✅ Local network is reachable.");
} catch (error: any) {
  console.error("❌ Error: Local Stellar network is not reachable.");
  console.error(`Attempt to connect to ${RPC_URL.replace('/soroban/rpc', '')} failed: ${error.message}`);
  console.error("Please ensure you have started the Quickstart container:\n");
  console.error(`docker run -d -p 8000:8000 stellar/quickstart \\
  --local \\
  --limits unlimited \\
  --enable core,rpc,lab,horizon,friendbot`);
  process.exit(1);
}

const Keypair = await loadKeypairFactory();

async function localAccountExists(address: string): Promise<boolean> {
  const res = await fetch(`http://localhost:8000/accounts/${address}`, { method: 'GET' });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon error ${res.status} checking ${address}`);
  return true;
}

async function ensureLocalFunded(address: string): Promise<void> {
  if (await localAccountExists(address)) return;
  console.log(`💰 Funding ${address} via local friendbot...`);
  const fundRes = await fetch(`http://localhost:8000/friendbot?addr=${address}`, { method: 'GET' });
  if (!fundRes.ok) {
    throw new Error(`Friendbot funding failed (${fundRes.status}) for ${address}`);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    if (await localAccountExists(address)) return;
  }
  throw new Error(`Funded ${address} but it still doesn't appear on local Horizon yet`);
}

async function localContractExists(contractId: string): Promise<boolean> {
  const tmpPath = join(tmpdir(), `stellar-contract-${contractId}.wasm`);
  try {
    await $`stellar -q contract fetch --id ${contractId} --network ${NETWORK} --out-file ${tmpPath}`;
    return true;
  } catch {
    return false;
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore missing temp file
    }
  }
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const allContracts = await getWorkspaceContracts();
const selection = selectContracts(allContracts, args);
if (selection.unknown.length > 0 || selection.ambiguous.length > 0) {
  console.error("❌ Error: Unknown or ambiguous contract names.");
  if (selection.unknown.length > 0) {
    console.error("Unknown:");
    for (const name of selection.unknown) console.error(`  - ${name}`);
  }
  if (selection.ambiguous.length > 0) {
    console.error("Ambiguous:");
    for (const entry of selection.ambiguous) {
      console.error(`  - ${entry.target}: ${entry.matches.join(", ")}`);
    }
  }
  console.error(`\nAvailable contracts: ${listContractNames(allContracts)}`);
  process.exit(1);
}

const contracts = selection.contracts;
const mock = allContracts.find((c) => c.isMockHub);
if (!mock) {
  console.error("❌ Error: mock-game-hub contract not found in workspace members");
  process.exit(1);
}

const needsMock = contracts.some((c) => !c.isMockHub);
const deployMockRequested = contracts.some((c) => c.isMockHub);
const shouldEnsureMock = deployMockRequested || needsMock;

// Check required WASM files exist for selected contracts
const missingWasm: string[] = [];
for (const contract of contracts) {
  if (contract.isMockHub) continue;
  if (!await Bun.file(contract.wasmPath).exists()) missingWasm.push(contract.wasmPath);
}
if (missingWasm.length > 0) {
  console.error("❌ Error: Missing WASM build outputs:");
  for (const p of missingWasm) console.error(`  - ${p}`);
  console.error("\nRun 'bun run build:local [contract-name]' first");
  process.exit(1);
}

// ── Check Identities ──────────────────────────────────────────────────────────
console.log('Resolving admin address (alice) from stellar CLI...');
let adminAddress = "";
try {
  adminAddress = (await $`stellar keys address ${SIGNER}`.text()).trim();
} catch (error) {
  console.error(`❌ Failed to resolve identity '${SIGNER}'. Did you configure it in the stellar CLI?`);
  process.exit(1);
}

// Ensure Alice has funds
try {
  await ensureLocalFunded(adminAddress);
  console.log('✅ admin funded (alice)');
} catch (error) {
  console.error('❌ Failed to ensure admin is funded. Deployment cannot proceed.', error);
  process.exit(1);
}

// Set up Player 1 & 2 for local config testing
const walletAddresses: Record<string, string> = { admin: adminAddress };
const walletSecrets: Record<string, string> = {};

let existingSecrets: Record<string, string | null> = { player1: null, player2: null };
const existingEnv = await readEnvFile('.env');
for (const identity of ['player1', 'player2']) {
  const key = `VITE_DEV_${identity.toUpperCase()}_SECRET`;
  const v = getEnvValue(existingEnv, key);
  if (v && v !== 'NOT_AVAILABLE') existingSecrets[identity] = v;
}

for (const identity of ['player1', 'player2']) {
  console.log(`Setting up ${identity}...`);
  let keypair: Keypair;
  if (existingSecrets[identity]) {
    console.log(`✅ Using existing ${identity} from .env`);
    keypair = Keypair.fromSecret(existingSecrets[identity]!);
  } else {
    console.log(`📝 Generating new ${identity}...`);
    keypair = Keypair.random();
  }

  walletAddresses[identity] = keypair.publicKey();
  walletSecrets[identity] = keypair.secret();
  
  try {
    await ensureLocalFunded(keypair.publicKey());
    console.log(`✅ ${identity} funded\n`);
  } catch (error) {
    console.warn(`⚠️  Warning: Failed to ensure ${identity} is funded, continuing anyway...`);
  }
}

// ── Load Existing Local Deployments ─────────────────────────────────────────
const existingContractIds: Record<string, string> = {};
let existingDeployment: any = null;
if (existsSync("local-deployment.json")) {
  try {
    existingDeployment = await Bun.file("local-deployment.json").json();
    if (existingDeployment?.contracts && typeof existingDeployment.contracts === "object") {
      Object.assign(existingContractIds, existingDeployment.contracts);
    } else {
      // Backwards compatible fallback
      if (existingDeployment?.mockGameHubId) existingContractIds["mock-game-hub"] = existingDeployment.mockGameHubId;
      if (existingDeployment?.twentyOneId) existingContractIds["twenty-one"] = existingDeployment.twentyOneId;
      if (existingDeployment?.numberGuessId) existingContractIds["number-guess"] = existingDeployment.numberGuessId;
    }
  } catch (error) {
    console.warn("⚠️  Warning: Failed to parse local-deployment.json, continuing...");
  }
}

const deployed: Record<string, string> = { ...existingContractIds };

// ── Deploy Mock Hub ───────────────────────────────────────────────────────────
let mockGameHubId = existingContractIds[mock.packageName] || "";
if (shouldEnsureMock) {
  if (mockGameHubId && await localContractExists(mockGameHubId)) {
    deployed[mock.packageName] = mockGameHubId;
    console.log(`✅ Using existing ${mock.packageName} on local: ${mockGameHubId}\n`);
  } else {
    if (!await Bun.file(mock.wasmPath).exists()) {
      console.error("❌ Error: Missing WASM build output for mock-game-hub:");
      console.error(`  - ${mock.wasmPath}`);
      console.error("\nRun 'bun run build:local mock-game-hub' first");
      process.exit(1);
    }

    console.warn(`⚠️  ${mock.packageName} not found on local. Deploying...`);
    try {
      const result =
        await $`stellar contract deploy --wasm ${mock.wasmPath} --source ${SIGNER} --network ${NETWORK}`.text();
      mockGameHubId = result.trim().split("\n").at(-1)!;
      deployed[mock.packageName] = mockGameHubId;
      console.log(`✅ ${mock.packageName} deployed: ${mockGameHubId}\n`);
    } catch (error) {
      console.error(`❌ Failed to deploy ${mock.packageName}:`, error);
      process.exit(1);
    }
  }
}

// ── Deploy Games ──────────────────────────────────────────────────────────────
for (const contract of contracts) {
  if (contract.isMockHub) continue;

  console.log(`Deploying ${contract.packageName}...`);
  try {
    console.log("  Installing WASM...");
    const installResult =
      await $`stellar contract install --wasm ${contract.wasmPath} --source ${SIGNER} --network ${NETWORK}`.text();
    const wasmHash = installResult.trim();
    console.log(`  WASM hash: ${wasmHash}`);

    console.log("  Deploying and initializing...");
    const deployResult =
      await $`stellar contract deploy --wasm-hash ${wasmHash} --source ${SIGNER} --network ${NETWORK} -- --admin ${adminAddress} --game-hub ${mockGameHubId}`.text();
    const contractId = deployResult.trim().split("\n").at(-1)!;
    deployed[contract.packageName] = contractId;
    console.log(`✅ ${contract.packageName} deployed: ${contractId}\n`);
  } catch (error) {
    console.error(`❌ Failed to deploy ${contract.packageName}:`, error);
    process.exit(1);
  }
}

// ── Wrap Up & Output ──────────────────────────────────────────────────────────
console.log("🎉 Local Deployment complete!\n");
console.log("Contract IDs:");
const outputContracts = new Set<string>();
for (const contract of contracts) outputContracts.add(contract.packageName);
if (shouldEnsureMock) outputContracts.add(mock.packageName);
for (const contract of allContracts) {
  if (!outputContracts.has(contract.packageName)) continue;
  const id = deployed[contract.packageName];
  if (id) console.log(`  ${contract.packageName}: ${id}`);
}

const deploymentContracts = allContracts.reduce<Record<string, string>>((acc, contract) => {
  acc[contract.packageName] = deployed[contract.packageName] || "";
  return acc;
}, {});

const deploymentInfo = {
  mockGameHubId,
  contracts: deploymentContracts,
  network: NETWORK,
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  wallets: {
    admin: adminAddress,
    player1: walletAddresses.player1,
    player2: walletAddresses.player2,
  },
  deployedAt: new Date().toISOString(),
};

await Bun.write('local-deployment.json', JSON.stringify(deploymentInfo, null, 2) + '\n');
console.log("\n✅ Wrote local deployment info to local-deployment.json");

const contractEnvLines = allContracts
  .map((c) => `VITE_${c.envKey}_CONTRACT_ID=${deploymentContracts[c.packageName] || ""}`)
  .join("\n");

let existingEnvContent = "";
if (existsSync('.env')) {
  existingEnvContent = await Bun.file('.env').text();
}

const envContent = `# Auto-generated by deploy script
# Do not edit manually - run 'bun run deploy:local' or 'deploy' to regenerate

VITE_SOROBAN_RPC_URL=${RPC_URL}
VITE_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
${contractEnvLines}

# Dev wallet addresses for testing
VITE_DEV_ADMIN_ADDRESS=${adminAddress}
VITE_DEV_PLAYER1_ADDRESS=${walletAddresses.player1}
VITE_DEV_PLAYER2_ADDRESS=${walletAddresses.player2}

# Dev wallet secret keys (WARNING: Never commit this file!)
VITE_DEV_PLAYER1_SECRET=${walletSecrets.player1}
VITE_DEV_PLAYER2_SECRET=${walletSecrets.player2}
`;

await Bun.write('.env', envContent + '\n');
console.log("✅ Wrote secrets to .env (gitignored)");
