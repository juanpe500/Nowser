/**
 * Nowser — DevTools Panel Logic
 *
 * Captures finished network requests via the DevTools API,
 * extracts Server-Timing headers injected by the VPS proxy,
 * and renders a timing breakdown table.
 */

const $ = (s) => document.getElementById(s);
const entries = [];
let selectedIdx = -1;

/* ── Helpers ─────────────────────────────────────────────── */

function parseServerTiming(headers) {
  const st = headers.find(h => h.name.toLowerCase() === 'server-timing');
  if (!st) return null;

  const metrics = {};
  // Format: name;dur=XX.XX;desc="...", name2;dur=YY.YY;desc="..."
  st.value.split(',').forEach(part => {
    const trimmed = part.trim();
    const nameMatch = trimmed.match(/^([\w-]+)/);
    const durMatch = trimmed.match(/dur=([\d.]+)/);
    if (nameMatch && durMatch) {
      metrics[nameMatch[1]] = parseFloat(durMatch[1]);
    }
  });
  return Object.keys(metrics).length ? metrics : null;
}

function getTargetIP(headers) {
  const h = headers.find(h => h.name.toLowerCase() === 'x-nowser-target-ip');
  return h ? h.value : null;
}

function formatMs(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function timingClass(ms) {
  if (ms == null) return 'timing-na';
  if (ms < 100) return 'timing-fast';
  if (ms < 300) return 'timing-med';
  if (ms < 1000) return 'timing-slow';
  return 'timing-crit';
}

function methodClass(m) {
  return 'method-' + (m || 'get').toLowerCase();
}

function statusClass(s) {
  if (s >= 200 && s < 300) return 'status-2xx';
  if (s >= 300 && s < 400) return 'status-3xx';
  if (s >= 400 && s < 500) return 'status-4xx';
  return 'status-5xx';
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/* ── Rendering ───────────────────────────────────────────── */

function renderRow(entry, idx) {
  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  if (idx === selectedIdx) tr.classList.add('selected');

  const vpsTotal = entry.vps?.['vps-total'] ?? null;
  const total = entry.totalTime;
  const localTime = (vpsTotal != null && total != null) ? Math.max(0, total - vpsTotal) : null;

  // Timing bar proportions
  const maxTime = total || 1;
  const localPct = localTime != null ? (localTime / maxTime * 100) : 0;
  const vpsPct = vpsTotal != null ? (vpsTotal / maxTime * 100) : 0;

  tr.innerHTML = `
    <td class="col-url" title="${entry.url}">${shortenUrl(entry.url)}</td>
    <td class="col-method"><span class="${methodClass(entry.method)}">${entry.method}</span></td>
    <td class="col-status"><span class="${statusClass(entry.status)}">${entry.status}</span></td>
    <td class="col-size">${formatSize(entry.size)}</td>
    <td class="col-vps ${timingClass(vpsTotal)}">${formatMs(vpsTotal)}</td>
    <td class="col-local ${timingClass(localTime)}">${formatMs(localTime)}</td>
    <td class="col-total">${formatMs(total)}</td>
    <td class="col-bar">
      <div class="timing-bar">
        <div class="seg-local" style="width:${localPct}%"></div>
        <div class="seg-vps" style="width:${vpsPct}%"></div>
      </div>
    </td>
  `;

  return tr;
}

function renderTable(filter) {
  const tbody = $('reqBody');
  tbody.innerHTML = '';

  const filterLower = (filter || '').toLowerCase();
  entries.forEach((e, i) => {
    if (filterLower && !e.url.toLowerCase().includes(filterLower)) return;
    tbody.appendChild(renderRow(e, i));
  });

  updateStats(filterLower);
}

function updateStats(filter) {
  const filtered = filter
    ? entries.filter(e => e.url.toLowerCase().includes(filter))
    : entries;

  $('statCount').textContent = filtered.length + ' requests';

  const vpsTimes = filtered.map(e => e.vps?.['vps-total']).filter(v => v != null);
  const avgVps = vpsTimes.length
    ? (vpsTimes.reduce((a, b) => a + b, 0) / vpsTimes.length)
    : null;
  $('statAvgVps').textContent = 'avg VPS: ' + formatMs(avgVps);

  const localTimes = filtered
    .map(e => {
      const vt = e.vps?.['vps-total'];
      return vt != null && e.totalTime != null ? Math.max(0, e.totalTime - vt) : null;
    })
    .filter(v => v != null);
  const avgLocal = localTimes.length
    ? (localTimes.reduce((a, b) => a + b, 0) / localTimes.length)
    : null;
  $('statAvgLocal').textContent = 'avg You→VPS: ' + formatMs(avgLocal);
}

/* ── Detail Panel ────────────────────────────────────────── */

function showDetail(idx) {
  const entry = entries[idx];
  if (!entry) return;

  selectedIdx = idx;
  renderTable($('filterInput').value);

  const panel = $('detailPanel');
  panel.classList.remove('hidden');
  $('detailUrl').textContent = entry.url;

  const body = $('detailBody');
  let html = '';

  // VPS Timing breakdown
  if (entry.vps) {
    const maxDur = entry.vps['vps-total'] || 1;
    const rows = [
      ['TCP Connect', entry.vps['vps-connect'], 'fill-connect'],
      ['TLS Handshake', entry.vps['vps-tls'], 'fill-tls'],
      ['Server Wait (TTFB)', entry.vps['vps-wait'], 'fill-wait'],
      ['Content Download', entry.vps['vps-download'], 'fill-download'],
      ['VPS Total', entry.vps['vps-total'], 'fill-total'],
    ];

    html += '<div class="detail-section-title">VPS → Target Breakdown</div>';
    rows.forEach(([label, dur, cls]) => {
      if (dur == null) return;
      const pct = Math.min(100, (dur / maxDur) * 100);
      html += `
        <div class="detail-row">
          <span class="detail-label">${label}</span>
          <span class="detail-value ${timingClass(dur)}">${formatMs(dur)}</span>
          <div class="detail-bar-wrap">
            <div class="detail-bar-fill ${cls}" style="width:${pct}%"></div>
          </div>
        </div>`;
    });
  } else {
    html += '<div class="detail-section-title">No VPS Timing Data</div>';
    html += '<p style="color:var(--text-muted);font-size:12px">This request may not have gone through the Nowser proxy.</p>';
  }

  // Local timing
  const vpsTotal = entry.vps?.['vps-total'];
  if (vpsTotal != null && entry.totalTime != null) {
    const localMs = Math.max(0, entry.totalTime - vpsTotal);
    const maxAll = entry.totalTime || 1;
    html += '<div class="detail-section-title">You → VPS</div>';
    html += `
      <div class="detail-row">
        <span class="detail-label">SSH Tunnel Overhead</span>
        <span class="detail-value ${timingClass(localMs)}">${formatMs(localMs)}</span>
        <div class="detail-bar-wrap">
          <div class="detail-bar-fill fill-local" style="width:${Math.min(100, localMs / maxAll * 100)}%"></div>
        </div>
      </div>`;
  }

  // Target IP
  if (entry.targetIP) {
    html += `<div class="detail-ip">Target IP: ${entry.targetIP}</div>`;
  }

  body.innerHTML = html;
}

/* ── Event Listeners ─────────────────────────────────────── */

// Capture finished requests
chrome.devtools.network.onRequestFinished.addListener(request => {
  const entry = {
    url: request.request.url,
    method: request.request.method,
    status: request.response.status,
    size: request.response.content?.size || request.response.bodySize || 0,
    totalTime: request.time, // total time in ms (browser perspective)
    vps: parseServerTiming(request.response.headers),
    targetIP: getTargetIP(request.response.headers),
    har: request
  };

  entries.push(entry);
  renderTable($('filterInput').value);
});

// Clear
$('clearBtn').addEventListener('click', () => {
  entries.length = 0;
  selectedIdx = -1;
  $('detailPanel').classList.add('hidden');
  renderTable('');
});

// Export
$('exportBtn').addEventListener('click', () => {
  const data = entries.map(({ har, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nowser-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Filter
$('filterInput').addEventListener('input', (e) => {
  renderTable(e.target.value);
});

// Row click → detail
$('reqBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (tr && tr.dataset.idx != null) {
    showDetail(parseInt(tr.dataset.idx, 10));
  }
});

// Close detail
$('detailClose').addEventListener('click', () => {
  selectedIdx = -1;
  $('detailPanel').classList.add('hidden');
  renderTable($('filterInput').value);
});
