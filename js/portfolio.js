'use strict';

const Portfolio = (() => {
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

  function annualDividend(holdings, dividends, year, taxAfter = false) {
    const TAX = 1 - 0.20315;
    let total = 0;
    const byStock = holdings.map(h => {
      const divs     = dividends[h.code] ?? [];
      const yearDivs = divs.filter(d => d.date.startsWith(String(year)));
      const perShare = yearDivs.reduce((s, d) => s + d.amount, 0);
      const gross    = perShare * h.shares;
      const net      = gross * TAX;
      const amount   = taxAfter ? net : gross;
      total += amount;
      return { code: h.code, name: h.name, shares: h.shares, account: h.account, perShare, gross, net, amount };
    });
    return { total, byStock: byStock.filter(x => x.perShare > 0).sort((a, b) => b.amount - a.amount) };
  }

  function monthlyDividend(holdings, dividends, year, taxAfter = false) {
    const TAX    = 1 - 0.20315;
    const months = Array.from({ length: 12 }, () => 0);
    holdings.forEach(h => {
      (dividends[h.code] ?? []).filter(d => d.date.startsWith(String(year))).forEach(d => {
        const m     = parseInt(d.date.slice(5, 7), 10) - 1;
        const gross = d.amount * h.shares;
        months[m]  += taxAfter ? gross * TAX : gross;
      });
    });
    return months;
  }

  return { calc, calcAll, summary, annualDividend, monthlyDividend };
})();
