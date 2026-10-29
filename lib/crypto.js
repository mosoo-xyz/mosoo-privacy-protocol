const { ethers } = require('ethers');
const crypto = require('crypto');
const { poseidon2, poseidon5 } = require('poseidon-lite');

// BN254 scalar field order (r)
const FIELD_SIZE = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

function deriveKeys(seedInput) {
    let seed;
    if (typeof seedInput === 'string' && seedInput.startsWith('0x')) {
        seed = ethers.keccak256(seedInput);
    } else if (typeof seedInput === 'string') {
        seed = ethers.keccak256(ethers.toUtf8Bytes(seedInput));
    } else {
        seed = ethers.hexlify(ethers.randomBytes(32));
    }

    const spendingKey = ethers.keccak256(ethers.concat([seed, ethers.toUtf8Bytes('mosoo.spending.key')]));
    const viewingKey = ethers.keccak256(ethers.concat([seed, ethers.toUtf8Bytes('mosoo.viewing.key')]));

    // Compressed secp256k1 public key for ECDH note delivery
    const signingKey = new ethers.SigningKey(viewingKey);
    const publicViewingKey = signingKey.compressedPublicKey;

    const stealthAddress = `0msk1${publicViewingKey.substring(2)}`;

    return {
        spendingKey,
        viewingKey,
        publicViewingKey,
        stealthAddress
    };
}

function resolveAssetAddress(asset) {
    if (!asset || asset === 'ETH' || asset === ethers.ZeroAddress) {
        return ethers.ZeroAddress;
    }
    if (ethers.isAddress(asset)) {
        return ethers.getAddress(asset);
    }
    return ethers.ZeroAddress;
}

function createNote({ amount, asset = 'ETH', recipient }) {
    const secret = ethers.hexlify(ethers.randomBytes(31));
    const nullifier = ethers.hexlify(ethers.randomBytes(31));

    const secretBn = BigInt(secret) % FIELD_SIZE;
    const nullifierBn = BigInt(nullifier) % FIELD_SIZE;
    const amountWei = ethers.parseEther(amount.toString());
    const amountBn = BigInt(amountWei) % FIELD_SIZE;

    const assetAddress = resolveAssetAddress(asset);
    const assetBn = BigInt(assetAddress);

    const recipientHash = BigInt(ethers.keccak256(ethers.toUtf8Bytes(recipient || '0msk1self'))) % FIELD_SIZE;

    // Cryptographically binds asset address to prevent cross-asset pool draining
    const poseidonCommitment = poseidon5([secretBn, nullifierBn, amountBn, assetBn, recipientHash]);
    const commitment = ethers.toBeHex(poseidonCommitment, 32);

    const poseidonNullifier = poseidon2([nullifierBn, 0n]);
    const nullifierHash = ethers.toBeHex(poseidonNullifier, 32);

    return {
        amount: amount.toString(),
        amountWei: amountWei.toString(),
        asset: assetAddress === ethers.ZeroAddress ? 'ETH' : assetAddress,
        assetAddress,
        secret,
        nullifier,
        commitment,
        nullifierHash,
        recipient,
        spent: false,
        timestamp: Date.now()
    };
}

function extractPublicKey(stealthOrKey) {
    if (!stealthOrKey) return null;
    const clean = stealthOrKey.trim();
    if (clean.startsWith('0msk1') && clean.length === 71) {
        return `0x${clean.substring(5)}`;
    }
    if (clean.startsWith('0x') && clean.length === 66) {
        return clean;
    }
    return null;
}

function encryptMemo(note, recipientStealthAddress) {
    const recipientPubKey = extractPublicKey(recipientStealthAddress);
    if (!recipientPubKey) {
        throw new Error(`invalid recipient key: ${recipientStealthAddress}`);
    }

    const ephemeralWallet = ethers.Wallet.createRandom();
    const ephemeralPubKey = ephemeralWallet.signingKey.compressedPublicKey;

    const sharedSecret = new ethers.SigningKey(ephemeralWallet.privateKey).computeSharedSecret(recipientPubKey);
    const aesKey = Buffer.from(ethers.getBytes(ethers.keccak256(sharedSecret)));

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);

    const payload = JSON.stringify({
        amount: note.amount,
        amountWei: note.amountWei,
        asset: note.asset,
        assetAddress: note.assetAddress,
        secret: note.secret,
        nullifier: note.nullifier,
        commitment: note.commitment,
        nullifierHash: note.nullifierHash
    });

    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return ethers.concat([
        ephemeralPubKey,
        ethers.hexlify(iv),
        ethers.hexlify(authTag),
        ethers.hexlify(ciphertext)
    ]);
}

function decryptMemo(memoHex, privateViewingKey) {
    try {
        if (!memoHex || !privateViewingKey) return null;
        const raw = Buffer.from(ethers.getBytes(memoHex));
        if (raw.length < 62) return null;

        const ephemeralPubKeyHex = ethers.hexlify(raw.subarray(0, 33));
        const iv = raw.subarray(33, 45);
        const authTag = raw.subarray(45, 61);
        const ciphertext = raw.subarray(61);

        const sharedSecret = new ethers.SigningKey(privateViewingKey).computeSharedSecret(ephemeralPubKeyHex);
        const aesKey = Buffer.from(ethers.getBytes(ethers.keccak256(sharedSecret)));

        const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
        decipher.setAuthTag(authTag);

        const str = decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
        return JSON.parse(str);
    } catch {
        return null;
    }
}

module.exports = {
    deriveKeys,
    createNote,
    resolveAssetAddress,
    extractPublicKey,
    encryptMemo,
    decryptMemo,
    FIELD_SIZE
};
