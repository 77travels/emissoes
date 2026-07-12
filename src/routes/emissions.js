const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { computeTotals } = require('../services/calc');
const { buildEmissionMessage, buildChangeMessage, waLink } = require('../services/whatsapp');
const drive = require('../services/drive');

const router = express.Router();
router.use(requireAuth);

function normalizePhone(p) {
  return String(p || '').replace(/[^\d+]/g, '');
}

// Garante o fornecedor na base (autocomplete futuro) e retorna o id.
function upsertSupplier(name, phone) {
  name = String(name || '').trim();
  phone = normalizePhone(phone);
  if (!name && !phone) return null;
  const existing = db.prepare('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND phone = ?').get(name, phone);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO suppliers (name, phone) VALUES (?, ?)').run(name, phone);
  return info.lastInsertRowid;
}

function sanitizeEmissionInput(body) {
  const passengers = Array.isArray(body.passengers)
    ? body.passengers.map((p) => String(p).trim()).filter(Boolean)
    : [];
  const segments = Array.isArray(body.segments)
    ? body.segments.map((s) => ({
        direction: s.direction === 'volta' ? 'volta' : 'ida',
        date: String(s.date || '').slice(0, 10),
        origin: String(s.origin || '').trim().toUpperCase(),
        destination: String(s.destination || '').trim().toUpperCase(),
        departure_time: String(s.departure_time || '').slice(0, 5),
        arrival_time: String(s.arrival_time || '').slice(0, 5),
        flight_number: String(s.flight_number || '').trim().toUpperCase(),
      }))
    : [];
  return {
    passengers: JSON.stringify(passengers),
    locator: String(body.locator || '').trim().toUpperCase(),
    airline: String(body.airline || '').trim(),
    segments: JSON.stringify(segments),
    ocr_raw: body.ocr_raw ? String(body.ocr_raw) : null,
    program: String(body.program || '').trim(),
    supplier_name: String(body.supplier_name || '').trim(),
    supplier_phone: normalizePhone(body.supplier_phone),
    miles_qty: Number(body.miles_qty) || 0,
    cost_per_thousand: Number(body.cost_per_thousand) || 0,
    taxes: Number(body.taxes) || 0,
    amount_charged: Number(body.amount_charged) || 0,
    payment_method: body.payment_method === 'cartao' ? 'cartao' : 'pix',
    gateway: ['mercadopago', 'cielo'].includes(body.gateway) ? body.gateway : null,
    installments: Math.min(Math.max(parseInt(body.installments, 10) || 1, 1), 12),
    notes: String(body.notes || '').trim(),
  };
}

function attachExtras(e) {
  const message = buildEmissionMessage(e);
  const changeMessage = buildChangeMessage(e);
  return {
    ...e,
    passengers: JSON.parse(e.passengers || '[]'),
    segments: JSON.parse(e.segments || '[]'),
    whatsapp_message: message,
    whatsapp_group_link: waLink('', message),
    change_message: changeMessage,
    change_link: waLink(e.supplier_phone, changeMessage),
  };
}

// Lista com filtro por mês (?month=YYYY-MM) e busca (?q=)
router.get('/', (req, res) => {
  const { month, q } = req.query;
  let sql = 'SELECT * FROM emissions WHERE 1=1';
  const params = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    sql += " AND substr(created_at, 1, 7) = ?";
    params.push(month);
  }
  if (q) {
    sql += ' AND (locator LIKE ? OR passengers LIKE ? OR airline LIKE ? OR supplier_name LIKE ? OR program LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY created_at DESC, id DESC';
  const rows = db.prepare(sql).all(...params);

  const totals = rows.reduce((acc, r) => {
    acc.amount_charged += r.amount_charged;
    acc.gross_profit += r.gross_profit;
    acc.net_profit += r.net_profit;
    return acc;
  }, { amount_charged: 0, gross_profit: 0, net_profit: 0 });

  res.json({ emissions: rows.map(attachExtras), totals, count: rows.length });
});

// Meses existentes (para o filtro)
router.get('/months', (req, res) => {
  const rows = db.prepare("SELECT DISTINCT substr(created_at, 1, 7) AS month FROM emissions ORDER BY month DESC").all();
  res.json({ months: rows.map((r) => r.month) });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM emissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Emissão não encontrada' });
  res.json({ emission: attachExtras(row) });
});

// Prévia dos cálculos (usada pelo formulário em tempo real)
router.post('/preview', (req, res) => {
  res.json(computeTotals(req.body || {}));
});

async function syncToDrive(id) {
  try {
    const row = db.prepare('SELECT * FROM emissions WHERE id = ?').get(id);
    if (!row) return;
    const link = waLink(row.supplier_phone, buildChangeMessage(row));
    await drive.syncEmission(row, link);
  } catch (err) {
    console.error('[drive] Falha ao sincronizar emissão', id, '-', err.message);
  }
}

router.post('/', async (req, res) => {
  const data = sanitizeEmissionInput(req.body || {});
  const totals = computeTotals(data);
  data.supplier_id = upsertSupplier(data.supplier_name, data.supplier_phone);

  const info = db.prepare(`
    INSERT INTO emissions (
      passengers, locator, airline, segments, ocr_raw,
      program, supplier_id, supplier_name, supplier_phone,
      miles_qty, cost_per_thousand, taxes, amount_charged,
      payment_method, gateway, installments,
      card_fee_pct, card_fee_value, miles_cost, gross_profit, net_profit,
      notes, created_by
    ) VALUES (
      @passengers, @locator, @airline, @segments, @ocr_raw,
      @program, @supplier_id, @supplier_name, @supplier_phone,
      @miles_qty, @cost_per_thousand, @taxes, @amount_charged,
      @payment_method, @gateway, @installments,
      @card_fee_pct, @card_fee_value, @miles_cost, @gross_profit, @net_profit,
      @notes, @created_by
    )`).run({ ...data, ...totals, created_by: req.session.user.id });

  const row = db.prepare('SELECT * FROM emissions WHERE id = ?').get(info.lastInsertRowid);
  syncToDrive(row.id); // assíncrono, não bloqueia a resposta
  res.json({ emission: attachExtras(row) });
});

router.put('/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM emissions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Emissão não encontrada' });

  const data = sanitizeEmissionInput(req.body || {});
  const totals = computeTotals(data);
  data.supplier_id = upsertSupplier(data.supplier_name, data.supplier_phone);

  db.prepare(`
    UPDATE emissions SET
      passengers=@passengers, locator=@locator, airline=@airline, segments=@segments,
      ocr_raw=COALESCE(@ocr_raw, ocr_raw),
      program=@program, supplier_id=@supplier_id, supplier_name=@supplier_name, supplier_phone=@supplier_phone,
      miles_qty=@miles_qty, cost_per_thousand=@cost_per_thousand, taxes=@taxes, amount_charged=@amount_charged,
      payment_method=@payment_method, gateway=@gateway, installments=@installments,
      card_fee_pct=@card_fee_pct, card_fee_value=@card_fee_value, miles_cost=@miles_cost,
      gross_profit=@gross_profit, net_profit=@net_profit,
      notes=@notes, updated_at=datetime('now', 'localtime')
    WHERE id=@id`).run({ ...data, ...totals, id: existing.id });

  const row = db.prepare('SELECT * FROM emissions WHERE id = ?').get(existing.id);
  syncToDrive(row.id);
  res.json({ emission: attachExtras(row) });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM emissions WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Emissão não encontrada' });
  res.json({ ok: true });
});

module.exports = router;
