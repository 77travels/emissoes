// Extração dos dados do voucher / confirmação de compra (OCR).
//
// Motor padrão: OCR LOCAL e gratuito — pdf-parse para PDFs e Tesseract para
// imagens, seguido de parsers calibrados com os modelos reais da agência
// (bilhete 77 Travels LATAM/GOL, bilhete GOL detalhado, comprovante LATAM,
// e-ticket internacional Amadeus/Qatar — ver src/services/parsers.js).
// Formatos desconhecidos caem em heurísticas genéricas. Os campos são sempre
// editáveis na tela.
//
// Opcional: defina OCR_ENGINE=claude e ANTHROPIC_API_KEY no .env para usar a
// API da Anthropic (paga) — útil para layouts nunca vistos.

const { getSetting } = require('../db');
const { parseKnownFormats } = require('./parsers');

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    passengers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Nome completo de cada passageiro, em MAIÚSCULAS, como aparece no documento',
    },
    locator: { type: 'string', description: 'Localizador / código de reserva (PNR), geralmente 5-7 caracteres alfanuméricos' },
    airline: { type: 'string', description: 'Nome da companhia aérea operadora (ex.: LATAM, GOL, Azul, TAP)' },
    segments: {
      type: 'array',
      description: 'Um item por trecho voado, na ordem do itinerário',
      items: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['ida', 'volta'], description: 'ida = trechos de ida; volta = trechos de retorno. Se for só ida, use ida em todos.' },
          date: { type: 'string', description: 'Data de partida do trecho no formato YYYY-MM-DD' },
          origin: { type: 'string', description: 'Aeroporto/cidade de origem (código IATA se disponível, ex.: GRU)' },
          destination: { type: 'string', description: 'Aeroporto/cidade de destino (código IATA se disponível)' },
          departure_time: { type: 'string', description: 'Horário de partida HH:MM (24h)' },
          arrival_time: { type: 'string', description: 'Horário de chegada HH:MM (24h)' },
          flight_number: { type: 'string', description: 'Número do voo, ex.: LA3340' },
        },
        required: ['direction', 'date', 'origin', 'destination', 'departure_time', 'arrival_time', 'flight_number'],
        additionalProperties: false,
      },
    },
  },
  required: ['passengers', 'locator', 'airline', 'segments'],
  additionalProperties: false,
};

const IMAGE_TYPES = { 'image/jpeg': 'image/jpeg', 'image/png': 'image/png', 'image/gif': 'image/gif', 'image/webp': 'image/webp' };

async function extractWithClaude(buffer, mimetype) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  const data = buffer.toString('base64');
  const contentBlock = mimetype === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[mimetype] || 'image/jpeg', data } };

  // "Dicas de extração" configuráveis: exemplos/regras que a agência acumula
  // conforme envia novos modelos de voucher (é assim que o sistema "aprende").
  const hints = getSetting('extraction_hints') || '';

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    system:
      'Você extrai dados de vouchers aéreos e confirmações de compra de passagens (LATAM, GOL, Azul, Smiles, TAP e outras). ' +
      'Extraia exatamente o que está no documento, sem inventar. Datas no formato YYYY-MM-DD, horários HH:MM. ' +
      'Classifique cada trecho como "ida" ou "volta" pela ordem e sentido do itinerário; se a viagem for somente de ida, todos os trechos são "ida". ' +
      'Se um campo não existir no documento, use string vazia (ou lista vazia).' +
      (hints ? `\n\nRegras adicionais da agência (aprendidas com vouchers anteriores):\n${hints}` : ''),
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: 'Extraia os dados desta emissão de passagem aérea.' },
      ],
    }],
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('A extração foi recusada pelo modelo. Preencha os campos manualmente.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  const parsed = JSON.parse(textBlock.text);
  return { ...parsed, raw_text: null, engine: 'claude' };
}

// ── Fallback local ───────────────────────────────────────────────────────────

async function ocrLocalText(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const out = await pdfParse(buffer);
    return out.text || '';
  }
  const Tesseract = require('tesseract.js');
  const result = await Tesseract.recognize(buffer, 'por+eng');
  return result.data.text || '';
}

const AIRLINES = [
  ['LATAM', /latam/i], ['GOL', /\bgol\b|smiles/i], ['Azul', /\bazul\b|tudo ?azul/i],
  ['TAP', /\btap\b|air ?portugal/i], ['American Airlines', /american air/i],
  ['Copa Airlines', /copa air/i], ['Avianca', /avianca/i], ['Iberia', /iberia/i],
  ['Air France', /air ?france/i], ['Emirates', /emirates/i], ['Aerolíneas Argentinas', /aerol[ií]neas/i],
];

function parseHeuristics(text) {
  const result = { passengers: [], locator: '', airline: '', segments: [] };

  for (const [name, re] of AIRLINES) if (re.test(text)) { result.airline = name; break; }

  const locMatch = text.match(/(?:localizador|c[óo]digo\s+de\s+reserva|reserva|pnr|record\s+locator|booking\s+(?:code|reference))\s*[:\-]?\s*([A-Z0-9]{5,7})\b/i);
  if (locMatch) result.locator = locMatch[1].toUpperCase();

  const paxMatches = text.match(/(?:passageiro|passenger|nome)[ \t]*[:\-]?[ \t]*([A-Za-zÀ-ü][A-Za-zÀ-ü \/]{5,60})/gi) || [];
  for (const m of paxMatches.slice(0, 9)) {
    const name = m.replace(/^(passageiro|passenger|nome)[ \t]*[:\-]?[ \t]*/i, '').trim().toUpperCase();
    if (name.length >= 5 && !result.passengers.includes(name)) result.passengers.push(name);
  }

  // pares IATA "GRU → LIS" / "GRU - LIS" e horários próximos
  const segRe = /\b([A-Z]{3})\s*(?:→|->|-|a|para|to)\s*([A-Z]{3})\b/g;
  const dateRe = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;
  const timeRe = /\b(\d{1,2}):(\d{2})\b/g;
  const dates = [...text.matchAll(dateRe)].map((m) => {
    let [, d, mo, y] = m; if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  });
  const times = [...text.matchAll(timeRe)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
  const pairs = [...text.matchAll(segRe)];
  pairs.forEach((m, i) => {
    result.segments.push({
      direction: i === 0 || (pairs[0] && m[1] !== pairs[0][2] && m[2] !== pairs[0][1]) ? 'ida' : 'volta',
      date: dates[i] || '',
      origin: m[1],
      destination: m[2],
      departure_time: times[i * 2] || '',
      arrival_time: times[i * 2 + 1] || '',
      flight_number: '',
    });
  });

  return result;
}

async function extractLocal(buffer, mimetype) {
  const text = await ocrLocalText(buffer, mimetype);
  // 1º: parsers calibrados com os modelos da agência
  const known = parseKnownFormats(text);
  if (known) return { ...known, raw_text: text, engine: `local:${known.format}` };
  // 2º: heurísticas genéricas para layouts desconhecidos
  const parsed = parseHeuristics(text);
  return { ...parsed, raw_text: text, engine: 'local:generico' };
}

async function extractVoucher(buffer, mimetype) {
  // A API da Anthropic só é usada se explicitamente ativada (OCR_ENGINE=claude).
  if (process.env.OCR_ENGINE === 'claude' && process.env.ANTHROPIC_API_KEY) {
    try {
      return await extractWithClaude(buffer, mimetype);
    } catch (err) {
      console.error('[extract] Falha na extração via Claude, usando OCR local:', err.message);
    }
  }
  return extractLocal(buffer, mimetype);
}

module.exports = { extractVoucher };
