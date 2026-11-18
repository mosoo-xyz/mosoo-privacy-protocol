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

function createNote({ amount, asset = 'ETH', recipient, decimals = 18, secret = null, nullifier = null }) {
    const noteSecret = secret || ethers.hexlify(ethers.randomBytes(31));
    const noteNullifier = nullifier || ethers.hexlify(ethers.randomBytes(31));

    const secretBn = BigInt(noteSecret) % FIELD_SIZE;
    const nullifierBn = BigInt(noteNullifier) % FIELD_SIZE;
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    const amountBn = BigInt(amountWei) % FIELD_SIZE;

    const assetAddress = resolveAssetAddress(asset);
    const assetBn = BigInt(assetAddress);

    const recipientHash = BigInt(ethers.keccak256(ethers.toUtf8Bytes(recipient || '0msk1self'))) % FIELD_SIZE;

    const poseidonCommitment = poseidon5([secretBn, nullifierBn, amountBn, assetBn, recipientHash]);
    const commitment = ethers.toBeHex(poseidonCommitment, 32);

    const poseidonNullifier = poseidon2([nullifierBn, 0n]);
    const nullifierHash = ethers.toBeHex(poseidonNullifier, 32);

    return {
        amount: amount.toString(),
        amountWei: amountWei.toString(),
        asset: assetAddress === ethers.ZeroAddress ? 'ETH' : assetAddress,
        assetAddress,
        decimals,
        secret: noteSecret,
        nullifier: noteNullifier,
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
        decimals: note.decimals,
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

function serializeNote(note, chainId = 1) {
    if (!note || !note.secret || !note.nullifier || !note.amount) {
        throw new Error('invalid note object');
    }
    const payload = [
        'v1',
        chainId.toString(),
        note.assetAddress || ethers.ZeroAddress,
        note.amount,
        note.decimals !== undefined ? note.decimals.toString() : '18',
        note.secret,
        note.nullifier,
        note.recipient || ''
    ].join(':');

    const checksum = ethers.keccak256(ethers.toUtf8Bytes(payload)).substring(2, 10);
    const encoded = Buffer.from(`${payload}:${checksum}`, 'utf8').toString('base64url');
    return `mosoo-note-${encoded}`;
}

function deserializeNote(noteStr) {
    if (typeof noteStr !== 'string' || !noteStr.startsWith('mosoo-note-')) {
        throw new Error('invalid note format prefix');
    }
    const raw = Buffer.from(noteStr.replace('mosoo-note-', ''), 'base64url').toString('utf8');
    const parts = raw.split(':');
    if (parts.length !== 9 || parts[0] !== 'v1') {
        throw new Error('invalid note payload structure');
    }

    const [version, chainIdStr, assetAddress, amount, decimalsStr, secret, nullifier, recipient, checksum] = parts;
    const expectedPayload = parts.slice(0, 8).join(':');
    const expectedChecksum = ethers.keccak256(ethers.toUtf8Bytes(expectedPayload)).substring(2, 10);

    if (checksum !== expectedChecksum) {
        throw new Error('note checksum verification failed');
    }

    return {
        ...createNote({
            amount,
            asset: assetAddress,
            recipient: recipient || undefined,
            decimals: parseInt(decimalsStr, 10),
            secret,
            nullifier
        }),
        chainId: parseInt(chainIdStr, 10)
    };
}

async function signUnshieldProof(signer, { root, nullifierHash, recipient, relayer, fee, chainId, poolAddress }) {
    const messageHash = ethers.keccak256(
        ethers.solidityPacked(
            ['bytes32', 'bytes32', 'address', 'address', 'uint256', 'uint256', 'address'],
            [root, nullifierHash, recipient, relayer, fee, chainId, poolAddress]
        )
    );
    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    return signature;
}

async function signTransact2to2Proof(signer, { root, inputNullifiers, outputCommitments, relayer, fee, chainId, poolAddress }) {
    const messageHash = ethers.keccak256(
        ethers.solidityPacked(
            ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'address', 'uint256', 'uint256', 'address'],
            [
                root,
                inputNullifiers[0],
                inputNullifiers[1],
                outputCommitments[0],
                outputCommitments[1],
                relayer,
                fee,
                chainId,
                poolAddress
            ]
        )
    );
    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    return signature;
}

module.exports = {
    deriveKeys,
    createNote,
    serializeNote,
    deserializeNote,
    signUnshieldProof,
    signTransact2to2Proof,
    resolveAssetAddress,
    extractPublicKey,
    encryptMemo,
    decryptMemo,
    FIELD_SIZE
};
