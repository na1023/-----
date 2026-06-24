'use strict';

/* ============================================================
   Storage
   ============================================================ */
const TradeStorage = {
  KEY: 'kabu_trades_v2',
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return [];
      const d = JSON.parse(raw);
      return (Array.isArray(d) ? d : d.trades ?? []).map(t => ({ id: t.id ?? Utils.uid(), ...t }));
    } catch { return []; }
  },
  saveLocal(trades) { localStorage.setItem(this.KEY, JSON.stringify(trades)); },
  save(trades) {
    this.saveLocal(trades);
    if (typeof Sync !== 'undefined') Sync.push();
  },
  exportJSON(trades) {
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), trades }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kabu_backup_${new Date().toISOString().slice(0,10)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  },
  importJSON(text) {
    const d = JSON.parse(text);
    const arr = Array.isArray(d) ? d : (d.trades ?? []);
    if (!Array.isArray(arr)) throw new Error('invalid');
    return arr.map(t => ({ id: t.id ?? Utils.uid(), source: t.source ?? 'backup', ...t }));
  },
};

/* ============================================================
   Toast
   ============================================================ */
const Toast = {
  _c: null,
  init() { this._c = document.getElementById('toastContainer'); },
  show(msg, type = 'info', ms = 3200) {
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = (icons[type] ?? '') + `<span>${msg}</span>`;
    this._c.appendChild(el);
    setTimeout(() => { el.classList.add('hide'); el.addEventListener('animationend', () => el.remove()); }, ms);
  },
};

/* ============================================================
   ChartManager
   ============================================================ */
const ChartMgr = {
  _i: {},
  P: ['#3b82f6','#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899'],
  destroy(id) { if (this._i[id]) { this._i[id].destroy(); delete this._i[id]; } },
  destroyAll() { Object.keys(this._i).forEach(id => this.destroy(id)); },
  make(id, cfg) { this.destroy(id); const c = document.getElementById(id); if (c) this._i[id] = new Chart(c, cfg); },

  doughnut(id, labels, data) {
    this.make(id, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: this.P, borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, boxWidth: 11 } },
          tooltip: { callbacks: { label: c => ` ${Utils.yen(c.raw)}` } } } } });
  },

  bar(id, labels, datasets, yFmt) {
    this.make(id, { type: 'bar', data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, boxWidth: 11 } } },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: yFmt ?? (v => Utils.yen(v)) }, grid: { color: '#f1f5f9' } } } } });
  },

  line(id, labels, data, label) {
    this.make(id, { type: 'line', data: { labels, datasets: [{ label, data, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.1)', fill: true, tension: 0.35, pointRadius: 3, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { ticks: { callback: v => Utils.yen(v) }, grid: { color: '#f1f5f9' } } } } });
  },

  monthlyDiv(id, months, buyData, label = '受取配当') {
    this.make(id, { type: 'bar', data: { labels: months, datasets: [{ label, data: buyData, backgroundColor: '#3b82f6', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${Utils.yen(c.raw)}` } } },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => v === 0 ? '¥0' : '¥' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#f1f5f9' } } } } });
  },
};

/* ============================================================
   App
   ============================================================ */
const App = {
  trades: [],
  page: 'dashboard',
  sortKey: 'date', sortDir: -1,
  hFilters: { q: '', account: '', side: '' },
  editId: null,

  /* ---- 配当ページ状態 ---- */
  divYear:    new Date().getFullYear(),
  divTax:     'after',   // 'before' | 'after'
  divYieldMode: 'cost',  // 'cost' | 'current'
  divData:    {},        // { code: [{ date, amount }] }
  quotes:     {},        // { code: { price, change, changePct, ... } }

  /* ---- 年度サマリー状態 ---- */
  annualYear: new Date().getFullYear(),

  /* ============================================================
     Init
     ============================================================ */
  init() {
    this.trades = TradeStorage.load();
    Toast.init();
    this._setupSidebar();
    this._setupModal();
    this._setupNav();

    const VALID = ['dashboard','portfolio','dividends','annual','history','charts','import','settings'];
    const initPage = location.hash.slice(1);
    this.navigate(VALID.includes(initPage) ? initPage : 'dashboard');

    window.addEventListener('hashchange', () => {
      const p = location.hash.slice(1);
      if (VALID.includes(p) && p !== this.page) this.navigate(p);
    });

    if (typeof Sync !== 'undefined') Sync.init();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  _setupSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('overlay');
    const open  = () => { sb.classList.add('open');    ov.classList.add('active'); };
    const close = () => { sb.classList.remove('open'); ov.classList.remove('active'); };
    document.getElementById('menuBtn').addEventListener('click', open);
    ov.addEventListener('click', close);
    document.querySelectorAll('.nav-item').forEach(a => a.addEventListener('click', () => { if (window.innerWidth < 768) close(); }));
  },

  _setupNav() {
    const TITLES = { dashboard:'ダッシュボード', portfolio:'保有銘柄', dividends:'配当管理', annual:'損益サマリー', history:'取引履歴', charts:'グラフ分析', import:'CSV取込', settings:'設定' };
    [...document.querySelectorAll('.nav-item'), ...document.querySelectorAll('.bnav-item[data-page]')].forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.page));
    });
    document.getElementById('sidebarNewBtn').addEventListener('click', () => this.openModal());
    document.getElementById('topbarNewBtn').addEventListener('click', () => this.openModal());
    document.getElementById('mobileNewBtn').addEventListener('click', () => this.openModal());
    this._TITLES = TITLES;
  },

  navigate(page) {
    if (!page) return;
    this.page = page;
    if (location.hash.slice(1) !== page) location.hash = page;
    ChartMgr.destroyAll();
    document.querySelectorAll('.nav-item,.bnav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
    document.getElementById('pageTitle').textContent = this._TITLES[page] ?? page;
    const renders = { dashboard: 'renderDashboard', portfolio: 'renderPortfolio', dividends: 'renderDividends', annual: 'renderAnnual', history: 'renderHistory', charts: 'renderCharts', import: 'renderImport', settings: 'renderSettings' };
    const fn = renders[page];
    if (fn) this[fn]();
  },

  html(h) { document.getElementById('pageContent').innerHTML = h; },

  /* ============================================================
     DASHBOARD
     ============================================================ */
  renderDashboard() {
    const buy  = this.trades.filter(t => t.side==='buy').reduce((s,t) => s+Math.abs(t.amount), 0);
    const sell = this.trades.filter(t => t.side==='sell').reduce((s,t) => s+Math.abs(t.amount), 0);
    const syms = new Set(this.trades.map(t => t.symbolCode||t.symbolName)).size;
    const recent = [...this.trades].sort((a,b) => b.date.localeCompare(a.date)).slice(0,8);

    this.html(`
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">取引件数</div><div class="kpi-value">${this.trades.length.toLocaleString()}</div><div class="kpi-sub">件</div></div>
        <div class="kpi-card"><div class="kpi-label">銘柄数</div><div class="kpi-value">${syms}</div><div class="kpi-sub">銘柄</div></div>
        <div class="kpi-card kpi-buy"><div class="kpi-label">買付総額</div><div class="kpi-value">${Utils.yen(buy)}</div><div class="kpi-sub">累計</div></div>
        <div class="kpi-card kpi-sell"><div class="kpi-label">売却総額</div><div class="kpi-value">${Utils.yen(sell)}</div><div class="kpi-sub">累計</div></div>
      </div>
      <div class="dash-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">直近の取引</span><button class="btn btn-sm btn-ghost" onclick="App.navigate('history')">すべて見る →</button></div>
          <div>${recent.length ? recent.map(t => this._tradeRow(t)).join('') : this._empty('データなし','新規登録またはCSV取込でデータを追加してください')}</div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">区分別 買付額</span></div>
          <div class="card-body"><div class="chart-container"><canvas id="dashChart"></canvas></div></div>
        </div>
      </div>`);

    if (this.trades.length) {
      const byAcc = {};
      this.trades.filter(t=>t.side==='buy').forEach(t => { byAcc[t.account]=(byAcc[t.account]??0)+Math.abs(t.amount); });
      ChartMgr.doughnut('dashChart', Object.keys(byAcc), Object.values(byAcc));
    }
  },

  _tradeRow(t) {
    return `<div class="trade-row">
      <div><div class="trade-symbol">${this.esc(t.symbolName||t.symbolCode)}</div>
        <div class="trade-meta">${Utils.fmtDate(t.date)} &ensp; ${this._accBadge(t.account)}</div></div>
      <div><div class="trade-amount ${t.side==='buy'?'text-buy':'text-sell'}">${t.side==='buy'?'買':'売'} ${Utils.yen(t.amount)}</div>
        <div class="trade-shares text-muted">${t.shares.toLocaleString()} 株</div></div>
    </div>`;
  },

  /* ============================================================
     PORTFOLIO — 保有銘柄 + リアルタイム株価
     ============================================================ */
  renderPortfolio() {
    const holdings = Portfolio.getHoldings(this.trades);
    if (!holdings.length) { this.html(`<div class="card"><div class="card-body">${this._empty('保有銘柄なし','取引を登録すると保有銘柄が表示されます')}</div></div>`); return; }

    const fetching = this._fetching;
    const NO_DATA  = `<span class="no-data-pill">${fetching ? '<span class="dot-loading"></span>取得中' : 'データ未取得'}</span>`;

    const tbody = holdings.map(h => {
      const q = this.quotes[h.symbolCode];
      const priceTd   = q ? `<span class="fw7">${Utils.yen(q.price)}</span>` : NO_DATA;
      const changeTd  = q ? `<span class="${q.changePct>=0?'change-pos':'change-neg'}">${q.changePct>=0?'▲':'▼'}${Math.abs(q.changePct).toFixed(2)}%</span>` : '';
      const evalAmt   = q ? h.shares * q.price : null;
      const evalPnl   = q ? evalAmt - h.totalCost : null;
      const evalPct   = q && h.totalCost > 0 ? (evalPnl / h.totalCost) * 100 : null;
      return `<tr>
        <td><div class="stock-name">${this.esc(h.symbolName)}</div><div class="stock-code">${h.symbolCode}</div></td>
        <td class="r">${h.shares.toLocaleString()}</td>
        <td class="r">${Utils.yen(h.avgCost)}</td>
        <td class="r"><div class="price-change">${priceTd}</div><div class="price-change">${changeTd}</div></td>
        <td class="r">${evalAmt != null ? Utils.yen(evalAmt) : NO_DATA}</td>
        <td class="r ${evalPnl==null?'':evalPnl>=0?'text-pos':'text-neg'}" style="font-weight:700">
          ${evalPnl != null ? `${evalPnl>=0?'+':''}${Utils.yen(evalPnl)}<div style="font-size:.75rem;font-weight:500">(${evalPct>=0?'+':''}${evalPct?.toFixed(2)}%)</div>` : NO_DATA}
        </td>
        <td class="r">${Utils.yen(h.totalCost)}</td>
      </tr>`;
    }).join('');

    const mobileCards = holdings.map(h => {
      const q = this.quotes[h.symbolCode];
      const evalPnl = q ? h.shares * q.price - h.totalCost : null;
      return `<div class="port-card">
        <div class="flex-between mb-4">
          <div><div class="stock-name">${this.esc(h.symbolName)}</div><div class="stock-code text-muted">${h.symbolCode}</div></div>
          <div style="text-align:right">
            <div class="fw7">${q ? Utils.yen(q.price) : '—'}</div>
            ${q ? `<div class="price-change ${q.changePct>=0?'change-pos':'change-neg'} text-xs">${q.changePct>=0?'▲':'▼'}${Math.abs(q.changePct).toFixed(2)}%</div>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.82rem">
          <div><div class="text-muted text-xs">保有株数</div><div class="fw7">${h.shares.toLocaleString()}株</div></div>
          <div><div class="text-muted text-xs">平均取得単価</div><div class="fw7">${Utils.yen(h.avgCost)}</div></div>
          <div><div class="text-muted text-xs">評価損益</div><div class="fw7 ${evalPnl==null?'':evalPnl>=0?'text-pos':'text-neg'}">${evalPnl!=null?`${evalPnl>=0?'+':''}${Utils.yen(evalPnl)}`:'—'}</div></div>
          <div><div class="text-muted text-xs">取得総額</div><div class="fw7">${Utils.yen(h.totalCost)}</div></div>
        </div>
      </div>`;
    }).join('');

    const totalCost = holdings.reduce((s,h) => s+h.totalCost, 0);
    const totalEval = Object.keys(this.quotes).length ? holdings.reduce((s,h) => s+(this.quotes[h.symbolCode]?h.shares*this.quotes[h.symbolCode].price:h.totalCost), 0) : null;
    const totalPnl  = totalEval != null ? totalEval - totalCost : null;

    const hasQuotes    = Object.keys(this.quotes).length > 0;
    const lastFetchTime = Object.values(this.quotes).map(q => q?.updatedAt).find(Boolean) ?? null;
    const fetchBanner  = this._fetching
      ? `<div class="fetch-banner fetch-banner-loading">
           <span class="dot-loading"></span>
           株価データを取得中です。しばらくお待ちください…
         </div>`
      : !hasQuotes
      ? `<div class="fetch-banner fetch-banner-warn">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
           株価がまだ取得されていません。
           <button class="btn btn-sm btn-primary" style="margin-left:auto;flex-shrink:0" onclick="App._refreshQuotes()">今すぐ取得</button>
         </div>`
      : '';

    this.html(`
      ${fetchBanner}
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi-card"><div class="kpi-label">保有銘柄数</div><div class="kpi-value">${holdings.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">取得総額</div><div class="kpi-value">${Utils.yen(totalCost)}</div></div>
        <div class="kpi-card ${totalPnl==null?'':totalPnl>=0?'kpi-pnl-pos':'kpi-pnl-neg'}">
          <div class="kpi-label">評価損益合計</div>
          <div class="kpi-value">${totalPnl!=null?`${totalPnl>=0?'+':''}${Utils.yen(totalPnl)}`:'—'}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">保有銘柄一覧</span>
          <div style="display:flex;align-items:center;gap:12px">
            ${lastFetchTime ? `<span style="font-size:.75rem;color:var(--c-text-3)">最終取得: ${lastFetchTime}</span>` : ''}
            <button class="btn btn-sm btn-ghost" onclick="App._refreshQuotes()" id="refreshBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
              株価更新
            </button>
          </div>
        </div>
        <!-- PC table -->
        <div class="portfolio-table-wrap">
          <table class="portfolio-table">
            <thead><tr>
              <th>銘柄</th><th class="r">保有株数</th><th class="r">平均取得単価</th>
              <th class="r">現在値 / 前日比</th><th class="r">評価額</th>
              <th class="r">評価損益</th><th class="r">取得総額</th>
            </tr></thead>
            <tbody>${tbody}</tbody>
          </table>
        </div>
        <!-- Mobile cards -->
        <div class="port-cards" style="padding:14px">${mobileCards}</div>
      </div>`);

    this._fetchQuotes(holdings);
  },

  async _fetchQuotes(holdings) {
    const codes = holdings.filter(h => Portfolio.isValidCode(h.symbolCode)).map(h => h.symbolCode);
    if (!codes.length) return;
    this._fetching = true;
    if (this.page === 'portfolio') this.renderPortfolio();
    await YahooFinance.getQuotes(codes, (done, total) => {
      const btn = document.getElementById('refreshBtn');
      if (btn) btn.textContent = `取得中… ${done}/${total}`;
    }).then(quotes => {
      Object.assign(this.quotes, quotes);
    }).catch(() => Toast.show('株価の取得に失敗しました', 'error'))
      .finally(() => {
        this._fetching = false;
        if (this.page === 'portfolio') this.renderPortfolio();
      });
  },

  async _refreshQuotes() {
    YahooFinance.clearDivCache();
    this.quotes = {};
    this.renderPortfolio();
  },

  /* ============================================================
     DIVIDENDS — 配当管理
     ============================================================ */
  async renderDividends() {
    const holdings = Portfolio.getHoldings(this.trades);
    const validHoldings = holdings.filter(h => Portfolio.isValidCode(h.symbolCode));

    this.html(`<div style="display:flex;align-items:center;gap:12px;color:var(--c-text-3);padding:40px;justify-content:center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20" style="animation:spin 1s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      配当データを取得中…</div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`);

    if (validHoldings.length) {
      for (const h of validHoldings) {
        try { this.divData[h.symbolCode] = await YahooFinance.getDividends(h.symbolCode); }
        catch { this.divData[h.symbolCode] = []; }
      }
    }

    // 株価も取得（利回り計算用）
    const codes = validHoldings.map(h => h.symbolCode);
    if (codes.length) {
      await YahooFinance.getQuotes(codes).then(q => Object.assign(this.quotes, q)).catch(() => {});
    }

    this._renderDividendUI(holdings);
  },

  _renderDividendUI(holdings) {
    const year = this.divYear;
    const tax  = this.divTax;

    // 全銘柄の受取配当を計算
    let allRecs = [];
    holdings.forEach(h => {
      const code = h.symbolCode || h.symbolName;
      const divHistory = this.divData[code] ?? [];
      const recs = Portfolio.calcDividendsReceived(this.trades, code, divHistory);
      recs.forEach(r => { r.symbolName = h.symbolName; r.symbolCode = h.symbolCode; r.avgCost = h.avgCost; });
      allRecs = allRecs.concat(recs);
    });

    const yearRecs = allRecs.filter(r => r.year === String(year));
    const total    = yearRecs.reduce((s,r) => s+(tax==='before'?r.gross:r.net), 0);

    // 月別集計（12ヶ月）
    const months = Array.from({length:12}, (_,i) => `${year}-${String(i+1).padStart(2,'0')}`);
    const monthlyMap = {};
    months.forEach(m => { monthlyMap[m] = 0; });
    yearRecs.forEach(r => { if (monthlyMap[r.month] !== undefined) monthlyMap[r.month] += tax==='before'?r.gross:r.net; });
    const monthlyData = months.map(m => monthlyMap[m]);
    const monthLabels = months.map(m => `${parseInt(m.slice(5))}月`);

    // 銘柄別集計
    const bySymbol = {};
    yearRecs.forEach(r => {
      const k = r.symbolCode||r.symbolName;
      if (!bySymbol[k]) bySymbol[k] = { name:r.symbolName, code:r.symbolCode, gross:0, net:0, count:0, avgCost:r.avgCost };
      bySymbol[k].gross += r.gross;
      bySymbol[k].net   += r.net;
      bySymbol[k].count++;
    });

    // 利回り計算
    const annualDivByCode = {};
    holdings.forEach(h => {
      const code = h.symbolCode;
      if (!Portfolio.isValidCode(code)) return;
      const divHistory = this.divData[code] ?? [];
      annualDivByCode[code] = Portfolio.annualDivPerShare(divHistory);
    });

    const yieldRows = holdings.filter(h => Portfolio.isValidCode(h.symbolCode) && annualDivByCode[h.symbolCode] > 0)
      .map(h => {
        const annDiv  = annualDivByCode[h.symbolCode];
        const yldCost = h.avgCost > 0 ? (annDiv / h.avgCost) * 100 : null;
        const q       = this.quotes[h.symbolCode];
        const yldNow  = q?.price > 0 ? (annDiv / q.price) * 100 : null;
        const yld     = this.divYieldMode === 'cost' ? yldCost : yldNow;
        return { h, annDiv, yldCost, yldNow, yld };
      });

    // 年リスト
    const years = [...new Set(allRecs.map(r => r.year))].sort().reverse();
    if (!years.includes(String(year))) years.unshift(String(year));
    const yearOpts = years.map(y => `<option value="${y}" ${y==year?'selected':''}>${y}年</option>`).join('');

    // 表行
    const tableRows = Object.values(bySymbol).sort((a,b) => b.net-a.net).map(s => {
      const code    = s.code;
      const annDiv  = annualDivByCode[code] ?? 0;
      const q       = this.quotes[code];
      const yldCost = s.avgCost>0 ? (annDiv/s.avgCost)*100 : null;
      const yldNow  = q?.price>0  ? (annDiv/q.price)*100   : null;
      const yld     = this.divYieldMode==='cost' ? yldCost : yldNow;
      return `<tr>
        <td><div class="fw7">${this.esc(s.name)}</div><div class="text-xs text-muted">${s.code}</div></td>
        <td class="r">${s.count}回</td>
        <td class="r">${Utils.yen(s.gross)}</td>
        <td class="r fw7">${Utils.yen(tax==='before'?s.gross:s.net)}</td>
        <td class="r">${yld!=null?`<span class="yield-pill ${yld<2?'warn':''}">${yld.toFixed(2)}%</span>`:'—'}</td>
      </tr>`;
    }).join('');

    // Mobile cards
    const divCards = Object.values(bySymbol).sort((a,b) => b.net-a.net).map(s => {
      const val = tax==='before'?s.gross:s.net;
      return `<div class="div-card flex-between">
        <div><div class="fw7">${this.esc(s.name)}</div><div class="text-xs text-muted">${s.code} &middot; ${s.count}回</div></div>
        <div style="text-align:right"><div class="fw7 text-pos">${Utils.yen(val)}</div><div class="text-xs text-muted">${tax==='before'?'税引前':'税引後'}</div></div>
      </div>`;
    }).join('');

    this.html(`
      <div class="div-header">
        <div class="div-kpi-main">
          <div class="div-kpi-label">年間受取配当（${year}年）</div>
          <div class="div-kpi-amount">${Utils.yen(total)}</div>
          <div class="div-kpi-sub">${tax==='before'?'税引前':'税引後（20.315%控除）'} &ensp; ${yearRecs.length}回受取</div>
        </div>
        <div class="div-controls">
          <div class="flex gap-2" style="flex-wrap:wrap">
            <select onchange="App.divYear=+this.value;App._renderDividendUI(${JSON.stringify(Portfolio.getHoldings(this.trades))})" style="padding:7px 28px 7px 12px;border:1.5px solid var(--c-border);border-radius:var(--r-md);background:var(--c-surface);font-size:.875rem;font-weight:600;cursor:pointer;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 8px center;background-size:15px;-webkit-appearance:none">
              ${yearOpts}
            </select>
          </div>
          <div class="seg-ctrl">
            <button class="seg-btn ${tax==='before'?'active':''}" onclick="App.divTax='before';App._renderDividendUI(${JSON.stringify(Portfolio.getHoldings(this.trades))})">税引前</button>
            <button class="seg-btn ${tax==='after'?'active':''}" onclick="App.divTax='after';App._renderDividendUI(${JSON.stringify(Portfolio.getHoldings(this.trades))})">税引後</button>
          </div>
        </div>
      </div>

      <div class="div-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">月別受取配当</span></div>
          <div class="card-body"><div class="div-chart-tall"><canvas id="divMonthChart"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">銘柄別 配当割合</span></div>
          <div class="card-body"><div class="div-chart-tall"><canvas id="divPieChart"></canvas></div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">銘柄別 配当詳細</span>
          <div class="seg-ctrl">
            <button class="seg-btn ${this.divYieldMode==='cost'?'active':''}" onclick="App.divYieldMode='cost';App._renderDividendUI(${JSON.stringify(Portfolio.getHoldings(this.trades))})">取得利回り</button>
            <button class="seg-btn ${this.divYieldMode==='current'?'active':''}" onclick="App.divYieldMode='current';App._renderDividendUI(${JSON.stringify(Portfolio.getHoldings(this.trades))})">現在利回り</button>
          </div>
        </div>
        ${tableRows ? `<div class="div-table-wrap"><table class="div-table">
          <thead><tr><th>銘柄</th><th class="r">受取回数</th><th class="r">税引前合計</th><th class="r">${tax==='before'?'税引前':'税引後'}受取額</th><th class="r">配当利回り</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>` : this._empty('このアカウントに配当データなし', '銘柄コードが正しく登録されているか確認してください')}
        <div class="div-cards">${divCards || this._empty('配当データなし','')}</div>
      </div>

      <div class="card mt-4">
        <div class="card-header"><span class="card-title">保有銘柄 配当利回り一覧</span>
          <div class="seg-ctrl">
            <button class="seg-btn ${this.divYieldMode==='cost'?'active':''}" onclick="App.divYieldMode='cost';App._renderDividendUI(${JSON.stringify(Portfolio.getHoldings(this.trades))})">取得利回り</button>
            <button class="seg-btn ${this.divYieldMode==='current'?'active':''}" onclick="App.divYieldMode='current';App._renderDividendUI(${JSON.stringify(Portfolio.getHoldings(this.trades))})">現在利回り</button>
          </div>
        </div>
        <div class="div-table-wrap"><table class="div-table">
          <thead><tr><th>銘柄</th><th class="r">年間配当/株</th><th class="r">平均取得単価</th><th class="r">現在株価</th><th class="r">配当利回り</th></tr></thead>
          <tbody>${yieldRows.map(({h,annDiv,yldCost,yldNow,yld}) => `<tr>
            <td><div class="fw7">${this.esc(h.symbolName)}</div><div class="text-xs text-muted">${h.symbolCode}</div></td>
            <td class="r">${Utils.yen(annDiv)}</td>
            <td class="r">${Utils.yen(h.avgCost)}</td>
            <td class="r">${this.quotes[h.symbolCode]?Utils.yen(this.quotes[h.symbolCode].price):'—'}</td>
            <td class="r"><span class="yield-pill ${(yld??0)<2?'warn':''}">${yld!=null?yld.toFixed(2)+'%':'—'}</span><div class="text-xs text-muted" style="margin-top:3px">${this.divYieldMode==='cost'?'取得':'現在'}</div></td>
          </tr>`).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px">データなし</td></tr>'}
          </tbody>
        </table></div>
      </div>`);

    // Chart
    ChartMgr.monthlyDiv('divMonthChart', monthLabels, monthlyData);
    const symNames = Object.values(bySymbol).map(s=>s.name);
    const symVals  = Object.values(bySymbol).map(s=>tax==='before'?s.gross:s.net);
    if (symNames.length) ChartMgr.doughnut('divPieChart', symNames, symVals);
  },

  /* ============================================================
     ANNUAL SUMMARY — 年度別損益
     ============================================================ */
  renderAnnual() {
    const pnlData = Portfolio.getRealizedPnL(this.trades);
    const years   = Object.keys(pnlData).sort().reverse();
    if (!years.length) { this.html(`<div class="card"><div class="card-body">${this._empty('損益データなし','売却取引を登録すると実現損益が表示されます')}</div></div>`); return; }

    const year    = String(this.annualYear);
    const yr      = pnlData[year] ?? { realized:0, buyAmt:0, sellAmt:0, taxEst:0 };
    const yearOpts = years.map(y => `<option value="${y}" ${y===year?'selected':''}>${y}年</option>`).join('');

    // 配当（divDataがあれば）
    const holdings = Portfolio.getHoldings(this.trades);
    let totalDiv = 0;
    holdings.forEach(h => {
      const divHistory = this.divData[h.symbolCode||h.symbolName] ?? [];
      const recs = Portfolio.calcDividendsReceived(this.trades, h.symbolCode||h.symbolName, divHistory)
        .filter(r => r.year === year);
      totalDiv += recs.reduce((s,r) => s+r.net, 0);
    });

    // 年別グラフ用
    const allYears = Object.keys(pnlData).sort();
    const barData  = allYears.map(y => pnlData[y].realized);

    this.html(`
      <div class="summary-year-selector">
        <select onchange="App.annualYear=+this.value;App.renderAnnual()">${yearOpts}</select>
        <span class="text-muted text-sm">${year}年 損益レポート</span>
      </div>

      <div class="annual-grid">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-header"><span class="card-title">実現損益</span></div>
            <div class="card-body">
              <div class="total-row mb-4">
                <div class="total-label">実現損益合計</div>
                <div class="total-value ${yr.realized>=0?'text-pos':'text-neg'}">${yr.realized>=0?'+':''}${Utils.yen(yr.realized)}</div>
              </div>
              <div class="pnl-row"><span class="pnl-label">売却総額</span><span class="pnl-value">${Utils.yen(yr.sellAmt)}</span></div>
              <div class="pnl-row"><span class="pnl-label">買付総額</span><span class="pnl-value">${Utils.yen(yr.buyAmt)}</span></div>
              <div class="pnl-row"><span class="pnl-label">税額概算（20.315%）</span><span class="pnl-value text-neg">${yr.realized>0?'▲'+Utils.yen(yr.taxEst):'—'}</span></div>
              <div class="pnl-row"><span class="pnl-label">税引後 実現益</span><span class="pnl-value ${yr.realized>=0?'text-pos':'text-neg'}">${Utils.yen(yr.realized - (yr.taxEst??0))}</span></div>
            </div>
          </div>

          ${totalDiv > 0 ? `<div class="card">
            <div class="card-header"><span class="card-title">配当収入</span></div>
            <div class="card-body">
              <div class="total-row">
                <div class="total-label">年間受取配当（税引後）</div>
                <div class="total-value text-pos">${Utils.yen(totalDiv)}</div>
              </div>
            </div>
          </div>` : ''}

          <div class="card">
            <div class="card-header"><span class="card-title">年間収益合計</span></div>
            <div class="card-body">
              <div class="total-row">
                <div class="total-label">実現益 ＋ 配当（税引後）</div>
                <div class="total-value ${(yr.realized-yr.taxEst+totalDiv)>=0?'text-pos':'text-neg'}">${Utils.yen(yr.realized-(yr.taxEst??0)+totalDiv)}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">年別 実現損益推移</span></div>
          <div class="card-body"><div style="position:relative;height:320px"><canvas id="annualChart"></canvas></div></div>
        </div>
      </div>`);

    ChartMgr.bar('annualChart', allYears.map(y=>y+'年'),
      [{ label:'実現損益', data: barData, backgroundColor: barData.map(v=>v>=0?'#86efac':'#fca5a5'), borderRadius:4 }],
      v => (v>=0?'+':'')+Utils.yen(v));
  },

  /* ============================================================
     HISTORY
     ============================================================ */
  renderHistory() {
    this.html(`
      <div class="card">
        <div class="filter-bar">
          <input class="filter-input" id="fq" type="search" placeholder="🔍 銘柄名・コード" value="${this.esc(this.hFilters.q)}" style="flex:1;min-width:140px">
          <select class="filter-select" id="fAcc">
            <option value="">すべての区分</option>
            ${['特定','一般','NISA','新NISA成長','新NISA積立'].map(v=>`<option value="${v}">${v}</option>`).join('')}
          </select>
          <select class="filter-select" id="fSide">
            <option value="">売買すべて</option>
            <option value="buy">買付</option>
            <option value="sell">売却</option>
          </select>
          <span class="text-muted text-sm" id="hCount" style="align-self:center;white-space:nowrap"></span>
        </div>
        <div class="data-table-wrap"><table class="data-table" id="hTable">
          <thead><tr>
            ${['date','symbolName','account','side','shares','price','amount'].map(k=>this._th(k)).join('')}
            <th>操作</th>
          </tr></thead>
          <tbody id="hTbody"></tbody>
        </table></div>
        <div class="trade-cards" id="hCards"></div>
        <div id="hEmpty" style="display:none">${this._empty('該当なし','条件を変更してください')}</div>
      </div>`);

    document.getElementById('fAcc').value  = this.hFilters.account;
    document.getElementById('fSide').value = this.hFilters.side;
    this._bindHistory();
    this._refreshHistory();
  },

  _TH_LABELS: { date:'日付', symbolName:'銘柄', account:'区分', side:'売買', shares:'株数', price:'単価', amount:'受渡金額' },
  _TH_R:      new Set(['shares','price','amount']),
  _th(key) {
    const sorted = this.sortKey === key;
    return `<th class="${sorted?'sorted':''}" data-sort="${key}" style="${this._TH_R.has(key)?'text-align:right':''}">
      ${this._TH_LABELS[key]} <span class="sort-icon">${sorted?(this.sortDir===1?'↑':'↓'):'↕'}</span></th>`;
  },

  _bindHistory() {
    const upd = () => {
      this.hFilters.q       = document.getElementById('fq')?.value ?? '';
      this.hFilters.account = document.getElementById('fAcc')?.value ?? '';
      this.hFilters.side    = document.getElementById('fSide')?.value ?? '';
      this._refreshHistory();
    };
    document.getElementById('fq')?.addEventListener('input', upd);
    document.getElementById('fAcc')?.addEventListener('change', upd);
    document.getElementById('fSide')?.addEventListener('change', upd);
    document.getElementById('hTable')?.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        this.sortKey === th.dataset.sort ? (this.sortDir *= -1) : (this.sortKey = th.dataset.sort, this.sortDir = -1);
        this.renderHistory();
      });
    });
  },

  _filteredTrades() {
    const { q, account, side } = this.hFilters;
    return this.trades
      .filter(t => {
        if (q && !((t.symbolName??'').includes(q)||(t.symbolCode??'').includes(q))) return false;
        if (account && t.account !== account) return false;
        if (side    && t.side    !== side)    return false;
        return true;
      })
      .sort((a,b) => {
        const av = a[this.sortKey]??'', bv = b[this.sortKey]??'';
        return typeof av === 'number' ? (av-bv)*this.sortDir : String(av).localeCompare(String(bv),'ja')*this.sortDir;
      });
  },

  _refreshHistory() {
    const rows = this._filteredTrades();
    document.getElementById('hCount').textContent = `${rows.length} 件`;
    document.getElementById('hEmpty').style.display = rows.length ? 'none' : 'block';
    const tbody = document.getElementById('hTbody');
    if (tbody) tbody.innerHTML = rows.map(t => `<tr>
      <td>${Utils.fmtDate(t.date)}</td>
      <td><div class="fw7" style="font-size:.875rem">${this.esc(t.symbolName)}</div><div class="text-xs text-muted">${this.esc(t.symbolCode??'')}</div></td>
      <td>${this._accBadge(t.account)}</td>
      <td><span class="badge ${t.side==='buy'?'badge-buy':'badge-sell'}">${t.side==='buy'?'買付':'売却'}</span></td>
      <td class="col-r">${t.shares.toLocaleString()}</td>
      <td class="col-r">${t.price?Utils.yen(t.price):'—'}</td>
      <td class="col-r fw7">${Utils.yen(t.amount)}</td>
      <td><div class="flex gap-2">
        <button class="btn-icon" title="編集" onclick="App.openModal('${t.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" title="削除" style="color:#ef4444" onclick="App.deleteTrade('${t.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div></td>
    </tr>`).join('');
    const cards = document.getElementById('hCards');
    if (cards) cards.innerHTML = rows.map(t => `<div class="trade-card-item">
      <div style="flex:1"><div class="fw7" style="font-size:.875rem">${this.esc(t.symbolName)} <span class="text-xs text-muted">${this.esc(t.symbolCode??'')}</span></div>
        <div class="text-xs text-muted mt-1">${Utils.fmtDate(t.date)} &ensp; ${this._accBadge(t.account)}</div>
        ${t.note?`<div class="text-xs text-muted">${this.esc(t.note)}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="fw7 ${t.side==='buy'?'text-buy':'text-sell'}">${t.side==='buy'?'買':'売'} ${Utils.yen(t.amount)}</div>
        <div class="text-xs text-muted">${t.shares.toLocaleString()} 株</div>
        <div class="flex gap-2" style="margin-top:8px;justify-content:flex-end">
          <button class="btn btn-sm btn-ghost" onclick="App.openModal('${t.id}')">編集</button>
          <button class="btn btn-sm" style="color:#ef4444;border:1px solid #fca5a5" onclick="App.deleteTrade('${t.id}')">削除</button>
        </div>
      </div>
    </div>`).join('');
  },

  deleteTrade(id) {
    if (!confirm('この取引を削除しますか？')) return;
    this.trades = this.trades.filter(t => t.id !== id);
    TradeStorage.save(this.trades);
    Toast.show('取引を削除しました','info');
    this._refreshHistory();
  },

  /* ============================================================
     CHARTS
     ============================================================ */
  renderCharts() {
    if (!this.trades.length) { this.html(`<div class="card"><div class="card-body">${this._empty('データなし','取引を追加してください')}</div></div>`); return; }
    this.html(`
      <div class="charts-grid">
        <div class="card"><div class="card-header"><span class="card-title">区分別 買付額</span></div><div class="card-body"><div class="chart-tall"><canvas id="c1"></canvas></div></div></div>
        <div class="card"><div class="card-header"><span class="card-title">月別 買付/売却</span></div><div class="card-body"><div class="chart-tall"><canvas id="c2"></canvas></div></div></div>
        <div class="card"><div class="card-header"><span class="card-title">銘柄別 買付額 Top10</span></div><div class="card-body"><div class="chart-tall"><canvas id="c3"></canvas></div></div></div>
        <div class="card"><div class="card-header"><span class="card-title">累計投資額の推移</span></div><div class="card-body"><div class="chart-tall"><canvas id="c4"></canvas></div></div></div>
      </div>`);
    const byAcc={};
    this.trades.filter(t=>t.side==='buy').forEach(t=>{byAcc[t.account]=(byAcc[t.account]??0)+Math.abs(t.amount);});
    ChartMgr.doughnut('c1',Object.keys(byAcc),Object.values(byAcc));
    const byM={};
    this.trades.forEach(t=>{const m=t.date.slice(0,7);if(!byM[m])byM[m]={buy:0,sell:0};if(t.side==='buy')byM[m].buy+=Math.abs(t.amount);else byM[m].sell+=Math.abs(t.amount);});
    const ms=Object.keys(byM).sort();
    ChartMgr.bar('c2',ms.map(m=>m.slice(2)),[{label:'買付',data:ms.map(m=>byM[m].buy),backgroundColor:'#fca5a5',borderRadius:4},{label:'売却',data:ms.map(m=>byM[m].sell),backgroundColor:'#86efac',borderRadius:4}]);
    const bySym={};
    this.trades.filter(t=>t.side==='buy').forEach(t=>{const k=t.symbolName||t.symbolCode;bySym[k]=(bySym[k]??0)+Math.abs(t.amount);});
    const sorted=Object.entries(bySym).sort((a,b)=>b[1]-a[1]).slice(0,10);
    ChartMgr.make('c3',{type:'bar',data:{labels:sorted.map(([k])=>k),datasets:[{label:'買付額',data:sorted.map(([,v])=>v),backgroundColor:ChartMgr.P,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>Utils.yen(v)},grid:{color:'#f1f5f9'}},y:{grid:{display:false}}}}});
    let cum=0;const pts=[...this.trades].sort((a,b)=>a.date.localeCompare(b.date)).map(t=>{cum+=t.side==='buy'?Math.abs(t.amount):-Math.abs(t.amount);return cum;});
    const dl=[...this.trades].sort((a,b)=>a.date.localeCompare(b.date)).map(t=>Utils.fmtDate(t.date));
    ChartMgr.line('c4',dl,pts,'累計投資額');
  },

  /* ============================================================
     IMPORT
     ============================================================ */
  renderImport() {
    this.html(`
      <div class="import-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">CSVファイル取込</span></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
            <div><label class="form-label" style="margin-bottom:5px;display:block">証券会社</label>
              <select class="form-select" id="brokerSel"><option value="auto">自動判定（推奨）</option><option value="SBI">SBI証券</option><option value="Rakuten">楽天証券</option><option value="Matsui">松井証券</option><option value="Monex">マネックス証券</option></select></div>
            <div class="dropzone" id="dz">
              <svg class="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p style="font-weight:600;color:var(--c-text-2)">クリック / ドラッグ&amp;ドロップ</p>
              <p class="text-sm text-muted" style="margin-top:4px">CSV（Shift-JIS / UTF-8）複数可</p>
              <input type="file" id="csvFile" accept=".csv" multiple>
            </div>
            <div id="importLog" class="import-log" style="display:none"></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:18px">
          <div class="card">
            <div class="card-header"><span class="card-title">対応証券会社</span></div>
            <div class="card-body">
              <table style="width:100%;font-size:.85rem;border-collapse:collapse">
                ${[['SBI証券','取引履歴.csv'],['楽天証券','取引履歴.csv'],['松井証券','取引一覧.csv'],['マネックス証券','取引履歴.csv']].map(([b,f])=>`
                  <tr style="border-top:1px solid var(--c-border)"><td style="padding:10px 0;font-weight:500">${b}</td><td style="padding:10px 0;color:var(--c-text-3)">${f}</td></tr>`).join('')}
              </table>
            </div>
          </div>
          <div class="info-block">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>重複する取引は自動的にスキップされます。同じファイルを複数回取込んでも二重登録にはなりません。</span>
          </div>
        </div>
      </div>`);
    const dz = document.getElementById('dz');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); this._processFiles(e.dataTransfer.files); });
    document.getElementById('csvFile').addEventListener('change', e => { this._processFiles(e.target.files); e.target.value=''; });
  },

  _processFiles(files) {
    const log = document.getElementById('importLog');
    log.style.display = 'block'; log.innerHTML = '';
    const add = (msg, cls='') => { log.innerHTML += `<div class="${cls}">${msg}</div>`; log.scrollTop = log.scrollHeight; };
    Array.from(files).forEach(file => {
      add(`<span class="log-info">📂 ${file.name}</span>`);
      const reader = new FileReader();
      reader.onload = () => {
        let text = new TextDecoder('shift-jis').decode(reader.result);
        if (/�/.test(text)) text = new TextDecoder('utf-8').decode(reader.result);
        const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
        let broker = document.getElementById('brokerSel')?.value ?? 'auto';
        if (broker === 'auto') broker = detectBroker(parsed.meta.fields ?? []);
        if (!broker) { add('❌ 証券会社を判定できませんでした', 'log-err'); return; }
        add(`🔍 ${broker} / ${parsed.data.length} 行`);
        const recs = normalizeCSV(parsed.data, broker);
        if (!recs.length) { add('❌ 有効な行が0件です', 'log-err'); return; }
        const exist = new Set(this.trades.map(deduplicateKey));
        const fresh = recs.filter(r => !exist.has(deduplicateKey(r)));
        this.trades = this.trades.concat(fresh);
        TradeStorage.save(this.trades);
        add(`✅ ${fresh.length} 件取込（重複スキップ: ${recs.length-fresh.length} 件）`, 'log-ok');
        Toast.show(`${broker}: ${fresh.length} 件取込みました`, 'success');
      };
      reader.readAsArrayBuffer(file);
    });
  },

  /* ============================================================
     SETTINGS
     ============================================================ */
  renderSettings() {
    this.html(`
      <div class="settings-grid">
        <div style="display:flex;flex-direction:column;gap:16px">
          ${this._syncCard()}
          <div class="card">
            <div class="card-header"><span class="card-title">💾 バックアップ・復元</span></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
              <div class="info-block">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>データは<strong>このブラウザの localStorage</strong> に保存されています。ブラウザデータ削除や機種変更の前に必ずバックアップを取ってください。</span>
              </div>
              <button class="btn btn-primary" onclick="App._exportData()">📤 JSONバックアップを保存</button>
              <div style="position:relative;border:2px dashed var(--c-border);border-radius:var(--r-lg);padding:20px;text-align:center;cursor:pointer" id="jsonDz">
                <p style="font-weight:600;color:var(--c-text-2);font-size:.875rem">📥 バックアップから復元（クリック）</p>
                <input type="file" accept=".json" id="jsonFile" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%">
              </div>
              <div id="settingsLog" class="import-log" style="display:none"></div>
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-header"><span class="card-title">📊 データ概要</span></div>
            <div class="card-body" style="font-size:.875rem">
              ${[['取引件数',`${this.trades.length.toLocaleString()} 件`],['うち買付',`${this.trades.filter(t=>t.side==='buy').length.toLocaleString()} 件`],['うち売却',`${this.trades.filter(t=>t.side==='sell').length.toLocaleString()} 件`],['手入力',`${this.trades.filter(t=>t.source==='manual').length.toLocaleString()} 件`]].map(([k,v])=>`<div class="pnl-row"><span class="pnl-label">${k}</span><span class="fw7">${v}</span></div>`).join('')}
            </div>
          </div>
          <div class="card" style="border-color:#fca5a5">
            <div class="card-header"><span class="card-title" style="color:#dc2626">⚠️ データ削除</span></div>
            <div class="card-body"><p class="text-sm text-muted" style="margin-bottom:12px">すべての取引データを削除します。元に戻せません。</p>
              <button class="btn btn-danger" onclick="App._clearAll()">すべてのデータを削除</button></div>
          </div>
        </div>
      </div>`);
    document.getElementById('jsonFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => this._importJSON(r.result);
      r.readAsText(f,'utf-8'); e.target.value='';
    });
  },

  _syncCard() {
    const S = (typeof Sync !== 'undefined') ? Sync : { status: 'unconfigured', code: null };

    if (S.status === 'unconfigured') {
      return `<div class="card" style="border-color:#fcd34d">
        <div class="card-header"><span class="card-title">☁️ クラウド同期（未設定）</span></div>
        <div class="card-body" style="font-size:.875rem;line-height:1.7">
          <div class="fetch-banner fetch-banner-warn" style="margin-bottom:12px">
            Firebaseが未設定のため、データはこの端末内にのみ保存されています。
          </div>
          <p style="font-weight:700;margin-bottom:6px">複数端末で同期するための設定手順</p>
          <ol style="padding-left:1.2em;display:flex;flex-direction:column;gap:5px">
            <li><a href="https://console.firebase.google.com/" target="_blank" rel="noopener" style="color:var(--c-primary)">Firebaseコンソール</a>で「プロジェクトを作成」（無料・クレカ不要）</li>
            <li>「Firestore Database」→「データベースを作成」→<b>テストモード</b>で開始</li>
            <li>プロジェクト設定 → 「マイアプリ」でウェブアプリ（&lt;/&gt;）を追加</li>
            <li>表示された <code>firebaseConfig</code> の中身を <code>js/firebase-config.js</code> に貼り付けて保存</li>
            <li>GitHubに再アップロード → アプリを開き直す</li>
          </ol>
        </div>
      </div>`;
    }

    if (S.status === 'on') {
      return `<div class="card" style="border-color:#86efac">
        <div class="card-header"><span class="card-title">☁️ クラウド同期</span>
          <span class="sync-status sync-on">● 同期中</span></div>
        <div class="card-body" style="font-size:.875rem">
          <div class="fetch-banner" style="background:#f0fdf4;border:1.5px solid #86efac;color:#166534;margin-bottom:12px">
            この合言葉で自動同期しています。<b>別の端末でも同じ合言葉を入力</b>すると、データが共有されます。
          </div>
          <div class="pnl-row"><span class="pnl-label">合言葉</span><span class="fw7" style="font-family:monospace;letter-spacing:1px">${this.esc(S.code)}</span></div>
          <button class="btn btn-ghost" style="margin-top:12px;width:100%" onclick="Sync.disconnect()">同期を停止する</button>
        </div>
      </div>`;
    }

    // status: 'off' or 'error'  → 接続フォーム
    const errBanner = S.status === 'error'
      ? `<div class="fetch-banner fetch-banner-warn" style="margin-bottom:12px">接続でエラーが発生しました。合言葉やFirebase設定を確認してください。</div>` : '';
    return `<div class="card">
      <div class="card-header"><span class="card-title">☁️ クラウド同期</span>
        <span class="sync-status sync-off">○ 未接続</span></div>
      <div class="card-body" style="font-size:.875rem">
        ${errBanner}
        <p style="margin-bottom:10px;color:var(--c-text-2)">好きな<b>合言葉</b>を決めて入力してください。<br>他の端末でも<b>同じ合言葉</b>を入れると、データが自動で同期されます。</p>
        <input class="form-input" id="syncCodeInput" type="text" placeholder="例: kabu-taro-2024" autocapitalize="off" autocomplete="off" style="margin-bottom:10px">
        <button class="btn btn-primary" style="width:100%" onclick="App._connectSync()">この合言葉で同期を開始</button>
        <p class="text-xs text-muted" style="margin-top:8px">※ 推測されにくい合言葉にしてください（合言葉を知る人は誰でもデータを見られます）</p>
      </div>
    </div>`;
  },

  _connectSync() {
    const v = document.getElementById('syncCodeInput')?.value?.trim();
    if (!v) { Toast.show('合言葉を入力してください', 'error'); return; }
    Sync.connect(v, false);
  },

  _exportData() { TradeStorage.exportJSON(this.trades); Toast.show('バックアップを保存しました','success'); },
  _importJSON(text) {
    const log = document.getElementById('settingsLog');
    if (log) log.style.display='block';
    try {
      const inc  = TradeStorage.importJSON(text);
      const exist= new Set(this.trades.map(deduplicateKey));
      const fresh= inc.filter(r => !exist.has(deduplicateKey(r)));
      this.trades= this.trades.concat(fresh);
      TradeStorage.save(this.trades);
      if (log) log.innerHTML=`<span class="log-ok">✅ ${fresh.length} 件復元（重複スキップ: ${inc.length-fresh.length} 件）</span>`;
      Toast.show(`${fresh.length} 件を復元しました`,'success');
    } catch { if (log) log.innerHTML='<span class="log-err">❌ ファイルが正しくありません</span>'; Toast.show('復元に失敗しました','error'); }
  },
  _clearAll() {
    if (!confirm('すべての取引データを削除します。\nこの操作は元に戻せません。')) return;
    this.trades=[]; TradeStorage.save(this.trades); Toast.show('データを削除しました','info'); this.navigate('dashboard');
  },

  /* ============================================================
     MODAL
     ============================================================ */
  _setupModal() {
    document.getElementById('modalClose').addEventListener('click',    () => this.closeModal());
    document.getElementById('modalCancelBtn').addEventListener('click',() => this.closeModal());
    document.getElementById('modalSubmitBtn').addEventListener('click',() => this._submitTrade());
    document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id==='modalBackdrop') this.closeModal(); });
    document.addEventListener('keydown', e => { if (e.key==='Escape') this.closeModal(); });
    document.querySelectorAll('.side-btn').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.side-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('f-side').value = btn.dataset.v;
    }));
    const calc = () => {
      const s=parseFloat(document.getElementById('f-shares')?.value)||0;
      const p=parseFloat(document.getElementById('f-price')?.value)||0;
      const a=document.getElementById('f-amount');
      if (s>0&&p>0&&a&&!a._edited) a.value=Math.round(s*p);
    };
    document.getElementById('f-shares')?.addEventListener('input',calc);
    document.getElementById('f-price')?.addEventListener('input',calc);
    document.getElementById('f-amount')?.addEventListener('input',function(){this._edited=true;});
  },

  openModal(id=null) {
    this.editId=id;
    const isEdit=!!id;
    document.getElementById('modalTitle').textContent   = isEdit?'取引を編集':'新規取引登録';
    document.getElementById('modalSubmitBtn').textContent = isEdit?'更新する':'登録する';
    if (isEdit) {
      const t=this.trades.find(t=>t.id===id); if (!t) return;
      document.getElementById('f-code').value    = t.symbolCode??'';
      document.getElementById('f-name').value    = t.symbolName??'';
      document.getElementById('f-date').value    = t.date??'';
      document.getElementById('f-account').value = t.account??'特定';
      document.getElementById('f-shares').value  = t.shares??'';
      document.getElementById('f-price').value   = t.price??'';
      document.getElementById('f-amount').value  = t.amount??'';
      document.getElementById('f-note').value    = t.note??'';
      document.getElementById('f-side').value    = t.side??'buy';
      document.querySelectorAll('.side-btn').forEach(b=>b.classList.toggle('active',b.dataset.v===t.side));
    } else {
      document.getElementById('tradeForm').reset();
      document.getElementById('f-date').value='';
      document.getElementById('f-date').value=new Date().toISOString().slice(0,10);
      document.getElementById('f-side').value='buy';
      document.querySelectorAll('.side-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
      const a=document.getElementById('f-amount'); if(a) a._edited=false;
    }
    document.querySelectorAll('.form-error').forEach(e=>e.textContent='');
    document.querySelectorAll('.form-input').forEach(e=>e.classList.remove('error'));
    document.getElementById('modalBackdrop').classList.add('open');
    setTimeout(()=>document.getElementById('f-name')?.focus(),120);
  },

  closeModal() { document.getElementById('modalBackdrop').classList.remove('open'); this.editId=null; },

  _validate() {
    let ok=true;
    [['f-name','err-name','銘柄名は必須です'],['f-date','err-date','日付は必須です'],['f-shares','err-shares','株数は必須です'],['f-amount','err-amount','受渡金額は必須です']].forEach(([id,eid,msg])=>{
      const el=document.getElementById(id),er=document.getElementById(eid);
      if (!el?.value.trim()){if(er)er.textContent=msg;el?.classList.add('error');ok=false;}
    });
    return ok;
  },

  _submitTrade() {
    if (!this._validate()) return;
    const rec={
      id:         this.editId??Utils.uid(),
      symbolCode: document.getElementById('f-code').value.trim(),
      symbolName: document.getElementById('f-name').value.trim(),
      date:       document.getElementById('f-date').value,
      account:    document.getElementById('f-account').value,
      side:       document.getElementById('f-side').value,
      shares:     parseFloat(document.getElementById('f-shares').value)||0,
      price:      parseFloat(document.getElementById('f-price').value)||0,
      amount:     parseFloat(document.getElementById('f-amount').value)||0,
      note:       document.getElementById('f-note').value.trim(),
      source:     'manual',
    };
    if (this.editId) {
      const i=this.trades.findIndex(t=>t.id===this.editId);
      if (i>=0) this.trades[i]=rec;
      Toast.show('取引を更新しました','success');
    } else { this.trades.push(rec); Toast.show('取引を登録しました','success'); }
    TradeStorage.save(this.trades);
    this.closeModal();
    if (this.page==='history') this._refreshHistory();
    else if (this.page==='dashboard') this.renderDashboard();
  },

  /* ============================================================
     Helpers
     ============================================================ */
  _accBadge(acc) {
    if (!acc) return '';
    const cls = acc.startsWith('新NISA')?'badge-nnisa':acc==='NISA'?'badge-nisa':'badge-acct';
    return `<span class="badge ${cls}">${acc}</span>`;
  },
  esc(s) { return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); },
  _empty(title, sub) {
    return `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg><h3>${title}</h3><p>${sub}</p></div>`;
  },
};

/* ============================================================
   Boot
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => App.init());
