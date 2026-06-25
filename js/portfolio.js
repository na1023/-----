'use strict';

const Portfolio = (() => {
  const TAX = 1 - 0.20315;

  function calc(h, quote) {
    const price     = quote?.price ?? h.avgCost;
    const cost      = h.avgCost * h.shares;
    const value     = price * h.shares;
    const pnl       = value - cost;
    const pnlPct    = cost > 0 ? pnl / cost * 100 : 0;
    const dayChg    = (quote?.change ?? 0) * h.shares;
    const dayChgPct = quote?.changePct ?? 0;
    return { ...h, price, cost, value, pnl, pnlPct, dayChg, dayChgPct };
  }

  function calcAll(holdings, quotes) {
    return holdings.map(h => calc(h, quotes[h.code] ?? null));
  }

  function summary(enriched) {
    const totalValue = enriched.reduce((s, h) => s + h.value, 0);
    const totalCost  = enriched.reduce((s, h) => s + h.cost,  0);
    const pnl        = totalValue - totalCost;
    const pnlPct     = totalCost > 0 ? pnl / totalCost * 100 : 0;
    const dayChg     = enriched.reduce((s, h) => s + h.dayChg, 0);
    return { totalValue, totalCost, pnl, pnlPct, dayChg };
  }

  // dividends[code] = [{ date, gross, net, perShare }]  ← CSV実績金額
  function annualDividend(holdings, dividends, year, taxAfter = false) {
    let total = 0;
    const byCode = {};

    Object.entries(dividends).forEach(([code, divs]) => {
      const yearDivs = (divs || []).filter(d => String(d.date).startsWith(String(year)));
      if (!yearDivs.length) return;
      const gross    = yearDivs.reduce((s, d) => s + (d.gross ?? 0), 0);
      const net      = yearDivs.reduce((s, d) => s + (d.net   ?? gross * TAX), 0);
      const perShare = yearDivs.reduce((s, d) => s + (d.perShare ?? 0), 0);
      const amount   = taxAfter ? net : gross;
      total += amount;
      const h = holdings.find(h => h.code === code) ?? { code, name: code, shares: 0, account: '—' };
      byCode[code] = { code, name: h.name, shares: h.shares, account: h.account, perShare, gross, net, amount };
    });

    const byStock = Object.values(byCode).sort((a, b) => b.amount - a.amount);
    return { total, byStock };
  }

  function monthlyDividend(holdings, dividends, year, taxAfter = false) {
    const months = Array.from({ length: 12 }, () => 0);
    Object.values(dividends).forEach(divs => {
      (divs || []).filter(d => String(d.date).startsWith(String(year))).forEach(d => {
        const m     = parseInt(String(d.date).slice(5, 7), 10) - 1;
        const gross = d.gross ?? 0;
        const net   = d.net   ?? gross * TAX;
        if (m >= 0 && m < 12) months[m] += taxAfter ? net : gross;
      });
    });
    return months;
  }

  return { calc, calcAll, summary, annualDividend, monthlyDividend };
})();
