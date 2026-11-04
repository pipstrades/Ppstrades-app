// Simulated login: no Deriv OAuth. "Connect with Deriv" just starts a
// local simulated session and goes straight to the dashboard.

import { saveToken } from '/src/core/auth/tokenManager.js';
import '/src/core/sim/simBadge.js';

// Kept only so the (unused) callback module still imports cleanly.
export const STORAGE_KEYS = { verifier: 'sim_unused_verifier', state: 'sim_unused_state' };

export async function startLogin() {
  saveToken('SIMULATED');
  window.location.href = '/dashboard';
}
