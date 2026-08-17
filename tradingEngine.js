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
      balanceUsd: null,
      startOfDayBalance: null,
      autoTradeEnabled: config.autoTradeEnabled,
      dryRun: config.dryRun,
      tradingHalted: false,
      haltReason: null,
      recentTrades: [],
      lastError: null,
    };

    this._productCache = null;
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
    const pos = (res.result || []).find((p) => Math.abs(+p.size) > 0);
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

      this.state.price = ind.price;
      this.state.indicators = ind;
      this.state.signalInfo = signalInfo;
      this.state.lastUpdated = new Date().toISOString();
      this.state.lastError = null;

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
          contractValue: product.contract_value ? +product.contract_value : 1,
        });

        const result = await this._placeEntryOrder({ side, size, product, stopLoss, takeProfit });

        if (this.config.dryRun) {
          this.state.position = { side, size, entryPrice: ind.price, stopLoss, takeProfit, simulated: true };
        }

        this._recordTrade({
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
