# 🛡️ Mosoo Privacy Protocol

[![Network: AbeyChain Testnet](https://img.shields.io/badge/Network-AbeyChain%20(Chain%20178)-059669?style=flat-square)](https://testnet.abeyscan.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![ZK Primitive: Poseidon BN254](https://img.shields.io/badge/ZK%20Circuit-Poseidon%20BN254-8b5cf6?style=flat-square)](https://github.com/mosoo-xyz/mosoo-privacy-protocol)
[![Status: Production Testnet Live](https://img.shields.io/badge/Status-Production%20Testnet%20Live-10b981?style=flat-square)](https://app.mosoo.xyz)

> **Enterprise Zero-Knowledge Privacy Pool and Multi-UTXO Confidential Transaction Layer on AbeyChain.**  
> Built for the **Abey Foundation Grant Program**.

---

## 🌐 Live Protocol Deployments

| Component | Production Endpoint | Network |
| :--- | :--- | :--- |
| **Landing Portal** | [https://mosoo.xyz](https://mosoo.xyz) | Web |
| **Privacy Cockpit DApp** | [https://app.mosoo.xyz](https://app.mosoo.xyz) | Web3 Terminal |
| **MosooScan Explorer** | [https://explorer.mosoo.xyz](https://explorer.mosoo.xyz) | On-Chain ZK Stream |
| **Relayer RPC Node** | [https://rpc.mosoo.xyz/health](https://rpc.mosoo.xyz/health) | Abey Testnet Daemon |
| **Main Pool Contract** | [`0x3aa5aA8Fc12b4C589300638522F0ea9A783305Eb`](https://testnet.abeyscan.com/address/0x3aa5aA8Fc12b4C589300638522F0ea9A783305Eb) | Abey Testnet (178) |
| **Poseidon Verifier** | [`0x91f303F459ecB99CF24efaea79bc57d9C0fc9A9e`](https://testnet.abeyscan.com/address/0x91f303F459ecB99CF24efaea79bc57d9C0fc9A9e) | Abey Testnet (178) |
| **Mock USDT Token** | [`0xeF89C5b126f90Fb728A022bc77377d793dCD22CB`](https://testnet.abeyscan.com/address/0xeF89C5b126f90Fb728A022bc77377d793dCD22CB) | Abey Testnet (178) |

---

## 📌 Executive Summary

While **AbeyChain** delivers high-throughput, scalable Layer-1 infrastructure, public on-chain ledger transparency leaves user balances and transaction trails exposed. This limits institutional adoption, confidential B2B transactions, payroll settlements, and MEV-resistant trading.

**Mosoo Privacy Protocol** solves this by establishing a non-custodial, zero-knowledge privacy pool on AbeyChain. Utilizing SNARK-friendly **Poseidon hashing**, **Multi-UTXO JoinSplit circuits (2-in 2-out)**, and **ECDH encrypted note memos**, Mosoo enables users to deposit public tokens, privately transact with zero address linkage, and withdraw cleanly to fresh recipient addresses.

---

## 📐 Protocol Architecture & Transaction Flow

```
[ Public L1 Wallet (MetaMask) ]
              │
              ▼  (1) SHIELD DEPOSIT
┌────────────────────────────────────────────────────────┐
│               MosooPrivacyPool.sol                     │
│  - Poseidon-BN254 Incremental Merkle Tree (Depth 20)  │
│  - 64-Slot Historical Merkle Roots Ring Buffer         │
│  - Multi-Token Vaults (Native ABEY & ERC-20 mUSDT)     │
└────────────────────────────────────────────────────────┘
              │
              ▼  (2) OFF-CHAIN SHIELDED STATE
┌────────────────────────────────────────────────────────┐
│           Confidential Multi-UTXO Ledger               │
│  - Client-Side Secp256k1 Scanning & Viewing Keys      │
│  - JoinSplit 2-in 2-out (Merge & Change Note Splits)   │
│  - End-to-End ECDH Encrypted Calldata Delivery         │
└────────────────────────────────────────────────────────┘
              │
              ▼  (3) ANONYMOUS BROADCASTER
┌────────────────────────────────────────────────────────┐
│             Hardened Relayer Network                   │
│  - Pre-Flight On-Chain Simulation (staticCall)         │
│  - Anti-Replay In-Memory Nullifier Locks               │
│  - Reverse-Proxy IP Rate Limiting & Malicious Auto-Ban │
└────────────────────────────────────────────────────────┘
              │
              ▼  (4) CLEAN UNSHIELD (WITHDRAWAL)
[ Fresh Unlinked Public EVM Address (Zero Historical Trace) ]
```

---

## 🔑 Core Technical Highlights

### 1. Multi-UTXO JoinSplit Engine (2-to-2)
Unlike early privacy pools that only support fixed-denomination notes, Mosoo features arbitrary-amount note handling:
- **Join:** Merge two existing shielded notes into a single payment.
- **Split:** Automatically generate a payment note for the recipient and a change note returned to the sender.

### 2. Poseidon-BN254 Merkle Tree
- Circuit-optimized algebraic hash function operating over the BN254 scalar field ($p \approx 2^{253.5}$).
- 20-depth incremental binary tree supporting over **1,048,576 notes**.
- 64-slot ring buffer cache for historical roots to prevent race conditions during concurrent transactions.

### 3. End-to-End Encrypted Memos (ECDH Calldata)
- Senders encrypt recipient note metadata using the recipient's public viewing key via **ECDH (Elliptic Curve Diffie-Hellman)**.
- Ciphertext is committed to transaction calldata (`encryptedMemo`).
- Recipients scan on-chain event logs with their secret viewing key to reconstruct balances without trusting centralized indexers.

### 4. Hardened Relayer Infrastructure
- **CORS Protection & Whitelisting:** Restricts API access to authorized frontend origins.
- **Pre-Flight Static Simulation:** Executes `staticCall` prior to on-chain broadcast, ensuring zero gas waste on invalid submissions.
- **Mempool Concurrency Guard:** Locks `pendingNullifiers` to eliminate frontrunning and replay attempts.
- **Fail-Fast Secret Isolation:** Private keys are isolated in server environment variables and never exposed to client applications.

---

## 📂 Project Repository Structure

```
mosoo-privacy-protocol/
├── app/                  # Web3 Privacy Cockpit DApp (app.mosoo.xyz)
│   ├── index.html        # Cockpit UI Layout & Terminal
│   ├── script.js         # Core DApp controller & wallet integration
│   ├── mosoo-crypto.js   # Client-side Secp256k1 key derivation & ECDH crypto
│   ├── poseidon-lite.js  # BN254 Poseidon hash library
│   └── style.css         # Cyber-terminal stylesheet
├── contracts/            # Smart Contracts Layer
│   ├── MosooPrivacyPool.sol       # Core Pool (Shield, Unshield, JoinSplit 2-to-2)
│   ├── MerkleTreeWithHistory.sol  # 20-Depth Poseidon Tree & 64-Root Ring Buffer
│   ├── MockUSDT.sol               # Multi-token test asset
│   └── circuits/                  # Circom zero-knowledge circuit definitions
│       └── transaction.circom     # JoinSplit constraint circuit
├── explorer/             # MosooScan Real-Time ZK Block Explorer (explorer.mosoo.xyz)
│   ├── index.html        # Explorer layout
│   └── script.js         # Real-time on-chain event stream parser
├── portal/               # Institutional Landing Page (mosoo.xyz)
│   ├── index.html        # Main landing portal
│   ├── how-it-works.html # Architectural walkthrough
│   ├── security.html     # Security model & audit disclosures
│   └── ecosystem.html    # AbeyChain ecosystem integrations
├── relayer/              # Hardened Broadcaster Daemon (rpc.mosoo.xyz)
│   ├── server.js         # Express + Ethers.js relayer daemon
│   └── package.json      # Relayer dependencies
├── deployment.json       # On-chain contract registry (Chain ID: 178)
└── mock_usdt.json        # Testnet ERC-20 configuration
```

---

## 🔒 Security & Audit Highlights

A comprehensive defense-in-depth audit was conducted across all protocol layers:
- **Checks-Effects-Interactions (CEI):** Nullifier hashes are marked spent before external value transfers.
- **Reentrancy Protection:** All state-modifying endpoints utilize `nonReentrant` mutex guards.
- **Scalar Field Boundary Enforcement:** All deposit commitments are verified to satisfy `uint256(commitment) < FIELD_SIZE`.
- **Client Sanitization:** Explorer search inputs feature strict HTML entity encoding, preventing DOM XSS vulnerabilities.
- **Credential Isolation:** Relayer private keys are strictly managed via environment variables with immediate startup validation.

---

## 🗺️ Grant Roadmap & Next Steps

Supported by the **Abey Foundation Grant Program**, Mosoo will advance across three major phases:

- [x] **Phase 1: Testnet Launch (Completed)**
  - Core privacy pool deployed on Abey Testnet (Chain ID 178)
  - Native ABEY & ERC-20 mUSDT support
  - Web3 Privacy Terminal & MosooScan Explorer live
- [ ] **Phase 2: Mainnet Launch & Security Audit**
  - Institutional 3rd-party audit (CertiK / OpenZeppelin standard)
  - Deployment of immutable contracts on AbeyChain Mainnet
  - Relayer network Dockerization and decentralized node cluster
- [ ] **Phase 3: Confidential AMM DEX Routing & Proof of Innocence (PoI 2.0)**
  - Atomic swap integration with AbeyChain DEX AMM routers
  - Zero-knowledge dual-proof compliance architecture (PoI 2.0)

---

## 👥 Core Team

| Name | Role | Focus Areas |
| :--- | :--- | :--- |
| **Omkar Chavan** | Founder & Lead Protocol Architect | Smart Contracts, ZK Circuits (Circom/SnarkJS), Cryptographic Primitives, AbeyChain Integration |
| **Sourabh Kumbhar** | Core Technical Engineer | Relayer Systems, Backend Concurrency, Docker Node DevOps, Automated Testing Pipelines |
| **Indrajeet Yadav** | UI/UX Designer & Frontend Tech Lead | Design System, Web3 Terminal UX, Mobile Responsive Architecture, Brand Identity |

---

## 📬 Contact & Inquiries

- **Official Inquiries:** [contact@mosoo.xyz](mailto:contact@mosoo.xyz)
- **Website:** [https://mosoo.xyz](https://mosoo.xyz)
- **GitHub:** [https://github.com/mosoo-xyz/mosoo-privacy-protocol](https://github.com/mosoo-xyz/mosoo-privacy-protocol)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
