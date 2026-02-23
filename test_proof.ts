import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import fs from 'fs';
import path from 'path';

async function main() {
    const circuitPath = path.resolve('aether-grid-app/eather-grid-frontend/zkbytecode/map_1.json');
    const circuitStr = fs.readFileSync(circuitPath, 'utf8');
    const circuit = JSON.parse(circuitStr);

    const honk = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
    const noir = new Noir(circuit as any);

    const nullifier = "123456";
    const xy_nullifier_hashed = "179d3b5c627f7c2e113000b98f4d65f4a3709dc3b497055f3fe85a1676d3411a";

    // Reconstruct decimal from hex string
    const hashHex = xy_nullifier_hashed.startsWith('0x') ? xy_nullifier_hashed.slice(2) : xy_nullifier_hashed;
    const hashDecimal = BigInt('0x' + hashHex.padStart(64, '0')).toString();

    console.log("hashDecimal", hashDecimal);

    try {
        const { witness } = await noir.execute({
            x: "3",
            y: "5",
            nullifier,
            xy_nullifier_hashed: hashDecimal
        });
        console.log("Witness generated!");

        const { proof, publicInputs } = await honk.generateProof(witness);
        console.log("Proof length (bytes):", proof.length);
        console.log("Public inputs:", publicInputs);
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}
main();
