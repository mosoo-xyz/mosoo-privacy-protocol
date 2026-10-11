// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPoseidon {
    function poseidon(uint256[2] memory input) external pure returns (uint256);
}

/**
 * @title MerkleTreeWithHistory
 * @dev Incremental Poseidon-BN254 Merkle Tree with historical roots cache for Mosoo Privacy Protocol
 */
contract MerkleTreeWithHistory {
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public constant TREE_DEPTH = 20;
    uint32 public constant ROOT_HISTORY_SIZE = 64;

    address public immutable poseidonContract;

    uint32 public nextIndex = 0;
    bytes32[TREE_DEPTH] public filledSubtrees;
    bytes32[ROOT_HISTORY_SIZE] public roots;
    uint32 public currentRootIndex = 0;

    bytes32[TREE_DEPTH] public zeros;

    event LeafInserted(bytes32 indexed commitment, uint32 indexed leafIndex, bytes32 root);

    constructor(address _poseidon) {
        require(_poseidon != address(0), "Mosoo: invalid Poseidon contract address");
        poseidonContract = _poseidon;

        // Initialize zero values for the tree levels using Poseidon
        bytes32 currentZero = bytes32(uint256(keccak256("mosoo.zero.leaf")) % FIELD_SIZE);
        zeros[0] = currentZero;
        filledSubtrees[0] = currentZero;

        for (uint32 i = 1; i < TREE_DEPTH; i++) {
            currentZero = hashLeftRight(currentZero, currentZero);
            zeros[i] = currentZero;
            filledSubtrees[i] = currentZero;
        }

        bytes32 initialRoot = hashLeftRight(currentZero, currentZero);
        roots[0] = initialRoot;
    }

    function hashLeftRight(bytes32 left, bytes32 right) public view returns (bytes32) {
        require(uint256(left) < FIELD_SIZE, "Left element outside field");
        require(uint256(right) < FIELD_SIZE, "Right element outside field");
        uint256[2] memory inputs = [uint256(left), uint256(right)];
        return bytes32(IPoseidon(poseidonContract).poseidon(inputs));
    }

    function _insert(bytes32 leaf) internal returns (uint32 index) {
        uint32 currentIndex = nextIndex;
        require(currentIndex < uint32(2) ** TREE_DEPTH, "Merkle tree is full");

        bytes32 currentLevelHash = leaf;
        bytes32 left;
        bytes32 right;

        for (uint32 i = 0; i < TREE_DEPTH; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(left, right);
            currentIndex /= 2;
        }

        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = currentLevelHash;
        index = nextIndex;
        nextIndex++;

        emit LeafInserted(leaf, index, currentLevelHash);
        return index;
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        for (uint32 i = 0; i < ROOT_HISTORY_SIZE; i++) {
            if (roots[i] == root) {
                return true;
            }
        }
        return false;
    }

    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }
}
