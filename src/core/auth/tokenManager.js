// Simulated session — there is no real Deriv login in this app. The
// "token" is just a flag saying you've clicked through the login page.

const KEY = 'pipstrades_sim_session';

export function saveToken(token) {
  try { localStorage.setItem(KEY, token || 'SIMULATED'); } catch (e) { /* ignore */ }
}

export function getToken() {
  try { return localStorage.getItem(KEY); } catch (e) { return null; }
}

export function clearToken() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function isAuthenticated() {
  return !!getToken();
}
