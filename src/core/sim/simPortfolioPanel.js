// Adds a quiet "Simulation settings" section to the bottom of the
// Portfolio page (collapsed by default) with:
//   - the simulated win rate
//   - an editable REAL account balance
// It is injected from here, so your existing portfolio.html / .css / .js
// don't need to change.

import { getWinRate, setWinRate } from '/src/core/sim/simBadge.js';

const STYLE = `
#simPanelWrap { margin-top: 36px; }
#simToggle { background: none; border: none; padding: 0; color: #b4b4c2; font: 500 12px 'Inter', sans-serif; cursor: pointer; }
#simToggle:hover { color: #6e6e82; }
#simPanel { margin-top: 14px; max-width: 420px; background: #ffffff; border: 1px solid #e6e6ec; border-radius: 14px; padding: 20px; font-family: 'Inter', sans-serif; color: #1a1a2e; }
#simPanel .sim-title { font-size: 14px; font-weight: 700; margin-bottom: 14px; }
#simPanel .sim-row { margin-bottom: 16px; }
#simPanel .sim-row:last-child { margin-bottom: 0; }
#simPanel label { display: block; font-size: 12px; color: #6e6e82; margin-bottom: 6px; }
#simPanel .sim-inputs { display: flex; gap: 8px; }
#simPanel input { flex: 1; min-width: 0; border: 1px solid #e6e6ec; border-radius: 8px; padding: 9px 12px; font: 500 14px 'Inter', sans-serif; color: #1a1a2e; }
#simPanel button { background: #ff444f; color: #ffffff; border: none; border-radius: 100px; padding: 9px 18px; font: 600 13px 'Inter', sans-serif; cursor: pointer; white-space: nowrap; }
#simPanel button:hover { background: #e6323d; }
#simPanel .sim-status { font-size: 12px; margin-top: 6px; min-height: 14px; }
`;

export function mountPortfolioPanel({ getBalance, setBalance }) {
  if (typeof document === 'undefined') return;
  if (!/portfolio/i.test(window.location.pathname)) return;

  const build = () => {
    if (document.getElementById('simPanelWrap')) return;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'simPanelWrap';
    wrap.innerHTML = `
      <button type="button" id="simToggle">⚙ Simulation settings</button>
      <div id="simPanel" hidden>
        <div class="sim-title">Simulation settings</div>
        <div class="sim-row">
          <label for="simWinRate">Win rate (%)</label>
          <div class="sim-inputs">
            <input id="simWinRate" type="number" min="0" max="100" step="1">
            <button type="button" id="simWinRateSave">Save</button>
          </div>
          <div class="sim-status" id="simWinRateStatus"></div>
        </div>
        <div class="sim-row">
          <label for="simRealBalance">Real account balance (USD)</label>
          <div class="sim-inputs">
            <input id="simRealBalance" type="number" min="0" step="0.01">
            <button type="button" id="simRealBalanceSave">Set balance</button>
          </div>
          <div class="sim-status" id="simRealBalanceStatus"></div>
        </div>
      </div>
    `;

    const host = document.querySelector('main.main') || document.querySelector('main') || document.body;
    host.appendChild(wrap);

    const panel = wrap.querySelector('#simPanel');
    const winInput = wrap.querySelector('#simWinRate');
    const balInput = wrap.querySelector('#simRealBalance');

    const flash = (id, text, ok) => {
      const el = wrap.querySelector(id);
      el.textContent = text;
      el.style.color = ok ? '#17b884' : '#e6323d';
      setTimeout(() => { el.textContent = ''; }, 2500);
    };

    const refresh = () => {
      winInput.value = getWinRate();
      balInput.value = Number(getBalance('real')).toFixed(2);
    };

    wrap.querySelector('#simToggle').addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refresh();
    });

    wrap.querySelector('#simWinRateSave').addEventListener('click', () => {
      const v = parseFloat(winInput.value);
      if (isNaN(v) || v < 0 || v > 100) {
        flash('#simWinRateStatus', 'Enter a number from 0 to 100.', false);
        return;
      }
      setWinRate(v);
      flash('#simWinRateStatus', `Saved — trades now resolve at ${v}%.`, true);
    });

    wrap.querySelector('#simRealBalanceSave').addEventListener('click', () => {
      const v = parseFloat(balInput.value);
      if (isNaN(v) || v < 0 || v > 100000000) {
        flash('#simRealBalanceStatus', 'Enter an amount of 0 or more.', false);
        return;
      }
      setBalance('real', v);
      flash('#simRealBalanceStatus', `Real balance set to $${v.toFixed(2)}.`, true);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
}
