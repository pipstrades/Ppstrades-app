// Holds the simulated win-rate setting. There is no visible badge any
// more — the control now lives in the Portfolio page's "Simulation
// settings" section. Pages still get a [SIM] prefix in the browser tab
// title and a noindex tag.

const WIN_KEY = 'pipstrades_sim_winrate';
const DEFAULT_WIN_RATE = 85;

export function getWinRate() {
  try {
    const v = parseFloat(localStorage.getItem(WIN_KEY));
    if (!isNaN(v)) return Math.min(100, Math.max(0, v));
  } catch (e) { /* storage unavailable */ }
  return DEFAULT_WIN_RATE;
}

export function setWinRate(v) {
  try { localStorage.setItem(WIN_KEY, String(v)); } catch (e) { /* ignore */ }
}

function inject() {
  if (typeof document === 'undefined' || window.__simMarked) return;
  window.__simMarked = true;

  const meta = document.createElement('meta');
  meta.name = 'robots';
  meta.content = 'noindex,nofollow';
  document.head.appendChild(meta);

  if (!document.title.startsWith('[SIM]')) document.title = '[SIM] ' + document.title;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
}
