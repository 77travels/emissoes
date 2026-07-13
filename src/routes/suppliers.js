const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Autocomplete de fornecedores: casa por nome OU telefone já usados antes.
router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    let rows;
    if (q) {
      const like = `%${q}%`;
      const likeDigits = like.replace(/[^\d%]/g, '') || like;
      rows = await db.all(`
        SELECT s.id, s.name, s.phone, COUNT(e.id) AS uses
        FROM suppliers s
        LEFT JOIN emissions e ON e.supplier_id = s.id
        WHERE s.name LIKE ? OR s.phone LIKE ?
        GROUP BY s.id ORDER BY uses DESC, s.name LIMIT 10`, [like, likeDigits]);
    } else {
      rows = await db.all(`
        SELECT s.id, s.name, s.phone, COUNT(e.id) AS uses
        FROM suppliers s
        LEFT JOIN emissions e ON e.supplier_id = s.id
        GROUP BY s.id ORDER BY uses DESC, s.name LIMIT 20`);
    }
    res.json({ suppliers: rows.map((r) => ({ ...r, id: Number(r.id), uses: Number(r.uses) })) });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
