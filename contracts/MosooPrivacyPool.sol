// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MerkleTreeWithHistory.sol";

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[6] memory input
    ) external view returns (bool);
}

/**
 * @title MosooPrivacyPool
 * @notice Multi-UTXO privacy pool with incremental Poseidon Merkle tree
 */
contract MosooPrivacyPool is MerkleTreeWithHistory {
    string public constant NAME = "Mosoo Privacy Pool";
    string public constant VERSION = "0.1.0";
    uint256 public immutable CHAIN_ID;

    address public owner;
    bool public paused;
    address public proofAuthorizer;
    address public verifier;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    mapping(bytes32 => bool) public nullifierHashes;
    mapping(address => uint256) public tokenPoolBalances;

    uint256 public totalShieldedVolume;
    uint256 public totalUnshieldedVolume;
    uint256 public totalTransactionsCount;

    event Shield(
        bytes32 indexed commitment,
        uint32 indexed leafIndex,
        uint256 amount,
        address indexed depositor,
        bytes encryptedMemo,
        uint256 timestamp
    );

    event ShieldToken(
        address indexed token,
        bytes32 indexed commitment,
        uint32 leafIndex,
        uint256 amount,
        address indexed depositor,
        bytes encryptedMemo,
        uint256 timestamp
    );

    event Unshield(
        address indexed recipient,
        bytes32 indexed nullifierHash,
        address indexed relayer,
        uint256 fee,
        uint256 amount,
        uint256 timestamp
    );

    event UnshieldMulti(
        address indexed recipient,
        bytes32[] inputNullifiers,
        address indexed relayer,
        uint256 fee,
        uint256 amount,
        uint256 timestamp
    );

    event UnshieldToken(
        address indexed token,
        address indexed recipient,
        bytes32 indexed nullifierHash,
        address relayer,
        uint256 fee,
        uint256 amount,
        uint256 timestamp
    );

    event Transact(
        bytes32 indexed nullifierHash,
        bytes32 indexed newCommitment,
        uint32 indexed newLeafIndex,
        address relayer,
        uint256 fee,
        bytes encryptedMemo,
        uint256 timestamp
    );

    event Transact2to2(
        bytes32[2] inputNullifiers,
        bytes32[2] outputCommitments,
        uint32[2] newLeafIndices,
        address relayer,
        uint256 fee,
        bytes encryptedMemo,
        uint256 timestamp
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProofAuthorizerUpdated(address indexed previousAuthorizer, address indexed newAuthorizer);
    event VerifierUpdated(address indexed previousVerifier, address indexed newVerifier);

    modifier onlyOwner() {
        require(msg.sender == owner, "Mosoo: caller is not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Mosoo: contract is paused");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "Mosoo: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address _poseidon, address _proofAuthorizer) MerkleTreeWithHistory(_poseidon) {
        require(_proofAuthorizer != address(0), "Mosoo: authorizer is zero address");
        owner = msg.sender;
        proofAuthorizer = _proofAuthorizer;
        CHAIN_ID = block.chainid;
        _status = _NOT_ENTERED;
    }

    // Deposit functions

    function shield(bytes32 commitment) external payable returns (uint32 leafIndex) {
        return shieldWithMemo(commitment, "");
    }

    function shieldWithMemo(bytes32 commitment, bytes memory encryptedMemo) public payable whenNotPaused nonReentrant returns (uint32 leafIndex) {
        require(msg.value > 0, "Mosoo: deposit amount must be greater than 0");
        require(uint256(commitment) < FIELD_SIZE, "Mosoo: commitment outside field");

        leafIndex = _insert(commitment);
        totalShieldedVolume += msg.value;
        tokenPoolBalances[address(0)] += msg.value;
        totalTransactionsCount++;

        emit Shield(commitment, leafIndex, msg.value, msg.sender, encryptedMemo, block.timestamp);
        return leafIndex;
    }

    function shieldToken(
        address token,
        uint256 amount,
        bytes32 commitment,
        bytes calldata encryptedMemo
    ) external whenNotPaused nonReentrant returns (uint32 leafIndex) {
        require(token != address(0), "Mosoo: token is zero address");
        require(amount > 0, "Mosoo: deposit amount must be greater than 0");
        require(uint256(commitment) < FIELD_SIZE, "Mosoo: commitment outside field");

        // Pull tokens from user
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "Mosoo: token transfer failed");

        leafIndex = _insert(commitment);
        tokenPoolBalances[token] += amount;
        totalTransactionsCount++;

        emit ShieldToken(token, commitment, leafIndex, amount, msg.sender, encryptedMemo, block.timestamp);
        return leafIndex;
    }

    // Withdrawal functions

    function unshield(
        bytes32 root,
        bytes32 nullifierHash,
        address payable recipient,
        address payable relayer,
        uint256 fee,
        uint256 amount,
        bytes calldata proof
    ) external whenNotPaused nonReentrant {
        require(recipient != address(0), "Mosoo: recipient is zero address");
        require(fee <= amount, "Mosoo: fee exceeds amount");
        require(!nullifierHashes[nullifierHash], "Mosoo: note has already been spent");
        require(isKnownRoot(root), "Mosoo: unknown or expired Merkle root");
        require(address(this).balance >= amount, "Mosoo: insufficient pool liquidity");

        require(verifyProof(root, nullifierHash, amount, recipient, relayer, fee, proof), "Mosoo: invalid or unauthorized proof");

        nullifierHashes[nullifierHash] = true;
        totalUnshieldedVolume += amount;
        tokenPoolBalances[address(0)] -= amount;
        totalTransactionsCount++;

        uint256 recipientAmount = amount - fee;
        (bool successRecipient, ) = recipient.call{value: recipientAmount}("");
        require(successRecipient, "Mosoo: payment to recipient failed");

        if (fee > 0 && relayer != address(0)) {
            (bool successRelayer, ) = relayer.call{value: fee}("");
            require(successRelayer, "Mosoo: payment to relayer failed");
        }

        emit Unshield(recipient, nullifierHash, relayer, fee, amount, block.timestamp);
    }

    function unshieldMulti(
        bytes32 root,
        bytes32[] calldata inputNullifiers,
        address payable recipient,
        address payable relayer,
        uint256 fee,
        uint256 amount,
        bytes calldata proof
    ) external whenNotPaused nonReentrant {
        require(recipient != address(0), "Mosoo: recipient is zero address");
        require(fee <= amount, "Mosoo: fee exceeds amount");
        require(inputNullifiers.length > 0 && inputNullifiers.length <= 8, "Mosoo: invalid nullifiers count");
        require(isKnownRoot(root), "Mosoo: unknown or expired Merkle root");
        require(address(this).balance >= amount, "Mosoo: insufficient pool liquidity");

        bytes32 nullifiersBatchHash = keccak256(abi.encodePacked(inputNullifiers));
        require(verifyProof(root, nullifiersBatchHash, amount, recipient, relayer, fee, proof), "Mosoo: invalid multi-unshield proof");

        for (uint256 i = 0; i < inputNullifiers.length; i++) {
            bytes32 nHash = inputNullifiers[i];
            require(nHash != bytes32(0), "Mosoo: zero nullifier");
            require(!nullifierHashes[nHash], "Mosoo: note in batch already spent");
            nullifierHashes[nHash] = true;
        }

        totalUnshieldedVolume += amount;
        tokenPoolBalances[address(0)] -= amount;
        totalTransactionsCount++;

        uint256 recipientAmount = amount - fee;
        (bool successRecipient, ) = recipient.call{value: recipientAmount}("");
        require(successRecipient, "Mosoo: payment to recipient failed");

        if (fee > 0 && relayer != address(0)) {
            (bool successRelayer, ) = relayer.call{value: fee}("");
            require(successRelayer, "Mosoo: payment to relayer failed");
        }

        emit UnshieldMulti(recipient, inputNullifiers, relayer, fee, amount, block.timestamp);
    }

    function unshieldToken(
        address token,
        bytes32 root,
        bytes32 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee,
        uint256 amount,
        bytes calldata proof
    ) external whenNotPaused nonReentrant {
        require(token != address(0), "Mosoo: token is zero address");
        require(recipient != address(0), "Mosoo: recipient is zero address");
        require(fee <= amount, "Mosoo: fee exceeds amount");
        require(!nullifierHashes[nullifierHash], "Mosoo: note has already been spent");
        require(isKnownRoot(root), "Mosoo: unknown or expired Merkle root");
        require(tokenPoolBalances[token] >= amount, "Mosoo: insufficient token pool liquidity");

        require(verifyProof(root, nullifierHash, amount, recipient, relayer, fee, proof), "Mosoo: invalid proof");

        nullifierHashes[nullifierHash] = true;
        tokenPoolBalances[token] -= amount;
        totalTransactionsCount++;

        uint256 recipientAmount = amount - fee;
        require(IERC20(token).transfer(recipient, recipientAmount), "Mosoo: token transfer to recipient failed");

        if (fee > 0 && relayer != address(0)) {
            require(IERC20(token).transfer(relayer, fee), "Mosoo: token fee transfer to relayer failed");
        }

        emit UnshieldToken(token, recipient, nullifierHash, relayer, fee, amount, block.timestamp);
    }

    // Confidential transfers

    function transact(
        bytes32 root,
        bytes32 nullifierHash,
        bytes32 newCommitment,
        address payable relayer,
        uint256 fee,
        bytes calldata proof
    ) external payable returns (uint32) {
        return transactWithMemo(root, nullifierHash, newCommitment, relayer, fee, "", proof);
    }

    function transactWithMemo(
        bytes32 root,
        bytes32 nullifierHash,
        bytes32 newCommitment,
        address payable relayer,
        uint256 fee,
        bytes memory encryptedMemo,
        bytes calldata proof
    ) public payable whenNotPaused nonReentrant returns (uint32 newLeafIndex) {
        require(!nullifierHashes[nullifierHash], "Mosoo: note has already been spent");
        require(isKnownRoot(root), "Mosoo: unknown or expired Merkle root");
        require(uint256(newCommitment) < FIELD_SIZE, "Mosoo: new commitment outside field");

        require(verifyTransactProof(root, nullifierHash, newCommitment, relayer, fee, proof), "Mosoo: invalid transact proof");

        nullifierHashes[nullifierHash] = true;
        newLeafIndex = _insert(newCommitment);
        totalTransactionsCount++;

        if (fee > 0 && relayer != address(0)) {
            require(msg.value >= fee, "Mosoo: transact fee must be attached via msg.value");
            (bool successRelayer, ) = relayer.call{value: fee}("");
            require(successRelayer, "Mosoo: payment to relayer failed");
        }

        emit Transact(nullifierHash, newCommitment, newLeafIndex, relayer, fee, encryptedMemo, block.timestamp);
        return newLeafIndex;
    }

    /**
     * @notice JoinSplit 2-to-2 Multi-UTXO Private Transfer
     * @dev Joins up to 2 input notes and splits into up to 2 output notes (payment + change)
     */
    function transact2to2(
        bytes32 root,
        bytes32[2] calldata inputNullifiers,
        bytes32[2] calldata outputCommitments,
        address payable relayer,
        uint256 fee,
        bytes calldata encryptedMemo,
        bytes calldata proof
    ) external payable whenNotPaused nonReentrant returns (uint32[2] memory newLeafIndices) {
        require(isKnownRoot(root), "Mosoo: unknown or expired Merkle root");

        // Verify Authorizer / SNARK proof
        bytes32 inputsHash = keccak256(abi.encodePacked(inputNullifiers[0], inputNullifiers[1], outputCommitments[0], outputCommitments[1]));
        require(verifyTransactProof(root, inputsHash, outputCommitments[0], relayer, fee, proof), "Mosoo: invalid 2-to-2 proof");

        // 1. Spend input nullifiers (prevent double-spend)
        for (uint256 i = 0; i < 2; i++) {
            bytes32 nHash = inputNullifiers[i];
            if (nHash != bytes32(0)) {
                require(!nullifierHashes[nHash], "Mosoo: input nullifier already spent");
                nullifierHashes[nHash] = true;
            }
        }

        // 2. Insert output commitments (Recipient note + Change note)
        for (uint256 j = 0; j < 2; j++) {
            bytes32 com = outputCommitments[j];
            if (com != bytes32(0)) {
                require(uint256(com) < FIELD_SIZE, "Mosoo: output commitment outside field");
                newLeafIndices[j] = _insert(com);
            }
        }

        totalTransactionsCount++;

        // 3. Handle fee
        if (fee > 0 && relayer != address(0)) {
            require(msg.value >= fee, "Mosoo: fee must be attached");
            (bool successRelayer, ) = relayer.call{value: fee}("");
            require(successRelayer, "Mosoo: payment to relayer failed");
        }

        emit Transact2to2(inputNullifiers, outputCommitments, newLeafIndices, relayer, fee, encryptedMemo, block.timestamp);
        return newLeafIndices;
    }

    // Verification logic

    function verifyProof(
        bytes32 root,
        bytes32 nullifierHash,
        uint256 amount,
        address recipient,
        address relayer,
        uint256 fee,
        bytes calldata proof
    ) public view returns (bool) {
        if (verifier != address(0)) {
            if (proof.length < 256) return false;
            (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
            uint256[6] memory inputs = [
                uint256(root),
                uint256(nullifierHash),
                amount,
                uint256(uint160(recipient)),
                uint256(uint160(relayer)),
                fee
            ];
            return IVerifier(verifier).verifyProof(a, b, c, inputs);
        }

        if (proof.length != 65) return false;

        bytes32 messageHash = keccak256(abi.encodePacked(root, nullifierHash, amount, recipient, relayer, fee, block.chainid, address(this)));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(proof.offset)
            s := calldataload(add(proof.offset, 32))
            v := byte(0, calldataload(add(proof.offset, 64)))
        }
        if (v < 27) v += 27;
        address recovered = ecrecover(ethSignedMessageHash, v, r, s);
        return recovered != address(0) && recovered == proofAuthorizer;
    }

    function verifyTransactProof(
        bytes32 root,
        bytes32 nullifierHash,
        bytes32 newCommitment,
        address relayer,
        uint256 fee,
        bytes calldata proof
    ) public view returns (bool) {
        if (proof.length != 65) return false;

        bytes32 messageHash = keccak256(abi.encodePacked(root, nullifierHash, newCommitment, relayer, fee, block.chainid, address(this)));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(proof.offset)
            s := calldataload(add(proof.offset, 32))
            v := byte(0, calldataload(add(proof.offset, 64)))
        }
        if (v < 27) v += 27;
        address recovered = ecrecover(ethSignedMessageHash, v, r, s);
        return recovered != address(0) && recovered == proofAuthorizer;
    }

    function isSpent(bytes32 nullifierHash) external view returns (bool) {
        return nullifierHashes[nullifierHash];
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function setProofAuthorizer(address _newAuthorizer) external onlyOwner {
        require(_newAuthorizer != address(0), "Mosoo: zero address authorizer");
        emit ProofAuthorizerUpdated(proofAuthorizer, _newAuthorizer);
        proofAuthorizer = _newAuthorizer;
    }

    function setVerifier(address _verifier) external onlyOwner {
        emit VerifierUpdated(verifier, _verifier);
        verifier = _verifier;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Mosoo: new owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
