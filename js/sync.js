'use strict';

const Sync = {
  db:     null,
  auth:   null,
  user:   null,
  unsub:  null,
  status: 'off',
  _t:     null,

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
      this.auth = firebase.auth();
      this.db   = firebase.firestore();
    } catch (e) {
      console.error(e);
      this.status = 'error';
      return;
    }

    this.auth.getRedirectResult().catch(e => console.error(e));

    this.auth.onAuthStateChanged(user => {
      if (user) {
        this.user = user;
        this._startSync();
      } else {
        this.user   = null;
        this.status = 'signedout';
        if (this.unsub) { this.unsub(); this.unsub = null; }
        if (App.page === 'settings') App.renderSettings();
      }
    });
  },

  async loginGoogle() {
    if (!this.auth) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      Toast.show('https URL で開いてください', 'error'); return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await this.auth.signInWithPopup(provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked') Toast.show('ポップアップをブラウザで許可してください', 'error', 6000);
      else if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') { /* no-op */ }
      else Toast.show('Googleログイン失敗: ' + (e.code || e.message), 'error', 6000);
    }
  },

  async signupEmail(email, pw) {
    try { await this.auth.createUserWithEmailAndPassword(email, pw); Toast.show('アカウントを作成しました', 'success'); }
    catch (e) { this._authError(e); }
  },

  async loginEmail(email, pw) {
    try { await this.auth.signInWithEmailAndPassword(email, pw); }
    catch (e) { this._authError(e); }
  },

  async logout() {
    try { await this.auth.signOut(); Toast.show('ログアウトしました', 'info'); }
    catch (e) { console.error(e); }
  },

  _authError(e) {
    const map = {
      'auth/invalid-email':        'メールアドレスの形式が正しくありません',
      'auth/email-already-in-use': 'このメールは既に登録済みです',
      'auth/weak-password':        'パスワードは6文字以上にしてください',
      'auth/wrong-password':       'パスワードが違います',
      'auth/user-not-found':       'アカウントが見つかりません',
      'auth/invalid-credential':   'メールアドレスまたはパスワードが違います',
    };
    Toast.show(map[e.code] || 'エラー: ' + (e.code || e.message), 'error', 5000);
  },

  _docRef() { return this.db.collection('portfolios').doc(this.user.uid); },

  _merge(local, remote) {
    const map = new Map();
    [...(local || []), ...(remote || [])].forEach(h => {
      if (!map.has(h.id)) map.set(h.id, h);
      else {
        const a = map.get(h.id), b = h;
        map.set(h.id, (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a);
      }
    });
    return [...map.values()];
  },

  async _startSync() {
    const ref = this._docRef();
    try {
      const snap        = await ref.get();
      const data        = snap.exists ? snap.data() : {};
      const remote      = data.holdings ?? [];
      const remoteDivs  = data.dividends ?? null;
      const remoteDivTs = data.dividendsUpdatedAt ?? 0;

      const merged = this._merge(App.holdings, remote);
      App.holdings = merged;
      HoldingStorage.save(merged);

      // 配当: タイムスタンプが新しい方を使う（デバイス間で最新を優先）
      const localDivTs = parseInt(localStorage.getItem('kabu_divs_ts') ?? '0', 10);
      if (remoteDivs !== null && remoteDivTs > localDivTs) {
        App.dividends = remoteDivs;
        DividendStorage.save(remoteDivs);
        localStorage.setItem('kabu_divs_ts', String(remoteDivTs));
      }

      const now = Date.now();
      await ref.set({
        holdings: merged,
        dividends: App.dividends,
        dividendsUpdatedAt: remoteDivTs > localDivTs ? remoteDivTs : now,
        updatedAt: now,
      });
      if (remoteDivTs <= localDivTs) localStorage.setItem('kabu_divs_ts', String(now));
    } catch (e) {
      console.error(e);
      this.status = 'error';
      if (App.page === 'settings') App.renderSettings();
      return;
    }

    if (this.unsub) this.unsub();
    this.unsub = ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const data       = snap.data();
      const remote     = data.holdings ?? [];
      const remoteDivs = data.dividends ?? null;
      const remoteDivTs = data.dividendsUpdatedAt ?? 0;
      const localDivTs  = parseInt(localStorage.getItem('kabu_divs_ts') ?? '0', 10);
      let changed = false;
      if (JSON.stringify(remote) !== JSON.stringify(App.holdings)) {
        App.holdings = remote;
        HoldingStorage.save(remote);
        changed = true;
      }
      if (remoteDivs !== null && remoteDivTs > localDivTs) {
        App.dividends = remoteDivs;
        DividendStorage.save(remoteDivs);
        localStorage.setItem('kabu_divs_ts', String(remoteDivTs));
        changed = true;
      }
      if (changed) App.navigate(App.page, false);
    }, err => { console.error(err); this.status = 'error'; });

    this.status = 'on';
    App.navigate(App.page, false);
    if (App.page === 'settings') App.renderSettings();
  },

  push() {
    if (this.status !== 'on' || !this.user || !this.db) return;
    clearTimeout(this._t);
    const now = Date.now();
    localStorage.setItem('kabu_divs_ts', String(now));
    this._t = setTimeout(() => {
      this._docRef().set({
        holdings: App.holdings,
        dividends: App.dividends,
        dividendsUpdatedAt: now,
        updatedAt: now,
      }).catch(e => console.error(e));
    }, 600);
  },
};
