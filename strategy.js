/**
 * 10-indicator confluence strategy.
 * Each indicator casts one vote: 'up', 'down', or 'neutral'.
 * A trade signal only fires when at least CONFIRM_THRESHOLD (8 of 10) indicators
 * agree on the same direction — high conviction, fewer trades by design.
 */
const CONFIRM_THRESHOLD = 6;
const TOTAL_INDICATORS = 10;

function generateSignal(ind) {
  const votes = []; // { name, direction: 'up'|'down'|'neutral', note }

  const vote = (name, direction, note) => votes.push({ name, direction, note });

  // 1. EMA9 vs EMA21 - short-term trend
  if (ind.ema9 != null && ind.ema21 != null) {
    vote('EMA9/21', ind.ema9 > ind.ema21 ? 'up' : 'down', `EMA9 ${ind.ema9 > ind.ema21 ? '>' : '<'} EMA21`);
  }

  // 2. EMA21 vs EMA50 - longer-term trend
  if (ind.ema21 != null && ind.ema50 != null) {
    vote('EMA21/50', ind.ema21 > ind.ema50 ? 'up' : 'down', `EMA21 ${ind.ema21 > ind.ema50 ? '>' : '<'} EMA50`);
  }

  // 3. MACD line vs signal line - momentum
  if (ind.macd && ind.macd.MACD != null && ind.macd.signal != null) {
    vote('MACD', ind.macd.MACD > ind.macd.signal ? 'up' : 'down', `MACD ${ind.macd.MACD > ind.macd.signal ? 'above' : 'below'} signal`);
  }

  // 4. RSI vs 50 - directional bias
  if (ind.rsi14 != null) {
    vote('RSI', ind.rsi14 > 50 ? 'up' : 'down', `RSI ${ind.rsi14.toFixed(1)} vs 50`);
  }

  // 5. Stochastic RSI K vs D - momentum crossover
  if (ind.stochRsi && ind.stochRsi.k != null && ind.stochRsi.d != null) {
    vote('StochRSI', ind.stochRsi.k > ind.stochRsi.d ? 'up' : 'down', `%K ${ind.stochRsi.k > ind.stochRsi.d ? '>' : '<'} %D`);
  }

  // 6. Bollinger Bands - price position (mean reversion signal)
  if (ind.bb && ind.price != null) {
    if (ind.price <= ind.bb.lower) vote('BB', 'up', 'Price at/below lower band');
    else if (ind.price >= ind.bb.upper) vote('BB', 'down', 'Price at/above upper band');
    else vote('BB', 'neutral', 'Price inside bands');
  }

  // 7. CCI vs 0
  if (ind.cci != null) {
    vote('CCI', ind.cci > 0 ? 'up' : 'down', `CCI ${ind.cci.toFixed(1)} vs 0`);
  }

  // 8. Williams %R vs -50
  if (ind.williamsR != null) {
    vote('Williams %R', ind.williamsR > -50 ? 'up' : 'down', `%R ${ind.williamsR.toFixed(1)} vs -50`);
  }

  // 9. ADX direction (+DI vs -DI), only counted as directional if trend has strength (ADX > 20)
  if (ind.adx && ind.adx.pdi != null && ind.adx.mdi != null) {
    if (ind.adx.adx != null && ind.adx.adx < 20) {
      vote('ADX', 'neutral', `ADX ${ind.adx.adx.toFixed(1)} — weak trend`);
    } else {
      vote('ADX', ind.adx.pdi > ind.adx.mdi ? 'up' : 'down', `+DI ${ind.adx.pdi > ind.adx.mdi ? '>' : '<'} -DI`);
    }
  }

  // 10. Parabolic SAR vs price
  if (ind.psar != null && ind.price != null) {
    vote('PSAR', ind.price > ind.psar ? 'up' : 'down', `Price ${ind.price > ind.psar ? 'above' : 'below'} PSAR`);
  }

  const upCount = votes.filter((v) => v.direction === 'up').length;
  const downCount = votes.filter((v) => v.direction === 'down').length;
  const neutralCount = votes.filter((v) => v.direction === 'neutral').length;

  let signal = 'HOLD';
  if (upCount >= CONFIRM_THRESHOLD) signal = 'BUY';
  else if (downCount >= CONFIRM_THRESHOLD) signal = 'SELL';

  // RSI/Williams %R extremes as a caution flag (doesn't change the vote, just a heads-up)
  let caution = null;
  if (ind.rsi14 != null && ind.rsi14 > 75) caution = 'RSI overbought (>75) — late to buy';
  if (ind.rsi14 != null && ind.rsi14 < 25) caution = 'RSI oversold (<25) — late to sell';

  return {
    signal,
    upCount,
    downCount,
    neutralCount,
    score: upCount - downCount,
    maxScore: TOTAL_INDICATORS,
    confirmThreshold: CONFIRM_THRESHOLD,
    confidence: Math.max(upCount, downCount) / TOTAL_INDICATORS,
    reasons: votes.map((v) => `${v.name}: ${v.note} (${v.direction})`),
    votes, // raw per-indicator votes: [{ name, direction, note }] — used for the cheat-sheet panel
    caution,
  };
}

module.exports = { generateSignal, CONFIRM_THRESHOLD, TOTAL_INDICATORS };
