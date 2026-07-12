const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const drive = require('../services/drive');
const { buildChangeMessage, waLink } = require('../services/whatsapp');

const router = express.Router();

router.get('/status', requireRole('master', 'admin'), (req, res) => {
  res.json({ configured: drive.isConfigured(), connected: drive.isConnected() });
});

router.get('/connect', requireRole('master', 'admin'), (req, res) => {
  if (!drive.isConfigured()) {
    return res.status(400).json({ error: 'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor (.env)' });
  }
  res.json({ url: drive.getAuthUrl() });
});

// Callback do OAuth do Google — não exige sessão (o Google redireciona o navegador).
router.get('/callback', async (req, res) => {
  try {
    if (!req.query.code) throw new Error('Código de autorização ausente');
    await drive.handleCallback(String(req.query.code));
    res.redirect('/?drive=ok');
  } catch (e) {
    console.error('[drive] callback:', e.message);
    res.redirect('/?drive=erro');
  }
});

router.post('/disconnect', requireRole('master', 'admin'), (req, res) => {
  drive.disconnect();
  res.json({ ok: true });
});

// Reenvia todas as emissões (ou de um mês) para as planilhas do Drive.
router.post('/sync', requireRole('master', 'admin'), async (req, res) => {
  if (!drive.isConnected()) return res.status(400).json({ error: 'Google Drive não conectado' });
  const { month } = req.body || {};
  let sql = 'SELECT * FROM emissions';
  const params = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    sql += " WHERE substr(created_at, 1, 7) = ?";
    params.push(month);
  }
  const rows = db.prepare(sql).all(...params);
  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      await drive.syncEmission(row, waLink(row.supplier_phone, buildChangeMessage(row)));
      ok++;
    } catch (e) {
      console.error('[drive] sync emissão', row.id, e.message);
      fail++;
    }
  }
  res.json({ ok, fail, total: rows.length });
});

module.exports = router;
