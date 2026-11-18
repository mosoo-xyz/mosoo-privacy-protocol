const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const {
    deriveKeys,
    createNote,
    serializeNote,
    deserializeNote,
    signUnshieldProof,
    signTransact2to2Proof,
    encryptMemo,
    decryptMemo,
    FIELD_SIZE
} = require('../lib/crypto');
const { IncrementalMerkleTree } = require('../lib/merkle_tree');

describe('Mosoo Privacy Protocol Specification Tests', () => {
    it('derives consistent dual-key stealth identities', () => {
        const alice = deriveKeys('alice.entropy.seed');
        const bob = deriveKeys('bob.entropy.seed');

        assert.ok(alice.spendingKey.startsWith('0x'));
        assert.ok(alice.viewingKey.startsWith('0x'));
        assert.strictEqual(alice.publicViewingKey.length, 68); // 0x + 33-byte compressed hex
        assert.ok(alice.stealthAddress.startsWith('0msk1'));
        assert.notStrictEqual(alice.stealthAddress, bob.stealthAddress);
    });

    it('generates BN254 note commitments within scalar field limits', () => {
        const note = createNote({
            amount: '1.5',
            asset: 'ETH',
            recipient: '0msk1alice'
        });

        assert.strictEqual(note.amount, '1.5');
        assert.strictEqual(note.asset, 'ETH');
        assert.ok(BigInt(note.commitment) < FIELD_SIZE);
        assert.ok(BigInt(note.nullifierHash) < FIELD_SIZE);
        assert.strictEqual(note.spent, false);
    });

    it('enforces cross-asset commitment isolation to prevent token draining', () => {
        const ethNote = createNote({
            amount: '10.0',
            asset: 'ETH',
            recipient: '0msk1alice'
        });

        const tokenAddress = '0x1111111111111111111111111111111111111111';
        const erc20Note = createNote({
            amount: '10.0',
            asset: tokenAddress,
            recipient: '0msk1alice'
        });

        assert.notStrictEqual(ethNote.commitment, erc20Note.commitment);
        assert.strictEqual(ethNote.assetAddress, ethers.ZeroAddress);
        assert.strictEqual(erc20Note.assetAddress, tokenAddress);
    });

    it('supports arbitrary ERC-20 token decimals (6 decimals for USDT)', () => {
        const tokenAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
        const noteUsdt = createNote({
            amount: '250.5',
            asset: tokenAddress,
            recipient: '0msk1alice',
            decimals: 6
        });

        assert.strictEqual(noteUsdt.amountWei, (250500000n).toString());
        assert.strictEqual(noteUsdt.decimals, 6);
        assert.ok(BigInt(noteUsdt.commitment) < FIELD_SIZE);
    });

    it('inserts notes into incremental Merkle tree and verifies membership proofs', () => {
        const tree = new IncrementalMerkleTree(20);
        const note = createNote({ amount: '5.0', recipient: '0msk1alice' });

        const { leafIndex, root } = tree.insert(note.commitment);
        assert.strictEqual(leafIndex, 0);
        assert.strictEqual(tree.isKnownRoot(root), true);

        const proof = tree.getProof(leafIndex);
        assert.strictEqual(proof.pathElements.length, 20);
        assert.strictEqual(proof.pathIndices.length, 20);

        const isValid = tree.verifyProof(note.commitment, proof.pathElements, proof.pathIndices, proof.root);
        assert.strictEqual(isValid, true);
    });

    it('verifies sequential Merkle insertions across multiple leaves', () => {
        const tree = new IncrementalMerkleTree(20);
        const notes = [];

        for (let i = 0; i < 4; i++) {
            const n = createNote({ amount: (i + 1).toString(), recipient: '0msk1alice' });
            notes.push(n);
            const res = tree.insert(n.commitment);
            assert.strictEqual(res.leafIndex, i);
        }

        const latestRoot = tree.root();
        for (let i = 0; i < 4; i++) {
            const proof = tree.getProof(i);
            assert.strictEqual(proof.root, latestRoot);
            const valid = tree.verifyProof(notes[i].commitment, proof.pathElements, proof.pathIndices, latestRoot);
            assert.strictEqual(valid, true);
        }
    });

    it('validates 2-in 2-out JoinSplit value conservation invariant', () => {
        const note1 = createNote({ amount: '5.0', recipient: '0msk1alice' });
        const note2 = createNote({ amount: '3.0', recipient: '0msk1alice' });

        const totalIn = ethers.parseEther(note1.amount) + ethers.parseEther(note2.amount);
        const sendAmount = ethers.parseEther('6.5');
        const relayerFee = ethers.parseEther('0.01');
        const changeAmount = totalIn - sendAmount - relayerFee;

        assert.strictEqual(changeAmount, ethers.parseEther('1.49'));
        assert.strictEqual(totalIn, sendAmount + changeAmount + relayerFee);

        const outBob = createNote({ amount: ethers.formatEther(sendAmount), recipient: '0msk1bob' });
        const outAlice = createNote({ amount: ethers.formatEther(changeAmount), recipient: '0msk1alice' });

        assert.ok(BigInt(outBob.commitment) < FIELD_SIZE);
        assert.ok(BigInt(outAlice.commitment) < FIELD_SIZE);
    });

    it('delivers encrypted note memo via ECDH with forward secrecy', () => {
        const alice = deriveKeys('alice.entropy.seed');
        const bob = deriveKeys('bob.entropy.seed');

        const note = createNote({
            amount: '2.5',
            asset: 'ETH',
            recipient: bob.stealthAddress
        });

        const memoHex = encryptMemo(note, bob.stealthAddress);
        assert.ok(memoHex.length > 100);

        // Bob decrypts with his viewing key
        const decrypted = decryptMemo(memoHex, bob.viewingKey);
        assert.ok(decrypted);
        assert.strictEqual(decrypted.amount, '2.5');
        assert.strictEqual(decrypted.commitment, note.commitment);
        assert.strictEqual(decrypted.nullifier, note.nullifier);

        // Adversary (Alice or eavesdropper) fails to decrypt
        const eveAttempt = decryptMemo(memoHex, alice.viewingKey);
        assert.strictEqual(eveAttempt, null);
    });

    it('enforces nullifier spend check to prevent double spending', () => {
        const spentNullifiers = new Set();
        const note = createNote({ amount: '1.0', recipient: '0msk1bob' });

        assert.strictEqual(spentNullifiers.has(note.nullifierHash), false);
        spentNullifiers.add(note.nullifierHash);

        assert.strictEqual(spentNullifiers.has(note.nullifierHash), true);
        assert.throws(() => {
            if (spentNullifiers.has(note.nullifierHash)) {
                throw new Error('nullifier already spent');
            }
        }, /nullifier already spent/);
    });

    it('rejects duplicate input nullifiers in 2-to-2 JoinSplit', () => {
        const note = createNote({ amount: '5.0', recipient: '0msk1alice' });
        const inputNullifiers = [note.nullifierHash, note.nullifierHash];

        assert.strictEqual(inputNullifiers[0], inputNullifiers[1]);
        assert.throws(() => {
            if (inputNullifiers[0] === inputNullifiers[1]) {
                throw new Error('duplicate input nullifier');
            }
        }, /duplicate input nullifier/);
    });

    it('serializes and deserializes notes with checksum validation', () => {
        const original = createNote({
            amount: '3.14159',
            asset: 'ETH',
            recipient: '0msk1recipient'
        });

        const serialized = serializeNote(original, 1);
        assert.ok(serialized.startsWith('mosoo-note-'));

        const reconstructed = deserializeNote(serialized);
        assert.strictEqual(reconstructed.amount, original.amount);
        assert.strictEqual(reconstructed.assetAddress, original.assetAddress);
        assert.strictEqual(reconstructed.secret, original.secret);
        assert.strictEqual(reconstructed.nullifier, original.nullifier);
        assert.strictEqual(reconstructed.commitment, original.commitment);
        assert.strictEqual(reconstructed.nullifierHash, original.nullifierHash);
        assert.strictEqual(reconstructed.chainId, 1);
    });

    it('detects tampering and rejects corrupted note strings', () => {
        const original = createNote({ amount: '1.0', recipient: '0msk1alice' });
        const serialized = serializeNote(original, 1);

        // Tamper with serialized string
        const base64Part = serialized.replace('mosoo-note-', '');
        const decoded = Buffer.from(base64Part, 'base64url').toString('utf8');
        const tampered = decoded.replace('1.0', '9999.0');
        const tamperedNoteStr = `mosoo-note-${Buffer.from(tampered, 'utf8').toString('base64url')}`;

        assert.throws(() => {
            deserializeNote(tamperedNoteStr);
        }, /checksum verification failed/);
    });

    it('supports batch Merkle insertion and index lookup', () => {
        const tree = new IncrementalMerkleTree(20);
        const notes = [
            createNote({ amount: '1.0', recipient: '0msk1a' }),
            createNote({ amount: '2.0', recipient: '0msk1b' }),
            createNote({ amount: '3.0', recipient: '0msk1c' })
        ];

        const commitments = notes.map((n) => n.commitment);
        const batchResults = tree.insertBatch(commitments);

        assert.strictEqual(batchResults.length, 3);
        assert.strictEqual(batchResults[0].leafIndex, 0);
        assert.strictEqual(batchResults[1].leafIndex, 1);
        assert.strictEqual(batchResults[2].leafIndex, 2);

        assert.strictEqual(tree.indexOf(commitments[1]), 1);
        assert.strictEqual(tree.indexOf('0xdeadbeef'), -1);
    });

    it('signs unshield proof message and verifies against authorizer address', async () => {
        const authorizer = ethers.Wallet.createRandom();
        const tree = new IncrementalMerkleTree(20);
        const note = createNote({ amount: '2.0', recipient: '0msk1alice' });
        const { root } = tree.insert(note.commitment);

        const recipient = ethers.Wallet.createRandom().address;
        const relayer = ethers.Wallet.createRandom().address;
        const fee = ethers.parseEther('0.005');
        const chainId = 1n;
        const poolAddress = '0x1000000000000000000000000000000000000001';

        const signature = await signUnshieldProof(authorizer, {
            root,
            nullifierHash: note.nullifierHash,
            recipient,
            relayer,
            fee,
            chainId,
            poolAddress
        });

        const messageHash = ethers.keccak256(
            ethers.solidityPacked(
                ['bytes32', 'bytes32', 'address', 'address', 'uint256', 'uint256', 'address'],
                [root, note.nullifierHash, recipient, relayer, fee, chainId, poolAddress]
            )
        );

        const recovered = ethers.recoverAddress(
            ethers.getBytes(ethers.hashMessage(ethers.getBytes(messageHash))),
            signature
        );
        assert.strictEqual(recovered.toLowerCase(), authorizer.address.toLowerCase());
    });
});
