// Simulated login: no Deriv OAuth. "Connect with Deriv" starts a local
// simulated session, shows a short neutral "Connecting…" screen, then
// opens the dashboard.

import { saveToken } from '/src/core/auth/tokenManager.js';
import '/src/core/sim/simBadge.js';

// Kept only so the (unused) callback module still imports cleanly.
export const STORAGE_KEYS = { verifier: 'sim_unused_verifier', state: 'sim_unused_state' };

const REDIRECT_DELAY_MS = 2000;

function showConnectingScreen() {
  if (typeof document === 'undefined') return;
  const overlay = document.createElement('div');
  overlay.id = 'simConnecting';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'background:#ffffff',
    'display:flex', 'flex-direction:column', 'align-items:center',
    'justify-content:center', 'gap:18px',
    "font-family:'Inter',system-ui,sans-serif"
  ].join(';');
  overlay.innerHTML = `
    <style>@keyframes simSpin { to { transform: rotate(360deg); } }</style>
    <div style="width:56px;height:56px;border-radius:50%;border:4px solid #ffd9dc;border-top-color:#ff444f;animation:simSpin 0.9s linear infinite;"></div>
    <div style="font-size:14px;color:#6e6e82;">Connecting…</div>
  `;
  document.body.appendChild(overlay);
}

export async function startLogin() {
  saveToken('SIMULATED');
  showConnectingScreen();
  setTimeout(() => { window.location.href = '/dashboard'; }, REDIRECT_DELAY_MS);
}
