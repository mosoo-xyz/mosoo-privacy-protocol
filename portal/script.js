// ==========================================
// MOSOO PORTAL INTERACTIVE CRYPTO ENGINE
// ==========================================

// --- Theme Management ---
const themeBtn = document.getElementById('theme-toggle');
const bodyEl = document.body;
const savedTheme = localStorage.getItem('mosoo_theme') || 'theme-dark';
if (savedTheme === 'theme-dark') {
  bodyEl.classList.add('theme-dark');
} else {
  bodyEl.classList.remove('theme-dark');
}

themeBtn.addEventListener('click', () => {
  bodyEl.classList.toggle('theme-dark');
  const isDark = bodyEl.classList.contains('theme-dark');
  localStorage.setItem('mosoo_theme', isDark ? 'theme-dark' : 'theme-light');
  playSynthTone(isDark ? 300 : 450);
});

// --- Audio Synthesizer (Disabled per specification) ---
function playSynthTone() {}
function playArpeggio() {}

// --- Ambient Cursor Glow Follower ---
const cursorGlow = document.getElementById('cursor-glow');
window.addEventListener('mousemove', (e) => {
  if (cursorGlow) {
    cursorGlow.style.left = `${e.clientX}px`;
    cursorGlow.style.top = `${e.clientY}px`;
  }
});

// --- Interactive ZK Mesh Particle Canvas ---
const canvas = document.getElementById('zk-canvas');
const ctx = canvas.getContext('2d');
let width, height;
let particles = [];

function resizeCanvas() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
  constructor() {
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.radius = Math.random() * 2 + 1;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    if (this.x < 0 || this.x > width) this.vx *= -1;
    if (this.y < 0 || this.y > height) this.vy *= -1;
  }
  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = bodyEl.classList.contains('theme-dark') ? 'rgba(60, 208, 112, 0.4)' : 'rgba(46, 184, 97, 0.3)';
    ctx.fill();
  }
}

for (let i = 0; i < 48; i++) {
  particles.push(new Particle());
}

let mouseX = -1000, mouseY = -1000;
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

function animateParticles() {
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < particles.length; i++) {
    particles[i].update();
    particles[i].draw();

    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 130) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        const alpha = (1 - dist / 130) * 0.15;
        ctx.strokeStyle = bodyEl.classList.contains('theme-dark') ? `rgba(60, 208, 112, ${alpha})` : `rgba(46, 184, 97, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Connect to mouse
    const mdx = particles[i].x - mouseX;
    const mdy = particles[i].y - mouseY;
    const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
    if (mdist < 160) {
      ctx.beginPath();
      ctx.moveTo(particles[i].x, particles[i].y);
      ctx.lineTo(mouseX, mouseY);
      const alpha = (1 - mdist / 160) * 0.35;
      ctx.strokeStyle = bodyEl.classList.contains('theme-dark') ? `rgba(91, 226, 141, ${alpha})` : `rgba(60, 208, 112, ${alpha})`;
      ctx.stroke();
    }
  }
  requestAnimationFrame(animateParticles);
}
animateParticles();

// --- 3D Mouse Parallax Tilt for Cockpit Hologram Card ---
const cockpitCard = document.getElementById('cockpit-card');
if (cockpitCard) {
  cockpitCard.addEventListener('mousemove', (e) => {
    const rect = cockpitCard.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -10;
    const rotateY = ((x - centerX) / centerX) * 10;

    cockpitCard.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;
  });

  cockpitCard.addEventListener('mouseleave', () => {
    cockpitCard.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
  });
}

// --- Interactive Anonymity Cloak Simulator ---
function setPrivacyState(state) {
  const btnPub = document.getElementById('btn-state-public');
  const btnShield = document.getElementById('btn-state-shielded');
  const cloakBox = document.getElementById('cloak-box');
  if (!btnPub || !btnShield || !cloakBox) return;

  const cloakDot = document.getElementById('cloak-dot');
  const cloakText = document.getElementById('cloak-status-text');
  const cloakBadge = document.getElementById('cloak-badge');
  const cloakEntropy = document.getElementById('cloak-entropy');
  const cloakIcon = document.getElementById('cloak-icon');
  const crIdentity = document.getElementById('cr-identity');
  const crVal = document.getElementById('cr-val');
  const crTrace = document.getElementById('cr-trace');
  const crMev = document.getElementById('cr-mev');
  const cloakBar = document.getElementById('cloak-bar');
  const cloakMetaRight = document.getElementById('cloak-meta-right');
  const laserSweep = document.getElementById('laser-sweep');

  // Trigger laser scan animation
  if (laserSweep) {
    laserSweep.classList.remove('sweep-anim');
    void laserSweep.offsetWidth;
    laserSweep.classList.add('sweep-anim');
  }

  if (state === 'public') {
    // 🔴 PUBLIC SURVEILLANCE STATE
    btnPub.classList.add('active', 'public');
    btnShield.classList.remove('active');
    cloakBox.classList.add('public-mode');
    cloakDot.classList.add('alert');
    cloakText.innerText = 'SURVEILLANCE STATE: EXPOSED (PUBLIC L1)';
    cloakText.style.color = '#ef4444';
    cloakBadge.innerText = '🚨 PUBLIC WALLET (TRACKABLE)';
    cloakBadge.style.color = '#ef4444';
    cloakBadge.style.background = 'rgba(239, 68, 68, 0.15)';
    cloakEntropy.innerText = 'Entropy: 0.0% (Zero Privacy)';
    cloakIcon.innerText = '👁️';
    cloakIcon.style.filter = 'drop-shadow(0 0 12px #ef4444)';

    crIdentity.className = 'cr-val danger';
    crIdentity.innerText = '0x71C8366420A0926718E2A3fB490a8d3027506691 (Public Account)';
    crVal.className = 'cr-val';
    crVal.innerText = '124.50 ABEY ($1,245.00) • Publicly Indexed';
    crTrace.className = 'cr-val danger';
    crTrace.innerText = '100.0% (KYC Exchange & IP Metadata Detected)';
    crMev.className = 'cr-val danger';
    crMev.innerText = 'CRITICAL (Mempool Sandwich & Front-Running Bots Active)';

    cloakBar.style.width = '0%';
    cloakBar.style.backgroundColor = '#ef4444';
    cloakMetaRight.innerText = 'ZK Solvency: Unshielded';
    playSynthTone(220, 'sawtooth', 0.2, 0.08);
  } else {
    // 🟢 CLOAK STATE (SHIELDED)
    btnPub.classList.remove('active', 'public');
    btnShield.classList.add('active');
    cloakBox.classList.remove('public-mode');
    cloakDot.classList.remove('alert');
    cloakText.innerText = 'CLOAK STATE: SHIELDED';
    cloakText.style.color = 'var(--green-primary)';
    cloakBadge.innerText = 'SHIELDED NOTE (POSEIDON UTXO)';
    cloakBadge.style.color = 'var(--green-primary)';
    cloakBadge.style.background = 'var(--green-bg)';
    cloakEntropy.innerText = 'Privacy Set: Active (Zero-Leakage)';
    cloakIcon.innerText = '🛡️';
    cloakIcon.style.filter = 'drop-shadow(0 0 12px var(--green-primary))';

    crIdentity.className = 'cr-val highlight';
    crIdentity.innerText = '0msk1e69...0680f (Shielded Address)';
    crVal.className = 'cr-val';
    crVal.innerText = 'Poseidon(npk, s, 124.50 ABEY)';
    crTrace.className = 'cr-val success';
    crTrace.innerText = '0.0% (Zero Address Trail • Severed)';
    crMev.className = 'cr-val success';
    crMev.innerText = 'IMMUNE (Gasless Private Relayer Daemon)';

    cloakBar.style.width = '98.4%';
    cloakBar.style.backgroundColor = 'var(--green-primary)';
    cloakMetaRight.innerText = 'ZK Solvency: 100%';
    playArpeggio([440, 554, 659, 880], 0.07);
  }
}

// --- Interactive Poseidon Merkle Tree Engine ---
const btnInsertLeaf = document.getElementById('btn-insert-leaf');
let currentLeafNum = 1;

if (btnInsertLeaf) {
  btnInsertLeaf.addEventListener('click', () => {
    btnInsertLeaf.disabled = true;
    const leafTarget = document.getElementById('leaf-new');
    const leafHash = document.getElementById('leaf-new-hash');
    const leafTag = document.getElementById('leaf-new-tag');
    const lineSub2 = document.getElementById('line-sub-2');
    const nodeMid2 = document.getElementById('node-mid-2');
    const lineRight = document.getElementById('line-right');
    const nodeRoot = document.getElementById('node-root');
    const nodeRootHash = document.getElementById('node-root-hash');
    const mvcRootVal = document.getElementById('mvc-root-val');
    const mvcStatus = document.getElementById('mvc-status');

    // Step 1: Leaf Insertion
    mvcStatus.innerHTML = `<span>[STEP 1/3] Hashing secret commitment: Poseidon(npk, s, ${currentLeafNum})...</span>`;
    leafTarget.classList.add('pulse-climb');
    const randHex = '0x' + Array.from({length: 8}, () => Math.floor(Math.random()*16).toString(16)).join('') + '...5d6e';
    leafHash.innerText = randHex;
    leafTag.innerText = `LEAF #${currentLeafNum} (INSERTED)`;
    playSynthTone(330, 'triangle', 0.15);

    // Step 2: Intermediate Climbing
    setTimeout(() => {
      if (lineSub2) lineSub2.classList.add('active');
      if (nodeMid2) nodeMid2.classList.add('pulse-climb');
      mvcStatus.innerHTML = `<span>[STEP 2/3] Evaluating Poseidon S-Boxes on BN254 Field...</span>`;
      playSynthTone(440, 'triangle', 0.15);
    }, 450);

    // Step 3: Root Update
    setTimeout(() => {
      if (lineRight) lineRight.classList.add('active');
      if (nodeRoot) nodeRoot.classList.add('pulse-climb');
      const newRoot = '0x130a' + Array.from({length: 20}, () => Math.floor(Math.random()*16).toString(16)).join('') + '977';
      nodeRootHash.innerText = newRoot.slice(0, 8) + '...' + newRoot.slice(-5);
      mvcRootVal.innerText = newRoot;
      mvcStatus.innerHTML = `<span style="color:var(--green-primary);">[CONFIRMED] Poseidon Merkle Root updated on Abey Testnet at Block #16,188,728!</span>`;
      playArpeggio([550, 660, 880, 1100], 0.08);

      currentLeafNum++;
      btnInsertLeaf.innerText = `🌿 Insert Shielded Note #${currentLeafNum}`;
      btnInsertLeaf.disabled = false;

      setTimeout(() => {
        leafTarget.classList.remove('pulse-climb');
        if (nodeMid2) nodeMid2.classList.remove('pulse-climb');
        if (nodeRoot) nodeRoot.classList.remove('pulse-climb');
      }, 1200);
    }, 950);
  });
}

// --- Groth16 Prover Simulator ---
const btnRunProof = document.getElementById('btn-run-proof');
const stLog = document.getElementById('st-log');
const stStatus = document.getElementById('st-status');
const stProgress = document.getElementById('st-progress-fill');
const btnDownloadProof = document.getElementById('btn-download-proof');

let lastGeneratedProof = null;

if (btnRunProof) {
  btnRunProof.addEventListener('click', () => {
    const amt = document.getElementById('sim-input-amt').value || '10.0';
    const key = document.getElementById('sim-input-key').value;

    btnRunProof.disabled = true;
    stStatus.innerText = 'SYNTHESIZING • Constraints Active';
    stProgress.style.width = '15%';
    stLog.innerText = `[PROVER] Initializing SnarkJS BN254 Witness Generator...\n[INPUT] Shielded UTXO Value: ${amt} ABEY\n[INPUT] Target Viewing Key: ${key.slice(0, 14)}...`;
    playSynthTone(280, 'square', 0.1);

    setTimeout(() => {
      stProgress.style.width = '45%';
      stLog.innerText += `\n[CIRCUIT] Evaluating 18,420 R1CS non-linear polynomial constraints...\n[POSEIDON] 63 S-Box rounds computed in 0.22s.`;
      playSynthTone(400, 'triangle', 0.1);
    }, 600);

    setTimeout(() => {
      stProgress.style.width = '80%';
      stLog.innerText += `\n[GROTH16] Synthesizing Group Elements (pi_a, pi_b, pi_c) on Alt-BN128...\n[MEMO] Encrypting ECDH secp256k1 memo ciphertext...`;
      playSynthTone(550, 'triangle', 0.1);
    }, 1200);

    setTimeout(() => {
      stProgress.style.width = '100%';
      stStatus.innerText = 'PROOF VERIFIED • Ready for Relayer';
      stLog.innerText += `\n[SUCCESS] Groth16 Proof Synthesized in 0.68s!\n[PUBLIC SIGNALS] Root: 0x130a...b085 • Nullifier: 0x33b1...98ef\n[STATUS] Ready to broadcast gaslessly via Relayer (HTTPS Node).`;
      playArpeggio([523, 659, 783, 1046], 0.08);

      lastGeneratedProof = {
        protocol: "groth16",
        curve: "bn254",
        circuit: "MosooMultiUTXO_2x2",
        pi_a: ["0x18ab3...", "0x09fc2...", "0x1"],
        pi_b: [["0x23a1...", "0x98cc..."], ["0x44dd...", "0x11ee..."], ["0x1", "0x0"]],
        pi_c: ["0x88bb...", "0x77aa...", "0x1"],
        publicSignals: [
          "0x130af55934137efe25b9a4359ae5b6fec08605b68558f5424fbf54e47ddcb085",
          "0x33b1e784ca12ef9034dcba9812739485716298ef",
          amt.toString(),
          "0x0eE7d9b9C8C0B7887Fe977994E8064A8"
        ],
        timestamp: new Date().toISOString()
      };

      if (btnDownloadProof) btnDownloadProof.style.display = 'inline-flex';
      btnRunProof.disabled = false;
    }, 1800);
  });
}

function downloadProofJson() {
  if (!lastGeneratedProof) return;
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(lastGeneratedProof, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "mosoo_groth16_proof.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  playSynthTone(880, 'sine', 0.15);
}

// --- Interactive 3-Stage Lifecycle Stepper ---
const STAGES = {
  1: {
    title: "01 • Shielding Ingestion (Public L1 to ZK Tree)",
    desc: "Public ABEY or tokens are locked into the MosooHardenedPool contract. A cryptographic commitment Poseidon(npk, s, v) is computed client-side and inserted into the 20-level Merkle tree without revealing the note's secret key.",
    op: "MosooHardenedPool.shield(commitment)",
    leak: "0.0% (Receiver identity undisclosed)",
    prim: "PoseidonT3 Hasher on BN254",
    in1: "10.0 ABEY (Public Deposit)",
    in2: "0.0 (Dummy Padding)",
    out1: "10.0 ABEY (Shielded Leaf)",
    out2: "0.0 (Null)",
    fee: "0.000 ABEY (Native Ingestion)"
  },
  2: {
    title: "02 • Off-Chain Shielded Spend (Multi-UTXO Value Conservation)",
    desc: "Transactions occur completely off-chain. Spendable input notes are proven to belong to the Merkle tree via Groth16 SNARK, nullifiers are generated to prevent double-spending, and change notes return safely to the sender.",
    op: "Relayer.relay(proof, nullifiers, commitments)",
    leak: "0.0% (No on-chain address linkage)",
    prim: "Circom 2.0 • 2-in 2-out Conservation",
    in1: "10.0 ABEY (Input UTXO)",
    in2: "0.0 ABEY (Padding)",
    out1: "6.0 ABEY (Recipient Shielded Note)",
    out2: "3.999 ABEY (Change Note)",
    fee: "0.001 ABEY (Relayer Fee)"
  },
  3: {
    title: "03 • Clean Exit & Atomic DEX Swap (Zero-Trace Exit)",
    desc: "Nullifiers are permanently revealed on-chain to unlock liquidity into a fresh, unlinked public address. Priority 3 integrates confidential AMM routing so tokens can swap without leaving the shielded pool.",
    op: "MosooHardenedPool.unshield(nullifier, to)",
    leak: "0.0% (Complete historical severing)",
    prim: "Poseidon Nullifier Invalidation",
    in1: "6.0 ABEY (Shielded Note)",
    in2: "0.0 ABEY (Padding)",
    out1: "5.999 ABEY (Fresh Public Address)",
    out2: "0.0 ABEY (Fully Spent)",
    fee: "0.001 ABEY (Gasless Relayer)"
  }
};

function switchLifecycleStage(num) {
  document.querySelectorAll('.stage-tab').forEach(t => {
    if (t.getAttribute('data-stage') === num.toString()) t.classList.add('active');
    else t.classList.remove('active');
  });

  const s = STAGES[num];
  if (!s) return;

  document.getElementById('stage-title').innerText = s.title;
  document.getElementById('stage-desc').innerText = s.desc;
  document.getElementById('stage-op').innerText = s.op;
  document.getElementById('stage-leak').innerText = s.leak;
  document.getElementById('stage-prim').innerText = s.prim;

  const in1 = document.querySelector('#sc-in-1 .uc-amount');
  const out1 = document.querySelector('#sc-out-1 .uc-amount');
  const out2 = document.querySelector('#sc-out-2 .uc-amount');

  if (in1) in1.innerText = s.in1;
  if (out1) out1.innerText = s.out1;
  if (out2) out2.innerText = s.out2;

  playSynthTone(440 + num * 80, 'triangle');
}

// --- Command Palette Trigger (Ctrl+K or ⌘K) ---
const cmdBackdrop = document.getElementById('cmd-palette-backdrop');
const btnCmd = document.getElementById('btn-cmd');
const cmdInput = document.getElementById('cmd-input');

function openCmd() {
  cmdBackdrop.classList.add('open');
  cmdInput.value = '';
  cmdInput.focus();
  playSynthTone(520);
}
function closeCmd() {
  cmdBackdrop.classList.remove('open');
  playSynthTone(260);
}

if (btnCmd) btnCmd.addEventListener('click', openCmd);

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (cmdBackdrop.classList.contains('open')) closeCmd();
    else openCmd();
  }
  if (e.key === 'Escape' && cmdBackdrop.classList.contains('open')) {
    closeCmd();
  }
});

if (cmdBackdrop) {
  cmdBackdrop.addEventListener('click', (e) => {
    if (e.target === cmdBackdrop) closeCmd();
  });
}

// Command item actions
document.querySelectorAll('.cmd-item').forEach(item => {
  item.addEventListener('click', () => {
    closeCmd();
    const action = item.getAttribute('data-action');
    if (action === 'dapp') {
      window.open('https://app.mosoo.xyz', '_blank');
    } else if (action === 'explorer') {
      window.open('https://explorer.mosoo.xyz', '_blank');
    } else if (action === 'how-it-works') {
      window.location.href = 'how-it-works.html';
    } else if (action === 'ecosystem') {
      window.location.href = 'ecosystem.html';
    } else if (action === 'security') {
      window.location.href = 'security.html';
    } else if (action === 'faq') {
      window.location.href = 'faq.html';
    } else if (action === 'cloak') {
      const el = document.getElementById('cloak-anchor');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        setPrivacyState('shielded');
      } else {
        window.location.href = 'index.html#cloak-anchor';
      }
    } else if (action === 'tree') {
      const el = document.getElementById('merkle-explorer');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      else window.location.href = 'index.html#merkle-explorer';
    } else if (action === 'demo') {
      const el = document.getElementById('zk-simulator');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      else window.location.href = 'index.html#zk-simulator';
    } else if (action === 'theme') {
      if (themeBtn) themeBtn.click();
    }
  });
});

// --- Interactive FAQ Accordion Engine ---
document.querySelectorAll('.faq-card').forEach(card => {
  card.addEventListener('click', (e) => {
    // Prevent accidental text selection interference
    const isOpen = card.classList.contains('open');
    card.classList.toggle('open');
    playSynthTone(isOpen ? 280 : 440, 'triangle', 0.08);
  });
});

// --- Mobile Navigation Drawer Engine ---
const mobileDrawer = document.getElementById('mobile-nav-drawer');
const btnMobileNav = document.getElementById('btn-mobile-nav');
const btnCloseMobileNav = document.getElementById('btn-close-mobile-nav');

if (btnMobileNav && mobileDrawer) {
  btnMobileNav.addEventListener('click', () => {
    mobileDrawer.classList.add('open');
    playSynthTone(480, 'sine', 0.1);
  });
}

if (btnCloseMobileNav && mobileDrawer) {
  btnCloseMobileNav.addEventListener('click', () => {
    mobileDrawer.classList.remove('open');
    playSynthTone(240, 'sine', 0.1);
  });
}

document.querySelectorAll('.m-nav-link').forEach(link => {
  link.addEventListener('click', () => {
    if (mobileDrawer) mobileDrawer.classList.remove('open');
  });
});

// Live On-Chain TVL Sync for Portal
function fetchPortalLiveTVL() {
  fetch('https://rpc.mosoo.xyz/health')
    .then(r => r.json())
    .then(data => {
      if (data && data.poolTVL) {
        const tvlEl = document.getElementById('t-tvl');
        if (tvlEl) tvlEl.innerText = data.poolTVL;
      }
    })
    .catch(() => {});
}
fetchPortalLiveTVL();

// Initialize on Load
setPrivacyState('shielded');
