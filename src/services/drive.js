// Integração com o Google Drive / Google Sheets da agência.
//
// Estrutura criada no Drive conectado (conta da agência):
//   Emissões 77 Travels/
//     2026/
//       Emissões 2026-07/   ← planilha Google Sheets do mês, uma linha por emissão
//
// Conexão via OAuth 2.0: o usuário master clica em "Conectar Google Drive" nas
// Configurações e autoriza com o e-mail da agência. Os tokens ficam no banco.

const { google } = require('googleapis');
const { getSetting, setSetting } = require('../db');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const HEADER = [
  'ID', 'Data', 'Passageiro(s)', 'Localizador', 'Companhia', 'Trechos',
  'Programa de fidelidade', 'Fornecedor', 'Telefone do fornecedor',
  'Qtd. milhas', 'Custo do milheiro (R$)', 'Custo das milhas (R$)', 'Taxas (R$)',
  'Valor cobrado (R$)', 'Forma de pagamento', 'Link de pagamento', 'Parcelas',
  'Taxa do cartão (%)', 'Taxa do cartão (R$)', 'Lucro bruto (R$)', 'Lucro líquido (R$)',
  'Observações', 'Alterações (WhatsApp)',
];

function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/drive/callback',
  );
}

async function getAuthorizedClient() {
  const raw = await getSetting('google_tokens');
  if (!raw) return null;
  const client = getOAuthClient();
  client.setCredentials(JSON.parse(raw));
  // Persiste tokens renovados automaticamente
  client.on('tokens', async (tokens) => {
    try {
      const current = JSON.parse((await getSetting('google_tokens')) || '{}');
      await setSetting('google_tokens', JSON.stringify({ ...current, ...tokens }));
    } catch (e) { console.error('[drive] falha ao salvar tokens renovados:', e.message); }
  });
  return client;
}

async function isConnected() {
  return Boolean(await getSetting('google_tokens'));
}

function getAuthUrl() {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function handleCallback(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  await setSetting('google_tokens', JSON.stringify(tokens));
}

async function disconnect() {
  await setSetting('google_tokens', null);
  await setSetting('drive_root_id', null);
}

async function findOrCreateFolder(drive, name, parentId) {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(' and ');
  const res = await drive.files.list({ q, fields: 'files(id, name)' });
  if (res.data.files.length) return res.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });
  return created.data.id;
}

async function findOrCreateMonthlySheet(auth, dateISO) {
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  const d = dateISO ? new Date(dateISO) : new Date();
  const year = String(d.getFullYear());
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  const sheetName = `Emissões ${year}-${monthNum} (${MONTHS_PT[d.getMonth()]})`;

  const rootId = await findOrCreateFolder(drive, 'Emissões 77 Travels', null);
  await setSetting('drive_root_id', rootId);
  const yearId = await findOrCreateFolder(drive, year, rootId);

  const q = `name = '${sheetName}' and mimeType = 'application/vnd.google-apps.spreadsheet' and '${yearId}' in parents and trashed = false`;
  const res = await drive.files.list({ q, fields: 'files(id, name)' });
  if (res.data.files.length) return res.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name: sheetName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [yearId],
    },
    fields: 'id',
  });
  const spreadsheetId = created.data.id;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER] },
  });
  return spreadsheetId;
}

function emissionToRow(e, changeLink) {
  const passengers = JSON.parse(e.passengers || '[]');
  const segments = JSON.parse(e.segments || '[]');
  const segTxt = segments.map((s) =>
    `[${s.direction}] ${s.date} ${s.origin}→${s.destination} ${s.departure_time}-${s.arrival_time}${s.flight_number ? ` (${s.flight_number})` : ''}`
  ).join(' | ');
  return [
    e.id, e.created_at, passengers.join(', '), e.locator, e.airline, segTxt,
    e.program, e.supplier_name, e.supplier_phone,
    e.miles_qty, e.cost_per_thousand, e.miles_cost, e.taxes,
    e.amount_charged, e.payment_method === 'cartao' ? 'Cartão de crédito' : 'Pix',
    e.gateway === 'mercadopago' ? 'Mercado Pago' : (e.gateway === 'cielo' ? 'Cielo' : ''),
    e.payment_method === 'cartao' ? e.installments : '',
    e.card_fee_pct, e.card_fee_value, e.gross_profit, e.net_profit,
    e.notes || '',
    changeLink ? `=HYPERLINK("${changeLink}"; "Alterações")` : '',
  ];
}

// Acrescenta (ou atualiza) a linha da emissão na planilha do mês correspondente.
async function syncEmission(emission, changeLink) {
  const auth = await getAuthorizedClient();
  if (!auth) return { synced: false, reason: 'Google Drive não conectado' };

  const spreadsheetId = await findOrCreateMonthlySheet(auth, emission.created_at);
  const sheets = google.sheets({ version: 'v4', auth });

  // Procura linha existente com o mesmo ID (coluna A) para atualizar em vez de duplicar
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'A2:A' });
  const ids = (existing.data.values || []).map((r) => String(r[0]));
  const idx = ids.indexOf(String(emission.id));
  const row = emissionToRow(emission, changeLink);

  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `A${idx + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }
  return { synced: true, spreadsheetId };
}

module.exports = { isConfigured, isConnected, getAuthUrl, handleCallback, disconnect, syncEmission };
