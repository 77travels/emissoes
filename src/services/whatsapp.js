// Montagem das mensagens de WhatsApp (grupo de emissões e alterações com fornecedor).

const GATEWAY_LABEL = { mercadopago: 'Mercado Pago', cielo: 'Cielo' };

function brl(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function intBR(v) {
  return (Number(v) || 0).toLocaleString('pt-BR');
}
function dateBR(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

function parseJSON(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

// Mensagem completa para o grupo de emissões (base para a nota fiscal).
function buildEmissionMessage(e) {
  const passengers = Array.isArray(e.passengers) ? e.passengers : parseJSON(e.passengers, []);
  const segments = Array.isArray(e.segments) ? e.segments : parseJSON(e.segments, []);

  const lines = [];
  lines.push('✈️ *NOVA EMISSÃO — 77 TRAVELS*');
  lines.push('');
  lines.push(`👤 *Passageiro(s):* ${passengers.join(', ') || '—'}`);
  lines.push(`🔖 *Localizador:* ${e.locator || '—'}`);
  lines.push(`🛩️ *Companhia aérea:* ${e.airline || '—'}`);

  const ida = segments.filter(s => s.direction !== 'volta');
  const volta = segments.filter(s => s.direction === 'volta');
  const renderSegs = (title, segs) => {
    if (!segs.length) return;
    lines.push('');
    lines.push(`*${title}*`);
    for (const s of segs) {
      const flight = s.flight_number ? ` (voo ${s.flight_number})` : '';
      lines.push(`📅 ${dateBR(s.date)}${flight}`);
      lines.push(`🛫 ${s.origin || '?'} → ${s.destination || '?'}  🕐 ${s.departure_time || '--:--'} → ${s.arrival_time || '--:--'}`);
    }
  };
  renderSegs('IDA', ida);
  renderSegs('VOLTA', volta);

  lines.push('');
  lines.push('💼 *Dados da emissão*');
  lines.push(`Programa de fidelidade: ${e.program || '—'}`);
  lines.push(`Fornecedor: ${e.supplier_name || '—'}${e.supplier_phone ? ` (${e.supplier_phone})` : ''}`);
  lines.push(`Milhas: ${intBR(e.miles_qty)} | Milheiro: ${brl(e.cost_per_thousand)}`);
  lines.push(`Custo das milhas: ${brl(e.miles_cost)}`);
  lines.push(`Taxas: ${brl(e.taxes)}`);
  lines.push(`Valor cobrado: ${brl(e.amount_charged)}`);

  if (e.payment_method === 'cartao') {
    const gw = GATEWAY_LABEL[e.gateway] || '—';
    lines.push(`Forma de pagamento: Cartão de crédito — ${gw} (${e.installments || 1}x)`);
    lines.push(`Taxa do cartão: ${brl(e.card_fee_value)} (${(e.card_fee_pct || 0).toLocaleString('pt-BR')}%)`);
  } else {
    lines.push('Forma de pagamento: Pix');
  }

  lines.push('');
  lines.push(`📊 *Lucro bruto:* ${brl(e.gross_profit)}`);
  lines.push(`📊 *Lucro líquido:* ${brl(e.net_profit)}`);
  if (e.notes) {
    lines.push('');
    lines.push(`📝 Obs.: ${e.notes}`);
  }
  return lines.join('\n');
}

// Mensagem para o fornecedor pelo botão "Alterações".
function buildChangeMessage(e) {
  const name = e.supplier_name ? ` ${e.supplier_name}` : '';
  return `Olá${name}! Preciso resolver uma alteração na emissão. Localizador: ${e.locator || '—'}.`;
}

// Normaliza telefone BR para o formato do wa.me (só dígitos, com DDI 55).
function waPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55')) digits = '55' + digits;
  return digits;
}

function waLink(phone, text) {
  const p = waPhone(phone);
  const q = encodeURIComponent(text);
  return p ? `https://wa.me/${p}?text=${q}` : `https://wa.me/?text=${q}`;
}

module.exports = { buildEmissionMessage, buildChangeMessage, waLink, waPhone };
