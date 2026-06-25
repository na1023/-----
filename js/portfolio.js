'use strict';

const Portfolio = (() => {
  const TAX   = 0.20315;
  const NISA  = new Set(['NISA', '新NISA成長', '新NISA積立']);

  /* 有効な銘柄コード（4桁数字）かチェック */
  function isValidCode(code) { return /^\d{4}$/.test(String(code ?? '')); }

  /* ===== 株式分割の自動反映 ===== */
  // { code: [{date:'YYYY-MM-DD', factor:Number}] }  factor=10 なら 1→10分割
  let SPLITS = {};
  function setSplits(map) { SPLITS = map || {}; }

  // 指定日「より後」に起きた分割の累積倍率（取引時の株数を現在基準へ換算）
  function splitFactorAfter(code, date) {
    const list = SPLITS[code];
    if (!list || !list.length) return 1;
    let f = 1;
    for (const s of list) { if (s.date > date) f *= s.factor; }
    return f;
  }

  // 取引の株数を現在基準に補正（受渡金額＝総額は不変、単価のみ変わる）
  function adjShares(t) {
    const code = t.symbolCode || t.symbolName;
    return t.shares * splitFactorAfter(code, t.date);
  }

  /* 保有銘柄一覧（口座別に残株・コスト追跡） */
  function getHoldings(trades) {
    const lots = {}; // key: `${code}::${account}`

    [...trades]
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(t => {
        const code = t.symbolCode || t.symbolName;
        const key  = `${code}::${t.account}`;
        if (!lots[key]) lots[key] = {
          symbolCode: t.symbolCode ?? '',
          symbolName: t.symbolName ?? '',
          account:    t.account ?? '特定',
          shares: 0, totalCost: 0,
        };
        const h = lots[key];
        const sh = adjShares(t);     // 分割補正後の株数
        if (t.side === 'buy') {
          h.shares    += sh;
          h.totalCost += Math.abs(t.amount);
        } else {
          if (h.shares > 0) {
            const ratio  = Math.min(sh / h.shares, 1);
            h.totalCost -= h.totalCost * ratio;
          }
          h.shares = Math.max(0, h.shares - sh);
        }
      });

    /* 銘柄単位に集約 */
    const byCode = {};
    Object.values(lots).filter(h => h.shares > 0.001).forEach(h => {
      const code = h.symbolCode || h.symbolName;
      if (!byCode[code]) byCode[code] = {
        symbolCode: h.symbolCode,
        symbolName: h.symbolName,
        shares: 0, totalCost: 0,
        accounts: [],
      };
      byCode[code].shares    += h.shares;
      byCode[code].totalCost += h.totalCost;
      byCode[code].accounts.push({ account: h.account, shares: h.shares, cost: h.totalCost });
    });

    return Object.values(byCode).map(h => ({
      ...h,
      avgCost:       h.shares > 0 ? h.totalCost / h.shares : 0,
      hasValidCode:  isValidCode(h.symbolCode),
    }));
  }

  /* 指定日より前に保有していた株数（口座別） */
  function sharesAtDateByAccount(trades, symbolCode, exDate) {
    const acc = {};
    [...trades]
      .filter(t => (t.symbolCode === symbolCode || t.symbolName === symbolCode) && t.date < exDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(t => {
        const a = t.account ?? '特定';
        const sh = adjShares(t);
        acc[a] = (acc[a] ?? 0) + (t.side === 'buy' ? sh : -sh);
      });
    return acc;
  }

  /* 配当受取額の計算（権利落ち日ベース・口座別課税） */
  function calcDividendsReceived(trades, symbolCode, dividendHistory) {
    return dividendHistory
      .map(div => {
        const accShares = sharesAtDateByAccount(trades, symbolCode, div.date);
        let gross = 0, net = 0, totalShares = 0;
        for (const [account, shares] of Object.entries(accShares)) {
          if (shares <= 0) continue;
          const tax     = NISA.has(account) ? 0 : TAX;
          const amount  = shares * div.amount;
          gross      += amount;
          net        += amount * (1 - tax);
          totalShares += shares;
        }
        return { ...div, gross, net, shares: totalShares, year: div.date.slice(0,4), month: div.date.slice(0,7) };
      })
      .filter(d => d.gross > 0);
  }

  /* 直近12ヶ月の年間配当/株（利回り計算用） */
  function annualDivPerShare(dividendHistory) {
    const now      = new Date().toISOString().slice(0, 10);
    const oneYrAgo = new Date(); oneYrAgo.setFullYear(oneYrAgo.getFullYear() - 1);
    const cutoff   = oneYrAgo.toISOString().slice(0, 10);
    return dividendHistory
      .filter(d => d.date >= cutoff && d.date <= now)
      .reduce((s, d) => s + d.amount, 0);
  }

  /* 実現損益（FIFO方式・年度別） */
  function getRealizedPnL(trades) {
    const lots   = {};  // { code: [{shares, costPerShare}] }
    const yearly = {};  // { year: { realized, buyAmt, sellAmt, taxEst } }

    [...trades]
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(t => {
        const code = t.symbolCode || t.symbolName;
        const year = t.date.slice(0, 4);
        if (!yearly[year]) yearly[year] = { realized: 0, buyAmt: 0, sellAmt: 0 };
        if (!lots[code])   lots[code]   = [];

        if (t.side === 'buy') {
          const sh = adjShares(t);
          lots[code].push({ shares: sh, costPerShare: Math.abs(t.amount) / sh });
          yearly[year].buyAmt += Math.abs(t.amount);
        } else {
          let remaining = adjShares(t), costBasis = 0;
          while (remaining > 0.001 && lots[code].length > 0) {
            const lot  = lots[code][0];
            const used = Math.min(remaining, lot.shares);
            costBasis   += used * lot.costPerShare;
            lot.shares  -= used;
            remaining   -= used;
            if (lot.shares < 0.001) lots[code].shift();
          }
          yearly[year].realized  += Math.abs(t.amount) - costBasis;
          yearly[year].sellAmt   += Math.abs(t.amount);
        }
      });

    Object.values(yearly).forEach(y => {
      y.taxEst = y.realized > 0 ? y.realized * TAX : 0;
    });
    return yearly;
  }

  return { getHoldings, calcDividendsReceived, annualDivPerShare, getRealizedPnL, isValidCode, setSplits };
})();
