import { UltraHonkBackend, BarretenbergSync, Fr } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuit from './src/zkbytecode/map_1.json' assert { type: 'json' };

async function main() {
    const api = await BarretenbergSync.initSingleton();
    const honk = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
    const noir = new Noir(circuit as any);
    const x = 3n;
    const y = 5n;
    const nullifier = 123456n;
    const hFr = api.poseidon2Hash([new Fr(x), new Fr(y), new Fr(nullifier)]);
    const hashHex = hFr.toString().replace(/^0x/, '');
    const hashDecimal = BigInt('0x' + hashHex).toString();

    const { witness } = await noir.execute({
        x: x.toString(), y: y.toString(), nullifier: nullifier.toString(), xy_nullifier_hashed: hashDecimal
    });

    const { proof, publicInputs } = await honk.generateProof(witness, { keccak: true });
    console.log("Proof length (bytes):", proof.length);
    console.log("Public inputs output:", publicInputs);
    console.log("Proof last 32 bytes:", Buffer.from(proof.slice(-32)).toString('hex'));
    process.exit(0);
}
main().catch(console.error);
