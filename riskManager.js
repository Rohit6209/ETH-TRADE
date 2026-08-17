/**
 * Position sizing = fixed % of available capital (RISK_PERCENT).
 * Stop-loss / take-profit = ATR-based, so they widen/narrow with current volatility
 * instead of a fixed dollar or % distance.
 */
function calculatePositionSize({ balanceUsd, riskPercent, leverage, price, contractValue = 1 }) {
  const capitalAtRisk = balanceUsd * (riskPercent / 100);
  const notional = capitalAtRisk * leverage;
  const rawSize = notional / (price * contractValue);
  const size = Math.max(1, Math.floor(rawSize)); // Delta futures sizes are in whole contracts
  return { capitalAtRisk, notional, size };
}

function calculateAtrStops({ side, entryPrice, atr, slMultiplier, tpMultiplier }) {
  const slDistance = atr * slMultiplier;
  const tpDistance = atr * tpMultiplier;

  if (side === 'buy') {
    return {
      stopLoss: +(entryPrice - slDistance).toFixed(2),
      takeProfit: +(entryPrice + tpDistance).toFixed(2),
    };
  }
  return {
    stopLoss: +(entryPrice + slDistance).toFixed(2),
    takeProfit: +(entryPrice - tpDistance).toFixed(2),
  };
}

/**
 * Circuit breaker: if today's realized loss exceeds maxDailyLossPercent of
 * starting balance, trading is disabled for the rest of the day.
 */
function isDailyLossLimitHit({ startBalance, currentBalance, maxDailyLossPercent }) {
  if (!startBalance) return false;
  const lossPercent = ((startBalance - currentBalance) / startBalance) * 100;
  return lossPercent >= maxDailyLossPercent;
}

module.exports = { calculatePositionSize, calculateAtrStops, isDailyLossLimitHit };
