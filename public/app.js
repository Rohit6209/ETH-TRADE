const $ = (id) => document.getElementById(id);

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPnl(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return sign + '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pnlClass(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n > 0 ? 'pnl-pos' : n < 0 ? 'pnl-neg' : '';
}

function setPnl(valueId, subId, usd, pct) {
  const valEl = $(valueId);
  valEl.textContent = fmtPnl(usd);
  valEl.className = 'pnl-value ' + pnlClass(usd);
  if (subId) {
    const subEl = $(subId);
    if (subEl) {
      subEl.textContent = pct != null ? (pct > 0 ? '+' : '') + fmt(pct) + '%' : '';
      subEl.className = 'pnl-sub ' + pnlClass(pct);
    }
  }
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
  $('chart-symbol').textContent = config.symbol;
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

    // Cheat sheet — one badge per indicator vote, quick glance at what's driving the signal
    if (sig.votes) {
      $('cheat-grid').innerHTML = sig.votes
        .map(
          (v) => `<div class="cheat-item cheat-${v.direction}">
            <span class="cheat-name">${v.name}</span>
            <span class="cheat-dir">${v.direction.toUpperCase()}</span>
          </div>`
        )
        .join('');
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

  // Account & P&L panel
  $('balance').textContent = state.balanceUsd != null ? '$' + fmt(state.balanceUsd) : '—';
  setPnl('session-pnl', 'session-pnl-pct', state.sessionPnlUsd, state.sessionPnlPercent);
  setPnl('unrealized-pnl', 'unrealized-pnl-pct', state.unrealizedPnlUsd, state.unrealizedPnlPercent);
  setPnl('realized-pnl', null, state.realizedPnlUsd, null);
  const totalClosed = state.totalClosedTrades || 0;
  $('win-rate').textContent = totalClosed
    ? `${state.wins}W / ${state.losses}L · ${fmt((state.wins / totalClosed) * 100, 0)}% win rate`
    : 'No closed trades yet';

  // Live price chart
  drawPriceChart(state.priceHistory || []);

  // Risk panel
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

  // Trade log — entries and exits, each row's P&L cell colored green/red
  const trades = state.recentTrades || [];
  $('trade-empty').hidden = trades.length > 0;
  $('trade-log').innerHTML = trades
    .map((t) => {
      const isExit = t.type === 'exit';
      return `<tr>
        <td>${new Date(t.time).toLocaleTimeString()}</td>
        <td>${isExit ? 'EXIT' : 'ENTRY'}</td>
        <td class="side-${t.side}">${t.side.toUpperCase()}</td>
        <td>${t.size}</td>
        <td>${fmt(t.entryPrice)}</td>
        <td>${isExit ? fmt(t.exitPrice) : fmt(t.stopLoss)}</td>
        <td>${isExit ? '—' : fmt(t.takeProfit)}</td>
        <td class="${isExit ? pnlClass(t.pnlUsd) : ''}">${isExit ? fmtPnl(t.pnlUsd) : '$' + fmt(t.capitalAtRisk) + ' risked'}</td>
        <td>${t.dryRun ? 'dry-run' : 'live'}</td>
      </tr>`;
    })
    .join('');

  $('last-updated').textContent = state.lastUpdated
    ? 'Last updated ' + new Date(state.lastUpdated).toLocaleTimeString()
    : 'Waiting for first data fetch…';
  $('last-error').textContent = state.lastError ? 'Error: ' + state.lastError : '';
}

// ---- Live price chart (plain canvas, no external chart library needed) ----
const chartCanvas = $('price-chart');
const chartCtx = chartCanvas.getContext('2d');

function resizeChartCanvas() {
  const rect = chartCanvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  chartCanvas.width = rect.width * dpr;
  chartCanvas.height = 140 * dpr;
  chartCanvas.style.width = rect.width + 'px';
  chartCanvas.style.height = '140px';
  chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeChartCanvas);
resizeChartCanvas();

function drawPriceChart(points) {
  const w = chartCanvas.clientWidth;
  const h = 140;
  chartCtx.clearRect(0, 0, w, h);

  $('chart-empty').hidden = points.length > 1;
  if (points.length < 2) return;

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = 8;

  const x = (i) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (price) => h - pad - ((price - min) / range) * (h - pad * 2);

  const first = prices[0];
  const last = prices[prices.length - 1];
  const up = last >= first;

  // Filled area under the line
  chartCtx.beginPath();
  chartCtx.moveTo(x(0), y(prices[0]));
  prices.forEach((p, i) => chartCtx.lineTo(x(i), y(p)));
  chartCtx.lineTo(x(prices.length - 1), h - pad);
  chartCtx.lineTo(x(0), h - pad);
  chartCtx.closePath();
  chartCtx.fillStyle = up ? 'rgba(61, 220, 132, 0.10)' : 'rgba(255, 92, 108, 0.10)';
  chartCtx.fill();

  // Line
  chartCtx.beginPath();
  prices.forEach((p, i) => {
    const px = x(i), py = y(p);
    if (i === 0) chartCtx.moveTo(px, py);
    else chartCtx.lineTo(px, py);
  });
  chartCtx.strokeStyle = up ? '#3DDC84' : '#FF5C6C';
  chartCtx.lineWidth = 1.75;
  chartCtx.stroke();

  // Last-price dot
  const lx = x(prices.length - 1), ly = y(last);
  chartCtx.beginPath();
  chartCtx.arc(lx, ly, 3, 0, Math.PI * 2);
  chartCtx.fillStyle = up ? '#3DDC84' : '#FF5C6C';
  chartCtx.fill();
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
