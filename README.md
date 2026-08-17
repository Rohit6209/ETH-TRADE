# ETH Futures — Analysis + Auto-Trade Bot (Delta Exchange)

A market-analysis dashboard for ETH perpetual futures on Delta Exchange, with an
optional auto-trading engine layered on top. Multi-indicator confirmation
(EMA crossover + MACD + RSI + Bollinger Bands) drives the signal; position size
is a % of your capital; stop-loss/take-profit are ATR-based (they scale with
current volatility instead of a fixed distance).

**This is a tool, not a guarantee of profit.** Crypto futures trading — especially
leveraged, automated trading — can lose money fast. Nothing here is financial
advice. Test thoroughly on testnet and in dry-run before risking real capital,
and only risk what you can afford to lose.

## 1. Install

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `DELTA_API_KEY` / `DELTA_API_SECRET` — generate from Delta Exchange India →
  Account → API Keys. Restrict the key's permissions and IP-whitelist it if
  the exchange offers that option.
- Leave `USE_TESTNET=true` and `DRY_RUN=true` until you've watched the bot run
  for a while and understand its behavior.

## 2. Run locally

```bash
npm start
```

Open `http://localhost:3000` — the dashboard polls the server every 5 seconds.

## 3. How the signal works

Ten indicators each cast one vote — `up`, `down`, or `neutral`:

1. **EMA 9 vs EMA 21** — short-term trend
2. **EMA 21 vs EMA 50** — longer-term trend
3. **MACD line vs signal line** — momentum
4. **RSI 14 vs 50** — directional bias
5. **Stochastic RSI %K vs %D** — momentum crossover
6. **Price vs Bollinger Bands** — mean-reversion/extremes
7. **CCI vs 0** — cyclical momentum
8. **Williams %R vs -50** — overbought/oversold momentum
9. **ADX + DI direction** — trend strength + direction (neutral if ADX < 20,
   i.e. no real trend to confirm)
10. **Price vs Parabolic SAR** — trend-following stop level

A `BUY` fires only when **8 of the 10** agree bullish; `SELL` only when 8 of
10 agree bearish (`CONFIRM_THRESHOLD` in `strategy.js`). Anything weaker shows
as `HOLD`. This is intentionally strict — fewer trades, much higher
conviction. Expect it to sit in `HOLD` most of the time; that's the design,
not a bug. Lower `CONFIRM_THRESHOLD` in `strategy.js` if you want more
frequent signals (at the cost of lower conviction per trade).

## 4. Risk management

- **Position size** = `balance × RISK_PERCENT%`, multiplied by leverage, converted
  to contracts at the current price.
- **Stop-loss / take-profit** = `entry ± (ATR14 × multiplier)`. Defaults:
  1.5× ATR for SL, 3× ATR for TP (roughly a 1:2 risk/reward). Both are sent to
  Delta as a bracket order attached to the entry, so they live on the exchange
  even if the bot goes offline.
- **Daily loss circuit breaker**: if realized losses hit `MAX_DAILY_LOSS_PERCENT`
  of the day's starting balance, auto-trading pauses until the next day. You'll
  see a banner on the dashboard when this trips.

Tune all of these in `.env`.

## 5. Turning on real trading

Three separate switches all have to agree before a real order goes to the
exchange — this is deliberate, so you don't flip on live trading by accident:

1. `USE_TESTNET=false` — points at Delta's production API instead of testnet
2. `DRY_RUN=false` — lets the bot actually call the Orders API
3. Auto-trade toggle **on the dashboard** — the master run/stop switch, so you
   can pause trading without touching the server or `.env`

Recommended order: testnet + dry-run first → testnet + live orders (fake
money, real order flow) → production + dry-run (real prices, no orders) →
production + live, starting with a small `RISK_PERCENT`.

## 6. Deploying (Render.com)

1. Push this folder to a GitHub repo.
2. New → Web Service on Render, connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add all the `.env` variables under Render's Environment tab — **never**
   commit `.env` or your API secret to the repo.
5. Delta's signature has a 5-second validity window — make sure your Render
   instance's clock is in sync (it is, by default).

## 7. A few honest caveats

- Delta's bracket-order fields (`bracket_stop_loss_price`,
  `bracket_take_profit_price`, etc.) are implemented per their current public
  docs as of this build. Exchange APIs change — if order placement starts
  failing, check `docs.delta.exchange` for the latest `/v2/orders` schema
  before assuming the strategy logic is at fault.
- The strategy here is a reasonable, transparent starting point, not a proven
  edge. Back-test it against historical candles (the `/v2/history/candles`
  endpoint is already wired up in `deltaClient.js`) before trusting it with
  real money.
- One position at a time, market entries only. No pyramiding, no partial
  exits, no funding-rate awareness yet — extend `tradingEngine.js` if you need
  those.
- The extra indicators (Stochastic RSI, CCI, Williams %R, ADX, PSAR) need
  more warmup candles than the original 4 — the engine now pulls ~400 candles
  and waits for at least 70 before generating a signal. If your chosen
  `RESOLUTION` is very short (1m), that's still only a few hours of history;
  fine for signals, but back-test on more data before trusting it live.
