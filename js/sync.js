'use strict';

/* ============================================================
   Sync — Firebase Authentication + Firestore
   各ユーザーがログインし、自分専用のデータをクラウドに保存・同期する。
   ログイン方法： Googleアカウント / メール+パスワード
   保存先： portfolios/{uid}
   ============================================================ */
const Sync = {
  db:     null,
  auth:   null,
  user:   null,
  unsub:  null,
  status: 'off',   // 'unconfigured' | 'signedout' | 'on' | 'error'
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

    // リダイレクト方式ログインの戻り処理
    this.auth.getRedirectResult().catch(e => console.error(e));

    this.auth.onAuthStateChanged(user => {
      if (user) {
        this.user = user;
        this._startSync();
      } else {
        this.user = null;
        this.status = 'signedout';
        if (this.unsub) { this.unsub(); this.unsub = null; }
        this._refreshSettings();
      }
    });
  },

  /* ---- ログイン操作 ---- */
  async loginGoogle() {
    if (!this.auth) return;

    // file:// やストレージ無効の環境では Google ログイン不可
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      Toast.show('この開き方ではGoogleログインを使えません。https のURL（GitHub Pages）で開いてください。', 'error', 6000);
      return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();

    // iOS Safari ではリダイレクト方式が完了できない不具合があるため、
    // 全環境でポップアップ方式を優先する（クリック直後なのでブロックされにくい）
    try {
      await this.auth.signInWithPopup(provider);
    } catch (e) {
      console.error(e);
      if (e.code === 'auth/operation-not-supported-in-this-environment') {
        Toast.show('この環境ではGoogleログインを使えません。通常のブラウザ(Safari/Chrome)の https URL で開くか、メール＋パスワードをご利用ください。', 'error', 7000);
      } else if (e.code === 'auth/unauthorized-domain') {
        Toast.show('このドメインが未許可です。Firebaseの「承認済みドメイン」にサイトのドメインを追加してください。', 'error', 7000);
      } else {
        Toast.show('Googleログインに失敗しました: ' + (e.code || e.message), 'error', 6000);
      }
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
    try { await this.auth.signOut(); Toast.show('ログアウトしました（端末内のデータは残ります）', 'info'); }
    catch (e) { console.error(e); }
  },

  _authError(e) {
    const msg = {
      'auth/invalid-email':        'メールアドレスの形式が正しくありません',
      'auth/email-already-in-use': 'このメールアドレスは既に登録済みです。ログインしてください',
      'auth/weak-password':        'パスワードは6文字以上にしてください',
      'auth/wrong-password':       'パスワードが違います',
      'auth/user-not-found':       'アカウントが見つかりません。新規登録してください',
      'auth/invalid-credential':   'メールアドレスまたはパスワードが違います',
    }[e.code] || ('エラー: ' + (e.code || e.message));
    Toast.show(msg, 'error', 5000);
  },

  /* ---- 同期 ---- */
  _docRef() { return this.db.collection('portfolios').doc(this.user.uid); },

  _key(t) { return t.id || (typeof deduplicateKey === 'function' ? deduplicateKey(t) : JSON.stringify(t)); },

  _merge(a, b) {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach(t => {
      const k = this._key(t);
      if (!map.has(k)) map.set(k, t);
    });
    return [...map.values()];
  },

  async _startSync() {
    const ref = this._docRef();
    try {
      const snap   = await ref.get();
      const remote = (snap.exists && snap.data().trades) ? snap.data().trades : [];
      const merged = this._merge(App.trades, remote);
      App.trades = merged;
      TradeStorage.saveLocal(merged);
      await ref.set({ trades: merged, updatedAt: Date.now() });
    } catch (e) {
      console.error(e);
      this.status = 'error';
      this._refreshSettings();
      return;
    }

    if (this.unsub) this.unsub();
    this.unsub = ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const remote = snap.data().trades || [];
      if (JSON.stringify(remote) !== JSON.stringify(App.trades)) {
        App.trades = remote;
        TradeStorage.saveLocal(remote);
        App.navigate(App.page);
      }
    }, err => { console.error(err); this.status = 'error'; this._refreshSettings(); });

    this.status = 'on';
    App.navigate(App.page);
    this._refreshSettings();
  },

  push() {
    if (this.status !== 'on' || !this.user || !this.db) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      this._docRef().set({ trades: App.trades, updatedAt: Date.now() }).catch(e => console.error(e));
    }, 600);
  },

  _refreshSettings() {
    if (App.page === 'settings') App.renderSettings();
  },
};
