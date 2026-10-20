const { ethers } = require('ethers');
const { poseidon2 } = require('poseidon-lite');
const { FIELD_SIZE } = require('./crypto');

const TREE_DEPTH = 20;
const ROOT_HISTORY_SIZE = 64;

class IncrementalMerkleTree {
    constructor(depth = TREE_DEPTH) {
        this.depth = depth;
        this.nextIndex = 0;
        this.zeros = new Array(depth);
        this.filledSubtrees = new Array(depth);
        this.roots = new Array(ROOT_HISTORY_SIZE);
        this.currentRootIndex = 0;
        this.leaves = [];

        const seedZero = BigInt(ethers.keccak256(ethers.toUtf8Bytes('mosoo.zero.leaf'))) % FIELD_SIZE;
        let currentZero = seedZero;
        this.zeros[0] = ethers.toBeHex(currentZero, 32);
        this.filledSubtrees[0] = this.zeros[0];

        for (let i = 1; i < depth; i++) {
            currentZero = poseidon2([currentZero, currentZero]);
            this.zeros[i] = ethers.toBeHex(currentZero, 32);
            this.filledSubtrees[i] = this.zeros[i];
        }

        const initialRoot = poseidon2([currentZero, currentZero]);
        this.roots[0] = ethers.toBeHex(initialRoot, 32);
    }

    hashLeftRight(leftHex, rightHex) {
        const left = BigInt(leftHex) % FIELD_SIZE;
        const right = BigInt(rightHex) % FIELD_SIZE;
        return ethers.toBeHex(poseidon2([left, right]), 32);
    }

    insert(leafHex) {
        if (this.nextIndex >= 2 ** this.depth) {
            throw new Error('tree is full');
        }

        const leafIndex = this.nextIndex;
        this.leaves.push(leafHex);

        let currentIndex = leafIndex;
        let currentHash = leafHex;

        for (let i = 0; i < this.depth; i++) {
            let left, right;
            if (currentIndex % 2 === 0) {
                left = currentHash;
                right = this.zeros[i];
                this.filledSubtrees[i] = currentHash;
            } else {
                left = this.filledSubtrees[i];
                right = currentHash;
            }

            currentHash = this.hashLeftRight(left, right);
            currentIndex = Math.floor(currentIndex / 2);
        }

        this.currentRootIndex = (this.currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        this.roots[this.currentRootIndex] = currentHash;
        this.nextIndex++;

        return {
            leafIndex,
            root: currentHash
        };
    }

    root() {
        return this.roots[this.currentRootIndex];
    }

    isKnownRoot(rootHex) {
        return this.roots.includes(rootHex);
    }

    getProof(leafIndex) {
        if (leafIndex >= this.nextIndex) {
            throw new Error(`leaf ${leafIndex} out of bounds`);
        }

        const pathElements = [];
        const pathIndices = [];

        let currentLevel = [...this.leaves];
        let index = leafIndex;

        for (let level = 0; level < this.depth; level++) {
            const isRight = index % 2 === 1;
            const siblingIndex = isRight ? index - 1 : index + 1;

            pathIndices.push(isRight ? 1 : 0);

            const sibling = siblingIndex < currentLevel.length ? currentLevel[siblingIndex] : this.zeros[level];
            pathElements.push(sibling);

            const nextLevel = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : this.zeros[level];
                nextLevel.push(this.hashLeftRight(left, right));
            }
            currentLevel = nextLevel;
            index = Math.floor(index / 2);
        }

        return {
            pathElements,
            pathIndices,
            root: this.root()
        };
    }

    verifyProof(leafHex, pathElements, pathIndices, expectedRoot) {
        let current = leafHex;
        for (let i = 0; i < this.depth; i++) {
            const isRight = pathIndices[i] === 1;
            const sibling = pathElements[i];
            current = isRight
                ? this.hashLeftRight(sibling, current)
                : this.hashLeftRight(current, sibling);
        }
        return current.toLowerCase() === expectedRoot.toLowerCase();
    }
}

module.exports = {
    IncrementalMerkleTree,
    TREE_DEPTH,
    ROOT_HISTORY_SIZE
};
