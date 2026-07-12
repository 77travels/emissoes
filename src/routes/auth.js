const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  }
  req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  res.json({ user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ ok: true });
});

module.exports = router;
