// Middlewares de autenticação/autorização baseados em sessão.

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Não autenticado' });
}

// roles: lista de papéis permitidos, ex.: requireRole('master', 'admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Sem permissão' });
    next();
  };
}

module.exports = { requireAuth, requireRole };
