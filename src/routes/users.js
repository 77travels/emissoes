const express = require('express');
const bcrypt = require('bcryptjs');
const { db, MASTER_EMAIL } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

// Gestão de usuários: master e admin podem gerenciar; somente o master pode
// conceder/remover o papel de administrador.
router.use(requireRole('master', 'admin'));

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY role DESC, name').all();
  res.json({ users });
});

router.post('/', (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!email || !name || !password) return res.status(400).json({ error: 'Informe e-mail, nome e senha' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });

  const newRole = role === 'admin' ? 'admin' : 'user';
  if (newRole === 'admin' && req.session.user.role !== 'master') {
    return res.status(403).json({ error: 'Somente o usuário master pode criar administradores' });
  }
  try {
    const info = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)')
      .run(String(email).trim(), String(name).trim(), bcrypt.hashSync(password, 10), newRole);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Já existe usuário com esse e-mail' });
    throw e;
  }
});

router.patch('/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (target.role === 'master') return res.status(403).json({ error: 'O usuário master não pode ser alterado por aqui' });

  const { name, role, active, password } = req.body || {};
  if (role !== undefined && role !== target.role) {
    if (req.session.user.role !== 'master') {
      return res.status(403).json({ error: 'Somente o usuário master pode alterar o tipo de usuário' });
    }
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Tipo de usuário inválido' });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  }
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), target.id);
  if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, target.id);
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), target.id);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (target.email.toLowerCase() === MASTER_EMAIL || target.role === 'master') {
    return res.status(403).json({ error: 'O usuário master não pode ser excluído' });
  }
  if (target.role === 'admin' && req.session.user.role !== 'master') {
    return res.status(403).json({ error: 'Somente o usuário master pode excluir administradores' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

module.exports = router;
