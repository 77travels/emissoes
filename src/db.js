// Camada de banco de dados — libsql/SQLite.
//
// Local (padrão): arquivo data/emissoes.db.
// Nuvem (hospedagem gratuita): defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no
// ambiente — o banco passa a viver no Turso (turso.tech, plano gratuito) e os
// dados sobrevivem a reinícios/redeploys de hosts com disco efêmero (Render Free).

const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const MASTER_EMAIL = 'gestao@77travels.com.br';

let url = process.env.TURSO_DATABASE_URL;
if (!url) {
  const DATA_DIR = path.join(__dirname, '..', 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  url = 'file:' + path.join(DATA_DIR, 'emissoes.db');
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

// ── helpers de consulta ──────────────────────────────────────────────────────
async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}
async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] || null;
}
async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return { changes: res.rowsAffected, lastInsertRowid: res.lastInsertRowid == null ? null : Number(res.lastInsertRowid) };
}
// várias escritas atômicas
async function batchRun(statements) {
  return client.batch(statements.map((s) => (typeof s === 'string' ? s : { sql: s.sql, args: s.args || [] })), 'write');
}

// Data/hora no fuso da agência (America/Sao_Paulo), formato "YYYY-MM-DD HH:MM:SS".
function nowBR() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date()).replace('T', ' ');
}

// ── esquema + seeds ──────────────────────────────────────────────────────────
const SCHEMA = `
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
  passengers TEXT NOT NULL DEFAULT '[]',
  locator TEXT NOT NULL DEFAULT '',
  airline TEXT NOT NULL DEFAULT '',
  segments TEXT NOT NULL DEFAULT '[]',
  ocr_raw TEXT,
  program TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_phone TEXT NOT NULL DEFAULT '',
  miles_qty REAL NOT NULL DEFAULT 0,
  cost_per_thousand REAL NOT NULL DEFAULT 0,
  taxes REAL NOT NULL DEFAULT 0,
  amount_charged REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'pix' CHECK (payment_method IN ('pix','cartao')),
  gateway TEXT CHECK (gateway IN ('mercadopago','cielo')),
  installments INTEGER NOT NULL DEFAULT 1,
  card_fee_pct REAL NOT NULL DEFAULT 0,
  card_fee_value REAL NOT NULL DEFAULT 0,
  miles_cost REAL NOT NULL DEFAULT 0,
  gross_profit REAL NOT NULL DEFAULT 0,
  net_profit REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS ocr_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  file_data BLOB NOT NULL,
  format_type TEXT,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let ready = null;

async function init() {
  await client.executeMultiple(SCHEMA);

  const hasMaster = await get('SELECT 1 AS ok FROM users WHERE role = ?', ['master']);
  if (!hasMaster) {
    const initial = process.env.MASTER_INITIAL_PASSWORD || '77travels';
    await run('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)',
      [MASTER_EMAIL, 'Hugo Mendes', bcrypt.hashSync(initial, 10), 'master']);
    console.log(`[db] Usuário master criado: ${MASTER_EMAIL} (senha inicial definida em MASTER_INITIAL_PASSWORD)`);
  }

  const feeCount = await get('SELECT COUNT(*) AS n FROM card_fees');
  if (Number(feeCount.n) === 0) {
    const stmts = [];
    for (const gw of ['mercadopago', 'cielo']) {
      for (let i = 1; i <= 12; i++) {
        stmts.push({ sql: 'INSERT INTO card_fees (gateway, installments, pct) VALUES (?,?,?)', args: [gw, i, 0] });
      }
    }
    await batchRun(stmts);
  }
  console.log(`[db] Banco pronto (${url.startsWith('file:') ? 'arquivo local' : 'Turso'})`);
}

// init único, aguardável de qualquer módulo
function ensureReady() {
  if (!ready) ready = init();
  return ready;
}

// ── settings ─────────────────────────────────────────────────────────────────
async function getSetting(key) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}
async function setSetting(key, value) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value == null ? null : String(value)]);
}

module.exports = { all, get, run, batchRun, nowBR, ensureReady, getSetting, setSetting, MASTER_EMAIL };
