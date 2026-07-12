const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { extractVoucher } = require('../services/extract');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Envie um PDF ou imagem (JPG, PNG, GIF, WebP)'), ok);
  },
});

// Recebe o voucher/confirmação e devolve os campos extraídos (editáveis na tela).
router.post('/', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    try {
      const result = await extractVoucher(req.file.buffer, req.file.mimetype);
      res.json(result);
    } catch (e) {
      console.error('[ocr]', e);
      res.status(500).json({ error: 'Falha ao extrair os dados: ' + e.message });
    }
  });
});

module.exports = router;
