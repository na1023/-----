'use strict';

/* ===== Storage ===== */
const HoldingStorage = {
  KEY: 'kabu_holdings_v1',
  QUOTE_KEY: 'kabu_q_cache_v2',
  load()        { try { return JSON.parse(localStorage.getItem(this.KEY) ?? '[]'); } catch { return []; } },
  save(d)       { localStorage.setItem(this.KEY, JSON.stringify(d)); },
  loadQuotes()  { try { return JSON.parse(localStorage.getItem(this.QUOTE_KEY) ?? '{}'); } catch { return {}; } },
  saveQuotes(d) { localStorage.setItem(this.QUOTE_KEY, JSON.stringify(d)); },
};

const DividendStorage = {
  KEY: 'kabu_divs_v2',
  load()   { try { return JSON.parse(localStorage.getItem(this.KEY) ?? '{}'); } catch { return {}; } },
  save(d)  { localStorage.setItem(this.KEY, JSON.stringify(d)); },
};

/* ===== Helpers ===== */
function uid() { return (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)); }

function yen(n, dec = 0) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const str = abs.toLocaleString('ja-JP', { maximumFractionDigits: dec });
  return (n < 0 ? '-' : '') + '¥' + str;
}
function pct(n, sign = true) {
  if (n == null || isNaN(n)) return '—';
  return (sign && n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function num(n) { return n == null ? '—' : n.toLocaleString('ja-JP'); }
function sc(n) { return n > 0 ? 'gain' : n < 0 ? 'loss' : 'neutral'; }
function sg(n) { return n > 0 ? '+' : ''; }
function badge(n) {
  if (n > 0) return `<span class="badge-gain">${sg(n)}${pct(n)}</span>`;
  if (n < 0) return `<span class="badge-loss">${pct(n)}</span>`;
  return `<span class="badge-neu">0.00%</span>`;
}

/* ===== Toast ===== */
const Toast = {
  show(msg, type = 'info', ms = 3000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-wrap').appendChild(el);
    setTimeout(() => el.remove(), ms);
  },
};

/* ===== App ===== */
const App = {
  holdings: [],
  quotes: {},
  dividends: {},
  quoteTime: null,
  page: 'dashboard',
  divYear: new Date().getFullYear(),
  taxAfter: false,
  holdFilter: 'all',
  brokerFilter: 'all',
  _charts: {},
  _editId: null,
  _acTimer: null,

  async init() {
    this.holdings  = HoldingStorage.load();
    this.quotes    = HoldingStorage.loadQuotes();
    this.dividends = DividendStorage.load();

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

    // Nav
    document.querySelectorAll('[data-page]').forEach(btn =>
      btn.addEventListener('click', () => this.navigate(btn.dataset.page)));

    // Add buttons
    ['sidebarAddBtn', 'topbarAddBtn'].forEach(id =>
      document.getElementById(id)?.addEventListener('click', () => this.openModal()));

    // Modal
    document.getElementById('modal-close').addEventListener('click',  () => this.closeModal());
    document.getElementById('modal-cancel').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') this.closeModal(); });
    document.getElementById('modal-save').addEventListener('click', () => this.saveHolding());

    // Account tabs in modal
    document.querySelectorAll('#holding-modal .tab-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('#holding-modal .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('m-account').value = btn.dataset.val;
      }));

    // Autocomplete
    document.getElementById('m-code').addEventListener('input', () => this._onCodeInput());
    document.getElementById('m-name').addEventListener('input', () => this._onNameInput());

    // Refresh
    document.getElementById('btn-refresh').addEventListener('click', () => this.refreshQuotes());

    // Hash routing
    const hash = location.hash.replace('#', '');
    if (['dashboard','holdings','dividends','pnl','settings'].includes(hash)) this.page = hash;
    window.addEventListener('hashchange', () => {
      const p = location.hash.replace('#', '');
      if (p !== this.page) this.navigate(p, false);
    });

    Sync.init();
    this.navigate(this.page, false);

    if (this.holdings.length > 0) {
      await this._fetchQuotes(this.holdings.map(h => h.code), false);
      this._fixMissingNames();
      this.renderPage();
    }

    setInterval(() => this.refreshQuotes(), 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refreshQuotes(); });
  },

  navigate(page, updateHash = true) {
    this.page = page;
    if (updateHash) location.hash = page;
    document.querySelectorAll('[data-page]').forEach(el =>
      el.classList.toggle('active', el.dataset.page === page));
    const titles = { dashboard:'ダッシュボード', holdings:'保有銘柄', dividends:'配当金', pnl:'損益分析', settings:'設定' };
    document.getElementById('topbar-title').textContent = titles[page] ?? page;
    this.renderPage();
  },

  renderPage() {
    const fn = { dashboard: 'renderDashboard', holdings: 'renderHoldings', dividends: 'renderDividends', pnl: 'renderPnL', settings: 'renderSettings' }[this.page];
    if (fn) this[fn]();
  },

  /* ===== Sync badge ===== */
  _updateSyncBadge() {
    const el = document.getElementById('sync-badge');
    if (!el) return;
    el.className = 'sync-badge ' + (Sync.status === 'on' ? 'on' : 'off');
    el.title = Sync.status === 'on' ? `同期中 (${Sync.user?.email ?? ''})` : 'オフライン';
  },

  /* ===== Quote fetch ===== */
  async _fetchQuotes(codes, notify = true) {
    if (!codes.length) return;
    const btn = document.getElementById('btn-refresh');
    btn?.classList.add('spinning');
    try {
      const result = await YahooFinance.getQuotes(codes);
      Object.assign(this.quotes, result);
      this.quoteTime = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      HoldingStorage.saveQuotes(this.quotes);
      if (notify) Toast.show('株価を更新しました', 'success');
    } catch {
      if (notify) Toast.show('株価取得に失敗しました', 'error');
    } finally {
      btn?.classList.remove('spinning');
    }
  },

  async refreshQuotes() {
    if (!this.holdings.length) return;
    await this._fetchQuotes(this.holdings.map(h => h.code));
    this.renderPage();
  },

  // 銘柄名がコードになっている保有株の名前をYahoo検索で修正
  async _fixMissingNames() {
    const broken = this.holdings.filter(h => !h.name || h.name === h.code);
    if (!broken.length) return;
    let fixed = false;
    for (const h of broken) {
      try {
        const results = await YahooFinance.searchSymbol(h.code);
        const match = results.find(r => r.code === h.code) ?? results[0];
        if (match?.name && match.name !== h.code) {
          const idx = this.holdings.findIndex(x => x.id === h.id);
          if (idx >= 0) { this.holdings[idx].name = match.name; fixed = true; }
        }
      } catch { /* silent */ }
    }
    if (fixed) { HoldingStorage.save(this.holdings); this.renderPage(); }
  },

  /* ===== Dashboard ===== */
  renderDashboard() {
    const enriched = Portfolio.calcAll(this.holdings, this.quotes);
    const sum      = Portfolio.summary(enriched);
    const annDiv   = this._annualDivEstimate();

    const el = document.getElementById('page-area');
    el.innerHTML = `
      <div class="summary-grid">
        ${this._summaryCard('総評価額', yen(sum.totalValue), `取得総額 ${yen(sum.totalCost)}`, '')}
        ${this._summaryCard('評価損益', `<span class="${sc(sum.pnl)}">${sg(sum.pnl)}${yen(sum.pnl)}</span>`, `<span class="${sc(sum.pnl)}">${sg(sum.pnlPct)}${pct(sum.pnlPct)}</span>`, '')}
        ${this._summaryCard('本日の変動', `<span class="${sc(sum.dayChg)}">${sg(sum.dayChg)}${yen(sum.dayChg)}</span>`, '前日比', '')}
        ${this._summaryCard('年間配当見込み', yen(annDiv), '税引前・保有株数ベース', '')}
      </div>

      <div class="dash-mid">
        <div class="card">
          <div class="card-title">ポートフォリオ構成</div>
          <div class="chart-wrap"><canvas id="chart-alloc"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
            保有銘柄
            <span style="font-size:.75rem;color:var(--text-3);font-weight:400">${this.quoteTime ? `更新 ${this.quoteTime}` : 'データ未取得'}</span>
          </div>
          <div class="holdings-mini" id="dash-mini"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">銘柄別 評価損益</div>
        <div style="height:220px"><canvas id="chart-pnl-bar"></canvas></div>
      </div>
    `;

    if (!enriched.length) {
      el.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
          <h3>まだ銘柄が登録されていません</h3>
          <p>「+ 追加」から保有銘柄を登録してください</p>
          <button class="btn-primary-lg" onclick="App.openModal()">銘柄を追加する</button>
        </div>`;
      return;
    }

    // Mini list
    const miniEl = document.getElementById('dash-mini');
    if (miniEl) {
      miniEl.innerHTML = enriched.slice(0, 8).map(h => `
        <div class="mini-row">
          <div class="mini-info">
            <span class="mini-code">${h.code}</span>
            <span class="mini-name">${h.name}</span>
          </div>
          <div class="mini-pnl">
            <div class="mini-pnl-val ${sc(h.pnl)}">${sg(h.pnl)}${yen(h.pnl)}</div>
            <div class="mini-pnl-pct ${sc(h.pnlPct)}">${sg(h.pnlPct)}${pct(h.pnlPct)}</div>
          </div>
        </div>`).join('');
    }

    this._destroyChart('alloc');
    this._destroyChart('pnl-bar');

    // Allocation donut
    const topH = enriched.sort((a, b) => b.value - a.value);
    this._charts['alloc'] = new Chart(document.getElementById('chart-alloc'), {
      type: 'doughnut',
      data: {
        labels: topH.map(h => h.name || h.code),
        datasets: [{
          data: topH.map(h => h.value),
          backgroundColor: ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0284c7','#db2777','#65a30d','#ea580c','#0891b2'],
          borderWidth: 2, borderColor: '#fff',
        }],
      },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } }, cutout: '65%' },
    });

    // P&L bar
    const sorted = [...enriched].sort((a, b) => b.pnl - a.pnl);
    this._charts['pnl-bar'] = new Chart(document.getElementById('chart-pnl-bar'), {
      type: 'bar',
      data: {
        labels: sorted.map(h => h.name || h.code),
        datasets: [{
          data: sorted.map(h => h.pnl),
          backgroundColor: sorted.map(h => h.pnl >= 0 ? 'rgba(22,163,74,.75)' : 'rgba(220,38,38,.75)'),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { callback: v => yen(v), font: { size: 11 } }, grid: { color: '#f1f5f9' } },
          y: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
  },

  _summaryCard(title, value, sub, extra) {
    return `<div class="card summary-card">
      <div class="card-title">${title}</div>
      <div class="card-value">${value}</div>
      <div class="card-sub">${sub}</div>${extra}
    </div>`;
  },

  _annualDivEstimate() {
    const year = new Date().getFullYear();
    let total = 0;
    Object.values(this.dividends).forEach(divs => {
      (divs || []).filter(d => String(d.date) >= `${year - 1}-01-01`).forEach(d => {
        total += d.gross ?? 0;
      });
    });
    return total;
  },

  /* ===== Holdings ===== */
  _BROKERS: ['SBI証券', '楽天証券', '松井証券', 'マネックス証券', 'その他'],

  renderHoldings() {
    const enriched  = Portfolio.calcAll(this.holdings, this.quotes);
    const brokers   = ['all', ...this._BROKERS.filter(b => enriched.some(h => (h.broker||'その他') === b))];
    const byBroker  = this.brokerFilter === 'all' ? enriched : enriched.filter(h => (h.broker||'その他') === this.brokerFilter);
    const filtered  = this.holdFilter === 'all' ? byBroker : byBroker.filter(h => h.account === this.holdFilter);

    // グループ: brokerFilter=allのとき証券会社ごとに分割表示
    const groups = this.brokerFilter === 'all'
      ? this._BROKERS.filter(b => enriched.some(h => (h.broker||'その他') === b))
          .map(b => ({ broker: b, items: filtered.filter(h => (h.broker||'その他') === b) }))
          .filter(g => g.items.length)
      : [{ broker: this.brokerFilter, items: filtered }];

    const el = document.getElementById('page-area');
    el.innerHTML = `
      <div class="page-hdr">
        <h2>保有銘柄 <span style="font-size:.875rem;font-weight:500;color:var(--text-2)">${this.holdings.length}件</span></h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn-ghost" onclick="App.triggerCsvImport()" style="display:flex;align-items:center;gap:5px;font-size:.8125rem;padding:7px 12px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            CSV取込
          </button>
          <button class="btn-primary-sm" onclick="App.openModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            追加
          </button>
        </div>
      </div>

      <!-- 証券会社フィルタ -->
      <div class="broker-filter-bar">
        ${brokers.map(b => `
          <button class="broker-tab ${this.brokerFilter===b?'active':''}" onclick="App.setBrokerFilter('${b}')">
            ${b === 'all' ? '全て' : `<span class="broker-dot broker-dot-${this._brokerKey(b)}"></span>${b}`}
          </button>`).join('')}
      </div>

      <!-- 口座フィルタ -->
      <div class="filter-tabs" style="margin-bottom:16px">
        ${['all','特定','NISA','一般'].map(k =>
          `<button class="filter-tab ${this.holdFilter===k?'active':''}" onclick="App.setHoldFilter('${k}')">${k==='all'?'全口座':k}</button>`
        ).join('')}
      </div>

      ${!filtered.length ? `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
        <h3>銘柄がありません</h3><p>「+ 追加」から登録してください</p>
        <button class="btn-primary-lg" onclick="App.openModal()">銘柄を追加する</button>
      </div>` : groups.map(g => this._renderBrokerGroup(g)).join('')}
    `;
  },

  _brokerKey(b) {
    return { 'SBI証券':'sbi','楽天証券':'rakuten','松井証券':'matsui','マネックス証券':'monex','その他':'other' }[b] ?? 'other';
  },

  _renderBrokerGroup(g) {
    const totalVal  = g.items.reduce((s,h) => s+h.value, 0);
    const totalPnl  = g.items.reduce((s,h) => s+h.pnl, 0);
    const totalDay  = g.items.reduce((s,h) => s+h.dayChg, 0);
    return `
      <div class="broker-group" style="margin-bottom:24px">
        <div class="broker-group-hdr">
          <span class="broker-dot broker-dot-${this._brokerKey(g.broker)}"></span>
          <span class="broker-group-name">${g.broker}</span>
          <span class="broker-group-stats">
            <span>${yen(totalVal)}</span>
            <span class="${sc(totalPnl)}" style="margin-left:8px">${sg(totalPnl)}${yen(totalPnl)} (${sg(totalPnl)}${pct(totalVal>0?(totalPnl/(totalVal-totalPnl)*100):0)})</span>
          </span>
        </div>

        <!-- PC Table -->
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>銘柄</th>
              <th class="num">株数</th>
              <th class="num">取得単価</th>
              <th class="num">現在値</th>
              <th class="num">評価額</th>
              <th class="num">評価損益</th>
              <th class="num">前日比</th>
              <th>口座</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${g.items.map(h => `<tr>
                <td>
                  <div style="font-size:.75rem;color:var(--text-3)">${h.code}</div>
                  <div style="font-weight:600">${h.name}</div>
                  ${h.memo ? `<div style="font-size:.75rem;color:var(--text-3)">${h.memo}</div>` : ''}
                </td>
                <td class="num">${num(h.shares)}</td>
                <td class="num">${yen(h.avgCost,1)}</td>
                <td class="num">${h.price!==h.avgCost ? yen(h.price,1) : '<span style="color:var(--text-3)">未取得</span>'}</td>
                <td class="num">${yen(h.value)}</td>
                <td class="num">
                  <span class="${sc(h.pnl)}" style="font-weight:700">${sg(h.pnl)}${yen(h.pnl)}</span>
                  <div class="${sc(h.pnlPct)}" style="font-size:.75rem">${sg(h.pnlPct)}${pct(h.pnlPct)}</div>
                </td>
                <td class="num">
                  <span class="${sc(h.dayChg)}">${sg(h.dayChg)}${yen(h.dayChg)}</span>
                  <div class="${sc(h.dayChgPct)}" style="font-size:.75rem">${sg(h.dayChgPct)}${pct(h.dayChgPct)}</div>
                </td>
                <td><span class="account-badge ${h.account}">${h.account}</span></td>
                <td>
                  <button class="action-btn" onclick="App.openModal('${h.id}')" title="編集">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="action-btn del" onclick="App.deleteHolding('${h.id}')" title="削除">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                </td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr class="tfoot-row">
              <td colspan="4">${g.broker} 合計</td>
              <td class="num">${yen(totalVal)}</td>
              <td class="num"><span class="${sc(totalPnl)}">${sg(totalPnl)}${yen(totalPnl)}</span></td>
              <td class="num"><span class="${sc(totalDay)}">${sg(totalDay)}${yen(totalDay)}</span></td>
              <td colspan="2"></td>
            </tr></tfoot>
          </table>
        </div>

        <!-- Mobile Cards -->
        <div class="holdings-cards">
          ${g.items.map(h => `
            <div class="holding-card">
              <div class="hc-top">
                <div class="hc-info">
                  <div class="hc-code">${h.code} <span class="account-badge ${h.account}">${h.account}</span></div>
                  <div class="hc-name">${h.name}</div>
                  ${h.memo ? `<div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${h.memo}</div>` : ''}
                </div>
                <div class="hc-pnl">
                  <div class="hc-pnl-val ${sc(h.pnl)}">${sg(h.pnl)}${yen(h.pnl)}</div>
                  <div class="hc-pnl-pct ${sc(h.pnlPct)}">${sg(h.pnlPct)}${pct(h.pnlPct)}</div>
                </div>
              </div>
              <div class="hc-grid">
                <div class="hc-stat"><div class="hc-label">株数</div><div class="hc-value">${num(h.shares)}</div></div>
                <div class="hc-stat"><div class="hc-label">取得単価</div><div class="hc-value">${yen(h.avgCost,1)}</div></div>
                <div class="hc-stat"><div class="hc-label">現在値</div><div class="hc-value ${h.price!==h.avgCost?'':'neutral'}">${h.price!==h.avgCost?yen(h.price,1):'未取得'}</div></div>
                <div class="hc-stat"><div class="hc-label">評価額</div><div class="hc-value">${yen(h.value)}</div></div>
                <div class="hc-stat"><div class="hc-label">前日比</div><div class="hc-value ${sc(h.dayChg)}">${sg(h.dayChg)}${yen(h.dayChg)}</div></div>
                <div class="hc-stat"><div class="hc-label">前日比率</div><div class="hc-value ${sc(h.dayChgPct)}">${sg(h.dayChgPct)}${pct(h.dayChgPct)}</div></div>
              </div>
              <div class="hc-actions">
                <button class="action-btn" onclick="App.openModal('${h.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  編集
                </button>
                <button class="action-btn del" onclick="App.deleteHolding('${h.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  削除
                </button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  },

  setHoldFilter(f)   { this.holdFilter = f;   this.renderHoldings(); },
  setBrokerFilter(b) { this.brokerFilter = b;  this.renderHoldings(); },

  /* ===== CSV Import ===== */
  triggerCsvImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => this._parseCsvHoldings(ev.target.result, file.name);
      reader.readAsText(file, 'Shift_JIS');
    });
    input.click();
  },

  _parseCsvHoldings(rawText, filename) {
    // BOM除去
    const text = rawText.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);

    // ブローカー自動判定
    const broker = this._detectBroker(text, filename);
    Toast.show(`${broker}形式で読み込み中…`, 'info', 2000);

    let parsed = [];
    if      (broker === 'SBI')     parsed = this._parseSBI(lines);
    else if (broker === '楽天')    parsed = this._parseRakuten(lines);
    else if (broker === '松井')    parsed = this._parseMatsui(lines);
    else if (broker === 'マネックス') parsed = this._parseMonex(lines);
    else                           parsed = this._parseGeneric(lines);

    if (!parsed.length) {
      Toast.show('有効な銘柄が見つかりませんでした。対応: SBI・楽天・松井・マネックス保有一覧CSV', 'error', 6000);
      return;
    }

    const preview = parsed.slice(0, 5).map(h => `${h.code} ${h.name}  ${h.shares}株 @${h.avgCost || '—'}円 [${h.account}]`).join('\n');
    const more = parsed.length > 5 ? `\n…他 ${parsed.length - 5}件` : '';
    const mode = confirm(
      `【${broker}】${parsed.length}件を検出:\n\n${preview}${more}\n\nOK = 既存に追加\nキャンセル = 全て置き換え`
    ) ? 'append' : 'replace';

    if (mode === 'replace') {
      if (!confirm('既存の保有銘柄を全て削除して置き換えますか？')) return;
      this.holdings = [];
    }

    // ブローカー名マッピング
    const brokerName = { 'SBI':'SBI証券', '楽天':'楽天証券', '松井':'松井証券', 'マネックス':'マネックス証券', '汎用':'その他' }[broker] ?? 'その他';

    let added = 0;
    parsed.forEach(h => {
      const exists = this.holdings.find(x => x.code === h.code && x.account === h.account && (x.broker||'その他') === brokerName);
      if (exists) {
        exists.shares    = h.shares;
        exists.avgCost   = h.avgCost;
        exists.name      = h.name || exists.name;
        exists.broker    = brokerName;
        exists.updatedAt = Date.now();
      } else {
        this.holdings.push({ id: uid(), ...h, broker: brokerName, memo: '', addedAt: Date.now(), updatedAt: Date.now() });
        added++;
      }
    });

    HoldingStorage.save(this.holdings);
    Sync.push();
    Toast.show(`インポート完了：新規${added}件・更新${parsed.length - added}件`, 'success', 5000);

    const codes = [...new Set(parsed.map(h => h.code))];
    this._fetchQuotes(codes, false).then(() => { this._fixMissingNames(); this.renderPage(); });
    this.renderPage();
  },

  _detectBroker(text, filename) {
    const t = text.slice(0, 500) + (filename || '');
    if (/SBI|sbi|エスビーアイ/i.test(t) || /預り区分|株式（特定|株式（一般|株式（NISA/.test(t)) return 'SBI';
    if (/楽天証券|rakuten/i.test(t) || /お預り/.test(t)) return '楽天';
    if (/松井証券|matsui/i.test(t) || /建玉/.test(t)) return '松井';
    if (/マネックス|monex/i.test(t)) return 'マネックス';
    return '汎用';
  },

  /* SBI証券 保有証券一覧CSV */
  _parseSBI(lines) {
    const accountMap = { '特定預り':'特定','一般預り':'一般','NISA預り':'NISA','成長投資枠':'NISA','積立投資枠':'NISA' };
    let account = '特定', headerIdx = -1;
    let codeCol = -1, nameCol = -1, sharesCol = -1, costCol = -1;
    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const [k, v] of Object.entries(accountMap)) { if (line.includes(k)) account = v; }

      if (headerIdx < 0 && (line.includes('銘柄コード') || line.includes('コード'))) {
        const cols = this._splitCsv(line);
        codeCol   = cols.findIndex(c => /銘柄コード|コード/.test(c));
        nameCol   = cols.findIndex(c => /銘柄名|銘柄/.test(c) && !/コード/.test(c));
        sharesCol = cols.findIndex(c => /保有株数|株数|数量/.test(c));
        costCol   = cols.findIndex(c => /取得単価|平均取得/.test(c));
        if (codeCol >= 0 && sharesCol >= 0) headerIdx = i;
        continue;
      }
      if (headerIdx < 0) continue;
      const cols = this._splitCsv(line);
      const h = this._extractHolding(cols, codeCol, nameCol, sharesCol, costCol, account);
      if (h) result.push(h);
    }
    return result;
  },

  /* 楽天証券 保有株式一覧CSV */
  _parseRakuten(lines) {
    let headerIdx = -1;
    let codeCol = -1, nameCol = -1, sharesCol = -1, costCol = -1, accountCol = -1;
    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (headerIdx < 0 && /銘柄コード|コード|証券コード/.test(line)) {
        const cols = this._splitCsv(line);
        codeCol    = cols.findIndex(c => /銘柄コード|コード|証券コード/.test(c));
        nameCol    = cols.findIndex(c => /銘柄名|銘柄/.test(c) && !/コード/.test(c));
        sharesCol  = cols.findIndex(c => /保有数量|数量|株数/.test(c));
        costCol    = cols.findIndex(c => /平均取得単価|取得単価|平均単価/.test(c));
        accountCol = cols.findIndex(c => /口座|預り区分/.test(c));
        if (codeCol >= 0 && sharesCol >= 0) headerIdx = i;
        continue;
      }
      if (headerIdx < 0) continue;
      const cols   = this._splitCsv(line);
      const accRaw = accountCol >= 0 ? cols[accountCol] ?? '' : '';
      const account = /NISA|成長|積立/.test(accRaw) ? 'NISA' : /一般/.test(accRaw) ? '一般' : '特定';
      const h = this._extractHolding(cols, codeCol, nameCol, sharesCol, costCol, account);
      if (h) result.push(h);
    }
    return result;
  },

  /* 松井証券 */
  _parseMatsui(lines) {
    let headerIdx = -1;
    let codeCol = -1, nameCol = -1, sharesCol = -1, costCol = -1;
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (headerIdx < 0 && /銘柄コード|コード/.test(line)) {
        const cols = this._splitCsv(line);
        codeCol   = cols.findIndex(c => /銘柄コード|コード/.test(c));
        nameCol   = cols.findIndex(c => /銘柄名|銘柄/.test(c) && !/コード/.test(c));
        sharesCol = cols.findIndex(c => /保有株数|株数|数量|残高/.test(c));
        costCol   = cols.findIndex(c => /平均取得単価|取得単価|取得コスト/.test(c));
        if (codeCol >= 0 && sharesCol >= 0) headerIdx = i;
        continue;
      }
      if (headerIdx < 0) continue;
      const h = this._extractHolding(this._splitCsv(line), codeCol, nameCol, sharesCol, costCol, '特定');
      if (h) result.push(h);
    }
    return result;
  },

  /* マネックス証券 */
  _parseMonex(lines) {
    let headerIdx = -1;
    let codeCol = -1, nameCol = -1, sharesCol = -1, costCol = -1, accountCol = -1;
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (headerIdx < 0 && /銘柄コード|コード/.test(line)) {
        const cols = this._splitCsv(line);
        codeCol    = cols.findIndex(c => /銘柄コード|コード/.test(c));
        nameCol    = cols.findIndex(c => /銘柄名|銘柄/.test(c) && !/コード/.test(c));
        sharesCol  = cols.findIndex(c => /保有数量|数量|株数/.test(c));
        costCol    = cols.findIndex(c => /取得単価|平均取得/.test(c));
        accountCol = cols.findIndex(c => /口座種別|口座区分/.test(c));
        if (codeCol >= 0 && sharesCol >= 0) headerIdx = i;
        continue;
      }
      if (headerIdx < 0) continue;
      const cols   = this._splitCsv(line);
      const accRaw = accountCol >= 0 ? cols[accountCol] ?? '' : '';
      const account = /NISA/.test(accRaw) ? 'NISA' : /一般/.test(accRaw) ? '一般' : '特定';
      const h = this._extractHolding(cols, codeCol, nameCol, sharesCol, costCol, account);
      if (h) result.push(h);
    }
    return result;
  },

  /* 汎用フォーマット（銘柄コード列を自動検出） */
  _parseGeneric(lines) {
    let headerIdx = -1;
    let codeCol = -1, nameCol = -1, sharesCol = -1, costCol = -1;
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = this._splitCsv(lines[i]);
      if (headerIdx < 0) {
        const ci = cols.findIndex(c => /コード|code/i.test(c));
        const si = cols.findIndex(c => /株数|数量|保有/i.test(c));
        if (ci >= 0 && si >= 0) {
          codeCol   = ci;
          nameCol   = cols.findIndex(c => /名|name/i.test(c) && !/コード/.test(c));
          sharesCol = si;
          costCol   = cols.findIndex(c => /単価|価格|コスト/i.test(c));
          headerIdx = i;
        }
        continue;
      }
      const h = this._extractHolding(cols, codeCol, nameCol, sharesCol, costCol, '特定');
      if (h) result.push(h);
    }
    return result;
  },

  _extractHolding(cols, codeCol, nameCol, sharesCol, costCol, account) {
    const code   = (codeCol >= 0 ? cols[codeCol] ?? '' : '').replace(/[^\d]/g, '');
    const name   = nameCol >= 0 ? (cols[nameCol] ?? '').trim() : '';
    const shares = sharesCol >= 0 ? parseFloat((cols[sharesCol] ?? '').replace(/,/g, '')) : 0;
    const cost   = costCol >= 0  ? parseFloat((cols[costCol]  ?? '').replace(/,/g, '')) : 0;
    if (!code || code.length < 4 || !shares || shares <= 0) return null;
    return { code, name: name || code, shares, avgCost: isNaN(cost) ? 0 : cost, account };
  },

  _splitCsv(line) {
    const result = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  },

  /* ===== Dividends ===== */
  renderDividends() {
    const year   = this.divYear;
    const years  = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
    const result = Portfolio.annualDividend(this.holdings, this.dividends, year, this.taxAfter);
    const months = Portfolio.monthlyDividend(this.holdings, this.dividends, year, this.taxAfter);
    const totalPre  = Portfolio.annualDividend(this.holdings, this.dividends, year, false).total;
    const totalPost = Portfolio.annualDividend(this.holdings, this.dividends, year, true).total;
    const hasAny = Object.keys(this.dividends).length > 0;

    const el = document.getElementById('page-area');
    el.innerHTML = `
      <div class="div-hdr">
        <div class="year-tabs">
          ${years.map(y => `<button class="year-tab ${y===year?'active':''}" onclick="App.setDivYear(${y})">${y}年</button>`).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="tax-toggle">
            <button class="tax-btn ${!this.taxAfter?'active':''}" onclick="App.setTax(false)">税引前</button>
            <button class="tax-btn ${this.taxAfter?'active':''}" onclick="App.setTax(true)">税引後</button>
          </div>
          <button class="btn-primary-sm" onclick="App.triggerDivCsvImport()" style="display:flex;align-items:center;gap:5px;font-size:.8125rem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            配当CSV取込
          </button>
          ${hasAny ? `<button class="btn-ghost" onclick="App.clearDividends()" style="font-size:.8125rem;padding:6px 12px;color:var(--loss)">配当データ削除</button>` : ''}
        </div>
      </div>

      <div class="div-summary">
        <div class="card">
          <div class="card-title">年間配当合計</div>
          <div class="card-value">${yen(result.total)}</div>
          <div class="card-sub">${this.taxAfter ? '税引後' : '税引前'}</div>
        </div>
        <div class="card">
          <div class="card-title">月平均</div>
          <div class="card-value">${yen(result.total / 12)}</div>
          <div class="card-sub">1ヶ月あたり</div>
        </div>
        <div class="card">
          <div class="card-title">税額概算</div>
          <div class="card-value loss">${yen(totalPre - totalPost)}</div>
          <div class="card-sub">約20.315%</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-title">月別配当金 (${year}年)</div>
        <div class="div-chart-wrap"><canvas id="chart-div"></canvas></div>
      </div>

      ${!hasAny ? `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        <h3>配当データがありません</h3>
        <p>「配当CSV取込」から証券会社の配当金履歴CSVを読み込んでください</p>
        <button class="btn-primary-lg" onclick="App.triggerDivCsvImport()">配当CSV取込</button>
      </div>` : result.byStock.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>銘柄</th><th>口座</th>
            <th class="num">保有株数</th><th class="num">1株配当</th>
            <th class="num">税引前</th><th class="num">税引後</th>
          </tr></thead>
          <tbody>
            ${result.byStock.map(s => `<tr>
              <td><div style="font-size:.75rem;color:var(--text-3)">${s.code}</div><div style="font-weight:600">${s.name}</div></td>
              <td><span class="account-badge ${s.account}">${s.account}</span></td>
              <td class="num">${num(s.shares)}</td>
              <td class="num">${yen(s.perShare,1)}</td>
              <td class="num">${yen(s.gross)}</td>
              <td class="num">${yen(s.net)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr class="tfoot-row">
            <td colspan="4">合計</td>
            <td class="num">${yen(totalPre)}</td>
            <td class="num">${yen(totalPost)}</td>
          </tr></tfoot>
        </table>
      </div>` : `<div class="card"><p style="color:var(--text-2);text-align:center;padding:32px">${year}年の配当データがありません</p></div>`}
    `;

    this._destroyChart('div');
    this._charts['div'] = new Chart(document.getElementById('chart-div'), {
      type: 'bar',
      data: {
        labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
        datasets: [{
          data: months,
          backgroundColor: months.map(v => v > 0 ? 'rgba(37,99,235,.75)' : 'rgba(203,213,225,.5)'),
          borderRadius: 5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { ticks: { callback: v => yen(v), font: { size: 11 } }, grid: { color: '#f1f5f9' }, min: 0 },
        },
      },
    });
  },

  setDivYear(y) { this.divYear = y; this.renderDividends(); },
  setTax(after) { this.taxAfter = after; this.renderDividends(); },

  triggerDivCsvImport() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv,text/csv';
    input.onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => this._parseDivCsv(ev.target.result, file.name);
      reader.onerror = () => Toast.show('ファイル読み込みエラー', 'error');
      // Shift_JIS対応
      reader.readAsText(file, 'Shift_JIS');
    };
    input.click();
  },

  _parseDivCsv(rawText, filename) {
    // UTF-8フォールバック（文字化けを検知）
    const text = rawText.includes('�') ? rawText : rawText;
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) { Toast.show('CSVが空です', 'error'); return; }

    let headerIdx = -1, dateCol = -1, codeCol = -1, nameCol = -1;
    let grossCol = -1, netCol = -1, perShareCol = -1, sharesCol = -1;

    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const cols = this._splitCsv(lines[i]);
      // ヘッダー行の検出
      const hasDivKey = cols.some(c => /受取日|入金日|支払日|配当|dividend/i.test(c));
      if (!hasDivKey) continue;
      dateCol     = cols.findIndex(c => /受取日|入金日|支払日|決済日/i.test(c));
      codeCol     = cols.findIndex(c => /銘柄コード|証券コード|コード/i.test(c));
      nameCol     = cols.findIndex(c => /銘柄名|銘柄/i.test(c) && !/コード/.test(c));
      perShareCol = cols.findIndex(c => /単価|1株|一株/i.test(c));
      sharesCol   = cols.findIndex(c => /数量|株数/i.test(c));
      grossCol    = cols.findIndex(c => /税引前|配当金額.*税引前|gross/i.test(c));
      netCol      = cols.findIndex(c => /税引後|配当金額.*税引後|net/i.test(c));
      if (dateCol >= 0 && (codeCol >= 0 || grossCol >= 0)) { headerIdx = i; break; }
    }

    if (headerIdx < 0) {
      Toast.show('配当CSVの形式を認識できませんでした。SBI証券・楽天証券の配当金履歴CSVに対応しています', 'error', 6000);
      return;
    }

    const parsed = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = this._splitCsv(lines[i]);
      if (cols.length < 2) continue;

      const rawDate = dateCol >= 0 ? (cols[dateCol] ?? '') : '';
      const dateStr = rawDate.replace(/\//g, '-').replace(/年|月/g, '-').replace(/日/, '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

      const code  = codeCol >= 0 ? (cols[codeCol] ?? '').replace(/[^\d]/g, '') : '';
      const name  = nameCol >= 0 ? (cols[nameCol] ?? '').trim() : '';
      const gross = grossCol >= 0    ? parseFloat((cols[grossCol] ?? '').replace(/,/g, '')) : NaN;
      const net   = netCol >= 0      ? parseFloat((cols[netCol]   ?? '').replace(/,/g, '')) : NaN;
      const perShare = perShareCol >= 0 ? parseFloat((cols[perShareCol] ?? '').replace(/,/g, '')) : NaN;

      if (!code || code.length < 4) continue;
      if (isNaN(gross) && isNaN(net)) continue;

      parsed.push({
        code, name, date: dateStr,
        gross:    isNaN(gross) ? 0 : gross,
        net:      isNaN(net)   ? 0 : net,
        perShare: isNaN(perShare) ? 0 : perShare,
      });
    }

    if (!parsed.length) { Toast.show('配当データが見つかりませんでした', 'error'); return; }

    // 既存に追加 or 年ごと置換を選択
    const preview = [...new Set(parsed.map(d => d.code))].slice(0, 5).join(', ');
    const mode = confirm(
      `配当データ ${parsed.length}件を検出:\n銘柄: ${preview}…\n\nOK = 既存に追加（重複は上書き）\nキャンセル = キャンセル`
    );
    if (!mode) return;

    let added = 0, updated = 0;
    parsed.forEach(d => {
      if (!this.dividends[d.code]) this.dividends[d.code] = [];
      const arr = this.dividends[d.code];
      const existIdx = arr.findIndex(x => x.date === d.date);
      if (existIdx >= 0) { arr[existIdx] = d; updated++; }
      else               { arr.push(d); added++; }
      // 銘柄名も更新（コードのままになっている場合）
      if (d.name) {
        const h = this.holdings.find(h => h.code === d.code);
        if (h && (!h.name || h.name === h.code)) h.name = d.name;
      }
    });

    DividendStorage.save(this.dividends);
    HoldingStorage.save(this.holdings);
    Sync.push();
    Toast.show(`配当データ取込完了：新規${added}件・更新${updated}件`, 'success', 5000);
    this.renderDividends();
  },

  clearDividends() {
    if (!confirm('配当データを全て削除しますか？')) return;
    this.dividends = {};
    DividendStorage.save({});
    Toast.show('配当データを削除しました', 'info');
    this.renderDividends();
  },

  /* ===== P&L ===== */
  renderPnL() {
    const enriched = Portfolio.calcAll(this.holdings, this.quotes);
    const sum      = Portfolio.summary(enriched);
    const sorted   = [...enriched].sort((a, b) => b.pnl - a.pnl);

    const el = document.getElementById('page-area');
    el.innerHTML = `
      <div class="pnl-grid">
        <div class="card">
          <div class="card-title">含み損益合計</div>
          <div class="card-value ${sc(sum.pnl)}">${sg(sum.pnl)}${yen(sum.pnl)}</div>
          <div class="card-sub ${sc(sum.pnlPct)}">${sg(sum.pnlPct)}${pct(sum.pnlPct)}</div>
        </div>
        <div class="card">
          <div class="card-title">本日の変動</div>
          <div class="card-value ${sc(sum.dayChg)}">${sg(sum.dayChg)}${yen(sum.dayChg)}</div>
          <div class="card-sub">前日比 合計</div>
        </div>
        <div class="card">
          <div class="card-title">取得総額</div>
          <div class="card-value">${yen(sum.totalCost)}</div>
          <div class="card-sub">現在 ${yen(sum.totalValue)}</div>
        </div>
      </div>

      ${enriched.length ? `
      <div class="card" style="margin-bottom:20px">
        <div class="card-title">銘柄別 評価損益</div>
        <div class="pnl-chart-wrap"><canvas id="chart-pnl-h"></canvas></div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>銘柄</th>
            <th class="num">現在値</th>
            <th class="num">取得単価</th>
            <th class="num">株数</th>
            <th class="num">評価損益</th>
            <th class="num">損益率</th>
            <th class="num">前日比(株)</th>
            <th class="num">前日比率</th>
          </tr></thead>
          <tbody>
            ${sorted.map(h => `<tr>
              <td>
                <div style="font-size:.75rem;color:var(--text-3)">${h.code}</div>
                <div style="font-weight:600">${h.name}</div>
              </td>
              <td class="num">${h.price !== h.avgCost ? yen(h.price,1) : '<span style="color:var(--text-3)">未取得</span>'}</td>
              <td class="num">${yen(h.avgCost,1)}</td>
              <td class="num">${num(h.shares)}</td>
              <td class="num"><span class="${sc(h.pnl)}" style="font-weight:700">${sg(h.pnl)}${yen(h.pnl)}</span></td>
              <td class="num">${badge(h.pnlPct)}</td>
              <td class="num"><span class="${sc(h.dayChg)}">${sg(h.dayChg)}${yen(h.dayChg)}</span></td>
              <td class="num">${badge(h.dayChgPct)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state"><h3>銘柄を登録してください</h3></div>`}
    `;

    if (!enriched.length) return;
    this._destroyChart('pnl-h');
    this._charts['pnl-h'] = new Chart(document.getElementById('chart-pnl-h'), {
      type: 'bar',
      data: {
        labels: sorted.map(h => h.name || h.code),
        datasets: [{
          label: '評価損益',
          data: sorted.map(h => h.pnl),
          backgroundColor: sorted.map(h => h.pnl >= 0 ? 'rgba(22,163,74,.75)' : 'rgba(220,38,38,.75)'),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { callback: v => yen(v), font: { size: 11 } }, grid: { color: '#f1f5f9' } },
          y: { ticks: { font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
  },

  /* ===== Settings ===== */
  renderSettings() {
    this._updateSyncBadge();
    const user = Sync.user;
    const st   = Sync.status;

    const el = document.getElementById('page-area');
    el.innerHTML = `
      <div class="settings-section">
        <h3>クラウド同期</h3>
        ${user ? `
          <div class="settings-row">
            <div><div class="settings-label">ログイン中</div><div class="settings-sub">${user.email || 'Google アカウント'}</div></div>
            <span class="sync-on">● 同期中</span>
          </div>
          <div class="settings-row">
            <div class="settings-label">ログアウト</div>
            <button class="btn-ghost" onclick="Sync.logout()">ログアウト</button>
          </div>` : `
          <p style="font-size:.875rem;color:var(--text-2);margin-bottom:16px">ログインするとデータが複数端末で同期されます</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button class="btn-google" onclick="Sync.loginGoogle()">
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M47.5 24.6c0-1.6-.1-3.1-.4-4.6H24v8.7h13.1c-.6 3-2.3 5.5-4.9 7.2v6h7.9c4.6-4.2 7.4-10.5 7.4-17.3z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.9-6c-2.1 1.4-4.9 2.3-8 2.3-6.1 0-11.3-4.1-13.2-9.7H2.7v6.2C6.6 42.6 14.7 48 24 48z"/><path fill="#FBBC05" d="M10.8 28.8c-.5-1.4-.7-2.9-.7-4.8s.3-3.3.7-4.8V13H2.7C1 16.4 0 20.1 0 24s1 7.6 2.7 11L10.8 28.8z"/><path fill="#EA4335" d="M24 9.5c3.4 0 6.5 1.2 8.9 3.5l6.7-6.7C35.9 2.5 30.4 0 24 0 14.7 0 6.6 5.4 2.7 13l8.1 6.2C12.7 13.6 17.9 9.5 24 9.5z"/></svg>
              Googleでログイン
            </button>
            <div class="or-divider">または</div>
            <div id="email-form" style="display:flex;flex-direction:column;gap:8px">
              <input class="form-input" id="set-email" type="email" placeholder="メールアドレス">
              <input class="form-input" id="set-pw" type="password" placeholder="パスワード（6文字以上）">
              <div style="display:flex;gap:8px">
                <button class="btn-ghost" style="flex:1" onclick="App._emailLogin()">ログイン</button>
                <button class="btn-primary-sm" style="flex:1;justify-content:center" onclick="App._emailSignup()">新規登録</button>
              </div>
            </div>
          </div>`}
      </div>

      <div class="settings-section">
        <h3>データ管理</h3>
        <div class="settings-row">
          <div><div class="settings-label">データをエクスポート</div><div class="settings-sub">保有銘柄をJSONで保存</div></div>
          <button class="btn-ghost" onclick="App.exportData()">エクスポート</button>
        </div>
        <div class="settings-row">
          <div><div class="settings-label">株価キャッシュを削除</div><div class="settings-sub">次回起動時に再取得されます</div></div>
          <button class="btn-ghost" onclick="App.clearQuoteCache()">削除</button>
        </div>
        <div class="settings-row">
          <div><div class="settings-label" style="color:var(--loss)">全データを削除</div><div class="settings-sub">保有銘柄を全て消去します</div></div>
          <button class="btn-danger" onclick="App.clearAll()">全削除</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>アプリ情報</h3>
        <div class="settings-row">
          <div class="settings-label">株価更新</div>
          <span style="font-size:.875rem;color:var(--text-2)">15分間隔・自動</span>
        </div>
        <div class="settings-row">
          <div class="settings-label">最終更新</div>
          <span style="font-size:.875rem;color:var(--text-2)">${this.quoteTime ?? 'データ未取得'}</span>
        </div>
        <div class="settings-row">
          <div class="settings-label">登録銘柄数</div>
          <span style="font-size:.875rem;color:var(--text-2)">${this.holdings.length} 銘柄</span>
        </div>
      </div>
    `;
  },

  _emailLogin()  { Sync.loginEmail(document.getElementById('set-email').value, document.getElementById('set-pw').value); },
  _emailSignup() { Sync.signupEmail(document.getElementById('set-email').value, document.getElementById('set-pw').value); },

  /* ===== Modal ===== */
  openModal(id = null) {
    this._editId = id;
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-title').textContent = id ? '銘柄を編集' : '銘柄を追加';

    // Reset form
    ['m-code','m-name','m-shares','m-avg-cost','m-memo'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('m-id').value = '';
    document.getElementById('m-account').value = '特定';
    document.querySelectorAll('#holding-modal .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.val === '特定'));

    if (id) {
      const h = this.holdings.find(h => h.id === id);
      if (h) {
        document.getElementById('m-code').value     = h.code;
        document.getElementById('m-name').value     = h.name;
        document.getElementById('m-shares').value   = h.shares;
        document.getElementById('m-avg-cost').value = h.avgCost;
        document.getElementById('m-memo').value     = h.memo ?? '';
        document.getElementById('m-id').value       = h.id;
        document.getElementById('m-account').value  = h.account;
        document.querySelectorAll('#holding-modal .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.val === h.account));
        if (document.getElementById('m-broker')) document.getElementById('m-broker').value = h.broker || 'その他';
      }
    }

    overlay.classList.add('open');
    setTimeout(() => document.getElementById('m-code').focus(), 50);
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('ac-list').classList.remove('open');
  },

  saveHolding() {
    const code    = document.getElementById('m-code').value.trim();
    const name    = document.getElementById('m-name').value.trim();
    const shares  = parseFloat(document.getElementById('m-shares').value);
    const avgCost = parseFloat(document.getElementById('m-avg-cost').value);
    const account = document.getElementById('m-account').value;
    const memo    = document.getElementById('m-memo').value.trim();
    const existId = document.getElementById('m-id').value;

    if (!name)          { Toast.show('銘柄名を入力してください', 'error'); return; }
    if (!shares || shares <= 0) { Toast.show('株数を正しく入力してください', 'error'); return; }
    if (!avgCost || avgCost < 0) { Toast.show('取得単価を入力してください', 'error'); return; }

    const broker = document.getElementById('m-broker')?.value || 'その他';

    if (existId) {
      const idx = this.holdings.findIndex(h => h.id === existId);
      if (idx >= 0) {
        this.holdings[idx] = { ...this.holdings[idx], code, name, shares, avgCost, account, broker, memo, updatedAt: Date.now() };
        Toast.show('更新しました', 'success');
      }
    } else {
      this.holdings.push({ id: uid(), code, name, shares, avgCost, account, broker, memo, addedAt: Date.now(), updatedAt: Date.now() });
      Toast.show('追加しました', 'success');
      // Fetch quote & dividends for new holding
      if (code) {
        this._fetchQuotes([code], false).then(() => { this._fixMissingNames(); this.renderPage(); });
      }
    }

    HoldingStorage.save(this.holdings);
    Sync.push();
    this.closeModal();
    this.renderPage();
  },

  deleteHolding(id) {
    if (!confirm('この銘柄を削除しますか？')) return;
    this.holdings = this.holdings.filter(h => h.id !== id);
    HoldingStorage.save(this.holdings);
    Sync.push();
    Toast.show('削除しました', 'info');
    this.renderPage();
  },

  /* ===== Autocomplete ===== */
  _onCodeInput() {
    clearTimeout(this._acTimer);
    const code = document.getElementById('m-code').value.trim();
    if (code.length < 3) { document.getElementById('ac-list').classList.remove('open'); return; }
    this._acTimer = setTimeout(async () => {
      const results = await YahooFinance.searchSymbol(code);
      this._showAc(results);
    }, 400);
  },

  _onNameInput() {
    clearTimeout(this._acTimer);
    const name = document.getElementById('m-name').value.trim();
    if (name.length < 2) { document.getElementById('ac-list').classList.remove('open'); return; }
    this._acTimer = setTimeout(async () => {
      const results = await YahooFinance.searchSymbol(name);
      this._showAc(results);
    }, 400);
  },

  _showAc(results) {
    const list = document.getElementById('ac-list');
    if (!results.length) { list.classList.remove('open'); return; }
    list.innerHTML = results.slice(0, 6).map(r => `
      <div class="ac-item" onclick="App._pickAc('${r.code}','${r.name.replace(/'/g,"\\'")}')">
        ${r.name} <span class="ac-code">${r.code}</span>
      </div>`).join('');
    list.classList.add('open');
  },

  _pickAc(code, name) {
    document.getElementById('m-code').value = code;
    document.getElementById('m-name').value = name;
    document.getElementById('ac-list').classList.remove('open');
  },

  /* ===== Data management ===== */
  exportData() {
    const json = JSON.stringify({ holdings: this.holdings, exportedAt: new Date().toISOString() }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `kabu_holdings_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  },

  clearQuoteCache() {
    HoldingStorage.saveQuotes({});
    this.quotes = {};
    YahooFinance.clearMemCache?.();
    Toast.show('株価キャッシュを削除しました', 'info');
  },

  clearAll() {
    if (!confirm('全ての保有銘柄データを削除しますか？この操作は元に戻せません。')) return;
    this.holdings = [];
    this.quotes   = {};
    HoldingStorage.save([]);
    HoldingStorage.saveQuotes({});
    Sync.push();
    Toast.show('全データを削除しました', 'info');
    this.renderPage();
  },

  /* ===== Chart helpers ===== */
  _destroyChart(key) {
    if (this._charts[key]) { this._charts[key].destroy(); delete this._charts[key]; }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
