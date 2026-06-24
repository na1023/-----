'use strict';

/* ============================================================
   Sync — Firebase Firestore によるクラウド同期
   合言葉(syncCode)をキーに、複数端末で同じデータを共有する。
   ログイン不要・無料(Sparkプラン)。
   ============================================================ */
const Sync = {
  db:     null,
  code:   null,
  unsub:  null,
  status: 'off',   // 'off' | 'on' | 'unconfigured' | 'error'
  _t:     null,
  CODE_KEY: 'kabu_sync_code',

  /* 設定済みか判定 */
  _configured() {
    const c = window.FIREBASE_CONFIG;
    return c && c.apiKey && c.projectId;
  },

  init() {
    if (typeof firebase === 'undefined' || !this._configured()) {
      this.status = 'unconfigured';
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      this.db = firebase.firestore();
    } catch (e) {
      console.error(e);
      this.status = 'error';
      return;
    }
    const saved = localStorage.getItem(this.CODE_KEY);
    if (saved) this.connect(saved, true);
    else this.status = 'off';
  },

  _docRef(code) { return this.db.collection('portfolios').doc(code); },

  /* 取引の重複排除キー */
  _key(t) { return t.id || (typeof deduplicateKey === 'function' ? deduplicateKey(t) : JSON.stringify(t)); },

  _merge(a, b) {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach(t => {
      const k = this._key(t);
      if (!map.has(k)) map.set(k, t);
    });
    return [...map.values()];
  },

  async connect(code, silent) {
    if (!this._configured() || !this.db) {
      if (!silent) Toast.show('Firebaseが未設定です。設定ページの手順を確認してください', 'error', 5000);
      this.status = 'unconfigured';
      this._refreshSettings();
      return;
    }
    code = String(code || '').trim();
    if (!code) { Toast.show('合言葉を入力してください', 'error'); return; }

    this.code = code;
    localStorage.setItem(this.CODE_KEY, code);
    const ref = this._docRef(code);

    try {
      // 初回マージ（端末内データ ∪ クラウドデータ）
      const snap   = await ref.get();
      const remote = (snap.exists && snap.data().trades) ? snap.data().trades : [];
      const merged = this._merge(App.trades, remote);
      App.trades = merged;
      TradeStorage.saveLocal(merged);
      await ref.set({ trades: merged, updatedAt: Date.now() });
    } catch (e) {
      console.error(e);
      this.status = 'error';
      if (!silent) Toast.show('同期接続に失敗しました', 'error');
      this._refreshSettings();
      return;
    }

    // リアルタイム購読
    if (this.unsub) this.unsub();
    this.unsub = ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const remote = snap.data().trades || [];
      if (JSON.stringify(remote) !== JSON.stringify(App.trades)) {
        App.trades = remote;
        TradeStorage.saveLocal(remote);
        App.navigate(App.page);            // 現在ページを再描画
      }
    }, err => { console.error(err); this.status = 'error'; this._refreshSettings(); });

    this.status = 'on';
    if (!silent) Toast.show('クラウド同期を開始しました', 'success');
    App.navigate(App.page);                // マージ結果を反映
    this._refreshSettings();
  },

  /* ローカル変更をクラウドへ送信（600msデバウンス） */
  push() {
    if (this.status !== 'on' || !this.code || !this.db) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      this._docRef(this.code)
        .set({ trades: App.trades, updatedAt: Date.now() })
        .catch(e => console.error(e));
    }, 600);
  },

  disconnect() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    this.code  = null;
    this.status = 'off';
    localStorage.removeItem(this.CODE_KEY);
    Toast.show('同期を停止しました（端末内のデータは残ります）', 'info');
    this._refreshSettings();
  },

  _refreshSettings() {
    if (App.page === 'settings') App.renderSettings();
  },
};
