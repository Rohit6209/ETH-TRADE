const $ = (id) => document.getElementById(id);

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    render(data);
  } catch (e) {
    $('last-error').textContent = 'Could not reach server: ' + e.message;
  }
}

function render({ config, state }) {
  $('symbol').textContent = config.symbol;
  $('resolution').textContent = config.resolution;
  $('price').textContent = state.price ? fmt(state.price) : '—';

  $('mode-badge').textContent = config.useTestnet ? 'Testnet' : 'Production';
  $('mode-badge').className = 'badge ' + (config.useTestnet ? 'on' : 'warn');

  $('dryrun-badge').textContent = config.dryRun ? 'Dry run' : 'Live orders';
  $('dryrun-badge').className = 'badge ' + (config.dryRun ? '' : 'warn');

  // Signal + confluence meter
  const sig = state.signalInfo;
  const word = $('signal-word');
  if (sig) {
    word.textContent = sig.signal;
    word.className = 'signal-word ' + sig.signal.toLowerCase();
    $('signal-score').textContent =
      `${sig.upCount} up · ${sig.downCount} down · ${sig.neutralCount} neutral ` +
      `(needs ${sig.confirmThreshold}/${sig.maxScore} agreeing)`;

    const pct = sig.maxScore ? (sig.score / sig.maxScore) * 50 : 0; // -50..+50
    const fill = $('confluence-fill');
    if (pct >= 0) {
      fill.style.left = '50%';
      fill.style.width = Math.abs(pct) + '%';
    } else {
      fill.style.left = 50 + pct + '%';
      fill.style.width = Math.abs(pct) + '%';
    }

    $('reasons').innerHTML = sig.reasons.map((r) => `<li>${r}</li>`).join('');
    if (sig.caution) {
      $('caution').hidden = false;
      $('caution').textContent = '⚠ ' + sig.caution;
    } else {
      $('caution').hidden = true;
    }
  }

  // Indicators
  const ind = state.indicators;
  if (ind) {
    $('ema9').textContent = fmt(ind.ema9);
    $('ema21').textContent = fmt(ind.ema21);
    $('ema50').textContent = fmt(ind.ema50);
    $('rsi14').textContent = ind.rsi14 != null ? fmt(ind.rsi14, 1) : '—';
    $('macd').textContent = ind.macd ? fmt(ind.macd.MACD, 3) : '—';
    $('macdsig').textContent = ind.macd ? fmt(ind.macd.signal, 3) : '—';
    $('bbupper').textContent = ind.bb ? fmt(ind.bb.upper) : '—';
    $('bblower').textContent = ind.bb ? fmt(ind.bb.lower) : '—';
    $('stochrsi').textContent = ind.stochRsi ? `${fmt(ind.stochRsi.k, 1)} / ${fmt(ind.stochRsi.d, 1)}` : '—';
    $('cci').textContent = fmt(ind.cci, 1);
    $('williamsr').textContent = fmt(ind.williamsR, 1);
    $('adx').textContent = ind.adx ? `${fmt(ind.adx.adx, 1)} (+DI ${fmt(ind.adx.pdi, 1)} / -DI ${fmt(ind.adx.mdi, 1)})` : '—';
    $('psar').textContent = fmt(ind.psar);
    $('atr14').textContent = fmt(ind.atr14);
  }

  // Risk panel
  $('balance').textContent = state.balanceUsd != null ? '$' + fmt(state.balanceUsd) : '—';
  $('riskpct').textContent = config.riskPercent + '%';
  $('leverage').textContent = config.leverage + '×';
  $('slmult').textContent = config.atrSlMultiplier;
  $('tpmult').textContent = config.atrTpMultiplier;
  $('dailyloss').textContent = config.maxDailyLossPercent + '%';

  $('halt-banner').hidden = !state.tradingHalted;

  const toggle = $('auto-toggle');
  toggle.setAttribute('aria-pressed', !!state.autoTradeEnabled);

  // Position
  if (state.position) {
    $('position-empty').hidden = true;
    $('position-block').hidden = false;
    const sideEl = $('pos-side');
    sideEl.textContent = state.position.side.toUpperCase() + (state.position.simulated ? ' (simulated)' : '');
    sideEl.className = 'position-side ' + state.position.side;
    $('pos-size').textContent = state.position.size;
    $('pos-entry').textContent = fmt(state.position.entryPrice);
    $('pos-sl').textContent = state.position.stopLoss != null ? fmt(state.position.stopLoss) : '—';
    $('pos-tp').textContent = state.position.takeProfit != null ? fmt(state.position.takeProfit) : '—';
  } else {
    $('position-empty').hidden = false;
    $('position-block').hidden = true;
  }

  // Trade log
  const trades = state.recentTrades || [];
  $('trade-empty').hidden = trades.length > 0;
  $('trade-log').innerHTML = trades
    .map(
      (t) => `<tr>
        <td>${new Date(t.time).toLocaleTimeString()}</td>
        <td class="side-${t.side}">${t.side.toUpperCase()}</td>
        <td>${t.size}</td>
        <td>${fmt(t.entryPrice)}</td>
        <td>${fmt(t.stopLoss)}</td>
        <td>${fmt(t.takeProfit)}</td>
        <td>$${fmt(t.capitalAtRisk)}</td>
        <td>${t.dryRun ? 'dry-run' : 'live'}</td>
      </tr>`
    )
    .join('');

  $('last-updated').textContent = state.lastUpdated
    ? 'Last updated ' + new Date(state.lastUpdated).toLocaleTimeString()
    : 'Waiting for first data fetch…';
  $('last-error').textContent = state.lastError ? 'Error: ' + state.lastError : '';
}

$('auto-toggle').addEventListener('click', async () => {
  const current = $('auto-toggle').getAttribute('aria-pressed') === 'true';
  await fetch('/api/toggle-auto-trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: !current }),
  });
  fetchStatus();
});

fetchStatus();
setInterval(fetchStatus, 5000);
