# Mosoo Privacy Protocol

A chain-agnostic Multi-UTXO confidential transaction protocol for EVM networks. Implements arbitrary-amount transfers using Poseidon hashing over the BN254 curve, client-side stealth addressing, and Circom 2.0 JoinSplit circuits.

---

## Overview

Public EVM chains expose all transaction amounts, sender-receiver linkages, and account balances on-chain. Existing EVM privacy solutions (such as early mixer designs) rely on fixed denominations (e.g. 0.1, 1, 10 ETH), which fragments liquidity and prevents arbitrary payment values.

Mosoo adapts a Multi-UTXO model on top of the EVM account state. Shielded balances exist as unspent note commitments within an incremental Poseidon Merkle tree. Users can join multiple notes and split them into recipient and change outputs, satisfying:

$$\sum \text{Inputs} = \sum \text{Outputs} + \text{Fee}$$

---

## System Architecture

```
[ Depositor ] ──(shield)──> [ MosooPrivacyPool.sol ] ──> [ Merkle Tree (Depth 20) ]
                                                                 │
                                                                 ▼
[ Recipient ] <──(scan & decrypt)── [ Calldata Memo ] <── [ JoinSplit Tx ]
      │
      └──(unshield)──> [ Fresh Address ] (Nullifier marked spent on-chain)
```

### 1. Dual-Key Stealth Identifiers

Each user derives two keypairs from entropy:
- **Spending Key ($sk_{spend}$):** Controls UTXO spending and generates nullifier preimages.
- **Viewing Key ($sk_{view}$):** Decrypts incoming encrypted calldata memos.
- **Public Viewing Key ($pk_{view}$):** Compressed 33-byte secp256k1 public key encoded into stealth address format (`0msk1...`).

### 2. Note Commitments and Nullifiers

Shielded notes are represented as Pedersen/Poseidon commitments on BN254:

$$\text{Commitment} = \text{Poseidon}_4(\text{secret}, \text{nullifier}, \text{amount}, \text{recipientHash})$$

$$\text{NullifierHash} = \text{Poseidon}_2(\text{nullifier}, 0)$$

- `secret`: 248-bit blinding factor known only to note owner.
- `nullifier`: 248-bit unique value revealed upon spending.
- The contract records spent nullifier hashes in `mapping(bytes32 => bool) public nullifierHashes`. Any attempt to replay a spent nullifier reverts.

### 3. Merkle Tree Design

- **Tree Depth:** 20 levels ($2^{20} = 1,048,576$ maximum leaves).
- **Hasher:** Poseidon ($t=3$ for binary tree node hashing).
- **History Cache:** 64 historical roots stored in a ring buffer to allow proofs against recent roots during network latency or concurrent transactions.

### 4. JoinSplit 2-in 2-out Engine

A JoinSplit transaction consumes up to 2 input UTXOs and produces up to 2 output UTXOs (recipient note + change note). The circuit asserts:
- Both input commitments exist in the Merkle tree at a valid root.
- The nullifiers correspond to the input commitments.
- Value conservation holds:
  $$\text{inAmount}_0 + \text{inAmount}_1 == \text{outAmount}_0 + \text{outAmount}_1 + \text{fee}$$
- All amounts fit within $2^{64} - 1$ to prevent field overflow wrapping.

### 5. Encrypted Calldata Memos

Recipients discover notes by scanning on-chain event logs:
1. Sender generates an ephemeral secp256k1 keypair $(sk_{eph}, pk_{eph})$.
2. Sender computes ECDH shared secret $S = sk_{eph} \times pk_{view, recipient}$.
3. Payload is encrypted with AES-256-GCM using derived key $K = \text{keccak256}(S)$.
4. Calldata format: $[pk_{eph} \text{ (33B)}] + [\text{IV (12B)}] + [\text{Tag (16B)}] + [\text{Ciphertext}]$.
5. The recipient reconstructs notes by scanning log memos with their viewing key. Non-recipients cannot decrypt or link the notes.

---

## Repository Layout

```text
├── contracts/
│   ├── MosooPrivacyPool.sol       # Core pool (shield, unshield, transact, transact2to2)
│   ├── MerkleTreeWithHistory.sol  # 20-depth Poseidon tree with 64-root buffer
│   ├── MockERC20.sol              # Standard ERC-20 token for multi-asset testing
│   └── circuits/
│       └── transaction.circom     # Circom 2.0 2-to-2 JoinSplit circuit
├── lib/
│   ├── crypto.js                  # Poseidon-BN254, key derivation, and ECDH memo engine
│   └── merkle_tree.js             # Incremental Merkle tree reference implementation
├── test/
│   └── protocol.test.js           # Protocol specification test suite (node:test)
├── package.json
├── LICENSE
└── README.md
```

---

## Development and Testing

### Prerequisites
- Node.js v18.0.0 or higher
- npm v9.0.0 or higher

### Install Dependencies

```bash
git clone https://github.com/mosoo-xyz/mosoo-privacy-protocol.git
cd mosoo-privacy-protocol
npm install
```

### Run Specification Tests

The test suite validates key derivation, note commitment bounds on BN254, 20-depth tree proofs, JoinSplit balance conservation, ECDH memo encryption/decryption, and double-spend rejection:

```bash
npm test
```

Test runner uses Node.js native `node:test` and `node:assert/strict`.

---

## Smart Contract Details

- **Chain Agnostic:** Dynamically queries `block.chainid` at deployment (`uint256 public immutable CHAIN_ID`), allowing direct deployment across Ethereum, Arbitrum, Base, Optimism, Polygon, or other EVM environments.
- **Reentrancy Protection:** All external state transitions enforce non-reentrancy guards.
- **State Ordering (CEI):** Nullifiers are marked spent prior to token or ether dispatches.
- **Scalar Field Validation:** Deposits and commitments verify $\text{commitment} < p$ where $p = 21888242871839275222246405745257275088548364400416034343698204186575808495617$.

---

## Research Status and Limitations

This codebase represents an experimental research prototype:
- **Circuits:** The Circom implementation in `contracts/circuits/` defines the structural constraint requirements for 2-in 2-out verification. Production deployment requires full compilation via snarkjs/rapidsnark and generating Groth16 verification keys.
- **Trusted Setup:** A multi-party trusted setup ceremony (Powers of Tau + phase 2 circuit ceremony) is required before on-chain verifier deployment.
- **Gas Costs:** Incremental Poseidon insertion on-chain requires approximately 180,000–220,000 gas per leaf depending on tree depth and batching optimizations.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
