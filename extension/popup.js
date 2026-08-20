/**
 * Nowser — Popup Logic
 * Per-domain proxy toggling with VPS profile management.
 */

const $ = (sel) => document.querySelector(sel);

const proxyToggle   = $('#proxyToggle');
const globalToggle  = $('#globalToggle');
const domainLabel   = $('#domainLabel');
const profileSelect = $('#profileSelect');
const profileName   = $('#profileName');
const profilePort   = $('#profilePort');
const addProfileBtn = $('#addProfile');
const profileList   = $('#profileList');
const domainList    = $('#domainList');
const statusEl      = $('#status');

/* ── Messaging ──────────────────────────────────────────── */

function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

/* ── Current tab domain ─────────────────────────────────── */

let currentDomain = null;

async function getCurrentTabDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return null;
  }
}

/* ── Render ──────────────────────────────────────────────── */

function render(cfg) {
  const domains = cfg.proxiedDomains || [];
  const isGlobal = cfg.globalMode;
  const isProxied = currentDomain && domains.includes(currentDomain);
  const hasProfile = !!cfg.activeProfile;

  // Toggle & status
  globalToggle.checked = isGlobal;
  globalToggle.disabled = !hasProfile;
  proxyToggle.checked = isProxied;
  proxyToggle.disabled = !currentDomain || !hasProfile || isGlobal;

  // Domain label under toggle
  if (isGlobal) {
    domainLabel.textContent = 'Global Proxy ON';
    domainLabel.classList.add('proxied');
  } else {
    domainLabel.textContent = currentDomain || 'No domain';
    domainLabel.classList.toggle('proxied', isProxied);
  }

  // Status
  const activeCount = domains.length;
  if (isGlobal) {
    statusEl.classList.add('active');
    statusEl.querySelector('.status-text').textContent =
      `All domains → ${cfg.activeProfile}`;
  } else if (isProxied) {
    statusEl.classList.add('active');
    statusEl.querySelector('.status-text').textContent =
      `${currentDomain} → ${cfg.activeProfile}`;
  } else if (activeCount > 0) {
    statusEl.classList.remove('active');
    statusEl.querySelector('.status-text').textContent =
      `${activeCount} domain${activeCount > 1 ? 's' : ''} routed`;
  } else {
    statusEl.classList.remove('active');
    statusEl.querySelector('.status-text').textContent = 'No domains routed';
  }

  // Profile dropdown
  profileSelect.innerHTML = '';
  if (!cfg.profiles.length) {
    profileSelect.innerHTML = '<option value="">— No profiles —</option>';
  } else {
    cfg.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = `${p.name} (localhost:${p.port})`;
      opt.selected = p.name === cfg.activeProfile;
      profileSelect.appendChild(opt);
    });
  }

  // Profile list
  profileList.innerHTML = '';
  cfg.profiles.forEach(p => {
    const li = document.createElement('li');
    li.className = 'profile-item';
    const isActive = p.name === cfg.activeProfile;
    li.innerHTML = `
      <span class="profile-name ${isActive ? 'active' : ''}">${p.name}</span>
      <span class="profile-port">:${p.port}</span>
      <button class="profile-remove" data-name="${p.name}" title="Remove">✕</button>
    `;
    profileList.appendChild(li);
  });

  // Proxied domains list
  domainList.innerHTML = '';
  domains.forEach(d => {
    const li = document.createElement('li');
    li.className = 'domain-item';
    const isCurrent = d === currentDomain;
    li.innerHTML = `
      <span class="domain-name ${isCurrent ? 'current' : ''}">${d}</span>
      <button class="domain-remove" data-domain="${d}" title="Remove">✕</button>
    `;
    domainList.appendChild(li);
  });
}

/* ── Events ──────────────────────────────────────────────── */

proxyToggle.addEventListener('change', async () => {
  if (!currentDomain) return;
  render(await send({ action: 'toggleDomain', domain: currentDomain }));
});

globalToggle.addEventListener('change', async () => {
  render(await send({ action: 'toggleGlobalMode' }));
});

profileSelect.addEventListener('change', async () => {
  render(await send({ action: 'setActiveProfile', name: profileSelect.value }));
});

addProfileBtn.addEventListener('click', addProfileHandler);
profileName.addEventListener('keydown', e => { if (e.key === 'Enter') addProfileHandler(); });

async function addProfileHandler() {
  const name = profileName.value.trim();
  const port = profilePort.value.trim() || '26652';
  if (!name) return;
  const cfg = await send({ action: 'addProfile', name, port });
  profileName.value = '';
  profilePort.value = '26652';
  render(cfg);
}

profileList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.profile-remove');
  if (!btn) return;
  render(await send({ action: 'removeProfile', name: btn.dataset.name }));
});

domainList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.domain-remove');
  if (!btn) return;
  render(await send({ action: 'removeDomain', domain: btn.dataset.domain }));
});

/* ── Init ────────────────────────────────────────────────── */

(async () => {
  currentDomain = await getCurrentTabDomain();
  render(await send({ action: 'getConfig' }));
})();
