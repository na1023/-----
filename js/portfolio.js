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

  // dividends[code] = [{ date, gross, net, grossUSD, netUSD, currency, perShare }]
  function annualDividend(holdings, dividends, year, taxAfter = false) {
    let total = 0, totalUSD = 0;
    const byCode = {};

    Object.entries(dividends).forEach(([code, divs]) => {
      const yearDivs = (divs || []).filter(d => String(d.date).startsWith(String(year)));
      if (!yearDivs.length) return;
      const gross    = yearDivs.reduce((s, d) => s + (d.gross    ?? 0), 0);
      const net      = yearDivs.reduce((s, d) => s + (d.net      ?? 0), 0);
      const grossUSD = yearDivs.reduce((s, d) => s + (d.grossUSD ?? 0), 0);
      const netUSD   = yearDivs.reduce((s, d) => s + (d.netUSD   ?? 0), 0);
      const perShare = yearDivs.reduce((s, d) => s + (d.perShare ?? 0), 0);
      const amount    = taxAfter ? net    : gross;
      const amountUSD = taxAfter ? netUSD : grossUSD;
      total    += amount;
      totalUSD += amountUSD;
      const isFund = code.startsWith('FUND_');
      const h = !isFund ? (holdings.find(h => h.code === code) ?? null) : null;
      const name = h?.name ?? (isFund ? (yearDivs[0]?.name ?? code) : code);
      byCode[code] = {
        code, name, isFund,
        shares: h?.shares ?? 0,
        account: h?.account ?? (isFund ? '投信' : '—'),
        perShare, gross, net, grossUSD, netUSD, amount, amountUSD,
      };
    });

    const byStock = Object.values(byCode).sort(
      (a, b) => (b.amount + b.amountUSD * 150) - (a.amount + a.amountUSD * 150)
    );
    return { total, totalUSD, byStock };
  }

  function monthlyDividend(holdings, dividends, year, taxAfter = false) {
    const months = Array.from({ length: 12 }, () => 0);
    Object.values(dividends).forEach(divs => {
      (divs || []).filter(d => String(d.date).startsWith(String(year))).forEach(d => {
        const m = parseInt(String(d.date).slice(5, 7), 10) - 1;
        if (m < 0 || m >= 12) return;
        months[m] += taxAfter ? (d.net ?? 0) : (d.gross ?? 0);
        // USD分は参考換算（1USD≈150円）で月別チャートに加算
        months[m] += (taxAfter ? (d.netUSD ?? 0) : (d.grossUSD ?? 0)) * 150;
      });
    });
    return months;
  }

  return { calc, calcAll, summary, annualDividend, monthlyDividend };
})();
