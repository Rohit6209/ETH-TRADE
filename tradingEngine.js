const { computeIndicators } = require('./indicators');
const { generateSignal } = require('./strategy');
const { calculatePositionSize, calculateAtrStops, isDailyLossLimitHit } = require('./riskManager');

const RESOLUTION_SECONDS = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '1d': 86400,
};

class TradingEngine {
  constructor({ deltaClient, config, logger }) {
    this.client = deltaClient;
    this.config = config;
    this.logger = logger || console;

    this.state = {
      lastUpdated: null,
      price: null,
      indicators: null,
      signalInfo: null,
      position: null, // { side, size, entryPrice, stopLoss, takeProfit }
      unrealizedPnlUsd: null,
      unrealizedPnlPercent: null,
      balanceUsd: null,
      startOfDayBalance: null,
      sessionPnlUsd: null,
      sessionPnlPercent: null,
      realizedPnlUsd: 0,
      wins: 0,
      losses: 0,
      totalClosedTrades: 0,
      autoTradeEnabled: config.autoTradeEnabled,
      dryRun: config.dryRun,
      tradingHalted: false,
      haltReason: null,
      recentTrades: [],
      priceHistory: [], // [{ time, price }] — rolling window for the live chart
      lastError: null,
    };

    this._productCache = null;
    this._balanceBeforeClose = null; // used to estimate realized PnL on live position closes
  }

  /** Unrealized $ / % PnL for the current open position at a given mark price. */
  _calcUnrealizedPnl(position, currentPrice, contractValue) {
    if (!position || currentPrice == null) return { usd: null, percent: null };
    const dir = position.side === 'buy' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * dir;
    const usd = priceDiff * position.size * contractValue;
    const notional = position.entryPrice * position.size * contractValue;
    const percent = notional ? (usd / notional) * 100 : null;
    return { usd, percent };
  }

  _pushPriceHistory(time, price) {
    this.state.priceHistory.push({ time, price });
    if (this.state.priceHistory.length > 300) {
      this.state.priceHistory = this.state.priceHistory.slice(-300);
    }
  }

  async _getProduct() {
    if (!this._productCache) {
      const res = await this.client.getProduct(this.config.symbol);
      this._productCache = res.result;
    }
    return this._productCache;
  }

  async _fetchCandles() {
    const resSeconds = RESOLUTION_SECONDS[this.config.resolution] || 900;
    const end = Math.floor(Date.now() / 1000);
    const start = end - resSeconds * 400; // ~400 candles - enough warmup for EMA50/ADX/PSAR
    const res = await this.client.getCandles({
      symbol: this.config.symbol,
      resolution: this.config.resolution,
      start,
      end,
    });
    // Delta returns newest-first; normalize to oldest-first
    const rows = (res.result || []).slice().reverse();
    return rows.map((r) => ({
      time: r.time,
      open: +r.open,
      high: +r.high,
      low: +r.low,
      close: +r.close,
      volume: +r.volume,
    }));
  }

  async _refreshBalance() {
    if (this.config.dryRun) {
      // Paper mode: keep a simulated balance so the dashboard still shows something.
      if (this.state.balanceUsd == null) this.state.balanceUsd = this.config.paperStartBalance || 1000;
      return this.state.balanceUsd;
    }
    const res = await this.client.getWalletBalances();
    const usd = (res.result || []).find((b) => b.asset_symbol === 'USD' || b.asset_symbol === 'USDT');
    const bal = usd ? +usd.available_balance : 0;
    this.state.balanceUsd = bal;
    return bal;
  }

  async _refreshPosition(productId) {
    if (this.config.dryRun) return this.state.position; // simulated position tracked locally
    const res = await this.client.getPositions(productId);
    // Delta's /v2/positions returns an ARRAY when called with no filter, but a
    // single OBJECT when filtered by product_id (as we do here) — handle both
    // shapes instead of assuming .find() always works.
    let pos;
    if (Array.isArray(res.result)) {
      pos = res.result.find((p) => Math.abs(+p.size) > 0);
    } else if (res.result && typeof res.result === 'object') {
      pos = Math.abs(+res.result.size) > 0 ? res.result : null;
    }
    if (!pos) {
      this.state.position = null;
      return null;
    }
    this.state.position = {
      side: +pos.size > 0 ? 'buy' : 'sell',
      size: Math.abs(+pos.size),
      entryPrice: +pos.entry_price,
    };
    return this.state.position;
  }

  async _placeEntryOrder({ side, size, product, stopLoss, takeProfit }) {
    const orderBody = {
      product_id: product.id,
      product_symbol: product.symbol,
      size,
      side,
      order_type: 'market_order',
      bracket_stop_loss_price: String(stopLoss),
      bracket_take_profit_price: String(takeProfit),
      bracket_stop_trigger_method: 'mark_price',
      client_order_id: `bot_${Date.now()}`,
    };

    if (this.config.dryRun) {
      this.logger.log('[DRY_RUN] Would place order:', orderBody);
      return { simulated: true, orderBody };
    }

    return this.client.placeOrder(orderBody);
  }

  _recordTrade(entry) {
    this.state.recentTrades.unshift({ ...entry, time: new Date().toISOString() });
    this.state.recentTrades = this.state.recentTrades.slice(0, 20);
  }

  _recordClosedTrade({ side, size, entryPrice, exitPrice, pnlUsd, reason, dryRun }) {
    this.state.realizedPnlUsd = +(this.state.realizedPnlUsd + pnlUsd).toFixed(2);
    this.state.totalClosedTrades += 1;
    if (pnlUsd >= 0) this.state.wins += 1;
    else this.state.losses += 1;

    this.state.recentTrades.unshift({
      type: 'exit',
      side,
      size,
      entryPrice,
      exitPrice,
      pnlUsd: +pnlUsd.toFixed(2),
      reason,
      dryRun,
      time: new Date().toISOString(),
    });
    this.state.recentTrades = this.state.recentTrades.slice(0, 20);
  }

  /** Dry-run only: locally simulated positions don't live on the exchange, so
   * the engine has to watch price vs. SL/TP itself and "close" the trade. */
  _checkAndCloseDryRunPosition(currentPrice, contractValue) {
    const pos = this.state.position;
    if (!pos || !pos.simulated || currentPrice == null) return;

    const hitTp = pos.side === 'buy' ? currentPrice >= pos.takeProfit : currentPrice <= pos.takeProfit;
    const hitSl = pos.side === 'buy' ? currentPrice <= pos.stopLoss : currentPrice >= pos.stopLoss;
    if (!hitTp && !hitSl) return;

    const exitPrice = hitTp ? pos.takeProfit : pos.stopLoss;
    const { usd: pnlUsd } = this._calcUnrealizedPnl(pos, exitPrice, contractValue);

    this.state.balanceUsd = +(this.state.balanceUsd + pnlUsd).toFixed(2);
    this._recordClosedTrade({
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      exitPrice,
      pnlUsd,
      reason: hitTp ? 'take-profit hit' : 'stop-loss hit',
      dryRun: true,
    });
    this.state.position = null;
  }

  async tick() {
    try {
      const product = await this._getProduct();
      const candles = await this._fetchCandles();
      if (candles.length < 70) {
        this.state.lastError = 'Not enough candle history yet';
        return this.state;
      }

      const ind = computeIndicators(candles);
      const signalInfo = generateSignal(ind);
      const contractValue = product.contract_value ? +product.contract_value : 1;

      const hadPositionBeforeRefresh = this.state.position;
      const balanceBeforeThisTick = this.state.balanceUsd;

      // Dry-run positions live only in memory — check SL/TP against the latest
      // price ourselves and realize the P&L before anything else this tick.
      this._checkAndCloseDryRunPosition(ind.price, contractValue);

      const balance = await this._refreshBalance();
      if (this.state.startOfDayBalance == null) this.state.startOfDayBalance = balance;

      const halted = isDailyLossLimitHit({
        startBalance: this.state.startOfDayBalance,
        currentBalance: balance,
        maxDailyLossPercent: this.config.maxDailyLossPercent,
      });
      this.state.tradingHalted = halted;
      if (halted) this.state.haltReason = 'Daily loss limit reached — auto-trading paused for today';

      const position = await this._refreshPosition(product.id);

      // Live mode: if a position we had last tick is gone now, the exchange
      // closed it (SL/TP or manual). We don't get an exit fill here, so the
      // realized P&L is estimated from the balance delta since last tick.
      if (!this.config.dryRun && hadPositionBeforeRefresh && !position && balanceBeforeThisTick != null) {
        const pnlUsd = +(balance - balanceBeforeThisTick).toFixed(2);
        this._recordClosedTrade({
          side: hadPositionBeforeRefresh.side,
          size: hadPositionBeforeRefresh.size,
          entryPrice: hadPositionBeforeRefresh.entryPrice,
          exitPrice: ind.price,
          pnlUsd,
          reason: 'position closed on exchange (estimated P&L)',
          dryRun: false,
        });
      }

      // Unrealized P&L on whatever's open right now
      const unrealized = this._calcUnrealizedPnl(this.state.position, ind.price, contractValue);
      this.state.unrealizedPnlUsd = unrealized.usd != null ? +unrealized.usd.toFixed(2) : null;
      this.state.unrealizedPnlPercent = unrealized.percent != null ? +unrealized.percent.toFixed(2) : null;

      if (this.state.startOfDayBalance) {
        this.state.sessionPnlUsd = +(balance - this.state.startOfDayBalance).toFixed(2);
        this.state.sessionPnlPercent = +(((balance - this.state.startOfDayBalance) / this.state.startOfDayBalance) * 100).toFixed(2);
      }

      this.state.price = ind.price;
      this.state.indicators = ind;
      this.state.signalInfo = signalInfo;
      this.state.lastUpdated = new Date().toISOString();
      this.state.lastError = null;
      this._pushPriceHistory(this.state.lastUpdated, ind.price);

      const canTrade =
        this.config.autoTradeEnabled &&
        !halted &&
        !position &&
        (signalInfo.signal === 'BUY' || signalInfo.signal === 'SELL');

      if (canTrade) {
        const side = signalInfo.signal === 'BUY' ? 'buy' : 'sell';
        const { stopLoss, takeProfit } = calculateAtrStops({
          side,
          entryPrice: ind.price,
          atr: ind.atr14,
          slMultiplier: this.config.atrSlMultiplier,
          tpMultiplier: this.config.atrTpMultiplier,
        });

        const { size, capitalAtRisk } = calculatePositionSize({
          balanceUsd: balance,
          riskPercent: this.config.riskPercent,
          leverage: this.config.leverage,
          price: ind.price,
          contractValue,
        });

        const result = await this._placeEntryOrder({ side, size, product, stopLoss, takeProfit });

        if (this.config.dryRun) {
          this.state.position = { side, size, entryPrice: ind.price, stopLoss, takeProfit, simulated: true };
        }

        this._recordTrade({
          type: 'entry',
          side,
          size,
          entryPrice: ind.price,
          stopLoss,
          takeProfit,
          capitalAtRisk: +capitalAtRisk.toFixed(2),
          reasons: signalInfo.reasons,
          dryRun: this.config.dryRun,
        });

        this.logger.log(`Signal ${signalInfo.signal} -> ${side} ${size} contracts @ ${ind.price} | SL ${stopLoss} TP ${takeProfit}`);
      }

      return this.state;
    } catch (err) {
      this.state.lastError = err.message;
      this.logger.error('Trading engine tick error:', err.message);
      return this.state;
    }
  }

  setAutoTrade(enabled) {
    this.config.autoTradeEnabled = enabled;
    this.state.autoTradeEnabled = enabled;
  }

  getState() {
    return this.state;
  }
}

module.exports = { TradingEngine };
