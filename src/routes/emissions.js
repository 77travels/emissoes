const express = require('express');
const db = require('../db');
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
async function upsertSupplier(name, phone) {
  name = String(name || '').trim();
  phone = normalizePhone(phone);
  if (!name && !phone) return null;
  const existing = await db.get('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND phone = ?', [name, phone]);
  if (existing) return Number(existing.id);
  const info = await db.run('INSERT INTO suppliers (name, phone) VALUES (?, ?)', [name, phone]);
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
    id: Number(e.id),
    passengers: JSON.parse(e.passengers || '[]'),
    segments: JSON.parse(e.segments || '[]'),
    whatsapp_message: message,
    whatsapp_group_link: waLink('', message),
    change_message: changeMessage,
    change_link: waLink(e.supplier_phone, changeMessage),
  };
}

// Lista com filtro por mês (?month=YYYY-MM) e busca (?q=)
router.get('/', async (req, res, next) => {
  try {
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
    const rows = await db.all(sql, params);

    const totals = rows.reduce((acc, r) => {
      acc.amount_charged += Number(r.amount_charged);
      acc.gross_profit += Number(r.gross_profit);
      acc.net_profit += Number(r.net_profit);
      return acc;
    }, { amount_charged: 0, gross_profit: 0, net_profit: 0 });

    res.json({ emissions: rows.map(attachExtras), totals, count: rows.length });
  } catch (e) { next(e); }
});

// Meses existentes (para o filtro)
router.get('/months', async (req, res, next) => {
  try {
    const rows = await db.all("SELECT DISTINCT substr(created_at, 1, 7) AS month FROM emissions ORDER BY month DESC");
    res.json({ months: rows.map((r) => r.month) });
  } catch (e) { next(e); }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const row = await db.get('SELECT * FROM emissions WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Emissão não encontrada' });
    res.json({ emission: attachExtras(row) });
  } catch (e) { next(e); }
});

// Prévia dos cálculos (usada pelo formulário em tempo real)
router.post('/preview', async (req, res, next) => {
  try { res.json(await computeTotals(req.body || {})); } catch (e) { next(e); }
});

async function syncToDrive(id) {
  try {
    const row = await db.get('SELECT * FROM emissions WHERE id = ?', [id]);
    if (!row) return;
    const link = waLink(row.supplier_phone, buildChangeMessage(row));
    await drive.syncEmission(row, link);
  } catch (err) {
    console.error('[drive] Falha ao sincronizar emissão', id, '-', err.message);
  }
}

router.post('/', async (req, res, next) => {
  try {
    const data = sanitizeEmissionInput(req.body || {});
    const totals = await computeTotals(data);
    const supplierId = await upsertSupplier(data.supplier_name, data.supplier_phone);
    const now = db.nowBR();

    const info = await db.run(`
      INSERT INTO emissions (
        passengers, locator, airline, segments, ocr_raw,
        program, supplier_id, supplier_name, supplier_phone,
        miles_qty, cost_per_thousand, taxes, amount_charged,
        payment_method, gateway, installments,
        card_fee_pct, card_fee_value, miles_cost, gross_profit, net_profit,
        notes, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.passengers, data.locator, data.airline, data.segments, data.ocr_raw,
        data.program, supplierId, data.supplier_name, data.supplier_phone,
        data.miles_qty, data.cost_per_thousand, data.taxes, data.amount_charged,
        data.payment_method, data.gateway, data.installments,
        totals.card_fee_pct, totals.card_fee_value, totals.miles_cost, totals.gross_profit, totals.net_profit,
        data.notes, req.session.user.id, now, now,
      ]);

    const row = await db.get('SELECT * FROM emissions WHERE id = ?', [info.lastInsertRowid]);
    syncToDrive(Number(row.id)); // assíncrono, não bloqueia a resposta
    res.json({ emission: attachExtras(row) });
  } catch (e) { next(e); }
});

router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const existing = await db.get('SELECT * FROM emissions WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Emissão não encontrada' });

    const data = sanitizeEmissionInput(req.body || {});
    const totals = await computeTotals(data);
    const supplierId = await upsertSupplier(data.supplier_name, data.supplier_phone);

    await db.run(`
      UPDATE emissions SET
        passengers=?, locator=?, airline=?, segments=?,
        ocr_raw=COALESCE(?, ocr_raw),
        program=?, supplier_id=?, supplier_name=?, supplier_phone=?,
        miles_qty=?, cost_per_thousand=?, taxes=?, amount_charged=?,
        payment_method=?, gateway=?, installments=?,
        card_fee_pct=?, card_fee_value=?, miles_cost=?, gross_profit=?, net_profit=?,
        notes=?, updated_at=?
      WHERE id=?`,
      [
        data.passengers, data.locator, data.airline, data.segments, data.ocr_raw,
        data.program, supplierId, data.supplier_name, data.supplier_phone,
        data.miles_qty, data.cost_per_thousand, data.taxes, data.amount_charged,
        data.payment_method, data.gateway, data.installments,
        totals.card_fee_pct, totals.card_fee_value, totals.miles_cost, totals.gross_profit, totals.net_profit,
        data.notes, db.nowBR(), existing.id,
      ]);

    const row = await db.get('SELECT * FROM emissions WHERE id = ?', [existing.id]);
    syncToDrive(Number(row.id));
    res.json({ emission: attachExtras(row) });
  } catch (e) { next(e); }
});

router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    const info = await db.run('DELETE FROM emissions WHERE id = ?', [req.params.id]);
    if (!info.changes) return res.status(404).json({ error: 'Emissão não encontrada' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
