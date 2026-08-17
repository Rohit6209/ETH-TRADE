const $ = (id) => document.getElementById(id);

// --- Safe DOM setters -------------------------------------------------
// If an element id is missing from the page (stale deploy, markup drift,
// etc.), these no-op with a console warning instead of throwing and
// killing the rest of render() — which previously meant one missing
// element (e.g. #slmult) silently broke the auto-trade toggle and the
// "last updated" timestamp on every single poll.
function setText(id, value) {
  const el = $(id);
  if (!el) { console.warn(`[app.js] #${id} not found in DOM`); return; }
  el.textContent = value;
}
function setClass(id, cls) {
  const el = $(id);
  if (!el) { console.warn(`[app.js] #${id} not found in DOM`); return; }
  el.className = cls;
}
function setHidden(id, hidden) {
  const el = $(id);
  if (!el) { console.warn(`[app.js] #${id} not found in DOM`); return; }
  el.hidden = hidden;
}
function setHTML(id, html) {
  const el = $(id);
  if (!el) { console.warn(`[app.js] #${id} not found in DOM`); return; }
  el.innerHTML = html;
}

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
  setText(valueId, fmtPnl(usd));
  setClass(valueId, 'pnl-value ' + pnlClass(usd));
  if (subId) {
    setText(subId, pct != null ? (pct > 0 ? '+' : '') + fmt(pct) + '%' : '');
    setClass(subId, 'pnl-sub ' + pnlClass(pct));
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
  // Each section below is independently guarded: if one DOM element is
  // missing, that section logs a warning and the rest of render() still
  // runs (in particular the auto-trade toggle and last-updated/last-error
  // footer at the bottom, which must always reflect the latest poll).
  try {
    setText('symbol', config.symbol);
    setText('chart-symbol', config.symbol);
    setText('resolution', config.resolution);
    setText('price', state.price ? fmt(state.price) : '—');

    setText('mode-badge', config.useTestnet ? 'Testnet' : 'Production');
    setClass('mode-badge', 'badge ' + (config.useTestnet ? 'on' : 'warn'));

    setText('dryrun-badge', config.dryRun ? 'Dry run' : 'Live orders');
    setClass('dryrun-badge', 'badge ' + (config.dryRun ? '' : 'warn'));
  } catch (e) { console.warn('[app.js] header render failed:', e); }

  // Signal + confluence meter
  try {
    const sig = state.signalInfo;
    if (sig) {
      setText('signal-word', sig.signal);
      setClass('signal-word', 'signal-word ' + sig.signal.toLowerCase());
      setText('signal-score',
        `${sig.upCount} up · ${sig.downCount} down · ${sig.neutralCount} neutral ` +
        `(needs ${sig.confirmThreshold}/${sig.maxScore} agreeing)`);

      const pct = sig.maxScore ? (sig.score / sig.maxScore) * 50 : 0; // -50..+50
      const fill = $('confluence-fill');
      if (fill) {
        if (pct >= 0) {
          fill.style.left = '50%';
          fill.style.width = Math.abs(pct) + '%';
        } else {
          fill.style.left = 50 + pct + '%';
          fill.style.width = Math.abs(pct) + '%';
        }
      }

      setHTML('reasons', sig.reasons.map((r) => `<li>${r}</li>`).join(''));
      if (sig.caution) {
        setHidden('caution', false);
        setText('caution', '⚠ ' + sig.caution);
      } else {
        setHidden('caution', true);
      }

      // Cheat sheet — one badge per indicator vote, quick glance at what's driving the signal
      if (sig.votes) {
        setHTML('cheat-grid', sig.votes
          .map(
            (v) => `<div class="cheat-item cheat-${v.direction}">
              <span class="cheat-name">${v.name}</span>
              <span class="cheat-dir">${v.direction.toUpperCase()}</span>
            </div>`
          )
          .join(''));
      }
    }
  } catch (e) { console.warn('[app.js] signal render failed:', e); }

  // Indicators
  try {
    const ind = state.indicators;
    if (ind) {
      setText('ema9', fmt(ind.ema9));
      setText('ema21', fmt(ind.ema21));
      setText('ema50', fmt(ind.ema50));
      setText('rsi14', ind.rsi14 != null ? fmt(ind.rsi14, 1) : '—');
      setText('macd', ind.macd ? fmt(ind.macd.MACD, 3) : '—');
      setText('macdsig', ind.macd ? fmt(ind.macd.signal, 3) : '—');
      setText('bbupper', ind.bb ? fmt(ind.bb.upper) : '—');
      setText('bblower', ind.bb ? fmt(ind.bb.lower) : '—');
      setText('stochrsi', ind.stochRsi ? `${fmt(ind.stochRsi.k, 1)} / ${fmt(ind.stochRsi.d, 1)}` : '—');
      setText('cci', fmt(ind.cci, 1));
      setText('williamsr', fmt(ind.williamsR, 1));
      setText('adx', ind.adx ? `${fmt(ind.adx.adx, 1)} (+DI ${fmt(ind.adx.pdi, 1)} / -DI ${fmt(ind.adx.mdi, 1)})` : '—');
      setText('psar', fmt(ind.psar));
      setText('atr14', fmt(ind.atr14));
    }
  } catch (e) { console.warn('[app.js] indicators render failed:', e); }

  // Account & P&L panel
  try {
    setText('balance', state.balanceUsd != null ? '$' + fmt(state.balanceUsd) : '—');
    setPnl('session-pnl', 'session-pnl-pct', state.sessionPnlUsd, state.sessionPnlPercent);
    setPnl('unrealized-pnl', 'unrealized-pnl-pct', state.unrealizedPnlUsd, state.unrealizedPnlPercent);
    setPnl('realized-pnl', null, state.realizedPnlUsd, null);
    const totalClosed = state.totalClosedTrades || 0;
    setText('win-rate', totalClosed
      ? `${state.wins}W / ${state.losses}L · ${fmt((state.wins / totalClosed) * 100, 0)}% win rate`
      : 'No closed trades yet');
  } catch (e) { console.warn('[app.js] P&L render failed:', e); }

  // Live price chart
  try {
    drawPriceChart(state.priceHistory || []);
  } catch (e) { console.warn('[app.js] chart render failed:', e); }

  // Risk panel
  try {
    setText('riskpct', config.riskPercent + '%');
    const levInput = $('leverage-input');
    if (levInput && document.activeElement !== levInput) {
      levInput.value = config.leverage;
    }
    setText('slmult', config.atrSlMultiplier);
    setText('tpmult', config.atrTpMultiplier);
    setText('dailyloss', config.maxDailyLossPercent + '%');

    setHidden('halt-banner', !state.tradingHalted);

    const toggle = $('auto-toggle');
    if (toggle) toggle.setAttribute('aria-pressed', !!state.autoTradeEnabled);
    else console.warn('[app.js] #auto-toggle not found in DOM');
  } catch (e) { console.warn('[app.js] risk panel render failed:', e); }

  // Position
  try {
    if (state.position) {
      setHidden('position-empty', true);
      setHidden('position-block', false);
      setText('pos-side', state.position.side.toUpperCase() + (state.position.simulated ? ' (simulated)' : ''));
      setClass('pos-side', 'position-side ' + state.position.side);
      setText('pos-size', state.position.size);
      setText('pos-entry', fmt(state.position.entryPrice));
      setText('pos-sl', state.position.stopLoss != null ? fmt(state.position.stopLoss) : '—');
      setText('pos-tp', state.position.takeProfit != null ? fmt(state.position.takeProfit) : '—');
    } else {
      setHidden('position-empty', false);
      setHidden('position-block', true);
    }
  } catch (e) { console.warn('[app.js] position render failed:', e); }

  // Trade log — entries and exits, each row's P&L cell colored green/red
  try {
    const trades = state.recentTrades || [];
    setHidden('trade-empty', trades.length > 0);
    setHTML('trade-log', trades
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
      .join(''));
  } catch (e) { console.warn('[app.js] trade log render failed:', e); }

  // Footer — always runs, regardless of whether any section above failed,
  // so the user can always see when the last successful poll happened and
  // whether the backend reported an error.
  setText('last-updated', state.lastUpdated
    ? 'Last updated ' + new Date(state.lastUpdated).toLocaleTimeString()
    : 'Waiting for first data fetch…');
  setText('last-error', state.lastError ? 'Error: ' + state.lastError : '');
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

  setHidden('chart-empty', points.length > 1);
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

$('leverage-apply').addEventListener('click', async () => {
  const btn = $('leverage-apply');
  const val = $('leverage-input').value;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await fetch('/api/set-leverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leverage: val }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to set leverage');
  } catch (e) {
    alert('Leverage not set: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Set';
    fetchStatus();
  }
});

function showManualTradeMsg(text, ok) {
  const el = $('manual-trade-msg');
  el.hidden = false;
  el.textContent = text;
  el.className = 'manual-trade-msg ' + (ok ? 'msg-ok' : 'msg-error');
}

async function placeManualTrade(side) {
  const buyBtn = $('manual-buy');
  const sellBtn = $('manual-sell');
  buyBtn.disabled = true;
  sellBtn.disabled = true;
  try {
    const res = await fetch('/api/manual-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Manual trade failed');
    showManualTradeMsg(`${side.toUpperCase()} order placed.`, true);
  } catch (e) {
    showManualTradeMsg(e.message, false);
  } finally {
    buyBtn.disabled = false;
    sellBtn.disabled = false;
    fetchStatus();
  }
}

$('manual-buy').addEventListener('click', () => placeManualTrade('buy'));
$('manual-sell').addEventListener('click', () => placeManualTrade('sell'));

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
