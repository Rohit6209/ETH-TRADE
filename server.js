require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { DeltaClient } = require('./deltaClient');
const { TradingEngine } = require('./tradingEngine');

const config = {
  symbol: process.env.SYMBOL || 'ETHUSD',
  resolution: process.env.RESOLUTION || '15m',
  riskPercent: parseFloat(process.env.RISK_PERCENT || '3'),
  leverage: parseFloat(process.env.LEVERAGE || '5'),
  atrSlMultiplier: parseFloat(process.env.ATR_SL_MULTIPLIER || '1.5'),
  atrTpMultiplier: parseFloat(process.env.ATR_TP_MULTIPLIER || '3'),
  maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '6'),
  dryRun: (process.env.DRY_RUN || 'true') === 'true',
  autoTradeEnabled: (process.env.AUTO_TRADE_ENABLED || 'false') === 'true',
  paperStartBalance: 1000,
};

const useTestnet = (process.env.USE_TESTNET || 'true') === 'true';

const deltaClient = new DeltaClient({
  apiKey: process.env.DELTA_API_KEY,
  apiSecret: process.env.DELTA_API_SECRET,
  useTestnet,
});

const engine = new TradingEngine({ deltaClient, config, logger: console });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    config: {
      symbol: config.symbol,
      resolution: config.resolution,
      riskPercent: config.riskPercent,
      leverage: config.leverage,
      atrSlMultiplier: config.atrSlMultiplier,
      atrTpMultiplier: config.atrTpMultiplier,
      maxDailyLossPercent: config.maxDailyLossPercent,
      useTestnet,
      dryRun: config.dryRun,
    },
    state: engine.getState(),
  });
});

app.post('/api/toggle-auto-trade', (req, res) => {
  const { enabled } = req.body;
  engine.setAutoTrade(!!enabled);
  res.json({ ok: true, autoTradeEnabled: engine.getState().autoTradeEnabled });
});

app.post('/api/set-leverage', async (req, res) => {
  try {
    const { leverage } = req.body;
    const applied = await engine.setLeverage(leverage);
    res.json({ ok: true, leverage: applied });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/manual-trade', async (req, res) => {
  try {
    const { side, riskPercent } = req.body;
    const state = await engine.manualTrade({ side, riskPercent });
    res.json({ ok: true, state });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/tick-now', async (req, res) => {
  const state = await engine.tick();
  res.json({ ok: true, state });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ETH futures analysis bot running on http://localhost:${PORT}`);
  console.log(`Mode: ${useTestnet ? 'TESTNET' : 'PRODUCTION'} | DRY_RUN=${config.dryRun} | AUTO_TRADE=${config.autoTradeEnabled}`);
});

// Run once at startup, then on an interval matching the analysis resolution
// (checking every minute is enough since candles only close periodically).
engine.tick();
setInterval(() => engine.tick(), 60 * 1000);
