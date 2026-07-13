const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

// Gestão de usuários: master e admin podem gerenciar; somente o master pode
// conceder/remover o papel de administrador.
router.use(requireRole('master', 'admin'));

router.get('/', async (req, res, next) => {
  try {
    const users = await db.all('SELECT id, email, name, role, active, created_at FROM users ORDER BY role DESC, name');
    res.json({ users });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { email, name, password, role } = req.body || {};
    if (!email || !name || !password) return res.status(400).json({ error: 'Informe e-mail, nome e senha' });
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });

    const newRole = role === 'admin' ? 'admin' : 'user';
    if (newRole === 'admin' && req.session.user.role !== 'master') {
      return res.status(403).json({ error: 'Somente o usuário master pode criar administradores' });
    }
    try {
      const info = await db.run('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)',
        [String(email).trim(), String(name).trim(), bcrypt.hashSync(password, 10), newRole]);
      res.json({ id: info.lastInsertRowid });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'Já existe usuário com esse e-mail' });
      throw e;
    }
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const target = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.role === 'master') return res.status(403).json({ error: 'O usuário master não pode ser alterado por aqui' });

    const { name, role, active, password } = req.body || {};
    if (role !== undefined && role !== target.role) {
      if (req.session.user.role !== 'master') {
        return res.status(403).json({ error: 'Somente o usuário master pode alterar o tipo de usuário' });
      }
      if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Tipo de usuário inválido' });
      await db.run('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
    }
    if (name) await db.run('UPDATE users SET name = ? WHERE id = ?', [String(name).trim(), target.id]);
    if (active !== undefined) await db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, target.id]);
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), target.id]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const target = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.email.toLowerCase() === db.MASTER_EMAIL || target.role === 'master') {
      return res.status(403).json({ error: 'O usuário master não pode ser excluído' });
    }
    if (target.role === 'admin' && req.session.user.role !== 'master') {
      return res.status(403).json({ error: 'Somente o usuário master pode excluir administradores' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [target.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
