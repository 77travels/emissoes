const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

// Tabela de taxas de cartão — leitura para todos (o formulário usa para
// calcular em tempo real); edição apenas master/admin.
router.get('/card-fees', requireAuth, async (req, res, next) => {
  try {
    const rows = await db.all('SELECT gateway, installments, pct FROM card_fees ORDER BY gateway, installments');
    res.json({ fees: rows.map((r) => ({ gateway: r.gateway, installments: Number(r.installments), pct: Number(r.pct) })) });
  } catch (e) { next(e); }
});

router.put('/card-fees', requireRole('master', 'admin'), async (req, res, next) => {
  try {
    const fees = Array.isArray(req.body && req.body.fees) ? req.body.fees : [];
    const stmts = [];
    for (const f of fees) {
      if (!['mercadopago', 'cielo'].includes(f.gateway)) continue;
      const n = parseInt(f.installments, 10);
      if (!(n >= 1 && n <= 12)) continue;
      stmts.push({ sql: 'UPDATE card_fees SET pct = ? WHERE gateway = ? AND installments = ?', args: [Number(f.pct) || 0, f.gateway, n] });
    }
    if (stmts.length) await db.batchRun(stmts);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Dicas de extração — usadas apenas quando o OCR com IA (OCR_ENGINE=claude)
// estiver ativado; são anexadas ao prompt a cada leitura.
router.get('/extraction-hints', requireRole('master', 'admin'), async (req, res, next) => {
  try { res.json({ hints: (await db.getSetting('extraction_hints')) || '' }); } catch (e) { next(e); }
});

router.put('/extraction-hints', requireRole('master', 'admin'), async (req, res, next) => {
  try {
    await db.setSetting('extraction_hints', String((req.body && req.body.hints) || ''));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
