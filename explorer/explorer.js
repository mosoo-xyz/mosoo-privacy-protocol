/**
 * MosooScan Explorer Logic
 * Queries Abey Testnet live RPC for Mosoo Privacy Pool events, Merkle roots, and historical logs
 */

const CONFIG = {
    rpcUrl: "https://testrpc.abeychain.com",
    contractAddress: "0x3aa5aA8Fc12b4C589300638522F0ea9A783305Eb",
    explorerUrl: "https://testnet.abeyscan.com",
    startBlock: 16188700, // MosooPrivacyPool v2.0 deployment block on Abey Testnet
    chunkSize: 450,       // Abey RPC max limit is 500 blocks per eth_getLogs
    concurrency: 5        // Parallel batches for fast scanning
};

const POOL_ABI = [
    "function poolBalance() external view returns (uint256)",
    "function nextIndex() external view returns (uint32)",
    "function totalTransactionsCount() external view returns (uint256)",
    "function getLastRoot() external view returns (bytes32)",
    "event Shield(bytes32 indexed commitment, uint32 indexed leafIndex, uint256 amount, address indexed depositor, uint256 timestamp)",
    "event Unshield(address indexed recipient, bytes32 indexed nullifierHash, address indexed relayer, uint256 fee, uint256 amount, uint256 timestamp)",
    "event Transact(bytes32 indexed nullifierHash, bytes32 indexed newCommitment, uint32 indexed newLeafIndex, address relayer, uint256 fee, uint256 timestamp)"
];

const CACHE_KEY_EVENTS = "mosoo_explorer_events_178_v3";
const CACHE_KEY_BLOCK = "mosoo_explorer_last_block_178_v2";

let provider;
let pool;
let poolInterface;
let allEvents = [];
let currentFilter = "all";
let currentSearch = "";
let isSyncing = false;
let lastSyncedBlock = 0;

// Theme Handling
function initTheme() {
    const saved = localStorage.getItem('mosoo_theme') || localStorage.getItem('mosoo_portal_theme') || 'light';
    applyTheme(saved);
}

function applyTheme(theme) {
    const btn = document.getElementById('theme-toggle-btn');
    if (theme === 'dark') {
        document.body.classList.add('theme-dark');
        if (btn) {
            btn.innerHTML = '☀️';
            btn.title = 'Switch to Day Mode';
        }
    } else {
        document.body.classList.remove('theme-dark');
        if (btn) {
            btn.innerHTML = '🌙';
            btn.title = 'Switch to Night Mode';
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

window.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    try {
        provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
        pool = new ethers.Contract(CONFIG.contractAddress, POOL_ABI, provider);
        poolInterface = new ethers.Interface(POOL_ABI);

        // Load cached events immediately for instant UI render
        loadCachedData();
        renderTable();
        updateFilterCounts();

        // Perform initial live sync and metrics fetch
        await syncData();

        // Periodic background poll every 15 seconds
        setInterval(async () => {
            if (!isSyncing) {
                await syncData(true);
            }
        }, 15000);

    } catch (err) {
        console.error("Initialization error:", err);
        showSyncStatus("Sync error: " + err.message, false);
    }
});

function loadCachedData() {
    try {
        const cachedRaw = localStorage.getItem(CACHE_KEY_EVENTS);
        const cachedBlock = localStorage.getItem(CACHE_KEY_BLOCK);
        if (cachedRaw) {
            allEvents = JSON.parse(cachedRaw);
            console.log(`Loaded ${allEvents.length} events from local cache.`);
        }
        if (cachedBlock) {
            lastSyncedBlock = parseInt(cachedBlock, 10);
        }
    } catch (e) {
        console.warn("Failed to load cache:", e);
        allEvents = [];
        lastSyncedBlock = 0;
    }
}

function saveCachedData() {
    try {
        localStorage.setItem(CACHE_KEY_EVENTS, JSON.stringify(allEvents));
        localStorage.setItem(CACHE_KEY_BLOCK, lastSyncedBlock.toString());
    } catch (e) {
        console.warn("Failed to save cache:", e);
    }
}

async function syncData(isBackground = false) {
    if (isSyncing) return;
    isSyncing = true;

    try {
        if (!isBackground) {
            setRefreshButtonSpin(true);
        }

        // 1. Fetch live pool metrics
        await fetchMetrics();

        // 2. Fetch current block
        const currentBlock = await provider.getBlockNumber();
        const startScan = (lastSyncedBlock && lastSyncedBlock >= CONFIG.startBlock) 
            ? lastSyncedBlock + 1 
            : CONFIG.startBlock;

        if (startScan <= currentBlock) {
            const totalBlocksToScan = currentBlock - startScan + 1;
            showSyncStatus(`Syncing Abey blocks #${startScan} → #${currentBlock} (${totalBlocksToScan} blks)...`, true);

            const newEvents = await scanLogsInChunks(startScan, currentBlock);

            if (newEvents.length > 0) {
                // Merge and deduplicate by txHash + logIndex
                const existingKeys = new Set(allEvents.map(e => `${e.txHash}_${e.logIndex}`));
                let addedCount = 0;
                for (const ev of newEvents) {
                    const key = `${ev.txHash}_${ev.logIndex}`;
                    if (!existingKeys.has(key)) {
                        allEvents.push(ev);
                        existingKeys.add(key);
                        addedCount++;
                    }
                }

                // Sort descending by block and logIndex
                allEvents.sort((a, b) => (b.block - a.block) || (b.logIndex - a.logIndex));
                console.log(`Synced ${addedCount} new privacy events.`);
            }

            lastSyncedBlock = currentBlock;
            saveCachedData();
        }

        showSyncStatus(`Synced to Block #${currentBlock} (${allEvents.length} transactions)`, false);
        renderTable();
        updateFilterCounts();

    } catch (err) {
        console.error("Sync error:", err);
        showSyncStatus("Sync error: " + (err.shortMessage || err.message), false);
    } finally {
        isSyncing = false;
        setRefreshButtonSpin(false);
    }
}

async function fetchMetrics() {
    try {
        const [bal, nextIdx, txCount, root] = await Promise.all([
            pool.poolBalance(),
            pool.nextIndex(),
            pool.totalTransactionsCount(),
            pool.getLastRoot()
        ]);

        document.getElementById('val-tvl').innerText = `${ethers.formatEther(bal)} ABEY`;
        document.getElementById('val-commitments').innerText = nextIdx.toString();
        document.getElementById('val-tx-count').innerText = txCount.toString();
        document.getElementById('val-current-root').innerText = root;
    } catch (e) {
        console.error("Failed to fetch pool metrics:", e);
    }
}

/**
 * Scans contract events using safe chunk sizes (≤ 450 blocks) to respect Abey RPC limits
 */
async function scanLogsInChunks(fromBlock, toBlock) {
    const chunks = [];
    for (let f = fromBlock; f <= toBlock; f += CONFIG.chunkSize) {
        const t = Math.min(f + CONFIG.chunkSize - 1, toBlock);
        chunks.push({ from: f, to: t });
    }

    let allRawLogs = [];

    for (let i = 0; i < chunks.length; i += CONFIG.concurrency) {
        const batch = chunks.slice(i, i + CONFIG.concurrency);
        const batchResults = await Promise.all(batch.map(c => 
            provider.getLogs({
                address: CONFIG.contractAddress,
                fromBlock: c.from,
                toBlock: c.to
            }).catch(err => {
                console.warn(`Error scanning blocks ${c.from}-${c.to}:`, err);
                return [];
            })
        ));

        for (const logs of batchResults) {
            allRawLogs = allRawLogs.concat(logs);
        }
    }

    const parsedEvents = [];
    for (const log of allRawLogs) {
        try {
            const parsed = poolInterface.parseLog(log);
            if (!parsed) continue;

            const baseEvent = {
                txHash: log.transactionHash,
                block: log.blockNumber,
                logIndex: log.index ?? 0,
                contract: log.address
            };

            if (parsed.name === "Shield") {
                parsedEvents.push({
                    ...baseEvent,
                    type: "SHIELD",
                    data: parsed.args[0], // commitment
                    leafIndex: Number(parsed.args[1]),
                    amountRaw: parsed.args[2].toString(),
                    amount: `+${ethers.formatEther(parsed.args[2])} ABEY`,
                    account: parsed.args[3], // depositor
                    accountLabel: "Depositor",
                    timestamp: parsed.args[4] ? Number(parsed.args[4]) * 1000 : Date.now()
                });
            } else if (parsed.name === "Unshield") {
                parsedEvents.push({
                    ...baseEvent,
                    type: "UNSHIELD",
                    data: parsed.args[1], // nullifierHash
                    recipient: parsed.args[0],
                    account: parsed.args[0],
                    accountLabel: "Recipient",
                    relayer: parsed.args[2],
                    fee: ethers.formatEther(parsed.args[3]),
                    amountRaw: parsed.args[4].toString(),
                    amount: `-${ethers.formatEther(parsed.args[4])} ABEY`,
                    timestamp: parsed.args[5] ? Number(parsed.args[5]) * 1000 : Date.now()
                });
            } else if (parsed.name === "Transact") {
                parsedEvents.push({
                    ...baseEvent,
                    type: "TRANSACT",
                    data: parsed.args[1], // newCommitment
                    nullifierHash: parsed.args[0],
                    leafIndex: Number(parsed.args[2]),
                    relayer: parsed.args[3],
                    account: parsed.args[3] || "Relayer Network",
                    accountLabel: "Relayer",
                    fee: ethers.formatEther(parsed.args[4]),
                    amount: "Private Transfer",
                    timestamp: parsed.args[5] ? Number(parsed.args[5]) * 1000 : Date.now()
                });
            }
        } catch (e) {
            // Ignore non-pool logs (e.g., internal MerkleTree events)
        }
    }

    return parsedEvents;
}

function renderTable() {
    const tbody = document.getElementById('tx-table-body');
    const filtered = getFilteredEvents();

    document.getElementById('table-sub-count').innerText = 
        `Showing ${filtered.length} of ${allEvents.length} verified events`;

    if (allEvents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="table-state-msg">
                    <div class="loading-spinner"></div>
                    <span>Scanning Abey Testnet blocks for Mosoo privacy events...</span>
                </td>
            </tr>`;
        return;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 35px; color: var(--text-muted);">
                    No transactions match your current search or filter criteria.
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((e, idx) => `
        <tr class="tx-row" onclick="openTxModal('${e.txHash}')">
            <td>
                <span class="badge-type ${e.type.toLowerCase()}">${e.type}</span>
            </td>
            <td>
                <div class="cell-hash">
                    <a href="${CONFIG.explorerUrl}/tx/${e.txHash}" target="_blank" class="hash-link" onclick="event.stopPropagation()">
                        ${truncate(e.txHash, 8, 6)}
                    </a>
                    <button class="mini-copy" onclick="event.stopPropagation(); copyDirect('${e.txHash}', 'Tx Hash copied!')" title="Copy Tx Hash">
                        📋
                    </button>
                </div>
            </td>
            <td style="font-weight:600; color:var(--text-white);">#${e.block}</td>
            <td>
                <div class="cell-hash">
                    <span class="mono-data" title="${e.data}">${truncate(e.data, 10, 6)}</span>
                    <button class="mini-copy" onclick="event.stopPropagation(); copyDirect('${e.data}', 'Hash copied!')" title="Copy Hash">
                        📋
                    </button>
                </div>
            </td>
            <td style="font-weight:700;" class="${getAmountColorClass(e.type)}">${e.amount}</td>
            <td style="color:var(--text-muted); font-size:0.8rem;" title="${new Date(e.timestamp).toLocaleString()}">
                ${formatTimeAgo(e.timestamp)}
            </td>
            <td>
                <button class="btn-inspect" onclick="event.stopPropagation(); openTxModal('${e.txHash}')">
                    Inspect ↗
                </button>
            </td>
        </tr>
    `).join('');
}

function getAmountColorClass(type) {
    if (type === 'SHIELD') return 'amount-shield';
    if (type === 'UNSHIELD') return 'amount-unshield';
    return 'amount-transact';
}

function getFilteredEvents() {
    return allEvents.filter(e => {
        // Filter by Type
        if (currentFilter !== "all" && e.type !== currentFilter) {
            return false;
        }

        // Filter by Search Query
        if (currentSearch) {
            const query = currentSearch.toLowerCase();
            const txMatch = e.txHash && e.txHash.toLowerCase().includes(query);
            const dataMatch = e.data && e.data.toLowerCase().includes(query);
            const accountMatch = e.account && e.account.toLowerCase().includes(query);
            const blockMatch = e.block && e.block.toString().includes(query);
            return txMatch || dataMatch || accountMatch || blockMatch;
        }

        return true;
    });
}

function updateFilterCounts() {
    const shieldCount = allEvents.filter(e => e.type === "SHIELD").length;
    const unshieldCount = allEvents.filter(e => e.type === "UNSHIELD").length;
    const transactCount = allEvents.filter(e => e.type === "TRANSACT").length;

    const elAll = document.getElementById('count-all');
    const elShield = document.getElementById('count-shield');
    const elUnshield = document.getElementById('count-unshield');
    const elTransact = document.getElementById('count-transact');

    if (elAll) elAll.innerText = allEvents.length;
    if (elShield) elShield.innerText = shieldCount;
    if (elUnshield) elUnshield.innerText = unshieldCount;
    if (elTransact) elTransact.innerText = transactCount;
}

function setFilter(type) {
    currentFilter = type;
    document.querySelectorAll('.filter-chips .chip').forEach(btn => {
        if (btn.getAttribute('data-filter') === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    renderTable();
}

function handleSearch() {
    const input = document.getElementById('search-input');
    currentSearch = input.value.trim();
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) {
        clearBtn.style.display = currentSearch ? 'block' : 'none';
    }
    renderTable();
}

function clearSearch() {
    const input = document.getElementById('search-input');
    if (input) input.value = "";
    currentSearch = "";
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    renderTable();
}

async function manualRefresh() {
    await syncData();
    showToast("Explorer data refreshed!");
}

function showSyncStatus(msg, isPulsing = false) {
    const textEl = document.getElementById('sync-status-text');
    const dotEl = document.querySelector('.sync-dot');
    if (textEl) textEl.innerText = msg;
    if (dotEl) {
        if (isPulsing) {
            dotEl.classList.add('pulsing');
        } else {
            dotEl.classList.remove('pulsing');
        }
    }
}

function setRefreshButtonSpin(spinning) {
    const icon = document.querySelector('.refresh-icon');
    if (icon) {
        if (spinning) icon.classList.add('spinning');
        else icon.classList.remove('spinning');
    }
}

/* Modal Details */
function openTxModal(txHash) {
    const ev = allEvents.find(e => e.txHash.toLowerCase() === txHash.toLowerCase());
    if (!ev) return;

    const modal = document.getElementById('tx-modal');
    const badge = document.getElementById('modal-type-badge');
    const body = document.getElementById('modal-content');

    badge.className = `badge-type ${ev.type.toLowerCase()}`;
    badge.innerText = ev.type;

    let specificHtml = "";
    if (ev.type === "SHIELD") {
        specificHtml = `
            <div class="modal-detail-row">
                <span class="detail-label">Commitment (Leaf):</span>
                <div class="detail-val-box">${ev.data} <button class="mini-copy" onclick="copyDirect('${ev.data}', 'Commitment copied!')">📋</button></div>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">Merkle Leaf Index:</span>
                <span class="detail-val">${ev.leafIndex ?? 0}</span>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">Depositor:</span>
                <div class="detail-val-box">${ev.account} <button class="mini-copy" onclick="copyDirect('${ev.account}', 'Address copied!')">📋</button></div>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">Amount:</span>
                <span class="detail-val amount-shield" style="font-size:1.1rem; font-weight:700;">${ev.amount}</span>
            </div>
        `;
    } else if (ev.type === "UNSHIELD") {
        specificHtml = `
            <div class="modal-detail-row">
                <span class="detail-label">Nullifier Hash:</span>
                <div class="detail-val-box">${ev.data} <button class="mini-copy" onclick="copyDirect('${ev.data}', 'Nullifier copied!')">📋</button></div>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">Recipient:</span>
                <div class="detail-val-box">${ev.recipient} <button class="mini-copy" onclick="copyDirect('${ev.recipient}', 'Recipient copied!')">📋</button></div>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">Relayer Address:</span>
                <div class="detail-val-box">${ev.relayer || "Self-executed"}</div>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">Amount Withdrawn:</span>
                <span class="detail-val amount-unshield" style="font-size:1.1rem; font-weight:700;">${ev.amount}</span>
            </div>
        `;
    } else {
        specificHtml = `
            <div class="modal-detail-row">
                <span class="detail-label">Spent Nullifier:</span>
                <div class="detail-val-box">${ev.nullifierHash} <button class="mini-copy" onclick="copyDirect('${ev.nullifierHash}', 'Nullifier copied!')">📋</button></div>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">New Note Commitment:</span>
                <div class="detail-val-box">${ev.data} <button class="mini-copy" onclick="copyDirect('${ev.data}', 'New Commitment copied!')">📋</button></div>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">New Leaf Index:</span>
                <span class="detail-val">${ev.leafIndex ?? 0}</span>
            </div>
            <div class="modal-detail-row">
                <span class="detail-label">Privacy Shield:</span>
                <span class="detail-val amount-transact" style="font-weight:700;">Full Cryptographic Anonymity</span>
            </div>
        `;
    }

    body.innerHTML = `
        <div class="modal-detail-row">
            <span class="detail-label">Transaction Hash:</span>
            <div class="detail-val-box">
                <a href="${CONFIG.explorerUrl}/tx/${ev.txHash}" target="_blank" class="hash-link">${ev.txHash} ↗</a>
                <button class="mini-copy" onclick="copyDirect('${ev.txHash}', 'Tx Hash copied!')">📋</button>
            </div>
        </div>
        <div class="modal-detail-row">
            <span class="detail-label">Block Number:</span>
            <span class="detail-val">#${ev.block}</span>
        </div>
        <div class="modal-detail-row">
            <span class="detail-label">Timestamp:</span>
            <span class="detail-val">${new Date(ev.timestamp).toLocaleString()} (${formatTimeAgo(ev.timestamp)})</span>
        </div>
        <div class="modal-detail-row">
            <span class="detail-label">Verification:</span>
            <span class="detail-val" style="color:var(--green-primary); font-weight:700;">
                ✓ Verified On-Chain Zero-Knowledge Proof
            </span>
        </div>
        <hr class="modal-divider">
        ${specificHtml}
        <div class="modal-actions">
            <a href="${CONFIG.explorerUrl}/tx/${ev.txHash}" target="_blank" class="btn-abeyscan-ext">
                View on AbeyScan Explorer ↗
            </a>
        </div>
    `;

    modal.style.display = "flex";
}

function closeModal() {
    const modal = document.getElementById('tx-modal');
    if (modal) modal.style.display = "none";
}

function closeModalOnBackdrop(e) {
    if (e.target.id === 'tx-modal') {
        closeModal();
    }
}

/* Helpers */
function truncate(str, start = 8, end = 6) {
    if (!str) return "";
    if (str.length <= start + end) return str;
    return `${str.substring(0, start)}...${str.substring(str.length - end)}`;
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function copyDirect(text, toastMsg = "Copied to clipboard!") {
    navigator.clipboard.writeText(text).then(() => {
        showToast(toastMsg);
    }).catch(() => {
        showToast("Copy failed, please copy manually.");
    });
}

function copyText(elementId, toastMsg) {
    const el = document.getElementById(elementId);
    if (el) {
        copyDirect(el.innerText.trim(), toastMsg);
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.className = 'toast show';
    setTimeout(() => {
        toast.className = 'toast';
    }, 2400);
}
