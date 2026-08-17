const {
  EMA, RSI, MACD, BollingerBands, ATR,
  StochasticRSI, CCI, WilliamsR, ADX, PSAR,
} = require('technicalindicators');

/**
 * candles: array of { time, open, high, low, close, volume } sorted oldest -> newest
 * Returns the latest value of each indicator (10 total) plus price/ATR for risk sizing.
 */
function computeIndicators(candles) {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);

  const ema9 = EMA.calculate({ period: 9, values: close });
  const ema21 = EMA.calculate({ period: 21, values: close });
  const ema50 = EMA.calculate({ period: 50, values: close });

  const rsi14 = RSI.calculate({ period: 14, values: close });

  const macd = MACD.calculate({
    values: close,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const bb = BollingerBands.calculate({ period: 20, values: close, stdDev: 2 });
  const atr14 = ATR.calculate({ period: 14, high, low, close });

  const stochRsi = StochasticRSI.calculate({
    values: close,
    rsiPeriod: 14,
    stochasticPeriod: 14,
    kPeriod: 3,
    dPeriod: 3,
  });

  const cci = CCI.calculate({ high, low, close, period: 20 });
  const williamsR = WilliamsR.calculate({ high, low, close, period: 14 });
  const adx = ADX.calculate({ high, low, close, period: 14 });
  const psar = PSAR.calculate({ high, low, step: 0.02, max: 0.2 });

  const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

  return {
    price: close[close.length - 1],
    ema9: last(ema9),
    ema21: last(ema21),
    ema50: last(ema50),
    rsi14: last(rsi14),
    macd: last(macd), // { MACD, signal, histogram }
    bb: last(bb), // { upper, middle, lower }
    atr14: last(atr14),
    stochRsi: last(stochRsi), // { k, d }
    cci: last(cci),
    williamsR: last(williamsR),
    adx: last(adx), // { adx, pdi, mdi }
    psar: last(psar),
  };
}

module.exports = { computeIndicators };
