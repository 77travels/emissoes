require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

require('./src/db'); // inicializa o banco e o usuário master

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.use(session({
  name: 'emissoes77.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-troque-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 1000 * 60 * 60 * 12, // 12h
  },
}));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/emissions', require('./src/routes/emissions'));
app.use('/api/suppliers', require('./src/routes/suppliers'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/ocr', require('./src/routes/ocr'));
app.use('/api/drive', require('./src/routes/drive'));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`77 Travels — Gestão de Emissões rodando em http://localhost:${PORT}`);
});
