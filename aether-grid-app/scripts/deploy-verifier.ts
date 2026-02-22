import { $ } from "bun";
import { join } from "path";
import { rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Assumes the script is run from inside aether-grid-app directory
const rootDir = join(process.cwd(), "..");
const map1CircuitDir = join(rootDir, "circuits", "map_1");
const contractDir = join(rootDir, "rs-soroban-ultrahonk");

async function main() {
    console.log("==> 0) Clean artifacts");
    await rm(join(map1CircuitDir, "target"), { recursive: true, force: true }).catch(() => {});
    await rm(join(contractDir, "target"), { recursive: true, force: true }).catch(() => {});

    console.log(`==> 1) Compile the Noir circuit`);
    console.log(`    -> cd ${map1CircuitDir}`);
    
    console.log("    -> Installing bb.js and dependencies");
    await $`bun install -D @aztec/bb.js@0.87.0 source-map-support`.cwd(map1CircuitDir);
    
    console.log("    -> Running nargo compile");
    await $`nargo compile`.cwd(map1CircuitDir);
    
    console.log("    -> Running nargo execute");
    await $`nargo execute`.cwd(map1CircuitDir);

    console.log("==> 2) Generate the UltraHonk Keccak Verifying Key (VK)");
    const bbjsPath = join(map1CircuitDir, "node_modules", "@aztec/bb.js", "dest", "node", "main.js");
    
    console.log("    -> Generating VK bytes...");
    await $`node ${bbjsPath} write_vk_ultra_keccak_honk -b ./target/map_1.json -o ./target/vk.keccak`.cwd(map1CircuitDir);
    
    console.log("    -> Generating Proof with public inputs...");
    await $`node ${bbjsPath} prove_ultra_keccak_honk -b ./target/map_1.json -w ./target/map_1.gz -o ./target/proof.with_public_inputs`.cwd(map1CircuitDir);
    
    // Output VK as hex
    const vkBuffer = await readFile(join(map1CircuitDir, "target", "vk.keccak"));
    const vkHex = vkBuffer.toString("hex");
    console.log(`    -> VK Hex extracted (${vkBuffer.length} bytes)`);
    console.log(`    -> VK Hex preview: ${vkHex.substring(0, 64)}...`);
    
    console.log("    -> Split proof into public_inputs + proof bytes");
    const map1JsonStr = await readFile(join(map1CircuitDir, "target", "map_1.json"), "utf8");
    const map1Json = JSON.parse(map1JsonStr);
    
    let pubCount = 0;
    for (const p of map1Json.abi.parameters.filter((p: any) => p.visibility === "public")) {
        if (p.type.kind === "array") pubCount += p.type.length;
        else pubCount += 1;
    }
    const pubBytes = pubCount * 32;
    console.log(`       PUB_COUNT=${pubCount}`);
    console.log(`       PUB_BYTES=${pubBytes}`);
    
    const proofWithPubInputs = await readFile(join(map1CircuitDir, "target", "proof.with_public_inputs"));
    const publicInputs = proofWithPubInputs.subarray(0, pubBytes);
    const proof = proofWithPubInputs.subarray(pubBytes);
    
    await writeFile(join(map1CircuitDir, "target", "public_inputs"), publicInputs);
    await writeFile(join(map1CircuitDir, "target", "proof"), proof);
    await writeFile(join(map1CircuitDir, "target", "vk"), vkBuffer); // Alias test-local.sh uses
    
    console.log(`==> 3) Build the verifier contract`);
    console.log(`    -> cd ${contractDir}`);
    console.log(`    -> stellar contract build --optimize`);
    await $`stellar contract build --optimize`.cwd(contractDir);
    
    const wasmPath = join(contractDir, "target", "wasm32v1-none", "release", "rs_soroban_ultrahonk.wasm");
    if (!existsSync(wasmPath)) {
        throw new Error(`WASM artifact not produced at ${wasmPath}`);
    }
    console.log(`    -> WASM artifact verified at ${wasmPath}`);
    
    console.log("==> 4) Deploy the verifier contract locally");
    // Stellar CLI outputs some logging and then the ID on the last line or sth similar
    const deployCmd = await $`stellar contract deploy \
        --wasm ${wasmPath} \
        --network local \
        --source alice \
        -- \
        --vk_bytes-file-path ${join(map1CircuitDir, "target", "vk")}`.cwd(contractDir).text();
        
    const deployOutputLines = deployCmd.trim().split("\n");
    let cid = "";
    // Find a valid CID in the output
    for (let i = deployOutputLines.length - 1; i >= 0; i--) {
        const line = deployOutputLines[i].trim();
        if (line.startsWith("C") && line.length === 56) {
            cid = line;
            break;
        }
    }
    if (!cid) {
        // Fallback to the last line if we couldn't easily parse a C... Soroban address
        cid = deployOutputLines[deployOutputLines.length - 1].trim();
    }
    
    console.log(`==> Deployed Contract ID: ${cid}`);
    
    console.log("==> 5) Verify proof (simulation, --send no)");
    await $`stellar contract invoke \
        --id ${cid} \
        --network local \
        --source alice \
        --send no \
        -- \
        verify_proof \
        --public_inputs-file-path ${join(map1CircuitDir, "target", "public_inputs")} \
        --proof_bytes-file-path ${join(map1CircuitDir, "target", "proof")}`.cwd(contractDir);
        
    console.log("==> 6) Verify proof on-chain (--send yes)");
    await $`stellar contract invoke \
        --id ${cid} \
        --network local \
        --source alice \
        --send yes \
        -- \
        verify_proof \
        --public_inputs-file-path ${join(map1CircuitDir, "target", "public_inputs")} \
        --proof_bytes-file-path ${join(map1CircuitDir, "target", "proof")}`.cwd(contractDir);
        
    console.log("==> Done! Local deployment and verification pipeline complete.");
}

main().catch(err => {
    console.error("Pipeline failed:", err);
    process.exit(1);
});
