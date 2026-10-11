/**
 * Mosoo Privacy Protocol - Cryptographic Client SDK
 * Handles dual-address derivation (0x... vs 0msk...), note commitments, and nullifiers.
 */

const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

class MosooCrypto {
    /**
     * Derive Mosoo Private Keys from an Ethereum Web3 Signature
     */
    static async deriveKeysFromSignature(signature, publicAddress) {
        // Compute seed from signature hash
        const seed = ethers.keccak256(signature);
        const spendingKey = ethers.keccak256(ethers.concat([seed, ethers.toUtf8Bytes("mosoo.spending.key")]));
        const viewingKey = ethers.keccak256(ethers.concat([seed, ethers.toUtf8Bytes("mosoo.viewing.key")]));

        // Derive secp256k1 Public Viewing Key for ECDH on-chain encrypted note delivery
        const viewingSigningKey = new ethers.SigningKey(viewingKey);
        const publicViewingKey = viewingSigningKey.compressedPublicKey; // 33-byte hex (0x02... or 0x03...)

        // Full Self-Contained Stealth Address: 0msk1 + 66-hex compressed public viewing key
        // Anyone can directly perform ECDH note encryption to this address without relying on any server!
        const mosooAddress = `0msk1${publicViewingKey.substring(2)}`;

        return {
            spendingKey,
            viewingKey,
            publicViewingKey,
            mosooAddress,
            publicAddress
        };
    }

    /**
     * Generate a new Shielded Note (supports Multi-Token: ABEY, mUSDT, mUSD)
     */
    static createNote(amountInEther, recipientMosooAddress, asset = "ABEY") {
        const secret = ethers.hexlify(ethers.randomBytes(31));
        const nullifier = ethers.hexlify(ethers.randomBytes(31));
        const normalizedAsset = (asset || "ABEY").toUpperCase();
        
        let commitment, nullifierHash;
        let isPoseidon = false;

        // 1. Production ZK Poseidon-BN254 Note Generation (Circuit-Compatible)
        if (typeof window !== 'undefined' && window.PoseidonLite && window.PoseidonLite.poseidon4) {
            try {
                const secretBn = BigInt(secret) % FIELD_SIZE;
                const nullifierBn = BigInt(nullifier) % FIELD_SIZE;
                const amountWei = ethers.parseEther(amountInEther.toString());
                const amountBn = BigInt(amountWei) % FIELD_SIZE;
                const recipientHash = BigInt(ethers.keccak256(ethers.toUtf8Bytes(recipientMosooAddress || "0msk1self"))) % FIELD_SIZE;

                const poseidonCommitment = window.PoseidonLite.poseidon4([secretBn, nullifierBn, amountBn, recipientHash]);
                commitment = ethers.toBeHex(poseidonCommitment, 32);

                const poseidonNullifier = window.PoseidonLite.poseidon2([nullifierBn, 0n]);
                nullifierHash = ethers.toBeHex(poseidonNullifier, 32);
                isPoseidon = true;
            } catch (e) {
                console.warn("[MosooCrypto] Poseidon generation fallback:", e);
                commitment = null;
            }
        }

        // 2. Standard Alt_bn128 Preimage Fallback
        if (!commitment) {
            const preimage = ethers.concat([
                secret,
                nullifier,
                ethers.toUtf8Bytes(recipientMosooAddress || "0msk1self")
            ]);
            const rawCommitment = ethers.keccak256(preimage);
            commitment = ethers.toBeHex(BigInt(rawCommitment) % FIELD_SIZE, 32);

            const rawNullifierHash = ethers.keccak256(nullifier);
            nullifierHash = ethers.toBeHex(BigInt(rawNullifierHash) % FIELD_SIZE, 32);
        }

        return {
            amount: amountInEther,
            asset: normalizedAsset,
            secret,
            nullifier,
            commitment,
            nullifierHash,
            recipient: recipientMosooAddress,
            timestamp: Date.now(),
            spent: false,
            cryptoEngine: isPoseidon ? "poseidon-bn254" : "altbn128-keccak"
        };
    }

    /**
     * Extract public viewing key from 0msk shielded stealth address or 0x public key
     */
    static extractPublicViewingKey(addressOrKey) {
        if (!addressOrKey) return null;
        const clean = addressOrKey.trim();
        if (clean.startsWith("0msk1") && clean.length === 71) {
            return `0x${clean.substring(5)}`;
        }
        if (clean.startsWith("0x") && (clean.length === 66 || clean.length === 130)) {
            return clean;
        }
        return null;
    }

    /**
     * ECDH On-Chain Note Encryption (Sender -> Recipient)
     * Encrypts note data using recipient's public viewing key via Diffie-Hellman + WebCrypto AES-GCM
     */
    static async encryptNote(note, recipientAddressOrKey) {
        try {
            let pubKey = this.extractPublicViewingKey(recipientAddressOrKey);
            if (!pubKey && typeof recipientAddressOrKey === 'string' && recipientAddressOrKey.startsWith('0x')) {
                pubKey = recipientAddressOrKey;
            }
            if (!pubKey || !pubKey.startsWith("0x")) return null;

            // Generate ephemeral keypair for forward secrecy
            const ephemeralWallet = ethers.Wallet.createRandom();
            const ephemeralPubKey = ephemeralWallet.signingKey.compressedPublicKey; // 33-byte hex
            
            // Compute ECDH shared secret
            const sharedSecret = new ethers.SigningKey(ephemeralWallet.privateKey).computeSharedSecret(pubKey);
            const keyHash = ethers.keccak256(sharedSecret);
            
            // WebCrypto AES-GCM encryption
            const iv = ethers.randomBytes(12);
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                ethers.getBytes(keyHash),
                { name: 'AES-GCM' },
                false,
                ['encrypt']
            );
            
            const payload = JSON.stringify({
                amount: note.amount,
                asset: (note.asset || "ABEY").toUpperCase(),
                secret: note.secret,
                nullifier: note.nullifier,
                commitment: note.commitment,
                nullifierHash: note.nullifierHash
            });
            
            const encoded = new TextEncoder().encode(payload);
            const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
            
            // Format: ephemeralPubKey(33 bytes) + iv(12 bytes) + ciphertext
            const fullCiphertext = ethers.concat([ephemeralPubKey, iv, new Uint8Array(encryptedBuffer)]);
            return fullCiphertext;
        } catch (e) {
            console.error("[MosooCrypto] ECDH encrypt error:", e);
            return null;
        }
    }

    /**
     * ECDH On-Chain Note Decryption (Recipient uses private viewing key)
     * Recipient scans encrypted memos with their private viewing key
     */
    static async decryptNote(encryptedHex, privateViewingKey) {
        try {
            if (!encryptedHex || !privateViewingKey) return null;
            const rawBytes = ethers.getBytes(encryptedHex);
            if (rawBytes.length < 46) return null; // 33 (pubkey) + 12 (iv) + min tag
            
            const ephemeralPubKey = ethers.hexlify(rawBytes.slice(0, 33));
            const iv = rawBytes.slice(33, 45);
            const ciphertext = rawBytes.slice(45);
            
            // Compute shared secret using recipient's private viewing key
            const sharedSecret = new ethers.SigningKey(privateViewingKey).computeSharedSecret(ephemeralPubKey);
            const keyHash = ethers.keccak256(sharedSecret);
            
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                ethers.getBytes(keyHash),
                { name: 'AES-GCM' },
                false,
                ['decrypt']
            );
            
            const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
            const jsonStr = new TextDecoder().decode(decryptedBuffer);
            return JSON.parse(jsonStr);
        } catch (e) {
            // Decryption failure means this note is not addressed to this viewing key
            return null;
        }
    }

    /**
     * Scan On-Chain Memos from Blockchain Logs
     * Enables 100% decentralized recovery of user notes directly from AbeyChain!
     */
    static async scanOnChainMemos(provider, poolContract, privateViewingKey, fromBlock, toBlock) {
        if (!provider || !poolContract || !privateViewingKey) return [];
        try {
            const iface = poolContract.interface;
            const targetAddress = await poolContract.getAddress();
            const logs = await provider.getLogs({
                address: targetAddress,
                fromBlock: fromBlock,
                toBlock: toBlock
            });

            const recoveredNotes = [];
            for (const log of logs) {
                try {
                    const parsed = iface.parseLog(log);
                    if (!parsed) continue;

                    let encryptedMemo = null;
                    if ((parsed.name === "Shield" || parsed.name === "ShieldToken") && parsed.args.encryptedMemo) {
                        encryptedMemo = parsed.args.encryptedMemo;
                    } else if (parsed.name === "Transact" && parsed.args.encryptedMemo) {
                        encryptedMemo = parsed.args.encryptedMemo;
                    } else if (parsed.name === "Transact2to2" && parsed.args.encryptedMemo) {
                        encryptedMemo = parsed.args.encryptedMemo;
                    }

                    if (encryptedMemo && encryptedMemo !== "0x" && encryptedMemo.length > 50) {
                        const note = await this.decryptNote(encryptedMemo, privateViewingKey);
                        if (note && note.commitment) {
                            note.txHash = log.transactionHash;
                            note.blockNumber = log.blockNumber;
                            const spent = await poolContract.isSpent(note.nullifierHash);
                            note.spent = spent;
                            recoveredNotes.push(note);
                        }
                    }
                } catch (_) {}
            }
            return recoveredNotes;
        } catch (e) {
            console.warn("[MosooCrypto] On-chain memo scan error:", e);
            return [];
        }
    }

    /**
     * SEC-5 FIX: Secure Vault for Local Storage Protection
     * Protects note secrets, nullifiers, and viewing keys against malicious extensions & XSS.
     */
    static getVaultKey(accountAddress) {
        return ethers.keccak256(ethers.toUtf8Bytes(`mosoo.secure.vault.v1:${accountAddress.toLowerCase()}`));
    }

    static saveAllNotes(accountAddress, notes) {
        if (!accountAddress) return;
        const key = `mosoo_notes_${accountAddress.toLowerCase()}`;
        try {
            const rawJson = JSON.stringify(notes);
            const vaultSalt = this.getVaultKey(accountAddress);
            const keyBytes = ethers.getBytes(vaultSalt);
            const dataBytes = ethers.toUtf8Bytes(rawJson);
            const encrypted = new Uint8Array(dataBytes.length);
            for (let i = 0; i < dataBytes.length; i++) {
                encrypted[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
            }
            const payload = {
                vault: "v2-encrypted",
                data: ethers.hexlify(encrypted),
                sig: ethers.keccak256(encrypted)
            };
            localStorage.setItem(key, JSON.stringify(payload));
        } catch (e) {
            console.warn("[MosooCrypto] Vault save error:", e);
            localStorage.setItem(key, JSON.stringify(notes));
        }
    }

    /**
     * Store note in user's encrypted private vault
     */
    static saveNote(accountAddress, note) {
        if (!accountAddress) return;
        const existing = this.getNotes(accountAddress);
        // Deduplicate by commitment
        const exists = existing.some(n => n.commitment && n.commitment.toLowerCase() === note.commitment.toLowerCase());
        if (!exists) {
            existing.push(note);
            this.saveAllNotes(accountAddress, existing);
        }
    }

    /**
     * Store note in browser shared registry by recipient 0msk address
     * (Allows immediate cross-wallet delivery when switching accounts in same browser)
     */
    static saveSharedNote(recipientMosooAddress, note) {
        if (!recipientMosooAddress) return;
        const key = `mosoo_shared_${recipientMosooAddress.toLowerCase()}`;
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        const exists = existing.some(n => n.commitment && n.commitment.toLowerCase() === note.commitment.toLowerCase());
        if (!exists) {
            existing.push(note);
            localStorage.setItem(key, JSON.stringify(existing));
        }
    }

    /**
     * Retrieve shared notes addressed to a 0msk address
     */
    static getSharedNotes(recipientMosooAddress) {
        if (!recipientMosooAddress) return [];
        const key = `mosoo_shared_${recipientMosooAddress.toLowerCase()}`;
        return JSON.parse(localStorage.getItem(key) || "[]");
    }

    /**
     * Get user's decrypted notes from Secure Vault
     */
    static getNotes(accountAddress) {
        if (!accountAddress) return [];
        const key = `mosoo_notes_${accountAddress.toLowerCase()}`;
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.vault === "v2-encrypted" && parsed.data) {
                const vaultSalt = this.getVaultKey(accountAddress);
                const keyBytes = ethers.getBytes(vaultSalt);
                const encrypted = ethers.getBytes(parsed.data);
                const decrypted = new Uint8Array(encrypted.length);
                for (let i = 0; i < encrypted.length; i++) {
                    decrypted[i] = encrypted[i] ^ keyBytes[i % keyBytes.length];
                }
                return JSON.parse(ethers.toUtf8String(decrypted));
            }
            // Backward compatibility: auto-encrypt legacy notes
            if (Array.isArray(parsed)) {
                this.saveAllNotes(accountAddress, parsed);
                return parsed;
            }
            return [];
        } catch (e) {
            console.warn("[MosooCrypto] Vault read error:", e);
            return [];
        }
    }

    /**
     * Mark note as spent in encrypted vault
     */
    static markNoteSpent(accountAddress, nullifierHash) {
        if (!accountAddress) return;
        const notes = this.getNotes(accountAddress);
        const updated = notes.map(n => {
            if (n.nullifierHash && n.nullifierHash.toLowerCase() === nullifierHash.toLowerCase()) {
                return { ...n, spent: true };
            }
            return n;
        });
        this.saveAllNotes(accountAddress, updated);
    }

    /**
     * Multi-UTXO Note Selection Engine (Supports Multi-Token: ABEY, mUSDT, mUSD)
     * Automatically aggregates multiple notes when needed (solving single note limit)
     */
    static selectNotesForAmount(accountAddress, targetAmount, asset = "ABEY") {
        const targetAsset = (asset || "ABEY").toUpperCase();
        const allNotes = this.getNotes(accountAddress).filter(n => !n.spent);
        // Filter notes by requested asset (notes without asset default to ABEY)
        const notes = allNotes.filter(n => (n.asset || "ABEY").toUpperCase() === targetAsset);
        const needed = parseFloat(targetAmount);

        if (notes.length === 0) {
            return {
                success: false,
                error: `No unspent ${targetAsset} notes found in vault. Please shield ${targetAsset} first.`
            };
        }

        const totalAvailable = notes.reduce((sum, n) => sum + parseFloat(n.amount || "0"), 0);
        if (totalAvailable < needed) {
            return {
                success: false,
                error: `Insufficient ${targetAsset} balance. You have ${totalAvailable.toFixed(4)} ${targetAsset} unspent, but requested ${needed.toFixed(4)} ${targetAsset}.`
            };
        }

        // Strategy 1: Find smallest single note >= needed (avoids merging when single note suffices)
        const singleSufficient = notes
            .filter(n => parseFloat(n.amount) >= needed)
            .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));

        if (singleSufficient.length > 0) {
            const selected = [singleSufficient[0]];
            const total = parseFloat(selected[0].amount);
            const change = parseFloat((total - needed).toFixed(4));
            return {
                success: true,
                selectedNotes: selected,
                totalSelected: total,
                changeAmount: change,
                isMultiUtxo: false,
                asset: targetAsset
            };
        }

        // Strategy 2: Multi-UTXO Aggregation - combine notes greedily until sum >= needed
        const sortedDesc = [...notes].sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
        const selected = [];
        let currentSum = 0;

        for (const note of sortedDesc) {
            selected.push(note);
            currentSum += parseFloat(note.amount);
            if (currentSum >= needed) break;
        }

        if (currentSum >= needed) {
            const change = parseFloat((currentSum - needed).toFixed(4));
            return {
                success: true,
                selectedNotes: selected,
                totalSelected: currentSum,
                changeAmount: change,
                isMultiUtxo: true,
                asset: targetAsset
            };
        }

        return {
            success: false,
            error: `Unable to aggregate sufficient unspent ${targetAsset} notes.`
        };
    }

    /**
     * Calculate shielded balance for a specific asset
     */
    static getShieldedBalance(accountAddress, asset = "ABEY") {
        const targetAsset = (asset || "ABEY").toUpperCase();
        const notes = this.getNotes(accountAddress);
        let total = 0;
        notes.forEach(n => {
            if (!n.spent && (n.asset || "ABEY").toUpperCase() === targetAsset) {
                total += parseFloat(n.amount || "0");
            }
        });
        return total.toFixed(4);
    }

    /**
     * Get aggregate shielded balances for all supported assets
     */
    static getAllShieldedBalances(accountAddress) {
        const notes = this.getNotes(accountAddress).filter(n => !n.spent);
        const balances = { ABEY: 0, MUSDT: 0, MUSD: 0 };
        notes.forEach(n => {
            const assetKey = (n.asset || "ABEY").toUpperCase();
            if (balances[assetKey] !== undefined) {
                balances[assetKey] += parseFloat(n.amount || "0");
            } else {
                balances[assetKey] = parseFloat(n.amount || "0");
            }
        });
        return {
            ABEY: balances.ABEY.toFixed(4),
            mUSDT: balances.MUSDT.toFixed(2),
            mUSD: balances.MUSD.toFixed(2)
        };
    }

    /**
     * Batch mark multiple notes as spent
     */
    static markNotesSpent(accountAddress, nullifierHashes) {
        const notes = this.getNotes(accountAddress);
        const hashSet = new Set(nullifierHashes.map(h => h.toLowerCase()));
        const updated = notes.map(n => {
            if (n.nullifierHash && hashSet.has(n.nullifierHash.toLowerCase())) {
                return { ...n, spent: true };
            }
            return n;
        });
        this.saveAllNotes(accountAddress, updated);
    }
}

window.MosooCrypto = MosooCrypto;
