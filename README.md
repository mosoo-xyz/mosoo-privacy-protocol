# 🛡️ Mosoo Privacy Protocol

[![EVM Compatible](https://img.shields.io/badge/Architecture-EVM%20Compatible-blue.svg?style=flat-square)](contracts/MosooPrivacyPool.sol)
[![ZK Primitive: Poseidon BN254](https://img.shields.io/badge/ZK%20Primitive-Poseidon%20BN254-8b5cf6?style=flat-square)](prototype/crypto.js)
[![Circuit: Circom 2.0](https://img.shields.io/badge/Circuit-Circom%202.0%20(2--to--2)-orange?style=flat-square)](contracts/circuits/transaction.circom)
[![Prototype: Verified](https://img.shields.io/badge/Prototype-100%25%20Verified%20(npm%20test)-10b981?style=flat-square)](prototype/prototype_demo.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

> **Universal EVM Zero-Knowledge Multi-UTXO Confidential Transaction Protocol (Working Prototype).**  
> Enables arbitrary-amount confidential transfers, dual-key stealth identities, and forward-secret on-chain encrypted memos across any EVM-compatible chain.

---

## 📌 Protocol Overview

Public EVM blockchains broadcast transaction graphs, account balances, and recipient addresses in plaintext. While essential for global consensus, this transparency presents severe challenges for institutional settlements, payroll distribution, private treasury management, and MEV frontrunning resistance.

Traditional privacy pools suffer from a major limitation: they restrict users to **fixed denominations** (e.g., exactly 0.1, 1, or 10 ETH), which fragments liquidity and prevents everyday arbitrary payments.

**Mosoo Privacy Protocol** introduces a non-custodial, chain-agnostic **Multi-UTXO Zero-Knowledge Privacy Pool**:
- **Arbitrary Amount JoinSplit:** Spend multiple input notes and produce recipient + change output notes ($In_1 + In_2 = Out_1 + Out_2 + Fee$), eliminating fixed-denomination constraints.
- **Dual-Key Stealth Identities:** Users derive deterministic Spending and Viewing keys, generating stealth addresses (`0msk1...`) that break public address linkage.
- **Asymmetric Calldata Memo Delivery:** Note preimages are encrypted via **ECDH (Elliptic Curve Diffie-Hellman)** and published directly in transaction calldata, allowing recipients to discover incoming funds without trusting centralized servers.
- **Poseidon-BN254 Incremental Merkle Trees:** High-throughput on-chain cryptographic tree with a 64-slot historical root buffer to prevent frontrunning and race conditions.

---

## 📐 How It Works (Architecture & Flow)

```
[ Public EVM Wallet ]
         │
         ▼  (1) SHIELD (DEPOSIT)
┌────────────────────────────────────────────────────────┐
│               MosooPrivacyPool.sol                     │
│  - Native Gas Token (ETH) & ERC-20 Support             │
│  - Poseidon-BN254 Incremental Merkle Tree (Depth 20)  │
│  - 64-Slot Historical Merkle Roots Ring Buffer         │
└────────────────────────────────────────────────────────┘
         │
         ▼  (2) OFF-CHAIN SHIELDED STATE TRANSITION
┌────────────────────────────────────────────────────────┐
│            Confidential Multi-UTXO Engine              │
│  - Client generates 2-in 2-out JoinSplit proof         │
│  - Nullifier 1 & 2 generated to mark notes spent       │
│  - Note A (Payment to Bob) + Note B (Alice Change)     │
│  - Value Invariant: Σ Inputs == Σ Outputs + Fee        │
└────────────────────────────────────────────────────────┘
         │
         ▼  (3) ENCRYPTED CALLDATA DELIVERY
┌────────────────────────────────────────────────────────┐
│            Forward-Secret ECDH Calldata Memo           │
│  - Sender derives shared secret with Bob's Viewing PubKey
│  - AES-256-GCM encrypts note ciphertext into tx memo   │
│  - Bob scans blockchain logs & decrypts note privately │
└────────────────────────────────────────────────────────┘
         │
         ▼  (4) UNSHIELD (CONFIDENTIAL WITHDRAWAL)
┌────────────────────────────────────────────────────────┐
│            Clean Recipient Public EVM Address          │
│  - On-chain nullifier registration prevents replay     │
│  - Zero address linkage between depositor and recipient│
└────────────────────────────────────────────────────────┘
```

---

## 🔑 Technical Specification

### 1. Dual-Key Stealth Derivation
From an initial entropy seed (or Web3 wallet signature), Mosoo derives two cryptographically isolated keypairs:
- **Spending Key ($sk_{spend}$):** Authorizes spending of UTXO commitments and generates nullifier preimages.
- **Viewing Key ($sk_{view}$):** Used exclusively to decrypt incoming transactions without granting authority to spend.
- **Public Viewing Key ($pk_{view}$):** Compressed 33-byte secp256k1 public key used by senders to encrypt note preimages.
- **Stealth Identifier (`0msk1...`):** Self-contained identifier containing the encoded public viewing key.

### 2. Note Commitment & Nullifier Hashes
Notes are modeled as UTXOs committed to an on-chain binary Merkle tree over the BN254 scalar field:

$$\text{Commitment} = \text{Poseidon}_4(\text{secret}, \text{nullifier}, \text{amount}, \text{recipientHash})$$

$$\text{NullifierHash} = \text{Poseidon}_2(\text{nullifier}, 0)$$

- `secret`: 248-bit cryptographically secure random value known only to the note owner.
- `nullifier`: 248-bit unique blinding value revealed as `nullifierHash` when the note is spent.
- Double-spending is prevented because the smart contract maintains a registry `mapping(bytes32 => bool) public nullifierHashes`. Re-submitting an existing nullifier reverts the transaction.

### 3. Multi-UTXO JoinSplit Circuit (2-in 2-out)
The Circom ZK circuit proves the following statements in Zero Knowledge:
1. Both input notes exist in the Merkle tree at some valid historical root:
   $$\text{MerkleVerify}(\text{leaf}_1, \text{path}_1, \text{root}) == 1 \quad \wedge \quad \text{MerkleVerify}(\text{leaf}_2, \text{path}_2, \text{root}) == 1$$
2. The nullifiers correctly correspond to the input commitments.
3. The sum of input values equals the sum of output values plus the relayer fee:
   $$\text{amount}_{in, 1} + \text{amount}_{in, 2} == \text{amount}_{out, 1} + \text{amount}_{out, 2} + \text{fee}$$
4. All values fit within the 64-bit unsigned integer range (preventing field-overflow exploits).

### 4. End-to-End Calldata Memo Delivery
To allow recipients to discover and restore their shielded balances without needing a centralized backend:
1. Sender creates an ephemeral keypair: $(sk_{eph}, pk_{eph})$.
2. Computes the ECDH shared secret: $S = sk_{eph} \times pk_{view, recipient}$.
3. Encrypts note parameters with AES-256-GCM using $K = \text{Keccak256}(S)$.
4. Calldata format: $[pk_{eph} \ (33B)] + [IV \ (12B)] + [\text{AuthTag} \ (16B)] + [\text{Ciphertext}]$.
5. Recipients scan contract event logs and decrypt only memos addressed to them. Third-party observers learn zero information.

---

## 📂 Repository Structure

```
mosoo-privacy-protocol/
├── contracts/
│   ├── MosooPrivacyPool.sol       # Core EVM Privacy Pool (dynamic chainId, Shield, Unshield, JoinSplit)
│   ├── MerkleTreeWithHistory.sol  # 20-Depth Poseidon Tree & 64-Root Ring Buffer
│   ├── MockERC20.sol              # Standard ERC-20 token for multi-asset pool testing
│   └── circuits/
│       └── transaction.circom     # Circom 2.0 JoinSplit 2-to-2 constraint verification circuit
├── prototype/
│   ├── prototype_demo.js          # Executable end-to-end cryptographic prototype demo
│   ├── crypto.js                  # Poseidon-BN254, stealth key derivation & ECDH memo engine
│   └── merkle_tree.js             # Incremental Poseidon Merkle tree (matching smart contract)
├── package.json                   # Project metadata and test commands
├── LICENSE                        # MIT License
└── README.md                      # Architecture and protocol specification
```

---

## 🚀 Running the Working Prototype Locally

The prototype simulation executes the complete cryptographic pipeline end-to-end:
- Generates Alice, Bob, and Eve stealth accounts
- Shields 5.0 ETH and 3.0 ETH into Poseidon commitments
- Inserts notes into a 20-depth incremental Poseidon Merkle tree
- Computes Merkle membership proofs
- Executes a JoinSplit 2-to-2 transfer (6.5 ETH to Bob, 1.49 ETH change to Alice, 0.01 ETH fee)
- Encrypts note calldata memo with forward-secret ECDH
- Simulates Bob's decentralized log scanning and successful recovery
- Verifies adversary (Eve) cannot decrypt the memo (zero knowledge leaked)
- Performs unshielding to a clean public EVM address
- Asserts that double-spend replay attempts are rejected

### Quickstart

```bash
# 1. Clone repository
git clone https://github.com/mosoo-xyz/mosoo-privacy-protocol.git
cd mosoo-privacy-protocol

# 2. Install dependencies
npm install

# 3. Run prototype demonstration
npm test
```

*(You can also run `npm run demo`)*

### Expected Output

```
================================================================================
  MOSOO PRIVACY PROTOCOL - ZERO-KNOWLEDGE PROTOTYPE SIMULATION
================================================================================
  Specification: Universal EVM Multi-UTXO Privacy Layer
  Curve: BN254 (alt_bn128) | Hasher: Poseidon (t=3, t=5) | Merkle Depth: 20

[STEP 1] Cryptographic Stealth Identity Derivation
  Deriving spending keys, viewing keys, and secp256k1 public viewing keys...
    • Alice Stealth Address: 0msk102f3ef27624db64a07750e54fbb6bdc3c0e1c248489037aec89a228f99dc222d73
    • Bob Stealth Address  : 0msk102f07c433bc781aab6299f764c4d570dfbd9580551277e5e72525f2a3f1cf9618a
    • Eve Stealth Address  : 0msk102b464873cd25e05d2a1472b68d9ab431b79a6e163b2e24b09414acfedc1aa92ac
  ✔ Dual-key stealth identity pairs derived successfully.

[STEP 2] Asset Shielding & Poseidon Note Commitments
  Alice deposits funds into the EVM Privacy Pool:
  - Note 1: 5.00 ETH
  - Note 2: 3.00 ETH
  ✔ Notes committed to 20-depth Poseidon Merkle Tree.
  ✔ Zero-Knowledge Merkle membership proof verified for Note 1.

[STEP 3] Multi-UTXO JoinSplit 2-to-2 Confidential Transfer
  Alice initiates an arbitrary confidential transfer to Bob:
  - Target Payment to Bob: 6.50 ETH
  - Relayer Gas Fee:       0.01 ETH
  - Change back to Alice:  1.49 ETH
  ✔ JoinSplit balance conservation validated: 5.0 + 3.0 == 6.5 + 1.49 + 0.01 ETH
  ✔ Input nullifiers marked spent.
  ✔ Tree updated with Output UTXO A and Output UTXO B.

[STEP 4] Asymmetric Calldata Memo Encryption (ECDH + AES-256-GCM)
  ✔ Encrypted memo generated with forward-secret ephemeral secp256k1 key.

[STEP 5] Decentralized Note Scanning & Privacy Verification
  ✔ Bob successfully decrypted incoming note: 6.5 ETH!
  ✔ Adversary decryption returned null: ZERO knowledge leaked to blockchain observers.

[STEP 6] Confidential Unshielding (Withdrawal to Public Address)
  ✔ Unshield verified on Merkle Root.
  ✔ Nullifier registered on-chain.
  ✔ Funds dispatched to recipient: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8

[STEP 7] Double-Spend Attack Prevention Test
  ✔ Double-spend attack thwarted: "MosooPrivacyPool: Nullifier already spent (revert)"

================================================================================
  PROTOTYPE TEST EXECUTION COMPLETE
================================================================================
  All Invariants Verified:
    [✔] Dual-Key Stealth Address Derivation
    [✔] Poseidon-BN254 Hash & 20-Depth Merkle Commitments
    [✔] Multi-UTXO JoinSplit 2-in 2-out Arbitrary Transfer
    [✔] ECDH Forward-Secret Calldata Memo Delivery
    [✔] Zero-Knowledge Confidentiality (Eve decryption rejected)
    [✔] Cryptographic Anti-Double-Spend Assertion
================================================================================
```

---

## ⚙️ Smart Contract Specifications

`contracts/MosooPrivacyPool.sol` is designed for universal EVM compatibility:
- **Dynamic Chain ID:** Retrieves `block.chainid` during construction (`uint256 public immutable CHAIN_ID`), avoiding hardcoded network restrictions. Deployable without code changes to Ethereum Mainnet, Arbitrum, Optimism, Base, Polygon, Avalanche, BNB Chain, or any custom EVM subnet.
- **Checks-Effects-Interactions (CEI):** Nullifiers are written to storage *before* transferring any ETH or ERC-20 tokens.
- **Reentrancy Protection:** All external state transitions are guarded by `nonReentrant` status flags.
- **Scalar Field Boundary Check:** All commitment inputs are strictly validated against `uint256(commitment) < FIELD_SIZE` ($21888242871839275222246405745257275088548364400416034343698204186575808495617$) to prevent BN254 field aliasing.

---

## 📄 License

This repository is licensed under the [MIT License](LICENSE).
