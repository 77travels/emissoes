const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();

// Tabela de taxas de cartão — leitura para todos (o formulário usa para
// calcular em tempo real); edição apenas master/admin.
router.get('/card-fees', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT gateway, installments, pct FROM card_fees ORDER BY gateway, installments').all();
  res.json({ fees: rows });
});

router.put('/card-fees', requireRole('master', 'admin'), (req, res) => {
  const fees = Array.isArray(req.body && req.body.fees) ? req.body.fees : [];
  const upd = db.prepare('UPDATE card_fees SET pct = ? WHERE gateway = ? AND installments = ?');
  const tx = db.transaction(() => {
    for (const f of fees) {
      if (!['mercadopago', 'cielo'].includes(f.gateway)) continue;
      const n = parseInt(f.installments, 10);
      if (!(n >= 1 && n <= 12)) continue;
      upd.run(Number(f.pct) || 0, f.gateway, n);
    }
  });
  tx();
  res.json({ ok: true });
});

// Dicas de extração — é assim que o sistema "aprende" novos modelos de voucher:
// regras/observações em texto que são anexadas ao prompt do OCR inteligente.
router.get('/extraction-hints', requireRole('master', 'admin'), (req, res) => {
  res.json({ hints: getSetting('extraction_hints') || '' });
});

router.put('/extraction-hints', requireRole('master', 'admin'), (req, res) => {
  setSetting('extraction_hints', String((req.body && req.body.hints) || ''));
  res.json({ ok: true });
});

module.exports = router;
