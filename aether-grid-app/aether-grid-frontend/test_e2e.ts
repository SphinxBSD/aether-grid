import { rpc, Contract, Keypair, Address, nativeToScVal, xdr, scValToNative } from '@stellar/stellar-sdk';
import fs from 'fs';
import { UltraHonkBackend, BarretenbergSync, Fr } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuit from './src/zkbytecode/map_1.json' assert { type: 'json' };

async function main() {
    const server = new rpc.Server('http://localhost:8000/soroban/rpc');
    const deployment = JSON.parse(fs.readFileSync('local-deployment.json', 'utf-8'));
    const contractId = deployment.contracts['eather-grid'];
    console.log("EatherGrid ID:", contractId);

    const adminKp = Keypair.fromSecret(deployment.wallets.admin || process.env.VITE_DEV_ADMIN_SECRET);
    const p1Kp = Keypair.fromSecret(process.env.VITE_DEV_PLAYER1_SECRET || deployment.wallets.player1);
    const p2Kp = Keypair.fromSecret(process.env.VITE_DEV_PLAYER2_SECRET || deployment.wallets.player2);

    const api = await BarretenbergSync.initSingleton();
    const honk = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
    const noir = new Noir(circuit as any);

    const sessionId = 99999;
    const x = 3n;
    const y = 5n;
    const nullifier = BigInt(sessionId >>> 0);

    const hFr = api.poseidon2Hash([new Fr(x), new Fr(y), new Fr(nullifier)]);
    const hashHex = hFr.toString().replace(/^0x/, '');
    const hashDecimal = BigInt('0x' + hashHex).toString();
    const treasureHashBuffer = Buffer.from(hashHex.padStart(64, '0'), 'hex');

    const contractObj = new Contract(contractId);

    // 1. Simulate start_game
    let tx = new xdr.TransactionEnvelope(xdr.EnvelopeType.envelopeTypeTx(new xdr.Transaction({
        sourceAccount: new xdr.MuxedAccount.keyTypeEd25519(adminKp.xdrPublicKey()),
        fee: 100,
        seqNum: new xdr.SequenceNumber(1),
        cond: new xdr.Preconditions(xdr.PreconditionType.precondNone()),
        memo: new xdr.Memo(xdr.MemoType.memoNone()),
        ext: new xdr.TransactionExt(0),
        operations: [
            contractObj.call('start_game', 
                nativeToScVal(sessionId, { type: 'u32' }),
                new Address(p1Kp.publicKey()).toScVal(),
                new Address(p2Kp.publicKey()).toScVal(),
                nativeToScVal(100, { type: 'i128' }),
                nativeToScVal(100, { type: 'i128' }),
                nativeToScVal(treasureHashBuffer)
            )
        ]
    })));

    console.log("Simulating start_game...");
    const simReq = await server.simulateTransaction(tx as any);
    if ('error' in simReq) {
        console.error("Start Game Simulation Error:", simReq.error);
    } else {
        console.log("Start Game Simulation SUCCESS.");
        // We cannot easily send via raw script without building the real tx, so we will use soroban-cli
        // Wait, simulating submit_zk_proof requires start_game to actually be on chain!
    }
}
main().catch(console.error);
