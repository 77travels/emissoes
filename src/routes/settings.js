const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

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

// Upload de amostras de bilhetes/comprovantes para calibração de novos parsers
router.post('/ocr-samples', requireRole('master', 'admin'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
    }
    const { format_type, notes } = req.body || {};

    await db.run(
      'INSERT INTO ocr_samples (filename, file_data, format_type, notes, uploaded_by) VALUES (?,?,?,?,?)',
      [req.file.originalname, req.file.buffer, String(format_type || ''), String(notes || ''), req.session.user.id]
    );
    res.json({ ok: true, message: 'Amostra enviada com sucesso. Analisaremos e criaremos um novo parser se necessário.' });
  } catch (e) { next(e); }
});

// Listar amostras enviadas
router.get('/ocr-samples', requireRole('master', 'admin'), async (req, res, next) => {
  try {
    const samples = await db.all(
      'SELECT id, filename, format_type, notes, uploaded_by, created_at FROM ocr_samples ORDER BY created_at DESC'
    );
    res.json({ samples });
  } catch (e) { next(e); }
});

// Deletar amostra
router.delete('/ocr-samples/:id', requireRole('master', 'admin'), async (req, res, next) => {
  try {
    const sample = await db.get('SELECT id FROM ocr_samples WHERE id = ?', [req.params.id]);
    if (!sample) return res.status(404).json({ error: 'Amostra não encontrada' });
    await db.run('DELETE FROM ocr_samples WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
