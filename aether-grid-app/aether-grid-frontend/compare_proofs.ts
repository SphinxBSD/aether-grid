import { UltraHonkBackend, BarretenbergSync, Fr } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuit from './src/zkbytecode/map_1.json' assert { type: 'json' };
import fs from 'fs';

async function main() {
    const pubBytes = 32;
    const cliProofWithPub = fs.readFileSync('../../circuits/map_1/target/proof.with_public_inputs');
    const cliProof = cliProofWithPub.subarray(pubBytes);
    const cliPubInputs = cliProofWithPub.subarray(0, pubBytes);

    const api = await BarretenbergSync.initSingleton();
    const honk = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
    const noir = new Noir(circuit as any);

    const x = 3n;
    const y = 5n;
    const nullifier = 42n;

    const hFr = api.poseidon2Hash([new Fr(x), new Fr(y), new Fr(nullifier)]);
    const hashHex = hFr.toString().replace(/^0x/, '');
    const hashDecimal = BigInt('0x' + hashHex).toString();

    // To ensure exact match with CLI, we must use the SAME witness.
    // However, witness generation is deterministic.
    const { witness } = await noir.execute({
        x: x.toString(), y: y.toString(), nullifier: nullifier.toString(), xy_nullifier_hashed: hashDecimal
    });

    const { proof, publicInputs } = await honk.generateProof(witness, { keccak: true });

    let match = true;
    for (let i = 0; i < cliProof.length; i++) {
        if (cliProof[i] !== proof[i]) {
            console.log(`Mismatch at index ${i}: CLI=${cliProof[i]}, JS=${proof[i]}`);
            match = false;
            break;
        }
    }
    
    if (match) {
        console.log("Proofs match EXACTLY!");
    } else {
        console.log("Proofs DO NOT MATCH!");
    }
    
    // Check public inputs
    const jsPubInputBuf = Buffer.from(publicInputs[0].replace('0x', '').padStart(64, '0'), 'hex');
    console.log("CLI Pub:", cliPubInputs.toString('hex'));
    console.log("JS Pub :", jsPubInputBuf.toString('hex'));
    
    process.exit(0);
}
main().catch(console.error);
