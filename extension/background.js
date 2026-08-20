/**
 * Nowser — Background Service Worker
 * Manages proxy routing through VPS profiles.
 * Per-domain routing: only explicitly enabled domains go through the proxy.
 */

const DEFAULT_CONFIG = {
  activeProfile: null,
  profiles: [],
  proxiedDomains: [],
  globalMode: false
  // Profile shape: { name: string, host: string, port: number }
};

/* ── Storage ─────────────────────────────────────────────── */

async function getConfig() {
  const { nowserConfig } = await chrome.storage.local.get('nowserConfig');
  return { ...DEFAULT_CONFIG, ...nowserConfig };
}

async function saveConfig(cfg) {
  await chrome.storage.local.set({ nowserConfig: cfg });
}

/* ── Proxy ───────────────────────────────────────────────── */

async function applyProxy(cfg) {
  const profile = cfg.profiles.find(p => p.name === cfg.activeProfile);
  const domains = cfg.proxiedDomains || [];
  const isGlobal = cfg.globalMode;

  if (!profile || (!isGlobal && domains.length === 0)) {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  // Build PAC script
  let pac = "";
  if (isGlobal) {
    pac = `function FindProxyForURL(url, host) {
  return "PROXY ${profile.host}:${profile.port}";
}`;
  } else {
    const domainList = JSON.stringify(domains);
    pac = `function FindProxyForURL(url, host) {
  var domains = ${domainList};
  for (var i = 0; i < domains.length; i++) {
    if (dnsDomainIs(host, domains[i]) || host === domains[i]) {
      return "PROXY ${profile.host}:${profile.port}";
    }
  }
  return "DIRECT";
}`;
  }

  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: pac } },
    scope: 'regular'
  });

  if (isGlobal) {
    await chrome.action.setBadgeText({ text: 'ALL' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d29922' });
  } else {
    await chrome.action.setBadgeText({ text: String(domains.length) });
    await chrome.action.setBadgeBackgroundColor({ color: '#3fb950' });
  }
}

/* ── Badge per tab ───────────────────────────────────────── */

async function updateTabBadge(tabId, url) {
  const cfg = await getConfig();
  const domain = extractDomain(url);
  const isGlobal = cfg.globalMode;
  const isProxied = isGlobal || (domain && cfg.proxiedDomains.includes(domain));

  await chrome.action.setBadgeText({
    tabId,
    text: isGlobal ? 'ALL' : (isProxied ? 'ON' : '')
  });
  if (isGlobal) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d29922' });
  } else if (isProxied) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#3fb950' });
  }
}

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

/* ── Message handler ─────────────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse);
  return true;
});

async function handleMessage(msg, sender) {
  let cfg = await getConfig();

  switch (msg.action) {
    case 'getConfig':
      return cfg;

    case 'getTabDomain':
      return { domain: extractDomain(msg.url) };

    case 'toggleGlobalMode':
      cfg.globalMode = !cfg.globalMode;
      break;

    case 'toggleDomain': {
      const domain = msg.domain;
      if (!domain) return cfg;

      const idx = cfg.proxiedDomains.indexOf(domain);
      if (idx >= 0) {
        cfg.proxiedDomains.splice(idx, 1);
      } else {
        cfg.proxiedDomains.push(domain);
      }
      break;
    }

    case 'removeDomain': {
      cfg.proxiedDomains = cfg.proxiedDomains.filter(d => d !== msg.domain);
      break;
    }

    case 'setActiveProfile':
      cfg.activeProfile = msg.name;
      break;

    case 'addProfile': {
      const exists = cfg.profiles.some(p => p.name === msg.name);
      if (!exists && msg.name) {
        cfg.profiles.push({
          name: msg.name,
          host: msg.host || 'localhost',
          port: parseInt(msg.port, 10) || 26652
        });
        if (!cfg.activeProfile) cfg.activeProfile = msg.name;
      }
      break;
    }

    case 'removeProfile':
      cfg.profiles = cfg.profiles.filter(p => p.name !== msg.name);
      if (cfg.activeProfile === msg.name) {
        cfg.activeProfile = cfg.profiles[0]?.name || null;
      }
      break;

    default:
      return { error: 'unknown action' };
  }

  await saveConfig(cfg);
  await applyProxy(cfg);
  return cfg;
}

/* ── Tab events — update per-tab badge ───────────────────── */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateTabBadge(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) updateTabBadge(tabId, tab.url);
  } catch {}
});

/* ── Startup ─────────────────────────────────────────────── */

chrome.runtime.onStartup.addListener(async () => applyProxy(await getConfig()));
chrome.runtime.onInstalled.addListener(async () => applyProxy(await getConfig()));
