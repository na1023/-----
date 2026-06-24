/* ============================================================
   TradeStorage — localStorage persistence
   ============================================================ */
const TradeStorage = {
  KEY: 'kabu_trades_v2',

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return (Array.isArray(data) ? data : data.trades ?? []).map(t => ({
        id: t.id ?? Utils.uid(),
        ...t,
      }));
    } catch { return []; }
  },

  save(trades) {
    localStorage.setItem(this.KEY, JSON.stringify(trades));
  },

  exportJSON(trades) {
    const payload = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), trades }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kabu_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  importJSON(text) {
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : (data.trades ?? []);
    if (!Array.isArray(incoming)) throw new Error('Invalid format');
    return incoming.map(t => ({ id: t.id ?? Utils.uid(), source: t.source ?? 'backup', ...t }));
  },
};

/* ============================================================
   Toast
   ============================================================ */
const Toast = {
  container: null,
  init() { this.container = document.getElementById('toastContainer'); },
  show(msg, type = 'info', duration = 3500) {
    const icons = {
      success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
      error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = icons[type] + `<span>${msg}</span>`;
    this.container.appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  },
};

/* ============================================================
   ChartManager
   ============================================================ */
const ChartManager = {
  instances: {},

  destroy(id) {
    if (this.instances[id]) { this.instances[id].destroy(); delete this.instances[id]; }
  },

  destroyAll() {
    Object.keys(this.instances).forEach(id => this.destroy(id));
  },

  PALETTE: ['#3b82f6','#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899'],

  create(id, config) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    this.instances[id] = new Chart(ctx, config);
  },

  drawAccountDoughnut(id, trades) {
    const byAcc = {};
    trades.filter(t => t.side === 'buy').forEach(t => {
      byAcc[t.account] = (byAcc[t.account] ?? 0) + Math.abs(t.amount);
    });
    const labels = Object.keys(byAcc);
    const data   = labels.map(k => byAcc[k]);
    this.create(id, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: this.PALETTE, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${Utils.yen(ctx.raw)}` } },
        },
      },
    });
  },

  drawMonthlyBar(id, trades) {
    const map = {};
    trades.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!map[m]) map[m] = { buy: 0, sell: 0 };
      if (t.side === 'buy')  map[m].buy  += Math.abs(t.amount);
      else                   map[m].sell += Math.abs(t.amount);
    });
    const months = Object.keys(map).sort();
    this.create(id, {
      type: 'bar',
      data: {
        labels: months.map(m => m.slice(2)),
        datasets: [
          { label: '買付', data: months.map(m => map[m].buy),  backgroundColor: '#fca5a5', borderRadius: 4 },
          { label: '売却', data: months.map(m => map[m].sell), backgroundColor: '#86efac', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 }, boxWidth: 12 } } },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: v => '¥' + (v / 10000).toFixed(0) + '万' }, grid: { color: '#f1f5f9' } },
        },
      },
    });
  },

  drawSymbolBar(id, trades) {
    const map = {};
    trades.filter(t => t.side === 'buy').forEach(t => {
      const key = t.symbolName || t.symbolCode || '不明';
      map[key] = (map[key] ?? 0) + Math.abs(t.amount);
    });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
    this.create(id, {
      type: 'bar',
      data: {
        labels: sorted.map(([k]) => k),
        datasets: [{ label: '買付額', data: sorted.map(([,v]) => v), backgroundColor: this.PALETTE, borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { callback: v => '¥' + (v / 10000).toFixed(0) + '万' }, grid: { color: '#f1f5f9' } },
          y: { grid: { display: false } },
        },
      },
    });
  },

  drawCumulative(id, trades) {
    const sorted = [...trades].filter(t => t.date).sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0;
    const points = sorted.map(t => {
      cum += t.side === 'buy' ? Math.abs(t.amount) : -Math.abs(t.amount);
      return { x: t.date, y: cum };
    });
    this.create(id, {
      type: 'line',
      data: {
        datasets: [{
          label: '累計投資額',
          data: points,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,.1)',
          fill: true,
          tension: 0.3,
          pointRadius: Math.min(4, Math.max(0, 8 - points.length / 10)),
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        parsing: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { type: 'category', ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { callback: v => '¥' + (v / 10000).toFixed(0) + '万' }, grid: { color: '#f1f5f9' } },
        },
      },
    });
  },
};

/* ============================================================
   App
   ============================================================ */
const App = {
  trades: [],
  currentPage: 'dashboard',
  sortKey: 'date',
  sortDir: -1,
  historyFilters: { q: '', account: '', side: '' },
  editingId: null,

  init() {
    this.trades = TradeStorage.load();
    Toast.init();
    this.setupSidebar();
    this.setupModal();
    this.setupNavigation();
    this.navigate('dashboard');
  },

  /* ---- Sidebar / mobile menu ---- */
  setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const open  = () => { sidebar.classList.add('open'); overlay.classList.add('active'); };
    const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); };
    document.getElementById('menuBtn').addEventListener('click', open);
    overlay.addEventListener('click', close);
    document.querySelectorAll('.nav-item').forEach(a => {
      a.addEventListener('click', () => { if (window.innerWidth < 768) close(); });
    });
  },

  /* ---- Navigation ---- */
  setupNavigation() {
    const allNavItems = [...document.querySelectorAll('.nav-item'), ...document.querySelectorAll('.bnav-item[data-page]')];
    allNavItems.forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.page));
    });
    document.getElementById('sidebarNewBtn').addEventListener('click', () => this.openModal());
    document.getElementById('topbarNewBtn').addEventListener('click', () => this.openModal());
    document.getElementById('mobileNewBtn').addEventListener('click', () => this.openModal());
  },

  navigate(page) {
    this.currentPage = page;
    ChartManager.destroyAll();

    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.page === page));
    document.querySelectorAll('.bnav-item[data-page]').forEach(el =>
      el.classList.toggle('active', el.dataset.page === page));

    const titles = {
      dashboard: 'ダッシュボード',
      history:   '取引履歴',
      charts:    'グラフ分析',
      import:    'CSV取込',
      settings:  '設定',
    };
    document.getElementById('pageTitle').textContent = titles[page] ?? page;

    const renders = {
      dashboard: () => this.renderDashboard(),
      history:   () => this.renderHistory(),
      charts:    () => this.renderCharts(),
      import:    () => this.renderImport(),
      settings:  () => this.renderSettings(),
    };
    (renders[page] ?? (() => {}))();
  },

  setContent(html) {
    document.getElementById('pageContent').innerHTML = html;
  },

  /* ============================================================
     DASHBOARD
     ============================================================ */
  renderDashboard() {
    const buy  = this.trades.filter(t => t.side === 'buy').reduce((s, t) => s + Math.abs(t.amount), 0);
    const sell = this.trades.filter(t => t.side === 'sell').reduce((s, t) => s + Math.abs(t.amount), 0);
    const syms = new Set(this.trades.map(t => t.symbolCode || t.symbolName)).size;
    const recent = [...this.trades].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

    this.setContent(`
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">取引件数</div>
          <div class="kpi-value">${this.trades.length.toLocaleString()}</div>
          <div class="kpi-sub">件</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">銘柄数</div>
          <div class="kpi-value">${syms.toLocaleString()}</div>
          <div class="kpi-sub">銘柄</div>
        </div>
        <div class="kpi-card kpi-buy">
          <div class="kpi-label">買付総額</div>
          <div class="kpi-value">${Utils.yen(buy)}</div>
          <div class="kpi-sub">累計</div>
        </div>
        <div class="kpi-card kpi-sell">
          <div class="kpi-label">売却総額</div>
          <div class="kpi-value">${Utils.yen(sell)}</div>
          <div class="kpi-sub">累計</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <span class="card-title">直近の取引</span>
            <button class="btn btn-sm btn-ghost" onclick="App.navigate('history')">すべて見る →</button>
          </div>
          <div class="card-body-p0">
            ${recent.length === 0 ? this.emptyState('取引がありません', '「新規登録」またはCSV取込でデータを追加してください。') : recent.map(t => this.tradeRowHtml(t)).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">取引区分別 買付額</span></div>
          <div class="card-body">
            <div class="chart-container"><canvas id="dashAccountChart"></canvas></div>
          </div>
        </div>
      </div>
    `);

    if (this.trades.length > 0) ChartManager.drawAccountDoughnut('dashAccountChart', this.trades);
  },

  tradeRowHtml(t) {
    return `
      <div class="trade-row">
        <div>
          <div class="trade-symbol">${this.esc(t.symbolName || t.symbolCode)}</div>
          <div class="trade-meta">${Utils.formatDate(t.date)} &ensp; ${this.accountBadge(t.account)}</div>
        </div>
        <div>
          <div class="trade-amount ${t.side === 'buy' ? 'text-buy' : 'text-sell'}">
            ${t.side === 'buy' ? '買' : '売'} ${Utils.yen(t.amount)}
          </div>
          <div class="trade-shares text-muted">${t.shares.toLocaleString()} 株</div>
        </div>
      </div>`;
  },

  /* ============================================================
     HISTORY
     ============================================================ */
  renderHistory() {
    this.setContent(`
      <div class="card">
        <div class="filter-bar">
          <input class="filter-input" id="fq" type="search" placeholder="🔍 銘柄名・コード" value="${this.esc(this.historyFilters.q)}" style="flex:1;min-width:160px">
          <select class="filter-select" id="fAccount">
            <option value="">すべての区分</option>
            <option value="特定">特定</option>
            <option value="一般">一般</option>
            <option value="NISA">NISA</option>
            <option value="新NISA成長">新NISA成長</option>
            <option value="新NISA積立">新NISA積立</option>
          </select>
          <select class="filter-select" id="fSide">
            <option value="">売買すべて</option>
            <option value="buy">買付のみ</option>
            <option value="sell">売却のみ</option>
          </select>
          <span class="text-muted text-sm" id="historyCount" style="align-self:center;white-space:nowrap"></span>
        </div>

        <!-- PC table -->
        <div class="data-table-wrapper">
          <table class="data-table" id="historyTable">
            <thead>
              <tr>
                ${this.thHtml('date',       '日付')}
                ${this.thHtml('symbolName', '銘柄')}
                ${this.thHtml('account',    '区分')}
                ${this.thHtml('side',       '売買')}
                ${this.thHtml('shares',     '株数', true)}
                ${this.thHtml('price',      '単価', true)}
                ${this.thHtml('amount',     '受渡金額', true)}
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="historyTbody"></tbody>
          </table>
        </div>

        <!-- Mobile cards -->
        <div class="trade-cards" id="historyCards"></div>

        <div id="historyEmpty" style="display:none">
          ${this.emptyState('該当する取引がありません', '条件を変更してみてください。')}
        </div>
      </div>
    `);

    document.getElementById('fAccount').value = this.historyFilters.account;
    document.getElementById('fSide').value    = this.historyFilters.side;
    this.bindHistoryFilters();
    this.refreshHistoryTable();
  },

  thHtml(key, label, num = false) {
    const sorted = this.sortKey === key;
    const icon = sorted ? (this.sortDir === 1 ? '↑' : '↓') : '↕';
    return `<th class="${sorted ? 'sorted' : ''}" data-sort="${key}" style="${num ? 'text-align:right' : ''}">
      ${label} <span class="sort-icon">${icon}</span>
    </th>`;
  },

  bindHistoryFilters() {
    const update = () => {
      this.historyFilters.q       = document.getElementById('fq')?.value ?? '';
      this.historyFilters.account = document.getElementById('fAccount')?.value ?? '';
      this.historyFilters.side    = document.getElementById('fSide')?.value ?? '';
      this.refreshHistoryTable();
    };
    document.getElementById('fq')?.addEventListener('input', update);
    document.getElementById('fAccount')?.addEventListener('change', update);
    document.getElementById('fSide')?.addEventListener('change', update);

    document.getElementById('historyTable')?.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (this.sortKey === key) this.sortDir *= -1;
        else { this.sortKey = key; this.sortDir = -1; }
        this.navigate('history');
      });
    });
  },

  filteredTrades() {
    const { q, account, side } = this.historyFilters;
    return this.trades
      .filter(t => {
        if (q && !((t.symbolName ?? '').includes(q) || (t.symbolCode ?? '').includes(q))) return false;
        if (account && t.account !== account) return false;
        if (side    && t.side    !== side)    return false;
        return true;
      })
      .sort((a, b) => {
        let av = a[this.sortKey] ?? '', bv = b[this.sortKey] ?? '';
        if (typeof av === 'number') return (av - bv) * this.sortDir;
        return String(av).localeCompare(String(bv), 'ja') * this.sortDir;
      });
  },

  refreshHistoryTable() {
    const rows = this.filteredTrades();
    const count = document.getElementById('historyCount');
    if (count) count.textContent = `${rows.length} 件`;

    const empty = document.getElementById('historyEmpty');
    if (empty) empty.style.display = rows.length === 0 ? 'block' : 'none';

    // PC table
    const tbody = document.getElementById('historyTbody');
    if (tbody) {
      tbody.innerHTML = rows.map(t => `
        <tr>
          <td>${Utils.formatDate(t.date)}</td>
          <td>
            <div style="font-weight:600">${this.esc(t.symbolName)}</div>
            <div class="text-xs text-muted">${this.esc(t.symbolCode ?? '')}</div>
          </td>
          <td>${this.accountBadge(t.account)}</td>
          <td><span class="badge ${t.side === 'buy' ? 'badge-buy' : 'badge-sell'}">${t.side === 'buy' ? '買付' : '売却'}</span></td>
          <td class="col-num">${t.shares.toLocaleString()}</td>
          <td class="col-num">${t.price ? Utils.yen(t.price) : '—'}</td>
          <td class="col-num" style="font-weight:600">${Utils.yen(t.amount)}</td>
          <td>
            <div class="flex-gap">
              <button class="btn-icon" title="編集" onclick="App.openModal('${t.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon" title="削除" onclick="App.deleteTrade('${t.id}')" style="color:#ef4444">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              </button>
            </div>
          </td>
        </tr>`).join('');
    }

    // Mobile cards
    const cards = document.getElementById('historyCards');
    if (cards) {
      cards.innerHTML = rows.map(t => `
        <div class="trade-card-item">
          <div style="flex:1">
            <div style="font-weight:700;margin-bottom:4px">${this.esc(t.symbolName)} <span class="text-xs text-muted">${this.esc(t.symbolCode ?? '')}</span></div>
            <div class="text-xs text-muted">${Utils.formatDate(t.date)} &ensp; ${this.accountBadge(t.account)}</div>
            ${t.note ? `<div class="text-xs text-muted" style="margin-top:4px">${this.esc(t.note)}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-weight:700;font-size:.95rem" class="${t.side === 'buy' ? 'text-buy' : 'text-sell'}">${t.side === 'buy' ? '買' : '売'} ${Utils.yen(t.amount)}</div>
            <div class="text-xs text-muted">${t.shares.toLocaleString()} 株</div>
            <div style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end">
              <button class="btn btn-sm btn-ghost" onclick="App.openModal('${t.id}')">編集</button>
              <button class="btn btn-sm" style="color:#ef4444;border:1px solid #fca5a5;background:#fff" onclick="App.deleteTrade('${t.id}')">削除</button>
            </div>
          </div>
        </div>`).join('');
    }
  },

  deleteTrade(id) {
    if (!confirm('この取引を削除しますか？')) return;
    this.trades = this.trades.filter(t => t.id !== id);
    TradeStorage.save(this.trades);
    Toast.show('取引を削除しました', 'info');
    this.refreshHistoryTable();
  },

  /* ============================================================
     CHARTS
     ============================================================ */
  renderCharts() {
    if (this.trades.length === 0) {
      this.setContent(`<div class="card"><div class="card-body">${this.emptyState('データがありません', 'CSV取込か手入力でデータを追加してください。')}</div></div>`);
      return;
    }
    this.setContent(`
      <div class="charts-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">取引区分別 買付額</span></div>
          <div class="card-body"><div class="chart-container chart-tall"><canvas id="c-account"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">月別 買付 / 売却額</span></div>
          <div class="card-body"><div class="chart-container chart-tall"><canvas id="c-monthly"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">銘柄別 買付額 Top 10</span></div>
          <div class="card-body"><div class="chart-container chart-tall"><canvas id="c-symbol"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">累計投資額の推移</span></div>
          <div class="card-body"><div class="chart-container chart-tall"><canvas id="c-cumulative"></canvas></div></div>
        </div>
      </div>
    `);
    ChartManager.drawAccountDoughnut('c-account', this.trades);
    ChartManager.drawMonthlyBar('c-monthly', this.trades);
    ChartManager.drawSymbolBar('c-symbol', this.trades);
    ChartManager.drawCumulative('c-cumulative', this.trades);
  },

  /* ============================================================
     IMPORT
     ============================================================ */
  renderImport() {
    this.setContent(`
      <div class="import-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">CSVファイル取込</span></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
            <div>
              <label class="form-label" style="margin-bottom:6px;display:block">証券会社</label>
              <select class="form-select" id="brokerSelect">
                <option value="auto">自動判定（推奨）</option>
                <option value="SBI">SBI証券</option>
                <option value="Rakuten">楽天証券</option>
                <option value="Matsui">松井証券</option>
                <option value="Monex">マネックス証券</option>
              </select>
            </div>
            <div class="dropzone" id="dropzone">
              <svg class="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p class="dropzone-label">クリック / ドラッグ＆ドロップ</p>
              <p class="dropzone-sub">.csv ファイル（Shift-JIS / UTF-8）</p>
              <input type="file" id="csvFile" accept=".csv" multiple>
            </div>
            <div id="importLog" class="import-log" style="display:none"></div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:20px">
          <div class="card">
            <div class="card-header"><span class="card-title">対応証券会社</span></div>
            <div class="card-body">
              <table style="width:100%;font-size:.85rem;border-collapse:collapse">
                <thead>
                  <tr style="color:var(--c-text-3);font-size:.75rem;text-transform:uppercase">
                    <th style="text-align:left;padding:6px 0;font-weight:600">証券会社</th>
                    <th style="text-align:left;padding:6px 0;font-weight:600">エクスポート名称</th>
                  </tr>
                </thead>
                <tbody>
                  ${[
                    ['SBI証券', '取引履歴.csv'],
                    ['楽天証券', '取引履歴.csv'],
                    ['松井証券', '取引一覧.csv'],
                    ['マネックス証券', '取引履歴.csv'],
                  ].map(([b, f]) => `
                    <tr style="border-top:1px solid var(--c-border)">
                      <td style="padding:10px 0;font-weight:500">${b}</td>
                      <td style="padding:10px 0;color:var(--c-text-3)">${f}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">取込み手順</span></div>
            <div class="card-body" style="font-size:.85rem;color:var(--c-text-2);line-height:2">
              <ol style="padding-left:1.2em;display:flex;flex-direction:column;gap:6px">
                <li>証券会社のWebサイトで取引履歴をCSV形式でダウンロード</li>
                <li>上のドロップゾーンにファイルをドラッグ＆ドロップ（複数可）</li>
                <li>自動で証券会社を判定し、統一スキーマに変換して保存</li>
                <li>重複する取引は自動でスキップされます</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    `);

    this.setupImportEvents();
  },

  setupImportEvents() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('csvFile');

    dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop',      e => { e.preventDefault(); dropzone.classList.remove('drag-over'); this.processFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', e => { this.processFiles(e.target.files); e.target.value = ''; });
  },

  processFiles(fileList) {
    const log = document.getElementById('importLog');
    log.style.display = 'block';
    log.innerHTML = '';

    const addLog = (msg, cls = '') => {
      log.innerHTML += `<div class="${cls}">${msg}</div>`;
      log.scrollTop = log.scrollHeight;
    };

    Array.from(fileList).forEach(file => {
      addLog(`<span class="log-info">📂 ${file.name} を処理中...</span>`);
      const reader = new FileReader();
      reader.onload = () => {
        let text = new TextDecoder('shift-jis').decode(reader.result);
        if (/�/.test(text)) text = new TextDecoder('utf-8').decode(reader.result);

        const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
        const headers = parsed.meta.fields ?? [];

        let broker = document.getElementById('brokerSelect').value;
        if (broker === 'auto') broker = detectBroker(headers);

        if (!broker) {
          addLog(`❌ 証券会社を判定できませんでした。手動で選択してください。`, 'log-err');
          return;
        }
        addLog(`🔍 証券会社: <strong>${broker}</strong> / ${parsed.data.length} 行`);

        const newRecs = normalizeCSV(parsed.data, broker);
        if (!newRecs.length) {
          addLog(`❌ 有効な取引行が0件でした。列名をご確認ください。`, 'log-err');
          return;
        }

        const existKeys = new Set(this.trades.map(deduplicateKey));
        const deduped   = newRecs.filter(r => !existKeys.has(deduplicateKey(r)));
        this.trades = this.trades.concat(deduped);
        TradeStorage.save(this.trades);

        addLog(`✅ <strong>${deduped.length}</strong> 件取込み完了（重複スキップ: ${newRecs.length - deduped.length} 件）`, 'log-ok');
        Toast.show(`${broker}: ${deduped.length} 件取込みました`, 'success');
      };
      reader.readAsArrayBuffer(file);
    });
  },

  /* ============================================================
     SETTINGS
     ============================================================ */
  renderSettings() {
    this.setContent(`
      <div class="settings-grid">
        <div style="display:flex;flex-direction:column;gap:20px">
          <div class="card">
            <div class="card-header"><span class="card-title">💾 バックアップ・復元</span></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
              <div class="info-block">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>データはこのPCの<strong>ブラウザ（localStorage）</strong>に保存されています。ブラウザのデータ削除やPC変更でデータが消えます。定期的にバックアップを取ってください。</span>
              </div>
              <button class="btn btn-primary" onclick="App.exportData()">📤 JSONにエクスポート（バックアップ）</button>
              <label style="display:flex;flex-direction:column;gap:4px">
                <span class="form-label">JSONから復元（インポート）</span>
                <div class="dropzone" style="padding:24px" id="jsonDropzone">
                  <p class="dropzone-label" style="font-size:.85rem">バックアップJSONをドロップ / クリック</p>
                  <input type="file" id="jsonFile" accept=".json">
                </div>
              </label>
              <div id="settingsLog" style="display:none" class="import-log"></div>
            </div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:20px">
          <div class="card">
            <div class="card-header"><span class="card-title">📊 データ概要</span></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:10px;font-size:.875rem">
              ${[
                ['取引件数',  `${this.trades.length.toLocaleString()} 件`],
                ['買付件数',  `${this.trades.filter(t=>t.side==='buy').length.toLocaleString()} 件`],
                ['売却件数',  `${this.trades.filter(t=>t.side==='sell').length.toLocaleString()} 件`],
                ['手入力',    `${this.trades.filter(t=>t.source==='manual').length.toLocaleString()} 件`],
              ].map(([k, v]) => `
                <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--c-border)">
                  <span class="text-muted">${k}</span>
                  <span style="font-weight:600">${v}</span>
                </div>`).join('')}
            </div>
          </div>

          <div class="card danger-zone">
            <div class="card-header"><span class="card-title" style="color:var(--c-danger)">⚠️ データ削除</span></div>
            <div class="card-body">
              <p class="text-sm text-muted" style="margin-bottom:14px">すべての取引データを削除します。この操作は元に戻せません。先にバックアップを取ってください。</p>
              <button class="btn btn-danger" onclick="App.clearAllData()">すべてのデータを削除</button>
            </div>
          </div>
        </div>
      </div>
    `);

    document.getElementById('jsonFile').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.importJSON(reader.result);
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });
  },

  exportData() {
    TradeStorage.exportJSON(this.trades);
    Toast.show('バックアップを保存しました', 'success');
  },

  importJSON(text) {
    const log = document.getElementById('settingsLog');
    if (log) log.style.display = 'block';
    try {
      const incoming = TradeStorage.importJSON(text);
      const existKeys = new Set(this.trades.map(deduplicateKey));
      const newRecs   = incoming.filter(r => !existKeys.has(deduplicateKey(r)));
      this.trades = this.trades.concat(newRecs);
      TradeStorage.save(this.trades);
      if (log) log.innerHTML = `<span class="log-ok">✅ ${newRecs.length} 件を復元（重複スキップ: ${incoming.length - newRecs.length} 件）</span>`;
      Toast.show(`${newRecs.length} 件を復元しました`, 'success');
    } catch {
      if (log) log.innerHTML = `<span class="log-err">❌ ファイルの形式が正しくありません</span>`;
      Toast.show('復元に失敗しました', 'error');
    }
  },

  clearAllData() {
    if (!confirm('すべての取引データを削除します。\nこの操作は元に戻せません。\n\nよろしいですか？')) return;
    this.trades = [];
    TradeStorage.save(this.trades);
    Toast.show('データを削除しました', 'info');
    this.navigate('dashboard');
  },

  /* ============================================================
     MODAL — Trade Entry / Edit
     ============================================================ */
  setupModal() {
    const backdrop = document.getElementById('modalBackdrop');
    document.getElementById('modalClose').addEventListener('click',   () => this.closeModal());
    document.getElementById('modalCancelBtn').addEventListener('click', () => this.closeModal());
    document.getElementById('modalSubmitBtn').addEventListener('click', () => this.submitTrade());
    backdrop.addEventListener('click', e => { if (e.target === backdrop) this.closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeModal(); });

    document.querySelectorAll('.side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('f-side').value = btn.dataset.v;
      });
    });

    // Auto-calc amount from shares × price
    const calc = () => {
      const shares = parseFloat(document.getElementById('f-shares')?.value) || 0;
      const price  = parseFloat(document.getElementById('f-price')?.value)  || 0;
      const amountEl = document.getElementById('f-amount');
      if (shares > 0 && price > 0 && amountEl && !amountEl._manuallyEdited) {
        amountEl.value = Math.round(shares * price);
      }
    };
    document.getElementById('f-shares')?.addEventListener('input', calc);
    document.getElementById('f-price')?.addEventListener('input', calc);
    document.getElementById('f-amount')?.addEventListener('input', function() { this._manuallyEdited = true; });
  },

  openModal(id = null) {
    this.editingId = id;
    const title = document.getElementById('modalTitle');
    const submit = document.getElementById('modalSubmitBtn');

    if (id) {
      const t = this.trades.find(t => t.id === id);
      if (!t) return;
      title.textContent = '取引を編集';
      submit.textContent = '更新する';
      document.getElementById('f-code').value    = t.symbolCode ?? '';
      document.getElementById('f-name').value    = t.symbolName ?? '';
      document.getElementById('f-date').value    = t.date ?? '';
      document.getElementById('f-account').value = t.account ?? '特定';
      document.getElementById('f-shares').value  = t.shares ?? '';
      document.getElementById('f-price').value   = t.price  ?? '';
      document.getElementById('f-amount').value  = t.amount ?? '';
      document.getElementById('f-note').value    = t.note   ?? '';
      document.getElementById('f-side').value    = t.side   ?? 'buy';
      document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b.dataset.v === t.side));
    } else {
      title.textContent = '新規取引登録';
      submit.textContent = '登録する';
      document.getElementById('tradeForm').reset();
      document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('f-side').value = 'buy';
      document.querySelectorAll('.side-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      const amountEl = document.getElementById('f-amount');
      if (amountEl) amountEl._manuallyEdited = false;
    }

    this.clearFormErrors();
    document.getElementById('modalBackdrop').classList.add('open');
    setTimeout(() => document.getElementById('f-name')?.focus(), 100);
  },

  closeModal() {
    document.getElementById('modalBackdrop').classList.remove('open');
    this.editingId = null;
  },

  clearFormErrors() {
    document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-input').forEach(el => el.classList.remove('error'));
  },

  validateForm() {
    this.clearFormErrors();
    let valid = true;
    const set = (id, errId, msg) => {
      const el = document.getElementById(id);
      const err = document.getElementById(errId);
      if (!el || !el.value.trim()) {
        if (err) err.textContent = msg;
        if (el)  el.classList.add('error');
        valid = false;
      }
    };
    set('f-name',   'err-name',   '銘柄名は必須です');
    set('f-date',   'err-date',   '日付は必須です');
    set('f-shares', 'err-shares', '株数は必須です');
    set('f-amount', 'err-amount', '受渡金額は必須です');
    return valid;
  },

  submitTrade() {
    if (!this.validateForm()) return;

    const record = {
      id:         this.editingId ?? Utils.uid(),
      symbolCode: document.getElementById('f-code').value.trim(),
      symbolName: document.getElementById('f-name').value.trim(),
      date:       document.getElementById('f-date').value,
      account:    document.getElementById('f-account').value,
      side:       document.getElementById('f-side').value,
      shares:     parseFloat(document.getElementById('f-shares').value) || 0,
      price:      parseFloat(document.getElementById('f-price').value)  || 0,
      amount:     parseFloat(document.getElementById('f-amount').value) || 0,
      note:       document.getElementById('f-note').value.trim(),
      source:     'manual',
    };

    if (this.editingId) {
      const idx = this.trades.findIndex(t => t.id === this.editingId);
      if (idx >= 0) this.trades[idx] = record;
      Toast.show('取引を更新しました', 'success');
    } else {
      this.trades.push(record);
      Toast.show('取引を登録しました', 'success');
    }

    TradeStorage.save(this.trades);
    this.closeModal();
    if (this.currentPage === 'history')   this.refreshHistoryTable();
    else if (this.currentPage === 'dashboard') this.navigate('dashboard');
  },

  /* ============================================================
     Helpers
     ============================================================ */
  accountBadge(acc) {
    if (!acc) return '';
    const cls = acc.startsWith('新NISA') ? 'badge-nnisa' : acc === 'NISA' ? 'badge-nisa' : 'badge-account';
    return `<span class="badge ${cls}">${acc}</span>`;
  },

  esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },

  emptyState(title, sub) {
    return `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
        </svg>
        <h3>${title}</h3>
        <p>${sub}</p>
      </div>`;
  },
};

/* ============================================================
   Boot
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => App.init());
