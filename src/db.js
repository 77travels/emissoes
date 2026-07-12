const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'emissoes.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('master','admin','user')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name COLLATE NOCASE, phone)
);

CREATE TABLE IF NOT EXISTS emissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- capturado por OCR (editável)
  passengers TEXT NOT NULL DEFAULT '[]',      -- JSON: ["NOME", ...]
  locator TEXT NOT NULL DEFAULT '',
  airline TEXT NOT NULL DEFAULT '',
  segments TEXT NOT NULL DEFAULT '[]',        -- JSON: [{direction,date,origin,destination,departure_time,arrival_time,flight_number}]
  ocr_raw TEXT,                               -- texto bruto extraído, para auditoria
  -- preenchido manualmente
  program TEXT NOT NULL DEFAULT '',           -- programa de fidelidade
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_phone TEXT NOT NULL DEFAULT '',
  miles_qty REAL NOT NULL DEFAULT 0,
  cost_per_thousand REAL NOT NULL DEFAULT 0,  -- custo do milheiro (R$)
  taxes REAL NOT NULL DEFAULT 0,              -- taxas de embarque (R$)
  amount_charged REAL NOT NULL DEFAULT 0,     -- valor cobrado do cliente (R$)
  payment_method TEXT NOT NULL DEFAULT 'pix' CHECK (payment_method IN ('pix','cartao')),
  gateway TEXT CHECK (gateway IN ('mercadopago','cielo')),
  installments INTEGER NOT NULL DEFAULT 1,
  -- calculado pelo sistema
  card_fee_pct REAL NOT NULL DEFAULT 0,
  card_fee_value REAL NOT NULL DEFAULT 0,
  miles_cost REAL NOT NULL DEFAULT 0,
  gross_profit REAL NOT NULL DEFAULT 0,
  net_profit REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS card_fees (
  gateway TEXT NOT NULL CHECK (gateway IN ('mercadopago','cielo')),
  installments INTEGER NOT NULL CHECK (installments BETWEEN 1 AND 12),
  pct REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (gateway, installments)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// ── seeds ────────────────────────────────────────────────────────────────────
const MASTER_EMAIL = 'gestao@77travels.com.br';
const hasMaster = db.prepare('SELECT 1 FROM users WHERE role = ?').get('master');
if (!hasMaster) {
  const initial = process.env.MASTER_INITIAL_PASSWORD || '77travels';
  db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)')
    .run(MASTER_EMAIL, 'Gestão 77 Travels', bcrypt.hashSync(initial, 10), 'master');
  console.log(`[db] Usuário master criado: ${MASTER_EMAIL} (senha inicial definida em MASTER_INITIAL_PASSWORD)`);
}

// Tabela de taxas padrão (placeholder) — a agência ajusta em Configurações com
// as taxas reais de cada transação do Mercado Pago e da Cielo.
const feeCount = db.prepare('SELECT COUNT(*) AS n FROM card_fees').get().n;
if (feeCount === 0) {
  const ins = db.prepare('INSERT INTO card_fees (gateway, installments, pct) VALUES (?,?,?)');
  const seed = db.transaction(() => {
    for (const gw of ['mercadopago', 'cielo']) {
      for (let i = 1; i <= 12; i++) ins.run(gw, i, 0);
    }
  });
  seed();
}

// ── settings helpers ─────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
}

module.exports = { db, getSetting, setSetting, MASTER_EMAIL };
