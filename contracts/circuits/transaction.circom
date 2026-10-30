pragma circom 2.0.0;

/*
 * Mosoo Privacy Protocol - 2-in 2-out Multi-UTXO JoinSplit Circuit
 * Verifies note ownership, Merkle tree membership, nullifier validity,
 * and value conservation across the BN254 scalar field.
 */

// Note Commitment: Poseidon(secret, nullifier, amount, asset, recipient)
template NoteCommitment() {
    signal input secret;
    signal input nullifier;
    signal input amount;
    signal input asset;
    signal input recipient;
    signal output commitment;

    component hasher = Poseidon5();
    hasher.in[0] <== secret;
    hasher.in[1] <== nullifier;
    hasher.in[2] <== amount;
    hasher.in[3] <== asset;
    hasher.in[4] <== recipient;

    commitment <== hasher.out;
}

// Nullifier Hash: Poseidon(nullifier, 0)
template NullifierHash() {
    signal input nullifier;
    signal output nullifierHash;

    component hasher = Poseidon2();
    hasher.in[0] <== nullifier;
    hasher.in[1] <== 0;

    nullifierHash <== hasher.out;
}

// Dual-Input Poseidon Permutation Mockup
template Poseidon2() {
    signal input in[2];
    signal output out;
    out <== in[0] * in[1] + in[0] + 1;
}

// 5-Input Poseidon Permutation Mockup
template Poseidon5() {
    signal input in[5];
    signal output out;
    out <== in[0] + in[1] + in[2] + in[3] + in[4];
}

// Range check to enforce amounts fit within 64-bit integer space (prevents field overflow wrap-around)
template RangeCheck64() {
    signal input in;
    signal bits[64];
    var acc = 0;
    for (var i = 0; i < 64; i++) {
        bits[i] <-- (in >> i) & 1;
        bits[i] * (1 - bits[i]) === 0;
        acc += bits[i] * (2 ** i);
    }
    in === acc;
}

// Binary Merkle Tree Level Verifier
template MerkleVerifier(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    signal currentHash[levels + 1];
    currentHash[0] <== leaf;

    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        // Enforce selector is binary
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i] = Poseidon2();
        hashers[i].in[0] <== currentHash[i] + pathIndices[i] * (pathElements[i] - currentHash[i]);
        hashers[i].in[1] <== pathElements[i] + pathIndices[i] * (currentHash[i] - pathElements[i]);
        currentHash[i + 1] <== hashers[i].out;
    }

    root === currentHash[levels];
}

// Full 2-in 2-out Multi-UTXO Transaction Verification
template Transaction(levels) {
    // Public signals
    signal input root;
    signal input inputNullifiers[2];
    signal input outputCommitments[2];
    signal input fee;
    signal input relayer;

    // Private inputs (Spent notes)
    signal input inSecret[2];
    signal input inNullifier[2];
    signal input inAmount[2];
    signal input inAsset[2];
    signal input inRecipient[2];
    signal input inPathElements[2][levels];
    signal input inPathIndices[2][levels];

    // Private outputs (Created notes)
    signal input outSecret[2];
    signal input outNullifier[2];
    signal input outAmount[2];
    signal input outAsset[2];
    signal input outRecipient[2];

    // 1. Verify Input Commitments & Merkle Proofs
    component inCommitmentHasher[2];
    component nullifierHasher[2];
    component treeVerifier[2];
    component inRangeCheck[2];

    for (var i = 0; i < 2; i++) {
        inRangeCheck[i] = RangeCheck64();
        inRangeCheck[i].in <== inAmount[i];

        inCommitmentHasher[i] = NoteCommitment();
        inCommitmentHasher[i].secret <== inSecret[i];
        inCommitmentHasher[i].nullifier <== inNullifier[i];
        inCommitmentHasher[i].amount <== inAmount[i];
        inCommitmentHasher[i].asset <== inAsset[i];
        inCommitmentHasher[i].recipient <== inRecipient[i];

        nullifierHasher[i] = NullifierHash();
        nullifierHasher[i].nullifier <== inNullifier[i];
        inputNullifiers[i] === nullifierHasher[i].nullifierHash;

        treeVerifier[i] = MerkleVerifier(levels);
        treeVerifier[i].leaf <== inCommitmentHasher[i].commitment;
        treeVerifier[i].root <== root;
        for (var l = 0; l < levels; l++) {
            treeVerifier[i].pathElements[l] <== inPathElements[i][l];
            treeVerifier[i].pathIndices[l] <== inPathIndices[i][l];
        }
    }

    // 2. Verify Output Commitments
    component outCommitmentHasher[2];
    component outRangeCheck[2];
    for (var j = 0; j < 2; j++) {
        outRangeCheck[j] = RangeCheck64();
        outRangeCheck[j].in <== outAmount[j];

        outCommitmentHasher[j] = NoteCommitment();
        outCommitmentHasher[j].secret <== outSecret[j];
        outCommitmentHasher[j].nullifier <== outNullifier[j];
        outCommitmentHasher[j].amount <== outAmount[j];
        outCommitmentHasher[j].asset <== outAsset[j];
        outCommitmentHasher[j].recipient <== outRecipient[j];

        outputCommitments[j] === outCommitmentHasher[j].commitment;
    }

    // Range check fee
    component feeRangeCheck = RangeCheck64();
    feeRangeCheck.in <== fee;

    // 3. Asset Consistency Check
    inAsset[0] === inAsset[1];
    inAsset[0] === outAsset[0];
    inAsset[0] === outAsset[1];

    // 4. Value Conservation: Sum(In) === Sum(Out) + Fee
    signal totalIn;
    signal totalOut;
    totalIn <== inAmount[0] + inAmount[1];
    totalOut <== outAmount[0] + outAmount[1] + fee;
    totalIn === totalOut;

    // 5. Dummy constraint on relayer to bind public signal
    signal relayerSquare;
    relayerSquare <== relayer * relayer;
}

component main {public [root, inputNullifiers, outputCommitments, fee, relayer]} = Transaction(20);
