const axios = require('axios');
const crypto = require('crypto');

const PROD_BASE = 'https://api.india.delta.exchange';
const TESTNET_BASE = 'https://cdn-ind.testnet.deltaex.org';

class DeltaClient {
  constructor({ apiKey, apiSecret, useTestnet }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = useTestnet ? TESTNET_BASE : PROD_BASE;
  }

  _sign(method, path, query, body) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = body ? JSON.stringify(body) : '';
    const message = method + timestamp + path + query + bodyStr;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('hex');
    return { timestamp, signature, bodyStr };
  }

  async _request(method, path, { query = '', params = {}, body = null, auth = false } = {}) {
    const url = this.baseUrl + path;
    const headers = { 'Accept': 'application/json', 'User-Agent': 'eth-futures-bot' };
    let data;

    if (auth) {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('Missing DELTA_API_KEY / DELTA_API_SECRET in .env');
      }
      const { timestamp, signature, bodyStr } = this._sign(method, path, query, body);
      headers['api-key'] = this.apiKey;
      headers['timestamp'] = timestamp;
      headers['signature'] = signature;
      headers['Content-Type'] = 'application/json';
      data = bodyStr || undefined;
    } else if (body) {
      headers['Content-Type'] = 'application/json';
      data = JSON.stringify(body);
    }

    try {
      const res = await axios({ method, url, headers, params, data, timeout: 15000 });
      return res.data;
    } catch (err) {
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Delta API ${method} ${path} failed: ${detail}`);
    }
  }

  // ---- Public endpoints ----
  getProduct(symbol) {
    return this._request('GET', `/v2/products/${symbol}`);
  }

  getTicker(symbol) {
    return this._request('GET', `/v2/tickers/${symbol}`);
  }

  getCandles({ symbol, resolution, start, end }) {
    return this._request('GET', '/v2/history/candles', {
      params: { symbol, resolution, start, end },
    });
  }

  // ---- Authenticated endpoints ----
  getWalletBalances() {
    return this._request('GET', '/v2/wallet/balances', { auth: true });
  }

  getPositions(product_id) {
    const query = product_id ? `?product_id=${product_id}` : '';
    return this._request('GET', '/v2/positions', {
      query,
      params: product_id ? { product_id } : {},
      auth: true,
    });
  }

  getOpenOrders(product_id) {
    const query = product_id ? `?product_id=${product_id}&state=open` : '?state=open';
    return this._request('GET', '/v2/orders', {
      query,
      params: product_id ? { product_id, state: 'open' } : { state: 'open' },
      auth: true,
    });
  }

  placeOrder(orderBody) {
    return this._request('POST', '/v2/orders', { body: orderBody, auth: true });
  }

  cancelAllOrders(product_id) {
    return this._request('DELETE', '/v2/orders/all', {
      body: { product_id },
      auth: true,
    });
  }
}

module.exports = { DeltaClient };
