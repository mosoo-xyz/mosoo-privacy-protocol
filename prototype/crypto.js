/**
 * Mosoo Privacy Protocol - Cryptographic Primitive Library
 * Universal EVM Zero-Knowledge Multi-UTXO Engine
 */

const { ethers } = require('ethers');
const crypto = require('crypto');
const { poseidon2, poseidon4 } = require('poseidon-lite');

// BN254 scalar field prime order (r)
const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

class MosooCrypto {
    /**
     * Derive Shielded Account Keys from a Web3 Wallet signature or raw seed
     * Creates:
     *  - Spending Key (authorizes spending UTXOs)
     *  - Viewing Key (decrypts incoming transactions)
     *  - Public Viewing Key (secp256k1 compressed key for ECDH)
     *  - Stealth Address (0msk1 + 66-hex public viewing key)
     */
    static deriveShieldedAccount(seedInput) {
        let seed;
        if (typeof seedInput === 'string' && seedInput.startsWith('0x')) {
            seed = ethers.keccak256(seedInput);
        } else if (typeof seedInput === 'string') {
            seed = ethers.keccak256(ethers.toUtf8Bytes(seedInput));
        } else {
            seed = ethers.hexlify(ethers.randomBytes(32));
        }

        const spendingKey = ethers.keccak256(ethers.concat([seed, ethers.toUtf8Bytes("mosoo.spending.key")]));
        const viewingKey = ethers.keccak256(ethers.concat([seed, ethers.toUtf8Bytes("mosoo.viewing.key")]));

        // Derive secp256k1 compressed public key for ECDH Diffie-Hellman encryption
        const signingKey = new ethers.SigningKey(viewingKey);
        const publicViewingKey = signingKey.compressedPublicKey; // 33-byte hex string (0x02... or 0x03...)

        // Stealth Address format: 0msk1 + 66 hex characters (chain-agnostic stealth identifier)
        const mosooAddress = `0msk1${publicViewingKey.substring(2)}`;

        return {
            spendingKey,
            viewingKey,
            publicViewingKey,
            mosooAddress
        };
    }

    /**
     * Create a new Shielded UTXO Note
     * Uses BN254 Poseidon hash:
     *   commitment = Poseidon4([secret, nullifier, amountWei, recipientHash])
     *   nullifierHash = Poseidon2([nullifier, 0])
     */
    static createNote({ amount, asset = "ETH", recipientMosooAddress }) {
        const secret = ethers.hexlify(ethers.randomBytes(31));
        const nullifier = ethers.hexlify(ethers.randomBytes(31));

        const secretBn = BigInt(secret) % FIELD_SIZE;
        const nullifierBn = BigInt(nullifier) % FIELD_SIZE;
        const amountWei = ethers.parseEther(amount.toString());
        const amountBn = BigInt(amountWei) % FIELD_SIZE;
        const recipientHash = BigInt(ethers.keccak256(ethers.toUtf8Bytes(recipientMosooAddress || "0msk1self"))) % FIELD_SIZE;

        // Poseidon-BN254 commitment binding secret, nullifier, value, and recipient
        const poseidonCommitment = poseidon4([secretBn, nullifierBn, amountBn, recipientHash]);
        const commitment = ethers.toBeHex(poseidonCommitment, 32);

        // Poseidon-BN254 nullifier hash to prevent double-spending on-chain
        const poseidonNullifier = poseidon2([nullifierBn, 0n]);
        const nullifierHash = ethers.toBeHex(poseidonNullifier, 32);

        return {
            amount: amount.toString(),
            amountWei: amountWei.toString(),
            asset: asset.toUpperCase(),
            secret,
            nullifier,
            commitment,
            nullifierHash,
            recipient: recipientMosooAddress,
            spent: false,
            timestamp: Date.now()
        };
    }

    /**
     * Extract compressed secp256k1 public viewing key from stealth address (0msk1...)
     */
    static extractPublicKey(stealthAddressOrPubKey) {
        if (!stealthAddressOrPubKey) return null;
        const clean = stealthAddressOrPubKey.trim();
        if (clean.startsWith("0msk1") && clean.length === 71) {
            return `0x${clean.substring(5)}`;
        }
        if (clean.startsWith("0x") && clean.length === 66) {
            return clean;
        }
        return null;
    }

    /**
     * ECDH Forward-Secret Calldata Memo Encryption
     * The sender generates an ephemeral secp256k1 key pair, derives the ECDH shared secret
     * with the recipient's public viewing key, and encrypts the note details with AES-256-GCM.
     * The encrypted payload is placed directly into transaction calldata.
     */
    static encryptMemo(note, recipientStealthAddress) {
        const recipientPubKey = this.extractPublicKey(recipientStealthAddress);
        if (!recipientPubKey) {
            throw new Error(`Invalid recipient address or public viewing key: ${recipientStealthAddress}`);
        }

        // Generate ephemeral keypair for forward secrecy
        const ephemeralWallet = ethers.Wallet.createRandom();
        const ephemeralPubKey = ephemeralWallet.signingKey.compressedPublicKey; // 33 bytes

        // Compute ECDH shared secret
        const sharedSecretHex = new ethers.SigningKey(ephemeralWallet.privateKey).computeSharedSecret(recipientPubKey);
        const aesKey = Buffer.from(ethers.getBytes(ethers.keccak256(sharedSecretHex)));

        // Encrypt with AES-256-GCM
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);

        const payload = JSON.stringify({
            amount: note.amount,
            amountWei: note.amountWei,
            asset: note.asset,
            secret: note.secret,
            nullifier: note.nullifier,
            commitment: note.commitment,
            nullifierHash: note.nullifierHash
        });

        const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag(); // 16 bytes

        // Encrypted Calldata format:
        // [33 bytes EphemeralPubKey] + [12 bytes IV] + [16 bytes AuthTag] + [Ciphertext]
        const fullMemo = ethers.concat([
            ephemeralPubKey,
            ethers.hexlify(iv),
            ethers.hexlify(authTag),
            ethers.hexlify(ciphertext)
        ]);

        return fullMemo;
    }

    /**
     * Decrypt Calldata Memo using Recipient's Private Viewing Key
     * Returns the full note object if decryption succeeds, or null if note was intended for someone else.
     */
    static decryptMemo(memoHex, privateViewingKey) {
        try {
            if (!memoHex || !privateViewingKey) return null;
            const rawBytes = Buffer.from(ethers.getBytes(memoHex));

            // Must be at least 33 (pubkey) + 12 (iv) + 16 (tag) + 1 byte payload = 62 bytes
            if (rawBytes.length < 62) return null;

            const ephemeralPubKeyHex = ethers.hexlify(rawBytes.subarray(0, 33));
            const iv = rawBytes.subarray(33, 45);
            const authTag = rawBytes.subarray(45, 61);
            const ciphertext = rawBytes.subarray(61);

            // Derive shared secret
            const sharedSecretHex = new ethers.SigningKey(privateViewingKey).computeSharedSecret(ephemeralPubKeyHex);
            const aesKey = Buffer.from(ethers.getBytes(ethers.keccak256(sharedSecretHex)));

            const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
            decipher.setAuthTag(authTag);

            const decryptedStr = decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
            return JSON.parse(decryptedStr);
        } catch (err) {
            // Decryption failure indicates note is not for this viewing key
            return null;
        }
    }
}

module.exports = { MosooCrypto, FIELD_SIZE };
