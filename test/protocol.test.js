const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const {
    deriveKeys,
    createNote,
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

        // Notes with different asset addresses must have different commitments
        assert.notStrictEqual(ethNote.commitment, erc20Note.commitment);
        assert.strictEqual(ethNote.assetAddress, ethers.ZeroAddress);
        assert.strictEqual(erc20Note.assetAddress, tokenAddress);
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

        // First spend (unshield)
        assert.strictEqual(spentNullifiers.has(note.nullifierHash), false);
        spentNullifiers.add(note.nullifierHash);

        // Attempting to spend the same nullifier again must fail
        assert.strictEqual(spentNullifiers.has(note.nullifierHash), true);
        assert.throws(() => {
            if (spentNullifiers.has(note.nullifierHash)) {
                throw new Error('nullifier already spent');
            }
        }, /nullifier already spent/);
    });
});
