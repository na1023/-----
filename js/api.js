'use strict';

const YahooFinance = (() => {
  const PROXIES = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  const MEM_CACHE = new Map();
  const MEM_TTL   = 15 * 60 * 1000;  // 15分
  const DIV_KEY   = 'kabu_div_cache_v1';
  const DIV_TTL   = 24 * 60 * 60 * 1000; // 24時間

  async function fetchRaw(url) {
    const hit = MEM_CACHE.get(url);
    if (hit && Date.now() - hit.ts < MEM_TTL) return hit.data;

    let lastErr;
    for (const proxy of PROXIES) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10000);
        const res  = await fetch(proxy(url), { signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        MEM_CACHE.set(url, { data, ts: Date.now() });
        return data;
      } catch (e) { lastErr = e; }
    }
    throw lastErr ?? new Error('Network error');
  }

  /* 株価・前日比 */
  async function getQuote(code) {
    const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?interval=1d&range=2d`;
    const data = await fetchRaw(url);
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data');
    const meta  = result.meta;
    const price = meta.regularMarketPrice;
    const prev  = meta.previousClose ?? meta.chartPreviousClose ?? price;
    return {
      code,
      price,
      prevClose:  prev,
      change:     price - prev,
      changePct:  ((price - prev) / prev) * 100,
      name:       meta.longName ?? meta.shortName ?? code,
      updatedAt:  new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    };
  }

  /* 複数銘柄を並列取得（同時4件まで） */
  async function getQuotes(codes, onProgress) {
    const results = {};
    let i = 0, done = 0;
    const CONC = 4;
    async function worker() {
      while (i < codes.length) {
        const code = codes[i++];
        try { results[code] = await getQuote(code); }
        catch { results[code] = null; }
        done++;
        if (onProgress) onProgress(done, codes.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONC, codes.length) }, worker));
    return results;
  }

  /* 配当履歴（localStorage 24h キャッシュ） */
  function loadDivCache() {
    try { return JSON.parse(localStorage.getItem(DIV_KEY) ?? '{}'); } catch { return {}; }
  }
  function saveDivCache(c) { localStorage.setItem(DIV_KEY, JSON.stringify(c)); }

  async function getDividends(code) {
    const cache = loadDivCache();
    if (cache[code] && Date.now() - cache[code].ts < DIV_TTL) return cache[code].data;

    const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?events=dividends&range=7y&interval=1mo`;
    const data = await fetchRaw(url);
    const events = data?.chart?.result?.[0]?.events?.dividends ?? {};
    const divs = Object.values(events)
      .map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    cache[code] = { data: divs, ts: Date.now() };
    saveDivCache(cache);
    return divs;
  }

  /* 即時にキャッシュだけ返す（ネット待ちなし） */
  function getDividendsCached(code) {
    const cache = loadDivCache();
    return cache[code]?.data ?? null;
  }

  /* 複数銘柄の配当を並列取得（同時4件） */
  async function getDividendsMany(codes, onProgress) {
    const results = {};
    let i = 0, done = 0;
    const CONC = 4;
    async function worker() {
      while (i < codes.length) {
        const code = codes[i++];
        try { results[code] = await getDividends(code); }
        catch { results[code] = []; }
        done++;
        if (onProgress) onProgress(done, codes.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONC, codes.length) }, worker));
    return results;
  }

  /* キャッシュ強制更新 */
  function clearDivCache(code) {
    const cache = loadDivCache();
    if (code) delete cache[code];
    else Object.keys(cache).forEach(k => delete cache[k]);
    saveDivCache(cache);
    MEM_CACHE.clear();
  }

  /* 株価のメモリキャッシュだけクリア（配当のローカル保存は残す） */
  function clearMemCache() { MEM_CACHE.clear(); }

  /* 銘柄検索（コード→名前、名前→コード 両対応） */
  async function searchSymbol(query) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&lang=ja-JP&region=JP`;
    try {
      const data = await fetchRaw(url);
      return (data?.quotes ?? [])
        .filter(x => x.symbol && /\.T$/.test(x.symbol))   // 東証銘柄のみ
        .map(x => ({
          symbol: x.symbol,
          code:   x.symbol.replace(/\.T$/, ''),
          name:   x.longname || x.shortname || x.symbol,
        }));
    } catch { return []; }
  }

  return { getQuote, getQuotes, getDividends, getDividendsCached, getDividendsMany, clearDivCache, clearMemCache, searchSymbol };
})();
