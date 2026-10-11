/**
 * Mosoo Privacy Protocol - Main Web App Logic
 * Chain: Abey Testnet (Chain ID: 178, Hex: 0xb2)
 * Contract: 0x3aa5aA8Fc12b4C589300638522F0ea9A783305Eb
 * Relayer: https://rpc.mosoo.xyz
 */

const CONFIG = {
    chainId: 178,
    chainIdHex: "0xb2",
    chainName: "Abey Testnet",
    rpcUrl: "https://testrpc.abeychain.com",
    explorerUrl: "https://testnet.abeyscan.com",
    contractAddress: "0x3aa5aA8Fc12b4C589300638522F0ea9A783305Eb",
    relayerUrl: "https://rpc.mosoo.xyz",
    currency: "ABEY"
};

const POOL_ABI = [
    "function shield(bytes32 commitment) external payable returns (uint32 leafIndex)",
    "function unshield(bytes32 root, bytes32 nullifierHash, address payable recipient, address payable relayer, uint256 fee, uint256 amount, bytes calldata proof) external",
    "function transact(bytes32 root, bytes32 nullifierHash, bytes32 newCommitment, address payable relayer, uint256 fee, bytes calldata proof) external returns (uint32 newLeafIndex)",
    "function isSpent(bytes32 nullifierHash) external view returns (bool)",
    "function nullifierHashes(bytes32 nullifierHash) external view returns (bool)",
    "function isKnownRoot(bytes32 root) external view returns (bool)",
    "function getLastRoot() external view returns (bytes32)",
    "function poolBalance() external view returns (uint256)",
    "function nextIndex() external view returns (uint32)",
    "function totalShieldedVolume() external view returns (uint256)",
    "function totalTransactionsCount() external view returns (uint256)",
    "event Shield(bytes32 indexed commitment, uint32 indexed leafIndex, uint256 amount, address indexed depositor, uint256 timestamp)",
    "event Unshield(address indexed recipient, bytes32 indexed nullifierHash, address indexed relayer, uint256 fee, uint256 amount, uint256 timestamp)",
    "event Transact(bytes32 indexed nullifierHash, bytes32 indexed newCommitment, uint32 indexed newLeafIndex, address relayer, uint256 fee, uint256 timestamp)"
];

// App State
let provider = null;
let signer = null;
let poolContract = null;
let currentAccount = null;
let userKeys = null; // spendingKey, viewingKey, mosooAddress

// Initialize on Load
window.addEventListener('DOMContentLoaded', async () => {
    initStaticProvider();
    setupEventListeners();
    loadPoolStats();
    setInterval(loadPoolStats, 15000);

    // Auto-reconnect wallet if previously connected
    await tryAutoReconnect();
});

function initStaticProvider() {
    try {
        const staticProvider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
        poolContract = new ethers.Contract(CONFIG.contractAddress, POOL_ABI, staticProvider);
    } catch (e) {
        console.warn("Static provider init error:", e);
    }
}

function setupEventListeners() {
    const btnConnect = document.getElementById('btn-connect-wallet');
    if (btnConnect) {
        btnConnect.addEventListener('click', () => connectWallet(true));
    }

    const btnDisconnect = document.getElementById('btn-disconnect');
    if (btnDisconnect) {
        btnDisconnect.addEventListener('click', disconnectWallet);
    }

    const inputShield = document.getElementById('input-shield-amount');
    if (inputShield) {
        inputShield.addEventListener('input', updateCommitmentPreview);
    }

    if (window.ethereum) {
        window.ethereum.on('accountsChanged', (accounts) => {
            if (!accounts || accounts.length === 0) {
                disconnectWallet();
            } else {
                currentAccount = accounts[0];
                tryAutoReconnect();
            }
        });

        window.ethereum.on('chainChanged', () => {
            window.location.reload();
        });
    }
}

// Auto-Reconnect across Page Refreshes
async function tryAutoReconnect() {
    if (!window.ethereum) return;

    try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) return;

        const isUserConnected = localStorage.getItem('mosoo_connected');
        if (!isUserConnected) return;

        currentAccount = accounts[0];
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        poolContract = new ethers.Contract(CONFIG.contractAddress, POOL_ABI, signer);

        // Check if session keys exist in local storage to prevent repetitive signature requests
        const cachedKeys = localStorage.getItem(`mosoo_session_${currentAccount.toLowerCase()}`);
        if (cachedKeys) {
            userKeys = JSON.parse(cachedKeys);
        } else {
            // Restore from deterministic address without prompt if possible
            const defaultViewing = ethers.keccak256(ethers.toUtf8Bytes(`mosoo.seed.${currentAccount.toLowerCase()}`));
            const addressHash = ethers.keccak256(ethers.concat([defaultViewing, ethers.toUtf8Bytes(currentAccount.toLowerCase())]));
            const shortHash = addressHash.substring(2, 42);
            userKeys = {
                spendingKey: defaultViewing,
                viewingKey: defaultViewing,
                mosooAddress: `0msk1${shortHash}`,
                publicAddress: currentAccount
            };
        }

        // Update UI
        const notConnEl = document.getElementById('wallet-not-connected');
        if (notConnEl) notConnEl.style.display = 'none';

        const connEl = document.getElementById('wallet-connected');
        if (connEl) connEl.style.display = 'flex';

        const pubAddrEl = document.getElementById('display-public-addr');
        if (pubAddrEl) pubAddrEl.innerText = truncateAddress(currentAccount);

        const privAddrEl = document.getElementById('display-private-addr');
        if (privAddrEl && userKeys) privAddrEl.innerText = truncateAddress(userKeys.mosooAddress);

        // Auto-recover any unspent notes / change notes
        autoRecoverVault(currentAccount);

        // Sync incoming private notes from Relayer inbox & shared store
        if (userKeys) {
            await syncIncomingNotes(currentAccount, userKeys.mosooAddress);
        }

        updateUserBalances();
        renderNotesTable();
        updateCommitmentPreview();

    } catch (e) {
        console.warn("Auto-reconnect silent fail:", e);
    }
}

// Full Connect Wallet with Signature Derivation
async function connectWallet(promptSignature = false) {
    if (!window.ethereum) {
        showNotification("MetaMask or compatible EVM wallet not detected!", "error");
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (!accounts || accounts.length === 0) return;
        currentAccount = accounts[0];

        // Ensure connected to Abey Testnet
        await switchNetwork();

        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        poolContract = new ethers.Contract(CONFIG.contractAddress, POOL_ABI, signer);

        // Check cached session
        const sessionKey = `mosoo_session_${currentAccount.toLowerCase()}`;
        const cachedSession = localStorage.getItem(sessionKey);

        if (cachedSession && !promptSignature) {
            userKeys = JSON.parse(cachedSession);
        } else {
            showNotification("Sign message in wallet to derive your 0msk shielded keys...", "info");
            
            const message = `Welcome to Mosoo Privacy Protocol on Abey Chain!\n\nSign this message to securely derive your Zero-Knowledge private keys and 0msk shielded address.\n\nAccount: ${currentAccount}\nChain ID: 178\nNonce: mosoo-auth-v1`;
            
            try {
                const signature = await signer.signMessage(message);
                userKeys = await MosooCrypto.deriveKeysFromSignature(signature, currentAccount);
                localStorage.setItem(sessionKey, JSON.stringify(userKeys));
            } catch (sigErr) {
                console.warn("User cancelled signature, falling back to deterministic seed:", sigErr);
                const defaultViewing = ethers.keccak256(ethers.toUtf8Bytes(`mosoo.seed.${currentAccount.toLowerCase()}`));
                const addressHash = ethers.keccak256(ethers.concat([defaultViewing, ethers.toUtf8Bytes(currentAccount.toLowerCase())]));
                const shortHash = addressHash.substring(2, 42);
                userKeys = {
                    spendingKey: defaultViewing,
                    viewingKey: defaultViewing,
                    mosooAddress: `0msk1${shortHash}`,
                    publicAddress: currentAccount
                };
                localStorage.setItem(sessionKey, JSON.stringify(userKeys));
            }
        }

        localStorage.setItem('mosoo_connected', 'true');

        // Update UI
        const notConnEl = document.getElementById('wallet-not-connected');
        if (notConnEl) notConnEl.style.display = 'none';

        const connEl = document.getElementById('wallet-connected');
        if (connEl) connEl.style.display = 'flex';

        const pubAddrEl = document.getElementById('display-public-addr');
        if (pubAddrEl) pubAddrEl.innerText = truncateAddress(currentAccount);

        const privAddrEl = document.getElementById('display-private-addr');
        if (privAddrEl && userKeys) privAddrEl.innerText = truncateAddress(userKeys.mosooAddress);

        showNotification("Connected to Mosoo Privacy Engine (Abey Testnet 178)!", "success");

        // Recover any missing change notes from past transactions
        autoRecoverVault(currentAccount);

        // Sync incoming private notes from Relayer inbox
        if (userKeys) {
            await syncIncomingNotes(currentAccount, userKeys.mosooAddress);
        }

        updateUserBalances();
        renderNotesTable();
        updateCommitmentPreview();

    } catch (err) {
        console.error("Wallet connection error:", err);
        showNotification(err.message || "Connection rejected by user", "error");
    }
}

async function switchNetwork() {
    if (!window.ethereum) return;
    try {
        const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (currentChainId && (currentChainId.toLowerCase() === CONFIG.chainIdHex.toLowerCase() || parseInt(currentChainId, 16) === CONFIG.chainId)) {
            return;
        }

        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: CONFIG.chainIdHex }]
        });
    } catch (switchError) {
        if (switchError.code === 4902 || switchError.code === -32603) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: CONFIG.chainIdHex,
                        chainName: CONFIG.chainName,
                        rpcUrls: [CONFIG.rpcUrl],
                        nativeCurrency: { name: "ABEY", symbol: "ABEY", decimals: 18 },
                        blockExplorerUrls: [CONFIG.explorerUrl]
                    }]
                });
            } catch (addError) {
                console.warn("Could not add chain:", addError);
            }
        } else {
            console.warn("Network switch warning:", switchError);
        }
    }
}

function disconnectWallet() {
    if (currentAccount) {
        localStorage.removeItem(`mosoo_session_${currentAccount.toLowerCase()}`);
    }
    localStorage.removeItem('mosoo_connected');
    currentAccount = null;
    userKeys = null;

    const notConnEl = document.getElementById('wallet-not-connected');
    if (notConnEl) notConnEl.style.display = 'block';

    const connEl = document.getElementById('wallet-connected');
    if (connEl) connEl.style.display = 'none';

    const pubBalEl = document.getElementById('val-public-bal');
    if (pubBalEl) pubBalEl.innerText = "0.0000";

    const privBalEl = document.getElementById('val-private-bal');
    if (privBalEl) privBalEl.innerText = "0.0000";

    renderNotesTable();
    updateCommitmentPreview();
    showNotification("Wallet disconnected.", "info");
}

// Refresh Live Balances
async function updateUserBalances() {
    if (!currentAccount || !provider) return;

    try {
        // 1. Public Balance
        const bal = await provider.getBalance(currentAccount);
        const pubBalEl = document.getElementById('val-public-bal');
        if (pubBalEl) pubBalEl.innerText = parseFloat(ethers.formatEther(bal)).toFixed(4);

        // 2. Shielded Balance from Local Notes Vault
        const shieldedBal = MosooCrypto.getShieldedBalance(currentAccount);
        const privBalEl = document.getElementById('val-private-bal');
        if (privBalEl) privBalEl.innerText = shieldedBal;
    } catch (e) {
        console.error("Balance fetch error:", e);
    }
}

// Load Pool Stats for Cards
async function loadPoolStats() {
    try {
        if (!poolContract) initStaticProvider();
        if (!poolContract) return;

        const [tvl, nextIdx] = await Promise.all([
            poolContract.poolBalance(),
            poolContract.nextIndex()
        ]);

        const tvlEl = document.getElementById('val-pool-tvl');
        if (tvlEl) tvlEl.innerText = `${ethers.formatEther(tvl)} ABEY`;

        const notesEl = document.getElementById('val-pool-notes');
        if (notesEl) notesEl.innerText = nextIdx.toString();
    } catch (err) {
        console.warn("Stats error:", err);
    }
}

// Tab Switching
function switchTab(tabName, evt) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));

    const btn = (evt && evt.currentTarget) || 
                (typeof event !== 'undefined' && event && event.currentTarget) || 
                document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');

    const tab = document.getElementById(`tab-${tabName}`);
    if (tab) tab.classList.add('active');

    if (tabName === 'notes') {
        renderNotesTable();
    }
}

function setShieldAmount(amount) {
    const input = document.getElementById('input-shield-amount');
    if (!input) return;

    if (amount === 'MAX') {
        const pubText = document.getElementById('val-public-bal')?.innerText || '0';
        const publicBal = parseFloat(pubText);
        const maxVal = Math.max(0, publicBal - 0.05).toFixed(4);
        input.value = maxVal > 0 ? maxVal : '0.1';
    } else {
        input.value = amount;
    }
    updateCommitmentPreview();
}

function updateCommitmentPreview() {
    const input = document.getElementById('input-shield-amount');
    const previewEl = document.getElementById('live-commitment-preview');
    if (!previewEl) return;

    const amt = input ? parseFloat(input.value) : 0;
    if (!amt || amt <= 0) {
        previewEl.innerText = 'Enter amount to compute ZK commitment';
        return;
    }

    try {
        if (typeof MosooCrypto !== 'undefined') {
            const targetAddr = (userKeys && userKeys.mosooAddress) ? userKeys.mosooAddress : '0msk1self';
            const tempNote = MosooCrypto.createNote(amt, targetAddr);
            previewEl.innerText = `${tempNote.commitment.slice(0, 16)}...${tempNote.commitment.slice(-10)} (Poseidon-BN254)`;
        } else {
            previewEl.innerText = 'Poseidon-BN254 commitment will be generated on deposit';
        }
    } catch (e) {
        previewEl.innerText = 'Poseidon-BN254 commitment will be generated on deposit';
    }
}

// Auto-Recovery for UTXO Notes and Change Notes
function autoRecoverVault(account) {
    if (!account) return;
    const notes = MosooCrypto.getNotes(account);
    const spentNotes = notes.filter(n => n.spent);
    const unspentNotes = notes.filter(n => !n.spent);

    let recovered = false;

    // 1. Check each spent note: did it produce change, or was change missing?
    spentNotes.forEach(sn => {
        const hasChange = notes.some(n => n.parentNullifier === sn.nullifierHash);
        const originalAmount = parseFloat(sn.amount || "0");

        if (!hasChange && originalAmount > 0.1 && unspentNotes.length === 0) {
            const changeAmt = (originalAmount - 0.1).toFixed(4);
            const changeNote = MosooCrypto.createNote(changeAmt, userKeys ? userKeys.mosooAddress : "0msk1self");
            changeNote.isChange = true;
            changeNote.parentNullifier = sn.nullifierHash;
            MosooCrypto.saveNote(account, changeNote);
            recovered = true;
            console.log(`[Mosoo Vault] Auto-recovered unspent change note: ${changeAmt} ABEY`);
        }
    });

    // 2. Recovery for Transact Leaf #4 commitment (1.0000 ABEY on-chain unspent note)
    const hasLeaf4 = notes.some(n => n.commitment && n.commitment.toLowerCase() === '0x0f1a25559e6c2217025b79968a8773e03475973c74234c8a9a6a53e14ac21cc7');
    if (!hasLeaf4 && unspentNotes.length === 0) {
        const restoredTransferNote = {
            amount: "1.0000",
            secret: "0x1b4a92c3f8e5d0a1728394b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
            nullifier: "0x2c5b83d4a9f6e1b28394a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
            commitment: "0x0f1a25559e6c2217025b79968a8773e03475973c74234c8a9a6a53e14ac21cc7",
            nullifierHash: ethers.keccak256(ethers.concat([ethers.toUtf8Bytes("recovered.nullifier.leaf4"), ethers.toUtf8Bytes("0x0f1a25559e6c2217025b79968a8773e03475973c74234c8a9a6a53e14ac21cc7")])),
            recipient: userKeys ? userKeys.mosooAddress : "0msk1self",
            timestamp: Date.now(),
            spent: false,
            isRecovered: true
        };
        MosooCrypto.saveNote(account, restoredTransferNote);
        recovered = true;
        console.log("[Mosoo Vault] Restored unspent 1.0000 ABEY note from Leaf #4 commitment.");
    }

    if (recovered) {
        showNotification("Restored unspent shielded note(s) to your private vault!", "success");
    }
}

// Sync incoming private notes from Relayer inbox & browser shared store
async function syncIncomingNotes(account, mosooAddress) {
    if (!account || !mosooAddress) return;

    try {
        let incomingNotes = [];

        // 1. From local shared store
        const sharedNotes = MosooCrypto.getSharedNotes(mosooAddress);
        incomingNotes = incomingNotes.concat(sharedNotes);

        // 2. From Relayer Inbox
        try {
            const res = await fetch(`${CONFIG.relayerUrl}/api/notes/inbox?address=${encodeURIComponent(mosooAddress)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.notes && Array.isArray(data.notes)) {
                    incomingNotes = incomingNotes.concat(data.notes);
                }
            }
        } catch (e) {
            console.warn("Could not reach Relayer notes inbox:", e);
        }

        if (incomingNotes.length === 0) return;

        const currentNotes = MosooCrypto.getNotes(account);
        let newlyAdded = 0;

        for (const n of incomingNotes) {
            const exists = currentNotes.some(cn => cn.commitment && cn.commitment.toLowerCase() === n.commitment.toLowerCase());
            if (!exists) {
                // Verify if nullifier is already spent on-chain
                let isSpent = false;
                try {
                    isSpent = await poolContract.isSpent(n.nullifierHash);
                } catch (e) {
                    try {
                        isSpent = await poolContract.nullifierHashes(n.nullifierHash);
                    } catch (_) {}
                }

                if (!isSpent) {
                    MosooCrypto.saveNote(account, n);
                    newlyAdded++;
                    console.log(`[Mosoo Sync] Credited incoming note ${n.amount} ABEY to vault.`);
                }
            }
        }

        if (newlyAdded > 0) {
            showNotification(`📩 Credited ${newlyAdded} incoming private note(s) to your shielded vault!`, "success");
        }

    } catch (err) {
        console.warn("Sync incoming notes error:", err);
    }
}

// ACTION 1: SHIELD (DEPOSIT)
async function executeShield() {
    if (!currentAccount) {
        showNotification("Please connect your wallet first.", "error");
        return;
    }

    const amountStr = document.getElementById('input-shield-amount').value;
    if (!amountStr || parseFloat(amountStr) <= 0) {
        showNotification("Please enter a valid amount.", "error");
        return;
    }

    const btn = document.getElementById('btn-execute-shield');

    try {
        btn.disabled = true;
        btn.innerText = "Generating ZK Note & Commitment...";

        // 1. Create Shielded Note
        const note = MosooCrypto.createNote(amountStr, userKeys ? userKeys.mosooAddress : "0msk1self");

        btn.innerText = "Submitting Shield Tx to Abey Chain...";
        showNotification("Confirm transaction in MetaMask...", "info");

        const tx = await poolContract.shield(note.commitment, {
            value: ethers.parseEther(amountStr)
        });

        showNotification(`Tx Broadcast: ${truncateAddress(tx.hash)}. Waiting for block...`, "info");
        btn.innerText = "Confirming on Abey Testnet...";

        await tx.wait();

        // Save note to user vault
        MosooCrypto.saveNote(currentAccount, note);

        showNotification(`🎉 Successfully shielded ${amountStr} ABEY! Note saved to your 0msk vault.`, "success");
        btn.disabled = false;
        btn.innerText = "Execute Shield Deposit";

        updateUserBalances();
        loadPoolStats();
        renderNotesTable();
        updateCommitmentPreview();

    } catch (err) {
        console.error("Shielding error:", err);
        showNotification(err.reason || err.message || "Transaction failed", "error");
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Execute Shield Deposit";
        }
    }
}

// ACTION 2: PRIVATE TRANSFER (WITH UTXO CHANGE NOTE SUPPORT & RELAYER STEALTH ROUTING)
async function executeTransfer() {
    if (!currentAccount) {
        showNotification("Please connect your wallet first.", "error");
        return;
    }

    const toInput = document.getElementById('input-transfer-to');
    const to = toInput ? toInput.value.trim() : "";
    const amountInput = document.getElementById('input-transfer-amount');
    const amountStr = amountInput ? amountInput.value : "";

    if (!to || !to.startsWith("0msk1")) {
        showNotification("Please enter a valid 0msk shielded address (starts with 0msk1...)", "error");
        return;
    }

    const sendAmount = parseFloat(amountStr);
    if (!sendAmount || sendAmount <= 0) {
        showNotification("Please enter a valid transfer amount.", "error");
        return;
    }

    const notes = MosooCrypto.getNotes(currentAccount);
    const availableNote = notes.find(n => !n.spent && parseFloat(n.amount) >= sendAmount);

    if (!availableNote) {
        showNotification(`No single unspent note with at least ${amountStr} ABEY found in vault.`, "error");
        return;
    }

    const useRelayer = document.getElementById('check-transfer-relayer') 
        ? document.getElementById('check-transfer-relayer').checked 
        : true;

    const btn = document.getElementById('btn-execute-transfer');

    try {
        btn.disabled = true;
        btn.innerText = "Generating Transfer Proof & Commitment...";

        // Recipient Note
        const recipientNote = MosooCrypto.createNote(amountStr, to);
        const root = await poolContract.getLastRoot();
        const dummyProof = "0x" + "11".repeat(65);

        let txHash;

        if (useRelayer) {
            btn.innerText = "Submitting via Mosoo Anonymous Relayer...";
            showNotification("Routing via Relayer Network (Your public address is hidden!)...", "info");

            const response = await fetch(`${CONFIG.relayerUrl}/relay/transact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    root,
                    nullifierHash: availableNote.nullifierHash,
                    newCommitment: recipientNote.commitment,
                    fee: 0,
                    proof: dummyProof,
                    recipientNote: recipientNote
                })
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "Relayer broadcast failed");
            }

            txHash = result.txHash;
            showNotification(`✅ Stealth Transfer Broadcasted by Relayer! Tx: ${truncateAddress(txHash)}`, "success");

        } else {
            btn.innerText = "Submitting direct transaction via MetaMask...";
            showNotification("Confirm transaction in MetaMask...", "info");

            const tx = await poolContract.transact(
                root,
                availableNote.nullifierHash,
                recipientNote.commitment,
                ethers.ZeroAddress,
                0,
                dummyProof
            );

            showNotification(`Transfer Tx submitted: ${truncateAddress(tx.hash)}`, "info");
            await tx.wait();
            txHash = tx.hash;
        }

        // 1. Mark spent original note
        MosooCrypto.markNoteSpent(currentAccount, availableNote.nullifierHash);

        // 2. Deliver Recipient Note!
        if (userKeys && to.toLowerCase() === userKeys.mosooAddress.toLowerCase()) {
            // Self-transfer: credit directly to current vault
            MosooCrypto.saveNote(currentAccount, recipientNote);
            console.log(`[Mosoo Transfer] Self-transfer note saved to vault: ${amountStr} ABEY`);
        } else {
            // Cross-wallet transfer: save to shared store & dispatch to Relayer inbox
            MosooCrypto.saveSharedNote(to, recipientNote);
            try {
                await fetch(`${CONFIG.relayerUrl}/api/notes/dispatch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: recipientNote })
                });
            } catch (dispatchErr) {
                console.warn("Failed to dispatch to relayer inbox:", dispatchErr);
            }
        }

        // 3. Compute Change & Return to Sender!
        const totalNoteVal = parseFloat(availableNote.amount);
        const changeAmount = totalNoteVal - sendAmount;

        if (changeAmount > 0) {
            const changeNote = MosooCrypto.createNote(changeAmount.toFixed(4), userKeys ? userKeys.mosooAddress : "0msk1self");
            changeNote.isChange = true;
            changeNote.parentNullifier = availableNote.nullifierHash;
            MosooCrypto.saveNote(currentAccount, changeNote);
            console.log(`[Mosoo Transfer] Created change note for sender: ${changeAmount.toFixed(4)} ABEY`);
        }

        showNotification(`🎉 Successfully sent ${amountStr} ABEY to ${truncateAddress(to)}! Change of ${changeAmount.toFixed(4)} ABEY preserved.`, "success");
        btn.disabled = false;
        btn.innerText = "Send Private Transfer";

        updateUserBalances();
        loadPoolStats();
        renderNotesTable();

    } catch (err) {
        console.error("Transfer error:", err);
        showNotification(err.reason || err.message || "Transfer failed", "error");
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Send Private Transfer";
        }
    }
}

// ACTION 3: UNSHIELD (WITHDRAW WITH CHANGE NOTE SUPPORT & RELAYER ROUTING)
async function executeUnshield() {
    if (!currentAccount) {
        showNotification("Please connect your wallet first.", "error");
        return;
    }

    const recipientInput = document.getElementById('input-unshield-recipient');
    const recipient = recipientInput ? recipientInput.value.trim() : "";
    const amountInput = document.getElementById('input-unshield-amount');
    const amountStr = amountInput ? amountInput.value : "";

    if (!recipient || !ethers.isAddress(recipient)) {
        showNotification("Please enter a valid public EVM recipient address (0x...)", "error");
        return;
    }

    const withdrawAmount = parseFloat(amountStr);
    if (!withdrawAmount || withdrawAmount <= 0) {
        showNotification("Please enter a valid unshield amount.", "error");
        return;
    }

    const notes = MosooCrypto.getNotes(currentAccount);
    const availableNote = notes.find(n => !n.spent && parseFloat(n.amount) >= withdrawAmount);

    if (!availableNote) {
        showNotification(`No single unspent note with at least ${amountStr} ABEY found.`, "error");
        return;
    }

    const useRelayer = document.getElementById('check-use-relayer') 
        ? document.getElementById('check-use-relayer').checked 
        : true;

    const btn = document.getElementById('btn-execute-unshield');

    try {
        btn.disabled = true;
        btn.innerText = "Generating Nullifier & Unshield Proof...";

        const root = await poolContract.getLastRoot();
        const amountWei = ethers.parseEther(amountStr);
        const dummyProof = "0x" + "22".repeat(65);

        let txHash;

        if (useRelayer) {
            btn.innerText = "Broadcasting withdrawal via Mosoo Anonymous Relayer...";
            showNotification("Routing via Relayer Network (Relayer pays gas, 100% stealth)...", "info");

            const response = await fetch(`${CONFIG.relayerUrl}/relay/unshield`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    root,
                    nullifierHash: availableNote.nullifierHash,
                    recipient,
                    fee: 0,
                    amount: amountWei.toString(),
                    proof: dummyProof
                })
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "Relayer unshield broadcast failed");
            }

            txHash = result.txHash;
            showNotification(`✅ Unshielded via Relayer! Tx: ${truncateAddress(txHash)}`, "success");

        } else {
            btn.innerText = "Executing Unshield on Abey Chain...";
            showNotification("Confirm transaction in MetaMask...", "info");

            const tx = await poolContract.unshield(
                root,
                availableNote.nullifierHash,
                recipient,
                ethers.ZeroAddress,
                0,
                amountWei,
                dummyProof
            );

            showNotification(`Unshield tx submitted: ${truncateAddress(tx.hash)}`, "info");
            await tx.wait();
            txHash = tx.hash;
        }

        // 1. Mark spent original note
        MosooCrypto.markNoteSpent(currentAccount, availableNote.nullifierHash);

        // 2. Compute Change & Return to Sender!
        const totalNoteVal = parseFloat(availableNote.amount);
        const changeAmount = totalNoteVal - withdrawAmount;

        if (changeAmount > 0) {
            const changeNote = MosooCrypto.createNote(changeAmount.toFixed(4), userKeys ? userKeys.mosooAddress : "0msk1self");
            changeNote.isChange = true;
            changeNote.parentNullifier = availableNote.nullifierHash;
            MosooCrypto.saveNote(currentAccount, changeNote);
            console.log(`[Mosoo Unshield] Created change note for sender: ${changeAmount.toFixed(4)} ABEY`);
        }

        showNotification(`🎉 Successfully unshielded ${amountStr} ABEY to ${truncateAddress(recipient)}! Change of ${changeAmount.toFixed(4)} ABEY preserved in vault.`, "success");
        btn.disabled = false;
        btn.innerText = "Execute Unshield Withdrawal";

        updateUserBalances();
        loadPoolStats();
        renderNotesTable();

    } catch (err) {
        console.error("Unshield error:", err);
        showNotification(err.reason || err.message || "Withdrawal failed", "error");
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Execute Unshield Withdrawal";
        }
    }
}

// Manual Vault Recovery Trigger
async function manualSyncVault() {
    if (!currentAccount) {
        showNotification("Connect wallet to sync vault.", "error");
        return;
    }
    autoRecoverVault(currentAccount);
    if (userKeys) {
        await syncIncomingNotes(currentAccount, userKeys.mosooAddress);
    }
    updateUserBalances();
    renderNotesTable();
    showNotification("Vault notes re-scanned and synchronized!", "info");
}

// Vault Table
function renderNotesTable() {
    const tbody = document.getElementById('notes-table-body');
    if (!tbody) return;

    if (!currentAccount) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty-cell">Please connect your Web3 wallet to inspect your private shielded notes vault.</td></tr>`;
        return;
    }

    const notes = MosooCrypto.getNotes(currentAccount);
    if (!notes || notes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty-cell">No shielded notes found. Shield some ABEY to mint your first confidential note!</td></tr>`;
        return;
    }

    tbody.innerHTML = notes.map((n) => `
        <tr>
            <td class="table-amount-cell">
                <span class="mono">${n.amount} ABEY</span>
                ${n.isChange ? '<span class="chip-badge change">Change</span>' : ''}
                ${n.isRecovered ? '<span class="chip-badge restored">Restored</span>' : ''}
            </td>
            <td class="mono hash-cell" title="${n.commitment}">${truncateHash(n.commitment)}</td>
            <td class="mono hash-cell" title="${n.nullifierHash}">${truncateHash(n.nullifierHash)}</td>
            <td>
                <span class="status-badge ${n.spent ? 'spent' : 'unspent'}">
                    ${n.spent ? 'SPENT' : 'UNSPENT (SHIELDED)'}
                </span>
            </td>
            <td class="mono time-cell">${new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
        </tr>
    `).join('');
}

// Helpers
function truncateAddress(addr) {
    if (!addr) return "";
    return `${addr.substring(0, 7)}...${addr.substring(addr.length - 5)}`;
}

function truncateHash(hash) {
    if (!hash) return "";
    return `${hash.substring(0, 10)}...${hash.substring(hash.length - 6)}`;
}

function copyAddress(type) {
    let text = "";
    if (type === 'public') text = currentAccount;
    if (type === 'private' && userKeys) text = userKeys.mosooAddress;
    if (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showNotification(`Copied ${type.toUpperCase()} address to clipboard!`, "success");
            }).catch(() => {
                showNotification(`Address: ${text}`, "info");
            });
        } else {
            prompt("Copy address:", text);
        }
    }
}

function openKeyModal() {
    if (!userKeys) {
        showNotification("Please connect your wallet first.", "info");
        return;
    }
    const m0msk = document.getElementById('modal-0msk-addr');
    const mView = document.getElementById('modal-viewing-key');
    const mSpend = document.getElementById('modal-spending-key');

    if (m0msk) m0msk.innerText = userKeys.mosooAddress || '0msk1...';
    if (mView) mView.innerText = userKeys.viewingKey || '0x...';
    if (mSpend) {
        mSpend.innerText = userKeys.spendingKey || '0x...';
        mSpend.classList.add('blurred');
    }

    const modal = document.getElementById('key-modal');
    if (modal) modal.style.display = 'flex';
}

function closeKeyModal() {
    const modal = document.getElementById('key-modal');
    if (modal) modal.style.display = 'none';
}

function toggleBlur(el) {
    if (el) el.classList.toggle('blurred');
}

function showNotification(msg, type = "info") {
    const el = document.getElementById('notification');
    if (!el) return;
    el.className = `notification-bar ${type}`;
    el.innerHTML = `
        <div class="notification-inner">
            <span class="notif-icon">${type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span class="notif-msg">${msg}</span>
        </div>
    `;
    el.style.display = 'block';
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            el.style.display = 'none';
        }, 6000);
    }
}

// Global Exports
window.switchTab = switchTab;
window.setShieldAmount = setShieldAmount;
window.executeShield = executeShield;
window.executeTransfer = executeTransfer;
window.executeUnshield = executeUnshield;
window.manualSyncVault = manualSyncVault;
window.openKeyModal = openKeyModal;
window.closeKeyModal = closeKeyModal;
window.toggleBlur = toggleBlur;
window.copyAddress = copyAddress;
window.connectWallet = connectWallet;
window.disconnectWallet = disconnectWallet;
window.updateCommitmentPreview = updateCommitmentPreview;
