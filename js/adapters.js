/* ============================================================
   CSV Broker Adapters
   ============================================================ */

const Utils = {
  num:  s  => Number(String(s ?? '').replace(/[^\d.-]/g, '')) || 0,
  yen:  n  => '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP'),
  uid:  () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  fmtDate: s => s ? s.replace(/-/g, '/') : '',
  toISO(s) {
    const m = String(s ?? '').trim().match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : String(s ?? '').trim();
  },
  mapSide: raw => /買|buy/i.test(raw ?? '') ? 'buy' : 'sell',
  mapAccount(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '特定';
    // 新NISA（枠の区別が最優先）
    if (/成長投資枠|成長枠/.test(s))             return '新NISA成長';
    if (/つみたて投資枠|つみたて枠|積立投資枠|積立枠/.test(s)) return '新NISA積立';
    // NISA（新NISA表記もここで成長扱い）
    if (/NISA|ニーサ/i.test(s)) {
      if (/つみたて|積立/.test(s)) return '新NISA積立';
      if (/成長|新/.test(s))       return '新NISA成長';
      return 'NISA';
    }
    if (/特定/.test(s)) return '特定';
    if (/一般/.test(s)) return '一般';
    return '特定';   // 不明時は最も一般的な特定に（旧仕様の一般デフォルトを変更）
  },
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2,7),
  yen: n => '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP'),
  formatDate: s => s ? s.replace(/-/g, '/') : '',
};

const BrokerAdapters = {
  SBI: {
    signature: ['約定日','銘柄コード','預り区分','約定数量'],
    encode: 'shift-jis',
    skipRows: 0,
    map: {
      symbolCode: r => r['銘柄コード'] ?? '',
      symbolName: r => r['銘柄'] ?? r['銘柄名'] ?? '',
      date:        r => Utils.toISO(r['約定日']),
      account:     r => Utils.mapAccount(r['預り区分']),
      side:        r => Utils.mapSide(r['取引']),
      shares:      r => Utils.num(r['約定数量']),
      price:       r => Utils.num(r['約定単価']),
      amount:      r => Utils.num(r['受渡金額']),
      note:        r => r['備考'] ?? '',
    },
  },
  Rakuten: {
    signature: ['約定日','口座区分','数量［株］'],
    encode: 'shift-jis',
    skipRows: 0,
    map: {
      symbolCode: r => r['銘柄コード'] ?? '',
      symbolName: r => r['銘柄名'] ?? '',
      date:        r => Utils.toISO(r['約定日']),
      account:     r => Utils.mapAccount(r['口座区分']),
      side:        r => Utils.mapSide(r['売買区分']),
      shares:      r => Utils.num(r['数量［株］']),
      price:       r => Utils.num(r['約定単価［円］'] ?? r['約定単価']),
      amount:      r => Utils.num(r['受渡金額［円］'] ?? r['受渡金額']),
      note:        r => r['備考'] ?? '',
    },
  },
  Matsui: {
    signature: ['約定日','区分','数量'],
    encode: 'shift-jis',
    skipRows: 0,
    map: {
      symbolCode: r => r['コード'] ?? r['銘柄コード'] ?? '',
      symbolName: r => r['銘柄名'] ?? '',
      date:        r => Utils.toISO(r['約定日']),
      account:     r => Utils.mapAccount(r['区分']),
      side:        r => Utils.mapSide(r['売買']),
      shares:      r => Utils.num(r['数量']),
      price:       r => Utils.num(r['単価']),
      amount:      r => Utils.num(r['受渡金額']),
      note:        r => r['摘要'] ?? '',
    },
  },
  Monex: {
    signature: ['取引日','銘柄コード','預り区分','数量'],
    encode: 'shift-jis',
    skipRows: 0,
    map: {
      symbolCode: r => r['銘柄コード'] ?? '',
      symbolName: r => r['銘柄名'] ?? '',
      date:        r => Utils.toISO(r['取引日'] ?? r['約定日']),
      account:     r => Utils.mapAccount(r['預り区分']),
      side:        r => Utils.mapSide(r['取引種別'] ?? r['売買']),
      shares:      r => Utils.num(r['数量']),
      price:       r => Utils.num(r['単価']),
      amount:      r => Utils.num(r['受渡金額']),
      note:        r => r['備考'] ?? '',
    },
  },
};

function detectBroker(headers) {
  const set = new Set(headers);
  let best = null, bestScore = 0;
  for (const [name, def] of Object.entries(BrokerAdapters)) {
    const score = def.signature.filter(h => set.has(h)).length;
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return bestScore >= 2 ? best : null;
}

function normalizeCSV(rows, broker) {
  const { map } = BrokerAdapters[broker];
  return rows.map(row => {
    const rec = { id: Utils.uid(), source: broker.toLowerCase() };
    for (const key in map) rec[key] = map[key](row);
    return rec;
  }).filter(r => r.date && r.symbolName && r.shares > 0);
}

function deduplicateKey(t) {
  return `${t.date}|${t.symbolCode}|${t.symbolName}|${t.shares}|${t.amount}`;
}
