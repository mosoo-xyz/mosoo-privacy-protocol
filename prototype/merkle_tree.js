/**
 * Mosoo Privacy Protocol - Incremental Poseidon Merkle Tree (Depth 20)
 * Exact in-memory equivalent of MerkleTreeWithHistory.sol
 */

const { ethers } = require('ethers');
const { poseidon2 } = require('poseidon-lite');
const { FIELD_SIZE } = require('./crypto');

const TREE_DEPTH = 20;
const ROOT_HISTORY_SIZE = 64;

class IncrementalMerkleTree {
    constructor() {
        this.depth = TREE_DEPTH;
        this.nextIndex = 0;
        this.zeros = new Array(TREE_DEPTH);
        this.filledSubtrees = new Array(TREE_DEPTH);
        this.roots = new Array(ROOT_HISTORY_SIZE);
        this.currentRootIndex = 0;
        this.leaves = [];

        // Initialize zero values exactly as in MerkleTreeWithHistory.sol
        const seedZero = BigInt(ethers.keccak256(ethers.toUtf8Bytes("mosoo.zero.leaf"))) % FIELD_SIZE;
        let currentZero = seedZero;
        this.zeros[0] = ethers.toBeHex(currentZero, 32);
        this.filledSubtrees[0] = this.zeros[0];

        for (let i = 1; i < TREE_DEPTH; i++) {
            const h = poseidon2([currentZero, currentZero]);
            currentZero = h;
            this.zeros[i] = ethers.toBeHex(currentZero, 32);
            this.filledSubtrees[i] = this.zeros[i];
        }

        const initialRoot = poseidon2([currentZero, currentZero]);
        this.roots[0] = ethers.toBeHex(initialRoot, 32);
    }

    hashLeftRight(leftHex, rightHex) {
        const leftBn = BigInt(leftHex) % FIELD_SIZE;
        const rightBn = BigInt(rightHex) % FIELD_SIZE;
        const out = poseidon2([leftBn, rightBn]);
        return ethers.toBeHex(out, 32);
    }

    insert(leafHex) {
        if (this.nextIndex >= 2 ** this.depth) {
            throw new Error("Merkle tree is full");
        }

        const leafIndex = this.nextIndex;
        this.leaves.push(leafHex);

        let currentIndex = leafIndex;
        let currentLevelHash = leafHex;

        for (let i = 0; i < this.depth; i++) {
            let left, right;
            if (currentIndex % 2 === 0) {
                left = currentLevelHash;
                right = this.zeros[i];
                this.filledSubtrees[i] = currentLevelHash;
            } else {
                left = this.filledSubtrees[i];
                right = currentLevelHash;
            }

            currentLevelHash = this.hashLeftRight(left, right);
            currentIndex = Math.floor(currentIndex / 2);
        }

        this.currentRootIndex = (this.currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        this.roots[this.currentRootIndex] = currentLevelHash;
        this.nextIndex++;

        return {
            leafIndex,
            leaf: leafHex,
            root: currentLevelHash
        };
    }

    getCurrentRoot() {
        return this.roots[this.currentRootIndex];
    }

    isKnownRoot(rootHex) {
        return this.roots.includes(rootHex);
    }

    /**
     * Compute Merkle Proof for any leaf index
     * Returns: { pathElements, pathIndices, root }
     */
    getProof(leafIndex) {
        if (leafIndex >= this.nextIndex) {
            throw new Error(`Leaf index ${leafIndex} does not exist`);
        }

        const pathElements = [];
        const pathIndices = [];

        // Build level nodes
        let currentLevel = [...this.leaves];
        // Pad current level to even
        const totalLeavesInTree = 2 ** this.depth;

        let index = leafIndex;
        for (let level = 0; level < this.depth; level++) {
            const isRightNode = index % 2 === 1;
            const siblingIndex = isRightNode ? index - 1 : index + 1;

            pathIndices.push(isRightNode ? 1 : 0);

            let sibling;
            if (siblingIndex < currentLevel.length) {
                sibling = currentLevel[siblingIndex];
            } else {
                sibling = this.zeros[level];
            }
            pathElements.push(sibling);

            // Compute next level
            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = (i + 1 < currentLevel.length) ? currentLevel[i + 1] : this.zeros[level];
                nextLevel.push(this.hashLeftRight(left, right));
            }
            currentLevel = nextLevel;
            index = Math.floor(index / 2);
        }

        return {
            pathElements,
            pathIndices,
            root: this.getCurrentRoot()
        };
    }

    /**
     * Verify a Merkle Proof locally
     */
    verifyProof(leafHex, pathElements, pathIndices, expectedRoot) {
        let current = leafHex;
        for (let i = 0; i < this.depth; i++) {
            const isRight = pathIndices[i] === 1;
            const sibling = pathElements[i];
            if (isRight) {
                current = this.hashLeftRight(sibling, current);
            } else {
                current = this.hashLeftRight(current, sibling);
            }
        }
        return current.toLowerCase() === expectedRoot.toLowerCase();
    }
}

module.exports = { IncrementalMerkleTree, TREE_DEPTH };
