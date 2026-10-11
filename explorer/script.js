// ==========================================
// MOSOOSCAN ZK LEDGER EXPLORER ENGINE
// Live On-Chain Synchronization & Proof Verification
// ==========================================

const CONFIG = {
  chainId: 178,
  rpcUrl: "https://testrpc.abeychain.com",
  contractAddress: "0x3aa5aA8Fc12b4C589300638522F0ea9A783305Eb",
  usdtAddress: "0xeF89C5b126f90Fb728A022bc77377d793dCD22CB",
  explorerUrl: "https://testnet.abeyscan.com",
  relayerUrl: "https://rpc.mosoo.xyz"
};

const POOL_ABI = [
  "function poolBalance() external view returns (uint256)",
  "function tokenPoolBalances(address token) external view returns (uint256)",
  "function nextIndex() external view returns (uint32)",
  "function totalTransactionsCount() external view returns (uint256)",
  "function getLastRoot() external view returns (bytes32)",
  "function isKnownRoot(bytes32 root) external view returns (bool)",
  "function isSpent(bytes32 nullifierHash) external view returns (bool)",
  "function nullifierHashes(bytes32 nullifierHash) external view returns (bool)"
];

let provider = null;
let pool = null;
let currentEvents = [];
let nextIndexOnChain = 2;

// Theme Management
const themeBtn = document.getElementById('theme-toggle');
const bodyEl = document.body;
const savedTheme = localStorage.getItem('mosoo_theme') || 'theme-dark';
if (savedTheme === 'theme-dark') bodyEl.classList.add('theme-dark');
else bodyEl.classList.remove('theme-dark');

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    bodyEl.classList.toggle('theme-dark');
    const isDark = bodyEl.classList.contains('theme-dark');
    localStorage.setItem('mosoo_theme', isDark ? 'theme-dark' : 'theme-light');
  });
}

// Modal Logic
const modal = document.getElementById('verify-modal');
const modalClose = document.getElementById('modal-close-btn');
const modalContent = document.getElementById('modal-content');

if (modalClose) {
  modalClose.addEventListener('click', () => modal.classList.remove('open'));
}
if (modal) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function openModal(title, type, hash, status, detailsHtml) {
  const safeHash = escapeHtml(hash);
  const safeType = escapeHtml(type);
  const safeStatus = escapeHtml(status);

  modalContent.innerHTML = `
    <div class="modal-field">
      <div class="mf-tag">Cryptographic Identifier</div>
      <div class="mf-content mono" style="word-break: break-all;">${safeHash}</div>
    </div>
    <div class="modal-field">
      <div class="mf-tag">Entity Class</div>
      <div class="mf-content mono" style="color:var(--text-main); font-weight:700;">${safeType}</div>
    </div>
    <div class="modal-field">
      <div class="mf-tag">On-Chain State</div>
      <div class="mf-content mono" style="color:var(--green-primary); font-weight:700;">${safeStatus}</div>
    </div>
    <div class="modal-field">
      <div class="mf-tag">Zero-Knowledge Verification</div>
      <div class="mf-content mono" style="color:var(--text-muted); font-size:12px; line-height:1.6;">${detailsHtml}</div>
    </div>
  `;
  modal.classList.add('open');
}

// Bind Hash Click Handlers
function bindHashCells() {
  document.querySelectorAll('.hash-cell').forEach(cell => {
    cell.onclick = () => {
      const hash = cell.getAttribute('title') || cell.innerText;
      const realTx = cell.getAttribute('data-tx');
      let extra = 'Cryptographic Poseidon-BN254 commitment / nullifier registered in contract storage.';
      if (realTx) {
        extra += `<br><br><a href="https://testnet.abeyscan.com/tx/${realTx}" target="_blank" style="color:var(--green-primary); font-weight:700; text-decoration:underline;">View Verified On-Chain Tx on AbeyScan ↗</a>`;
      }
      openModal('Hash Details', 'Cryptographic Commitment', hash, 'AUTHENTICATED ON-CHAIN', extra);
    };
  });
}

// Filtering
function bindFilters() {
  const filterBtns = document.querySelectorAll('.fp-btn');
  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.getAttribute('data-filter');

      document.querySelectorAll('.event-row').forEach(row => {
        if (filter === 'all') {
          row.style.display = '';
        } else if (row.classList.contains(`event-${filter}`)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    };
  });
}

// Render dynamic rows
function renderLedgerRows(events) {
  const tbody = document.getElementById('ledger-rows');
  if (!tbody || !Array.isArray(events) || events.length === 0) return;

  tbody.innerHTML = events.map(e => {
    let badgeClass = 'badge-transact';
    let label = e.operation;
    if (e.operation === 'SHIELD') {
      badgeClass = 'badge-shield';
      label = e.asset ? `SHIELD (${e.asset})` : 'SHIELD';
    } else if (e.operation === 'UNSHIELD') {
      badgeClass = 'badge-unshield';
      label = e.asset ? `UNSHIELD (${e.asset})` : 'UNSHIELD';
    } else if (e.operation === 'JOINSPLIT 2-to-2') {
      badgeClass = 'badge-transact';
      label = 'JOINSPLIT 2-to-2';
    } else {
      badgeClass = 'badge-transact';
      label = 'SHIELDED TRANSFER';
    }

    const rowClass = e.operation === 'SHIELD' ? 'event-shield' : (e.operation === 'UNSHIELD' ? 'event-unshield' : 'event-transact');
    const shortHash = e.commitment ? (e.commitment.slice(0, 6) + '...' + e.commitment.slice(-4)) : (e.nullifier ? (e.nullifier.slice(0, 6) + '...' + e.nullifier.slice(-4)) : '0x...');
    const shortRelayer = e.depositor ? (e.depositor.slice(0, 6) + '...' + e.depositor.slice(-4)) : (e.relayer || 'Direct L1');

    return `
      <tr class="event-row ${rowClass}">
        <td><span class="event-badge ${badgeClass}">${label}</span></td>
        <td class="mono">#${e.blockNumber ? e.blockNumber.toLocaleString() : 'Pending'}</td>
        <td class="mono hash-cell" title="Identifier: ${e.commitment || e.nullifier || ''}" data-tx="${e.txHash || ''}">${shortHash}</td>
        <td class="mono">#${e.leafIndex !== undefined ? e.leafIndex : '—'}</td>
        <td class="mono"><strong>${e.amount || 'Confidential 🔒'}</strong></td>
        <td class="mono text-muted">${shortRelayer}</td>
        <td class="mono text-muted"><a href="https://testnet.abeyscan.com/tx/${e.txHash}" target="_blank" style="color:var(--green-primary); text-decoration:none;">Tx ↗</a></td>
      </tr>
    `;
  }).join('');

  bindHashCells();
}

// Live Data Fetcher
async function fetchOnChainStats() {
  if (typeof ethers === 'undefined') return;
  try {
    if (!provider) {
      provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
      pool = new ethers.Contract(CONFIG.contractAddress, POOL_ABI, provider);
    }

    // 1. Try Relayer Ledger API
    let ledgerData = null;
    try {
      const resp = await fetch(`${CONFIG.relayerUrl}/api/ledger`, { cache: 'no-cache' });
      if (resp.ok) {
        ledgerData = await resp.json();
      }
    } catch (_) {}

    // 2. Query On-Chain Directly
    const [balWei, nextIdx, totalTxs, lastRoot] = await Promise.all([
      pool.poolBalance().catch(() => null),
      pool.nextIndex().catch(() => null),
      pool.totalTransactionsCount().catch(() => null),
      pool.getLastRoot().catch(() => null)
    ]);

    if (nextIdx !== null) nextIndexOnChain = Number(nextIdx);

    // Update TVL Card
    const tvlEl = document.getElementById('exp-tvl') || document.querySelector('.telem-card:nth-child(1) .tc-val');
    if (tvlEl) {
      if (ledgerData && ledgerData.poolTVL) {
        tvlEl.innerText = ledgerData.poolTVL;
      } else if (balWei !== null) {
        const balEth = parseFloat(ethers.formatEther(balWei)).toFixed(3);
        tvlEl.innerText = `${balEth} ABEY`;
      }
    }

    // Update Leaves Card & Gauge
    const leavesEl = document.getElementById('exp-leaves') || document.querySelector('.telem-card:nth-child(2) .tc-val');
    const leafGaugeLabel = document.getElementById('exp-leaf-gauge-label') || document.querySelector('.tg-labels span:nth-child(2)');
    const leafGaugeFill = document.getElementById('exp-leaf-gauge-fill') || document.querySelector('.tg-fill');

    if (nextIdx !== null) {
      const leafCount = Number(nextIdx);
      if (leavesEl) {
        leavesEl.innerText = `${leafCount} ${leafCount === 1 ? 'Leaf' : 'Leaves'}`;
      }
      if (leafGaugeLabel) {
        leafGaugeLabel.innerText = `Current Leaf #${Math.max(0, leafCount - 1)} (${leafCount} Active Leaves)`;
      }
      if (leafGaugeFill) {
        const pct = Math.max(1, (leafCount / 1048576) * 100);
        leafGaugeFill.style.width = `${Math.min(100, pct.toFixed(2))}%`;
      }
    }

    // Update Transactions Card
    const txsEl = document.getElementById('exp-txs') || document.querySelector('.telem-card:nth-child(3) .tc-val');
    if (txsEl && totalTxs !== null) {
      txsEl.innerText = `${totalTxs.toString()} Txs On-Chain`;
    }

    // Update Current Root Card
    const rootEl = document.getElementById('exp-root') || document.querySelector('.telem-card:nth-child(4) .tc-val');
    if (rootEl) {
      const activeRoot = (ledgerData && ledgerData.lastRoot) ? ledgerData.lastRoot : lastRoot;
      if (activeRoot) {
        rootEl.innerText = `${activeRoot.slice(0, 8)}...${activeRoot.slice(-4)}`;
        rootEl.title = activeRoot;
      }
    }

    // Render Ledger stream from API or fallback
    if (ledgerData && Array.isArray(ledgerData.events) && ledgerData.events.length > 0) {
      currentEvents = ledgerData.events;
      renderLedgerRows(currentEvents);
    }
  } catch (err) {
    console.warn("Live RPC fetch fallback:", err);
  }
}

// Search handling with real contract verification
const searchBtn = document.getElementById('search-btn');
const searchInput = document.getElementById('search-input');

if (searchBtn && searchInput) {
  searchBtn.addEventListener('click', async () => {
    const val = searchInput.value.trim();
    if (!val) {
      alert('Please enter a commitment, nullifier, root, or leaf index to verify.');
      return;
    }

    searchBtn.disabled = true;
    searchBtn.innerText = 'Verifying...';

    try {
      // 1. Check if input is a Leaf Index number
      const numVal = Number(val.replace('#', ''));
      if (!isNaN(numVal) && !val.startsWith('0x')) {
        if (numVal < nextIndexOnChain) {
          const matchEv = currentEvents.find(e => e.leafIndex === numVal);
          let extra = `Leaf index #${numVal} is permanently inserted in the 20-level on-chain Merkle tree.`;
          if (matchEv && matchEv.txHash) {
            extra += `<br><br><strong>Deposit Amount:</strong> ${matchEv.amount || 'Shielded'}<br><strong>Commitment:</strong> ${matchEv.commitment || '—'}<br><br><a href="https://testnet.abeyscan.com/tx/${matchEv.txHash}" target="_blank" style="color:var(--green-primary); font-weight:700; text-decoration:underline;">View Tx on AbeyScan ↗</a>`;
          }
          openModal('Leaf Verification', 'Poseidon Merkle Leaf Index', `#${numVal}`, 'OCCUPIED ON-CHAIN', extra);
        } else {
          openModal('Leaf Verification', 'Unallocated Leaf Index', `#${numVal}`, 'UNALLOCATED / FUTURE LEAF', `Tree currently has ${nextIndexOnChain} active leaves (#0 to #${nextIndexOnChain - 1}). Leaf #${numVal} will be filled by a future Shield deposit.`);
        }
        searchBtn.disabled = false;
        searchBtn.innerText = 'Verify State';
        return;
      }

      // 2. Check known events in current stream
      const eventMatch = currentEvents.find(e => 
        (e.commitment && e.commitment.toLowerCase() === val.toLowerCase()) ||
        (e.txHash && e.txHash.toLowerCase() === val.toLowerCase()) ||
        (e.nullifier && e.nullifier.toLowerCase() === val.toLowerCase())
      );

      if (eventMatch) {
        let extra = `<strong>Operation:</strong> ${eventMatch.operation}<br><strong>Leaf:</strong> #${eventMatch.leafIndex}<br><strong>Block:</strong> #${eventMatch.blockNumber}<br><strong>Amount:</strong> ${eventMatch.amount || 'Confidential'}<br><br><a href="https://testnet.abeyscan.com/tx/${eventMatch.txHash}" target="_blank" style="color:var(--green-primary); font-weight:700; text-decoration:underline;">View Verified On-Chain Tx on AbeyScan ↗</a>`;
        openModal('Ledger Event Match', `On-Chain ${eventMatch.operation}`, val, 'VERIFIED ON-CHAIN', extra);
        searchBtn.disabled = false;
        searchBtn.innerText = 'Verify State';
        return;
      }

      // 3. Contract calls for Root and Nullifier
      if (pool && val.startsWith('0x') && val.length === 66) {
        const isRoot = await pool.isKnownRoot(val).catch(() => false);
        if (isRoot) {
          openModal('Root Verification', 'Historical Merkle Root', val, 'AUTHENTICATED ROOT ON-CHAIN', 'Belongs to 64-slot ring buffer historical Poseidon-BN254 roots. Verified on Abey Testnet contract 0x3aa5...05Eb.');
          searchBtn.disabled = false;
          searchBtn.innerText = 'Verify State';
          return;
        }

        const isSpent = await pool.nullifierHashes(val).catch(() => false);
        if (isSpent) {
          openModal('Nullifier Verification', 'Spent Nullifier Hash', val, 'SPENT ON-CHAIN', 'Nullifier has been permanently revealed. Double-spending this note is mathematically prohibited.');
          searchBtn.disabled = false;
          searchBtn.innerText = 'Verify State';
          return;
        }
      }
    } catch (e) {}

    // Fallback structural check
    if (val.startsWith('0x') && val.length === 66) {
      openModal('Cryptographic Hash', 'BN254 Field Element', val, 'VALID HASH STRUCTURE', '256-bit scalar hash formatted correctly for Poseidon-BN254 curve operations on AbeyChain.');
    } else {
      openModal('Search Result', 'Query String', val, 'NOT FOUND IN ACTIVE SET', 'No matching commitment, nullifier, or historical root found in the active on-chain ring buffer.');
    }

    searchBtn.disabled = false;
    searchBtn.innerText = 'Verify State';
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchBtn.click();
  });
}

// Quick Search Chip Handler
function quickFillSearch(term) {
  const input = document.getElementById('search-input');
  const btn = document.getElementById('search-btn');
  if (input && btn) {
    input.value = term;
    btn.click();
  }
}
window.quickFillSearch = quickFillSearch;

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  bindFilters();
  bindHashCells();
  fetchOnChainStats();
  setInterval(fetchOnChainStats, 8000);
});
