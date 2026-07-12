const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Autocomplete de fornecedores: casa por nome OU telefone já usados antes.
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT s.id, s.name, s.phone, COUNT(e.id) AS uses
      FROM suppliers s
      LEFT JOIN emissions e ON e.supplier_id = s.id
      WHERE s.name LIKE ? OR s.phone LIKE ?
      GROUP BY s.id ORDER BY uses DESC, s.name LIMIT 10`).all(like, like.replace(/[^\d%]/g, '') || like);
  } else {
    rows = db.prepare(`
      SELECT s.id, s.name, s.phone, COUNT(e.id) AS uses
      FROM suppliers s
      LEFT JOIN emissions e ON e.supplier_id = s.id
      GROUP BY s.id ORDER BY uses DESC, s.name LIMIT 20`).all();
  }
  res.json({ suppliers: rows });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
