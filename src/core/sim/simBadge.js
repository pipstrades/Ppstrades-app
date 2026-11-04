// Shared by the simulated app: holds the win-rate setting and shows a small
// "SIMULATED" badge on every page (click it to change the win rate).

const WIN_KEY = 'pipstrades_sim_winrate';
const DEFAULT_WIN_RATE = 85;

export function getWinRate() {
  try {
    const v = parseFloat(localStorage.getItem(WIN_KEY));
    if (!isNaN(v)) return Math.min(100, Math.max(0, v));
  } catch (e) { /* storage unavailable */ }
  return DEFAULT_WIN_RATE;
}

function setWinRate(v) {
  try { localStorage.setItem(WIN_KEY, String(v)); } catch (e) { /* ignore */ }
}

function inject() {
  if (typeof document === 'undefined' || window.__simBadgeInjected) return;
  window.__simBadgeInjected = true;

  const meta = document.createElement('meta');
  meta.name = 'robots';
  meta.content = 'noindex,nofollow';
  document.head.appendChild(meta);

  if (!document.title.startsWith('[SIM]')) document.title = '[SIM] ' + document.title;

  const badge = document.createElement('div');
  badge.id = 'simBadge';
  badge.title = 'Simulated — click to change the win rate';
  badge.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:9999',
    'font:600 11px/1 "JetBrains Mono",monospace', 'letter-spacing:0.05em',
    'padding:7px 12px', 'border-radius:100px', 'cursor:pointer',
    'color:#ffb347', 'background:rgba(255,179,71,0.12)',
    'border:1px solid rgba(255,179,71,0.4)', 'user-select:none'
  ].join(';');

  const render = () => { badge.textContent = `SIMULATED · ${getWinRate()}% win rate`; };
  render();

  badge.addEventListener('click', () => {
    const input = window.prompt('Simulated win rate (0-100):', String(getWinRate()));
    if (input === null) return;
    const v = parseFloat(input);
    if (isNaN(v) || v < 0 || v > 100) {
      window.alert('Enter a number between 0 and 100.');
      return;
    }
    setWinRate(v);
    render();
  });

  document.body.appendChild(badge);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
}
