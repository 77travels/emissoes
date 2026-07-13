const db = require('../db');

// Busca a taxa (%) configurada para o link de pagamento + nº de parcelas.
async function getCardFeePct(gateway, installments) {
  if (!gateway) return 0;
  const n = Math.min(Math.max(parseInt(installments, 10) || 1, 1), 12);
  const row = await db.get('SELECT pct FROM card_fees WHERE gateway = ? AND installments = ?', [gateway, n]);
  return row ? Number(row.pct) : 0;
}

// Regras de negócio:
//   custo das milhas  = (qtd milhas / 1000) * custo do milheiro
//   lucro bruto       = valor cobrado - (custo das milhas + taxas de embarque)
//   taxa do cartão    = valor cobrado * (% da tabela do link de pagamento)   [só no cartão]
//   lucro líquido     = lucro bruto - taxa do cartão
async function computeTotals({ miles_qty, cost_per_thousand, taxes, amount_charged, payment_method, gateway, installments }) {
  const miles = Number(miles_qty) || 0;
  const perThousand = Number(cost_per_thousand) || 0;
  const tax = Number(taxes) || 0;
  const charged = Number(amount_charged) || 0;

  const milesCost = (miles / 1000) * perThousand;
  const grossProfit = charged - (milesCost + tax);

  let feePct = 0;
  let feeValue = 0;
  if (payment_method === 'cartao') {
    feePct = await getCardFeePct(gateway, installments);
    feeValue = charged * (feePct / 100);
  }
  const netProfit = grossProfit - feeValue;

  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    miles_cost: r2(milesCost),
    gross_profit: r2(grossProfit),
    card_fee_pct: feePct,
    card_fee_value: r2(feeValue),
    net_profit: r2(netProfit),
  };
}

module.exports = { computeTotals, getCardFeePct };
