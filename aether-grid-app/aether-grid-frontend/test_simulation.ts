import { rpc, Contract, Keypair, Address, nativeToScVal, xdr, scValToNative } from '@stellar/stellar-sdk';
import { eather_grid } from './src/contracts/eather_grid';
import fs from 'fs';

async function main() {
    const server = new rpc.Server('http://localhost:8000/soroban/rpc');
    const deployment = JSON.parse(fs.readFileSync('local-deployment.json', 'utf-8'));
    const contractId = deployment.contracts['eather-grid'];
    console.log("EatherGrid ID:", contractId);

    const pubBytes = 32;
    const cliProofWithPub = fs.readFileSync('../../circuits/map_1/target/proof.with_public_inputs');
    const cliProof = cliProofWithPub.subarray(pubBytes);
    const cliPubInputs = cliProofWithPub.subarray(0, pubBytes);

    const adminKp = Keypair.fromSecret(process.env.VITE_DEV_ADMIN_SECRET || 'SDXYB3DODKWWK2TZZT2BXXNQQE7UHRXX36N7P6K5KDBT65A46V4RSDXT');
    // ... wait, we don't have the active session id to simulate submit_zk_proof.
    // If the session isn't initialized, we will get GameNotFound anyway.
}
main().catch(console.error);
