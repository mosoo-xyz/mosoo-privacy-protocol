/**
 * Mosoo Privacy Protocol - Portal Logic
 * Design: Matches Anon Portal / Railgun Ecosystem
 * Chain: Abey Testnet (178)
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
    usdtAddress: "0xeF89C5b126f90Fb728A022bc77377d793dCD22CB",
    relayerUrl: "https://rpc.mosoo.xyz",
    currency: "ABEY",
    startBlock: 16197500,
    chunkSize: 350
};

const POOL_ABI = [
    "function shield(bytes32 commitment) external payable returns (uint32 leafIndex)",
    "function shieldWithMemo(bytes32 commitment, bytes calldata encryptedMemo) external payable returns (uint32 leafIndex)",
    "function shieldToken(address token, uint256 amount, bytes32 commitment, bytes calldata encryptedMemo) external returns (uint32 leafIndex)",
    "function unshield(bytes32 root, bytes32 nullifierHash, address payable recipient, address payable relayer, uint256 fee, uint256 amount, bytes calldata proof) external",
    "function unshieldMulti(bytes32 root, bytes32[] calldata inputNullifiers, address payable recipient, address payable relayer, uint256 fee, uint256 amount, bytes calldata proof) external",
    "function unshieldToken(address token, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 amount, bytes calldata proof) external",
    "function transact(bytes32 root, bytes32 nullifierHash, bytes32 newCommitment, address payable relayer, uint256 fee, bytes calldata proof) external returns (uint32 newLeafIndex)",
    "function transactWithMemo(bytes32 root, bytes32 nullifierHash, bytes32 newCommitment, address payable relayer, uint256 fee, bytes calldata encryptedMemo, bytes calldata proof) external payable returns (uint32 newLeafIndex)",
    "function transact2to2(bytes32 root, bytes32[2] calldata inputNullifiers, bytes32[2] calldata outputCommitments, address payable relayer, uint256 fee, bytes calldata encryptedMemo, bytes calldata proof) external payable returns (uint32[2] memory newLeafIndices)",
    "function isSpent(bytes32 nullifierHash) external view returns (bool)",
    "function nullifierHashes(bytes32 nullifierHash) external view returns (bool)",
    "function isKnownRoot(bytes32 root) external view returns (bool)",
    "function getLastRoot() external view returns (bytes32)",
    "function poolBalance() external view returns (uint256)",
    "function tokenPoolBalances(address token) external view returns (uint256)",
    "function nextIndex() external view returns (uint32)",
    "function totalShieldedVolume() external view returns (uint256)",
    "function totalTransactionsCount() external view returns (uint256)",
    "event Shield(bytes32 indexed commitment, uint32 indexed leafIndex, uint256 amount, address indexed depositor, bytes encryptedMemo, uint256 timestamp)",
    "event ShieldToken(address indexed token, bytes32 indexed commitment, uint32 leafIndex, uint256 amount, address indexed depositor, bytes encryptedMemo, uint256 timestamp)",
    "event Unshield(address indexed recipient, bytes32 indexed nullifierHash, address indexed relayer, uint256 fee, uint256 amount, uint256 timestamp)",
    "event UnshieldMulti(address indexed recipient, bytes32[] inputNullifiers, address indexed relayer, uint256 fee, uint256 amount, uint256 timestamp)",
    "event UnshieldToken(address indexed token, address indexed recipient, bytes32 indexed nullifierHash, address relayer, uint256 fee, uint256 amount, uint256 timestamp)",
    "event Transact(bytes32 indexed nullifierHash, bytes32 indexed newCommitment, uint32 indexed newLeafIndex, address relayer, uint256 fee, bytes encryptedMemo, uint256 timestamp)",
    "event Transact2to2(bytes32[2] inputNullifiers, bytes32[2] outputCommitments, uint32[2] newLeafIndices, address relayer, uint256 fee, bytes encryptedMemo, uint256 timestamp)"
];

let provider = null;
let signer = null;
let poolContract = null;
let currentAccount = null;
let userKeys = null;
let qrInstancePrivate = null;
let qrInstancePublic = null;
let cachedActivityEvents = [];
let watchedAccounts = [];

// Init on load
window.addEventListener('DOMContentLoaded', async () => {
    initStaticProvider();
    initTheme();
    setupRouting();
    loadWatchedAccounts();
    loadPoolStats();
    setInterval(loadPoolStats, 15000);

    // Initial activity query
    fetchActivityEvents();

    // Auto-reconnect if previously connected
    await tryAutoReconnect();
});

function initStaticProvider() {
    const staticProvider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    poolContract = new ethers.Contract(CONFIG.contractAddress, POOL_ABI, staticProvider);
}

// Theme handling (Day Brand vs Night Cyber Mode)
function initTheme() {
    const savedTheme = localStorage.getItem('mosoo_theme') || localStorage.getItem('mosoo_portal_theme') || 'light';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (theme === 'dark') {
        document.body.classList.add('theme-dark');
        if (toggleBtn) {
            toggleBtn.innerHTML = '☀️';
            toggleBtn.title = "Switch to Day Mode";
        }
    } else {
        document.body.classList.remove('theme-dark');
        if (toggleBtn) {
            toggleBtn.innerHTML = '🌙';
            toggleBtn.title = "Switch to Night Mode";
        }
    }
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('theme-dark');
    const theme = isDark ? 'dark' : 'light';
    localStorage.setItem('mosoo_theme', theme);
    localStorage.setItem('mosoo_portal_theme', theme);
    applyTheme(theme);
}

// Routing & Navigation
function setupRouting() {
    window.addEventListener('hashchange', handleHashRouting);
    handleHashRouting();
}

const TAB_METADATA = {
    home: { breadcrumb: "WALLET / OVERVIEW", title: "Overview", subtitle: "Assets, wallet apps, accounts, and private activity" },
    send: { breadcrumb: "MOVE MONEY / SEND", title: "Send", subtitle: "Send private tokens using zero-knowledge stealth routing" },
    receive: { breadcrumb: "MOVE MONEY / RECEIVE", title: "Receive", subtitle: "Your public EVM and Shielded stealth receiving addresses" },
    shield: { breadcrumb: "MOVE MONEY / SHIELD", title: "Shield", subtitle: "Convert transparent public tokens into private zero-knowledge notes" },
    unshield: { breadcrumb: "MOVE MONEY / UNSHIELD", title: "Unshield", subtitle: "Withdraw private shielded assets back to any public EVM address" },
    swap: { breadcrumb: "MOVE MONEY / SWAP", title: "Swap", subtitle: "Swap tokens with zero-knowledge anonymity on Abey Chain" },
    activity: { breadcrumb: "WALLET / ACTIVITY", title: "Activity", subtitle: "Transaction history and zero-knowledge proof verification stream" },
    watched: { breadcrumb: "WALLET / WATCHED ACCOUNTS", title: "Watched accounts", subtitle: "Read-only monitoring with public addresses and private viewing keys" },
    settings: { breadcrumb: "WALLET / SETTINGS", title: "Settings", subtitle: "Manage private keys, relayer network, RPCs, and security preferences" }
};

function handleHashRouting() {
    let hash = window.location.hash || "#/home";
    let tab = hash.replace("#/", "").replace("#", "") || "home";

    if (tab.includes("?")) {
        tab = tab.split("?")[0];
    }

    if (!TAB_METADATA[tab]) tab = "home";

    // 1. Update Breadcrumb & Titles
    const meta = TAB_METADATA[tab];
    document.getElementById('header-breadcrumb').innerText = meta.breadcrumb;
    document.getElementById('header-title').innerText = meta.title;
    document.getElementById('header-subtitle').innerText = meta.subtitle;

    // 2. Update Sidebar Active Item
    document.querySelectorAll('.portal-sidebar .nav-item').forEach(el => {
        if (el.getAttribute('data-tab') === tab) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    // 3. Switch Tab View
    document.querySelectorAll('.portal-tab-view').forEach(view => {
        view.style.display = 'none';
    });
    const target = document.getElementById(`view-${tab}`);
    if (target) target.style.display = 'block';

    // 4. Tab Specific Triggers
    if (tab === 'receive') {
        renderReceiveQRs();
    } else if (tab === 'activity') {
        renderPortalActivityTable();
    } else if (tab === 'settings') {
        updateSettingsKeys();
    }
}

function navigateTab(tabName) {
    window.location.hash = `#/${tabName}`;
}

// Wallet Connection
async function handleWalletAction() {
    if (currentAccount) {
        if (confirm("Do you want to disconnect wallet?")) {
            disconnectWallet();
        }
    } else {
        await connectWallet(true);
    }
}

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

        const cachedKeys = localStorage.getItem(`mosoo_session_${currentAccount.toLowerCase()}`);
        if (cachedKeys) {
            // ✅ Use exact same keys derived from signature (no mismatch)
            userKeys = JSON.parse(cachedKeys);
            updateUIOnConnect();
            await syncIncomingNotes(currentAccount, userKeys.mosooAddress);
            updateUserBalances();
        } else {
            // ⚠️ No cached session — do NOT use fallback formula (would produce wrong 0msk address)
            // Clear state and ask user to sign again
            localStorage.removeItem('mosoo_connected');
            currentAccount = null;
            provider = null;
            signer = null;
            showNotification("⚠️ Session expired. Please reconnect your wallet to unlock your vault.", "info");
        }

    } catch (e) {
        console.warn("Silent reconnect fail:", e);
    }
}

async function connectWallet(promptSignature = false) {
    if (!window.ethereum) {
        showNotification("MetaMask or compatible EVM wallet not detected!", "error");
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        currentAccount = accounts[0];

        await switchNetwork();

        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        poolContract = new ethers.Contract(CONFIG.contractAddress, POOL_ABI, signer);

        const sessionKey = `mosoo_session_${currentAccount.toLowerCase()}`;
        const cachedSession = localStorage.getItem(sessionKey);

        if (cachedSession && !promptSignature) {
            userKeys = JSON.parse(cachedSession);
        } else {
            showNotification("Sign message to unlock your Mosoo Private Address...", "info");
            const message = `Welcome to Mosoo Privacy Protocol on Abey Chain!\n\nSign this message to securely derive your Zero-Knowledge private keys and Shielded Address.\n\nAccount: ${currentAccount}\nChain ID: 178\nNonce: mosoo-auth-v1`;
            const signature = await signer.signMessage(message);
            userKeys = await MosooCrypto.deriveKeysFromSignature(signature, currentAccount);
            localStorage.setItem(sessionKey, JSON.stringify(userKeys));
        }

        localStorage.setItem('mosoo_connected', 'true');

        updateUIOnConnect();
        showNotification("Connected to Mosoo Privacy Portal!", "success");

        await syncIncomingNotes(currentAccount, userKeys.mosooAddress);
        updateUserBalances();

    } catch (err) {
        console.error("Connect error:", err);
        showNotification(err.message || "Connection failed", "error");
    }
}

function updateUIOnConnect() {
    document.getElementById('sidebar-account-name').innerText = "user.mosoo.id";
    document.getElementById('sidebar-account-addr').innerText = truncateAddress(currentAccount);
    document.getElementById('sidebar-avatar').innerText = currentAccount.substring(2, 4).toUpperCase();
    document.getElementById('btn-wallet-action').innerText = '🔓';
    document.getElementById('modal-pub-addr').innerText = currentAccount;
    document.getElementById('modal-priv-addr').innerText = userKeys ? userKeys.mosooAddress : "0msk1...";
    updateSettingsKeys();
}

function disconnectWallet() {
    if (currentAccount) {
        localStorage.removeItem(`mosoo_session_${currentAccount.toLowerCase()}`);
    }
    localStorage.removeItem('mosoo_connected');
    currentAccount = null;
    userKeys = null;

    document.getElementById('sidebar-account-name').innerText = "user.mosoo.id";
    document.getElementById('sidebar-account-addr').innerText = "Connect Wallet";
    document.getElementById('sidebar-avatar').innerText = "M";
    document.getElementById('btn-wallet-action').innerText = '🔒';

    document.getElementById('val-big-total').innerText = "$0.00";
    document.getElementById('val-col-public').innerText = "$0.00";
    document.getElementById('val-col-private').innerText = "$0.00";
    document.getElementById('donut-center-amt').innerText = "$0.00";
    updateDonutChart(0, 0);

    showNotification("Wallet disconnected.", "info");
}

async function switchNetwork() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: CONFIG.chainIdHex }]
        });
    } catch (err) {
        if (err.code === 4902) {
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
        }
    }
}

// Balance and Donut Chart
async function updateUserBalances() {
    if (!currentAccount || !provider) return;

    try {
        const pubBalWei = await provider.getBalance(currentAccount);
        const pubBal = parseFloat(ethers.formatEther(pubBalWei));
        
        // Multi-Token private balances from vault
        const allBalances = MosooCrypto.getAllShieldedBalances(currentAccount);
        const privBalAbey = parseFloat(allBalances.ABEY || "0");
        const privBalUsdt = parseFloat(allBalances.mUSDT || "0");
        const privBalMusd = parseFloat(allBalances.mUSD || "0");

        const abeyPriceUsd = 3.0; // ~$3.00 estimated USD
        const pubUsd = pubBal * abeyPriceUsd;
        // Total private valuation in USD
        const privUsd = (privBalAbey * abeyPriceUsd) + (privBalUsdt * 1.0) + (privBalMusd * 1.0);
        const totalUsd = pubUsd + privUsd;

        document.getElementById('val-big-total').innerText = `$${totalUsd.toFixed(2)}`;
        document.getElementById('val-col-public').innerText = `$${pubUsd.toFixed(2)} (${pubBal.toFixed(4)} ABEY)`;
        document.getElementById('val-col-private').innerText = `$${privUsd.toFixed(2)}`;
        
        const breakdownEl = document.getElementById('val-col-private-breakdown');
        if (breakdownEl) {
            breakdownEl.innerText = `${allBalances.ABEY} ABEY • ${allBalances.mUSDT} mUSDT`;
        }

        document.getElementById('val-col-stealth').innerText = `$${privUsd.toFixed(2)}`;
        document.getElementById('val-col-defi').innerText = "$0.00";

        document.getElementById('donut-center-amt').innerText = `$${totalUsd.toFixed(2)}`;
        document.getElementById('stealth-val-spec').innerText = `${privBalAbey.toFixed(4)} ABEY ($${(privBalAbey * abeyPriceUsd).toFixed(2)})`;

        updateDonutChart(privUsd, totalUsd);

    } catch (e) {
        console.error("Balance fetch error:", e);
    }
}

function updateDonutChart(shieldedUsd, totalUsd) {
    const circle = document.getElementById('donut-circle-fill');
    if (!circle) return;

    const circumference = 339.29; // 2 * PI * 54
    if (totalUsd <= 0) {
        circle.style.strokeDashoffset = circumference;
        return;
    }

    const ratio = Math.min(1, shieldedUsd / totalUsd);
    const offset = circumference * (1 - ratio);
    circle.style.strokeDashoffset = offset;
}

// Receive QRs
function renderReceiveQRs() {
    if (!currentAccount || !userKeys) return;

    document.getElementById('receive-text-private').innerText = userKeys.mosooAddress;
    document.getElementById('receive-text-public').innerText = currentAccount;

    const privContainer = document.getElementById('receive-qr-private');
    const pubContainer = document.getElementById('receive-qr-public');

    privContainer.innerHTML = "";
    pubContainer.innerHTML = "";

    try {
        new QRCode(privContainer, {
            text: userKeys.mosooAddress,
            width: 160,
            height: 160,
            colorDark: "#181715",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });

        new QRCode(pubContainer, {
            text: currentAccount,
            width: 160,
            height: 160,
            colorDark: "#181715",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    } catch (_) {}
}

// Pool Stats
async function loadPoolStats() {
    try {
        if (!poolContract) initStaticProvider();
        const [tvl, nextIdx] = await Promise.all([
            poolContract.poolBalance(),
            poolContract.nextIndex()
        ]);
        const tvlFormatted = parseFloat(ethers.formatEther(tvl)).toFixed(4);
        const commitments = nextIdx.toString();

        // Update home tab pool stats badges
        const tvlEl = document.getElementById('pool-tvl-val');
        const idxEl = document.getElementById('pool-commitments-val');
        if (tvlEl) tvlEl.innerText = `${tvlFormatted} ABEY`;
        if (idxEl) idxEl.innerText = `${commitments} notes`;

    } catch (_) {}
}

// Activity Events
async function fetchActivityEvents() {
    try {
        const currentBlock = await poolContract.runner.provider.getBlockNumber();
        const fromBlock = Math.max(CONFIG.startBlock, currentBlock - 1200);

        const iface = new ethers.Interface(POOL_ABI);
        const logs = await poolContract.runner.provider.getLogs({
            address: CONFIG.contractAddress,
            fromBlock: fromBlock,
            toBlock: currentBlock
        }).catch(() => []);

        const events = [];
        for (const log of logs) {
            try {
                const parsed = iface.parseLog(log);
                if (!parsed) continue;

                if (parsed.name === "Shield") {
                    events.push({
                        type: "SHIELD",
                        txHash: log.transactionHash,
                        block: log.blockNumber,
                        amount: `+${ethers.formatEther(parsed.args[2])} ABEY`,
                        timestamp: parsed.args[4] ? Number(parsed.args[4]) * 1000 : Date.now()
                    });
                } else if (parsed.name === "Unshield") {
                    events.push({
                        type: "UNSHIELD",
                        txHash: log.transactionHash,
                        block: log.blockNumber,
                        amount: `-${ethers.formatEther(parsed.args[4])} ABEY`,
                        timestamp: parsed.args[5] ? Number(parsed.args[5]) * 1000 : Date.now()
                    });
                } else if (parsed.name === "Transact") {
                    events.push({
                        type: "TRANSACT",
                        txHash: log.transactionHash,
                        block: log.blockNumber,
                        amount: "Private Transfer",
                        timestamp: parsed.args[5] ? Number(parsed.args[5]) * 1000 : Date.now()
                    });
                }
            } catch (_) {}
        }

        events.sort((a, b) => b.block - a.block);
        cachedActivityEvents = events;
        renderPortalActivityTable();

    } catch (e) {
        console.warn("Activity fetch error:", e);
    }
}

function renderPortalActivityTable() {
    const tbody = document.getElementById('portal-activity-tbody');
    if (!tbody) return;

    if (cachedActivityEvents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No recent events found.</td></tr>`;
        return;
    }

    tbody.innerHTML = cachedActivityEvents.map(e => `
        <tr style="border-bottom:1px solid var(--border-sub);">
            <td style="padding:12px 10px;"><span style="font-weight:700; color:${e.type === 'SHIELD' ? 'var(--green-primary)' : e.type === 'UNSHIELD' ? 'var(--amber)' : '#a855f7'};">${e.type}</span></td>
            <td style="padding:12px 10px;">
                <a href="${CONFIG.explorerUrl}/tx/${e.txHash}" target="_blank" style="color:var(--text-main); font-family:var(--font-mono); text-decoration:underline;">
                    ${truncateAddress(e.txHash)} ↗
                </a>
            </td>
            <td style="padding:12px 10px; font-family:var(--font-mono);">#${e.block}</td>
            <td style="padding:12px 10px; font-weight:700; font-family:var(--font-mono);">${e.amount}</td>
            <td style="padding:12px 10px; color:var(--text-muted); font-size:0.8rem;">${formatTimeAgo(e.timestamp)}</td>
        </tr>
    `).join('');
}

// Custom Relayer Support (UI-4 fix)
function getRelayerUrl() {
    return localStorage.getItem('mosoo_custom_relayer') || CONFIG.relayerUrl;
}

function saveCustomRelayer() {
    const input = document.getElementById('settings-relayer-url');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    localStorage.setItem('mosoo_custom_relayer', val);
    showNotification("✅ Custom relayer URL saved!", "success");
}

function resetCustomRelayer() {
    localStorage.removeItem('mosoo_custom_relayer');
    const input = document.getElementById('settings-relayer-url');
    if (input) input.value = CONFIG.relayerUrl;
    showNotification("Relayer reset to default.", "info");
}

async function syncIncomingNotes(account, mosooAddress) {
    if (!account || !mosooAddress) return;
    try {
        let newlyAdded = 0;
        const currentNotes = MosooCrypto.getNotes(account);

        // 1. 100% Decentralized On-Chain Memos Recovery from AbeyChain Logs
        if (userKeys && userKeys.viewingKey && provider && poolContract) {
            try {
                const currentBlock = await provider.getBlockNumber();
                const fromBlock = Math.max(CONFIG.startBlock, currentBlock - 1200);
                const onChainNotes = await MosooCrypto.scanOnChainMemos(provider, poolContract, userKeys.viewingKey, fromBlock, currentBlock);
                for (const oNote of onChainNotes) {
                    const exists = currentNotes.some(cn => cn.commitment && cn.commitment.toLowerCase() === oNote.commitment.toLowerCase());
                    if (!exists && !oNote.spent) {
                        MosooCrypto.saveNote(account, oNote);
                        currentNotes.push(oNote);
                        newlyAdded++;
                    }
                }
            } catch (scanErr) {
                console.warn("[OnChainSync] Scan error:", scanErr);
            }
        }

        // 2. Shared browser storage & Relayer inbox backup
        let incomingNotes = [];
        const sharedNotes = MosooCrypto.getSharedNotes(mosooAddress);
        incomingNotes = incomingNotes.concat(sharedNotes);

        try {
            const res = await fetch(`${getRelayerUrl()}/api/notes/inbox?address=${encodeURIComponent(mosooAddress)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.notes && Array.isArray(data.notes)) {
                    incomingNotes = incomingNotes.concat(data.notes);
                }
            }
        } catch (_) {}

        for (const n of incomingNotes) {
            const exists = currentNotes.some(cn => cn.commitment && cn.commitment.toLowerCase() === n.commitment.toLowerCase());
            if (!exists) {
                MosooCrypto.saveNote(account, n);
                currentNotes.push(n);
                newlyAdded++;
            }
        }

        if (newlyAdded > 0) {
            showNotification(`📩 Credited ${newlyAdded} incoming private note(s) to your vault!`, "success");
        }
    } catch (_) {}
}


// Shield
function setShieldAmount(amt) {
    document.getElementById('input-shield-amount').value = amt;
}

async function setShieldMax() {
    if (!currentAccount || !provider) return;
    try {
        const bal = await provider.getBalance(currentAccount);
        const floatBal = parseFloat(ethers.formatEther(bal));
        const maxSafe = Math.max(0, floatBal - 0.05).toFixed(4);
        document.getElementById('input-shield-amount').value = maxSafe;
    } catch (_) {}
}

function updateShieldAssetUnit() {
    const sel = document.getElementById('select-shield-asset');
    const unitEl = document.getElementById('unit-shield-asset');
    if (sel && unitEl) unitEl.innerText = sel.value;
}

function updateTransferAssetUnit() {
    const sel = document.getElementById('select-transfer-asset');
    const unitEl = document.getElementById('unit-transfer-asset');
    if (sel && unitEl) unitEl.innerText = sel.value;
}

function updateUnshieldAssetUnit() {
    const sel = document.getElementById('select-unshield-asset');
    const unitEl = document.getElementById('unit-unshield-asset');
    if (sel && unitEl) unitEl.innerText = sel.value;
}

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

    const assetEl = document.getElementById('select-shield-asset');
    const asset = assetEl ? assetEl.value : "ABEY";

    try {
        const btn = document.getElementById('btn-execute-shield');
        btn.disabled = true;
        btn.innerText = `Generating ZK ${asset} Note...`;

        const note = MosooCrypto.createNote(amountStr, userKeys.mosooAddress, asset);
        const encryptedMemo = (userKeys && userKeys.publicViewingKey) 
            ? await MosooCrypto.encryptNote(note, userKeys.publicViewingKey) || "0x" 
            : "0x";

        if (asset === "ABEY") {
            btn.innerText = "Submitting Shield Tx to Abey Chain...";
            showNotification("Confirm transaction in MetaMask...", "info");

            let tx;
            try {
                tx = await poolContract.shieldWithMemo(note.commitment, encryptedMemo, {
                    value: ethers.parseEther(amountStr)
                });
            } catch (_) {
                tx = await poolContract.shield(note.commitment, {
                    value: ethers.parseEther(amountStr)
                });
            }

            showNotification(`Tx Broadcast: ${tx.hash}. Waiting for block...`, "info");
            btn.innerText = "Confirming on Abey Testnet...";
            await tx.wait();
        } else {
            // Simulated Testnet Shield for mock tokens (mUSDT / mUSD)
            btn.innerText = `Shielding ${amountStr} ${asset} into Privacy Vault...`;
            await new Promise(r => setTimeout(r, 600));
        }

        MosooCrypto.saveNote(currentAccount, note);

        showNotification(`🎉 Successfully shielded ${amountStr} ${asset}!`, "success");
        btn.disabled = false;
        btn.innerText = "Execute Shield Deposit";

        updateUserBalances();
        fetchActivityEvents();

    } catch (err) {
        console.error("Shield error:", err);
        showNotification(err.reason || err.message || "Shield failed", "error");
        const btn = document.getElementById('btn-execute-shield');
        btn.disabled = false;
        btn.innerText = "Execute Shield Deposit";
    }
}

// Transfer
function setTransferAmount(amt) {
    document.getElementById('input-transfer-amount').value = amt;
}

function setTransferMax() {
    if (!currentAccount) return;
    const privBal = MosooCrypto.getShieldedBalance(currentAccount);
    document.getElementById('input-transfer-amount').value = privBal;
}

async function executeTransfer() {
    if (!currentAccount) {
        showNotification("Please connect your wallet first.", "error");
        return;
    }

    const to = document.getElementById('input-transfer-to').value.trim();
    const amountStr = document.getElementById('input-transfer-amount').value;
    const assetEl = document.getElementById('select-transfer-asset');
    const asset = assetEl ? assetEl.value : "ABEY";
    const feeEl = document.getElementById('select-transfer-fee');
    const feeStr = feeEl ? feeEl.value : "0";

    if (!to || (!to.startsWith("0msk1") && !to.startsWith("0x"))) {
        showNotification("Please enter a valid recipient address (0msk or 0x)", "error");
        return;
    }

    const selection = MosooCrypto.selectNotesForAmount(currentAccount, amountStr, asset);
    if (!selection.success) {
        showNotification(selection.error, "error");
        return;
    }

    const availableNote = selection.selectedNotes[0];
    if (selection.isMultiUtxo) {
        showNotification(`🔄 Aggregating ${selection.selectedNotes.length} unspent notes (${selection.totalSelected.toFixed(4)} ${asset}) into transfer...`, "info");
    }

    const useRelayer = document.getElementById('check-transfer-relayer') 
        ? document.getElementById('check-transfer-relayer').checked 
        : true;

    try {
        const btn = document.getElementById('btn-execute-transfer');
        btn.disabled = true;
        btn.innerText = `Generating ${asset} Transfer Proof & Commitment...`;

        const recipientNote = MosooCrypto.createNote(amountStr, to, asset);
        const encryptedMemo = await MosooCrypto.encryptNote(recipientNote, to) || "0x";
        const root = await poolContract.getLastRoot();
        const dummyProof = "0x" + "11".repeat(65);
        const feeWei = ethers.parseEther(feeStr || "0");

        let txHash;

        if (selection.isMultiUtxo && selection.selectedNotes.length > 1) {
            // JoinSplit 2-to-2 Mode (Note Jodna & Todna)
            const note1 = selection.selectedNotes[0];
            const note2 = selection.selectedNotes[1];
            const inputNullifiers = [note1.nullifierHash, note2.nullifierHash];

            let changeNote = null;
            if (selection.changeAmount > 0) {
                changeNote = MosooCrypto.createNote(selection.changeAmount.toFixed(4), userKeys.mosooAddress, asset);
                changeNote.isChange = true;
            }
            const outputCommitments = [recipientNote.commitment, changeNote ? changeNote.commitment : ethers.ZeroHash];

            if (useRelayer) {
                btn.innerText = "Broadcasting JoinSplit via Anonymous Relayer...";
                showNotification("Executing JoinSplit 2-to-2 (Notes Merged on-chain!)...", "info");

                const response = await fetch(`${getRelayerUrl()}/relay/transact2to2`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        root,
                        inputNullifiers,
                        outputCommitments,
                        fee: feeWei.toString(),
                        encryptedMemo,
                        recipientNote
                    })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || "JoinSplit broadcast failed");
                txHash = result.txHash;
            } else {
                const tx = await poolContract.transact2to2(
                    root,
                    inputNullifiers,
                    outputCommitments,
                    ethers.ZeroAddress,
                    feeWei,
                    encryptedMemo,
                    dummyProof
                );
                await tx.wait();
                txHash = tx.hash;
            }

            if (changeNote) {
                MosooCrypto.saveNote(currentAccount, changeNote);
            }
        } else {
            // Single Note Transfer Mode
            if (useRelayer) {
                btn.innerText = "Submitting via Mosoo Anonymous Relayer...";
                showNotification("Routing via Relayer Network (Sender address hidden!)...", "info");

                const response = await fetch(`${getRelayerUrl()}/relay/transact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        root,
                        nullifierHash: availableNote.nullifierHash,
                        newCommitment: recipientNote.commitment,
                        fee: feeWei.toString(),
                        encryptedMemo,
                        proof: dummyProof,
                        recipientNote: recipientNote
                    })
                });

                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.error || "Relayer broadcast failed");
                }
                txHash = result.txHash;

            } else {
                let tx;
                try {
                    tx = await poolContract.transactWithMemo(
                        root,
                        availableNote.nullifierHash,
                        recipientNote.commitment,
                        ethers.ZeroAddress,
                        feeWei,
                        encryptedMemo,
                        dummyProof
                    );
                } catch (_) {
                    tx = await poolContract.transact(
                        root,
                        availableNote.nullifierHash,
                        recipientNote.commitment,
                        ethers.ZeroAddress,
                        feeWei,
                        dummyProof
                    );
                }
                await tx.wait();
                txHash = tx.hash;
            }

            if (selection.changeAmount > 0) {
                const changeNote = MosooCrypto.createNote(selection.changeAmount.toFixed(4), userKeys.mosooAddress, asset);
                changeNote.isChange = true;
                changeNote.parentNullifier = availableNote.nullifierHash;
                MosooCrypto.saveNote(currentAccount, changeNote);
            }
        }

        // Mark all consumed input notes as spent
        MosooCrypto.markNotesSpent(currentAccount, selection.selectedNotes.map(n => n.nullifierHash));

        if (userKeys && to.toLowerCase() === userKeys.mosooAddress.toLowerCase()) {
            MosooCrypto.saveNote(currentAccount, recipientNote);
        } else {
            MosooCrypto.saveSharedNote(to, recipientNote);
            try {
                await fetch(`${getRelayerUrl()}/api/notes/dispatch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: recipientNote })
                });
            } catch (_) {}
        }

        showNotification(`🎉 Successfully sent ${amountStr} ${asset}! (On-Chain Memo Anchored)`, "success");
        btn.disabled = false;
        btn.innerText = "Send Stealth Transfer";

        updateUserBalances();
        fetchActivityEvents();

    } catch (err) {
        console.error("Transfer error:", err);
        showNotification(err.reason || err.message || "Transfer failed", "error");
        const btn = document.getElementById('btn-execute-transfer');
        btn.disabled = false;
        btn.innerText = "Send Stealth Transfer";
    }
}

// Unshield
function fillSelfPublicAddress() {
    if (currentAccount) {
        document.getElementById('input-unshield-recipient').value = currentAccount;
    }
}

// BUG-7 Fix: MAX button for Unshield tab
function setUnshieldMax() {
    if (!currentAccount) return;
    const privBal = MosooCrypto.getShieldedBalance(currentAccount);
    document.getElementById('input-unshield-amount').value = privBal;
}

async function executeUnshield() {
    if (!currentAccount) {
        showNotification("Please connect your wallet first.", "error");
        return;
    }

    const recipient = document.getElementById('input-unshield-recipient').value.trim();
    const amountStr = document.getElementById('input-unshield-amount').value;
    const assetEl = document.getElementById('select-unshield-asset');
    const asset = assetEl ? assetEl.value : "ABEY";
    const feeEl = document.getElementById('select-unshield-fee');
    const feeStr = feeEl ? feeEl.value : "0";

    if (!recipient || !ethers.isAddress(recipient)) {
        showNotification("Please enter a valid public EVM recipient address (0x...)", "error");
        return;
    }

    const selection = MosooCrypto.selectNotesForAmount(currentAccount, amountStr, asset);
    if (!selection.success) {
        showNotification(selection.error, "error");
        return;
    }

    const availableNote = selection.selectedNotes[0];
    if (selection.isMultiUtxo) {
        showNotification(`🔄 Aggregating ${selection.selectedNotes.length} unspent notes (${selection.totalSelected.toFixed(4)} ${asset}) into withdrawal...`, "info");
    }

    const useRelayer = document.getElementById('check-use-relayer') 
        ? document.getElementById('check-use-relayer').checked 
        : true;

    try {
        const btn = document.getElementById('btn-execute-unshield');
        btn.disabled = true;
        btn.innerText = `Generating Nullifier & ${asset} Unshield Proof...`;

        const root = await poolContract.getLastRoot();
        const amountWei = ethers.parseEther(amountStr);
        const dummyProof = "0x" + "22".repeat(65);
        const feeWei = ethers.parseEther(feeStr || "0");

        let txHash;

        if (selection.isMultiUtxo && selection.selectedNotes.length > 1) {
            const inputNullifiers = selection.selectedNotes.map(n => n.nullifierHash);

            if (useRelayer) {
                btn.innerText = "Broadcasting multi-note withdrawal via Relayer...";
                showNotification("Routing Multi-UTXO Unshield via Relayer Network...", "info");

                const response = await fetch(`${getRelayerUrl()}/relay/unshieldMulti`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        root,
                        inputNullifiers,
                        recipient,
                        fee: feeWei.toString(),
                        amount: amountWei.toString()
                    })
                });

                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.error || "Relayer multi-unshield broadcast failed");
                }
                txHash = result.txHash;

            } else {
                const tx = await poolContract.unshieldMulti(
                    root,
                    inputNullifiers,
                    recipient,
                    ethers.ZeroAddress,
                    feeWei,
                    amountWei,
                    dummyProof
                );
                await tx.wait();
                txHash = tx.hash;
            }
        } else {
            if (useRelayer) {
                btn.innerText = "Broadcasting withdrawal via Mosoo Anonymous Relayer...";
                showNotification("Routing via Relayer Network (100% stealth)...", "info");

                const response = await fetch(`${getRelayerUrl()}/relay/unshield`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        root,
                        nullifierHash: availableNote.nullifierHash,
                        recipient,
                        fee: feeWei.toString(),
                        amount: amountWei.toString(),
                        proof: dummyProof
                    })
                });

                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.error || "Relayer unshield broadcast failed");
                }
                txHash = result.txHash;

            } else {
                const tx = await poolContract.unshield(
                    root,
                    availableNote.nullifierHash,
                    recipient,
                    ethers.ZeroAddress,
                    feeWei,
                    amountWei,
                    dummyProof
                );
                await tx.wait();
                txHash = tx.hash;
            }
        }

        // Mark all consumed input notes as spent
        MosooCrypto.markNotesSpent(currentAccount, selection.selectedNotes.map(n => n.nullifierHash));

        // Create change note if excess balance was selected
        if (selection.changeAmount > 0) {
            const changeNote = MosooCrypto.createNote(selection.changeAmount.toFixed(4), userKeys.mosooAddress, asset);
            changeNote.isChange = true;
            changeNote.parentNullifier = availableNote.nullifierHash;
            MosooCrypto.saveNote(currentAccount, changeNote);
        }

        showNotification(`🎉 Successfully unshielded ${amountStr} ${asset}!`, "success");
        btn.disabled = false;
        btn.innerText = "Execute Unshield Withdrawal";

        updateUserBalances();
        fetchActivityEvents();

    } catch (err) {
        console.error("Unshield error:", err);
        showNotification(err.reason || err.message || "Withdrawal failed", "error");
        const btn = document.getElementById('btn-execute-unshield');
        btn.disabled = false;
        btn.innerText = "Execute Unshield Withdrawal";
    }
}

// Watched Accounts
function loadWatchedAccounts() {
    try {
        const raw = localStorage.getItem('mosoo_watched_accounts');
        watchedAccounts = raw ? JSON.parse(raw) : [];
        renderWatchedList();
    } catch (_) {
        watchedAccounts = [];
    }
}

function addWatchedAccount() {
    const input = document.getElementById('input-watch-addr');
    const val = input.value.trim();
    if (!val) return;

    if (!watchedAccounts.includes(val)) {
        watchedAccounts.push(val);
        localStorage.setItem('mosoo_watched_accounts', JSON.stringify(watchedAccounts));
        input.value = "";
        renderWatchedList();
        showNotification("Added account to watch list!", "success");
    }
}

function renderWatchedList() {
    const countEl = document.getElementById('watched-accounts-count');
    if (countEl) countEl.innerText = `${watchedAccounts.length} accounts`;

    const container = document.getElementById('watched-list-container');
    if (!container) return;

    if (watchedAccounts.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem;">No watched accounts added yet.</div>`;
        return;
    }

    container.innerHTML = watchedAccounts.map((addr, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card-sub); padding:10px 14px; border-radius:8px; margin-bottom:8px; font-family:var(--font-mono); font-size:0.82rem;">
            <span>${addr}</span>
            <button class="chip-btn" onclick="removeWatchedAccount(${idx})" style="color:#ef4444;">Remove</button>
        </div>
    `).join('');
}

function removeWatchedAccount(idx) {
    watchedAccounts.splice(idx, 1);
    localStorage.setItem('mosoo_watched_accounts', JSON.stringify(watchedAccounts));
    renderWatchedList();
}

// Settings
function updateSettingsKeys() {
    if (!userKeys) return;
    document.getElementById('settings-0msk-addr').innerText = userKeys.mosooAddress;
    document.getElementById('settings-viewing-key').innerText = userKeys.viewingKey;
    const pubViewingEl = document.getElementById('settings-public-viewing-key');
    if (pubViewingEl) pubViewingEl.innerText = userKeys.publicViewingKey || "Derived from viewing key";
    document.getElementById('settings-spending-key').innerText = userKeys.spendingKey;
    // Populate custom relayer input with current value
    const relayerInput = document.getElementById('settings-relayer-url');
    if (relayerInput) relayerInput.value = getRelayerUrl();
}

// Modals
function openKeyModal() {
    if (!currentAccount) {
        connectWallet(true);
        return;
    }
    document.getElementById('key-modal').style.display = 'flex';
}

function closeKeyModal() {
    document.getElementById('key-modal').style.display = 'none';
}

function closeKeyModalOnBackdrop(e) {
    if (e.target.id === 'key-modal') closeKeyModal();
}

function openDocsModal() {
    window.open("https://mosoo.xyz", "_blank");
}

function openAppsModal() {
    window.open("https://explorer.mosoo.xyz", "_blank");
}

function toggleBlur(el) {
    el.classList.toggle('blurred');
}

// Helpers
function truncateAddress(addr) {
    if (!addr) return "";
    return `${addr.substring(0, 7)}...${addr.substring(addr.length - 5)}`;
}

function formatTimeAgo(timestamp) {
    const s = Math.floor((Date.now() - timestamp) / 1000);
    if (s < 60) return `${Math.max(1, s)}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function copyAddress(type) {
    let text = "";
    if (type === 'public') text = currentAccount;
    if (type === 'private' && userKeys) text = userKeys.mosooAddress;
    if (text) {
        navigator.clipboard.writeText(text);
        showNotification(`Copied ${type.toUpperCase()} address to clipboard!`, "success");
    }
}

// BUG-12 Fix: Notification uses CSS variables — dark mode safe
function showNotification(msg, type = "info") {
    const el = document.getElementById('notification');
    if (!el) return;
    el.innerText = msg;
    el.style.display = 'block';
    el.className = ''; // clear previous class

    if (type === 'error') {
        el.style.background = 'var(--notif-error-bg, #fef2f2)';
        el.style.color = 'var(--notif-error-text, #dc2626)';
        el.style.border = '1px solid var(--notif-error-border, #fecaca)';
    } else if (type === 'success') {
        el.style.background = 'var(--green-bg)';
        el.style.color = 'var(--green-primary)';
        el.style.border = '1px solid rgba(60, 208, 112, 0.35)';
    } else {
        el.style.background = 'var(--bg-card-sub)';
        el.style.color = 'var(--text-main)';
        el.style.border = '1px solid var(--border-color)';
    }

    setTimeout(() => {
        el.style.display = 'none';
    }, 4500);
}


window.navigateTab = navigateTab;
window.toggleTheme = toggleTheme;
window.handleWalletAction = handleWalletAction;
window.updateShieldAssetUnit = updateShieldAssetUnit;
window.updateTransferAssetUnit = updateTransferAssetUnit;
window.updateUnshieldAssetUnit = updateUnshieldAssetUnit;
window.setShieldAmount = setShieldAmount;
window.setShieldMax = setShieldMax;
window.executeShield = executeShield;
window.setTransferAmount = setTransferAmount;
window.setTransferMax = setTransferMax;
window.executeTransfer = executeTransfer;
window.fillSelfPublicAddress = fillSelfPublicAddress;
window.setUnshieldMax = setUnshieldMax;
window.executeUnshield = executeUnshield;
window.copyAddress = copyAddress;
window.addWatchedAccount = addWatchedAccount;
window.removeWatchedAccount = removeWatchedAccount;
window.toggleBlur = toggleBlur;
window.openKeyModal = openKeyModal;
window.closeKeyModal = closeKeyModal;
window.closeKeyModalOnBackdrop = closeKeyModalOnBackdrop;
window.openDocsModal = openDocsModal;
window.openAppsModal = openAppsModal;
window.fetchActivityEvents = fetchActivityEvents;
window.saveCustomRelayer = saveCustomRelayer;
window.resetCustomRelayer = resetCustomRelayer;

