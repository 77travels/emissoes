// Parsers de modelos conhecidos de bilhete/comprovante — OCR local (gratuito).
//
// Cada parser reconhece um layout específico (calibrado com amostras reais da
// agência) e devolve { passengers, locator, airline, segments } no formato do
// sistema. O primeiro parser cujo detector casar com o texto é usado; se nenhum
// casar, cai nas heurísticas genéricas.
//
// Formatos calibrados:
//   A. Bilhete 77 Travels (LATAM / GOL)      — "LOCALIZADOR" + "VISUALIZAR RESERVA"
//   B. Bilhete GOL detalhado                 — "Bilhete" + "Localizador" + "VOO NNNN"
//   C. Comprovante de compra LATAM           — "Código da reserva"
//   D. E-ticket internacional (Amadeus/Qatar)— "ELECTRONICTICKETRECEIPT" / "Bookingref"

const AIRLINE_BY_PREFIX = {
  LA: 'LATAM', JJ: 'LATAM', G3: 'GOL', AD: 'Azul', TP: 'TAP Air Portugal',
  QR: 'Qatar Airways', AA: 'American Airlines', CM: 'Copa Airlines',
  AV: 'Avianca', IB: 'Iberia', AF: 'Air France', EK: 'Emirates',
  AR: 'Aerolíneas Argentinas', LH: 'Lufthansa', BA: 'British Airways',
  DL: 'Delta', UA: 'United', KL: 'KLM', TK: 'Turkish Airlines', ET: 'Ethiopian',
  AC: 'Air Canada', AM: 'Aeroméxico', UX: 'Air Europa', AZ: 'ITA Airways',
};

function airlineFromFlight(flightNumber) {
  const m = String(flightNumber || '').match(/^([A-Z][A-Z0-9])/);
  return (m && AIRLINE_BY_PREFIX[m[1]]) || '';
}

// "28/07/26" | "28/07/2026" → "2026-07-28"
function brDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// "17Mar2026" → "2026-03-17"
const EN_MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function enDate(d, mon, y) {
  const mm = EN_MONTHS[String(mon).toLowerCase().slice(0, 3)];
  return mm ? `${y}-${mm}-${String(d).padStart(2, '0')}` : '';
}

// "11h40" | "11:40" → "11:40"
function hhmm(s) {
  const m = String(s || '').match(/(\d{1,2})[h:](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

// Classifica ida/volta: em viagens de ida e volta (destino final volta à origem),
// a "volta" começa depois do maior intervalo entre trechos consecutivos.
function classifyDirections(segments) {
  if (segments.length < 2) return segments.map((s) => ({ ...s, direction: 'ida' }));
  const ts = segments.map((s) => Date.parse(`${s.date}T${s.departure_time || '00:00'}:00`) || 0);
  const roundTrip = segments[0].origin && segments[0].origin === segments[segments.length - 1].destination;
  if (!roundTrip && segments.length < 2) return segments.map((s) => ({ ...s, direction: 'ida' }));

  let maxGap = -1, splitAt = -1;
  for (let i = 1; i < segments.length; i++) {
    const gap = ts[i] - ts[i - 1];
    if (gap > maxGap) { maxGap = gap; splitAt = i; }
  }
  // Só considera volta se houver round trip ou um intervalo grande (> 20h)
  const shouldSplit = roundTrip || maxGap > 20 * 3600 * 1000;
  return segments.map((s, i) => ({ ...s, direction: shouldSplit && i >= splitAt ? 'volta' : 'ida' }));
}

const seg = (o) => ({
  direction: 'ida', date: '', origin: '', destination: '',
  departure_time: '', arrival_time: '', flight_number: '', ...o,
});

function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ── A. Bilhete 77 Travels (LATAM / GOL) ─────────────────────────────────────
// LOCALIZADOR / <PNR> / [NÚMERO DA COMPRA / <nº>] / VISUALIZAR RESERVA ...
// <LA3231> / <11h40> / <28/07/26> / <BelémBELGRUSão Paulo> / <15h20> / <28/07/26>
// ... Passageiros / PASSAGEIRO 1 / <nome em 1-2 linhas> ... / Bagagens
function parse77TravelsTicket(text) {
  if (!/LOCALIZADOR/.test(text) || !/VISUALIZAR\s+RESERVA/i.test(text)) return null;
  const ls = lines(text);
  const out = { passengers: [], locator: '', airline: '', segments: [] };

  const locIdx = ls.findIndex((l) => /^LOCALIZADOR$/i.test(l));
  if (locIdx >= 0 && ls[locIdx + 1] && /^[A-Z0-9]{5,7}$/.test(ls[locIdx + 1])) {
    out.locator = ls[locIdx + 1];
  }

  // trechos: voo / hora / data / rota / hora / data
  const flightRe = /^([A-Z][A-Z0-9])\s?(\d{3,4})$/;
  for (let i = 0; i < ls.length; i++) {
    const fm = ls[i].match(flightRe);
    if (!fm) continue;
    const depTime = hhmm(ls[i + 1]);
    const depDate = brDate(ls[i + 2]);
    const routeLine = ls[i + 3] || '';
    const arrTime = hhmm(ls[i + 4]);
    const arrDate = brDate(ls[i + 5]);
    if (!depTime || !depDate) continue;
    // rota: cidades coladas com os dois códigos IATA no meio, ex. "BelémBELGRUSão Paulo"
    const rm = routeLine.match(/[A-Z]{6,}/);
    let origin = '', destination = '';
    if (rm) { origin = rm[0].slice(0, 3); destination = rm[0].slice(3, 6); }
    out.segments.push(seg({
      date: depDate, origin, destination,
      departure_time: depTime, arrival_time: arrTime,
      flight_number: `${fm[1]}${fm[2]}`,
    }));
    i += 2;
  }

  // passageiros
  const paxIdx = ls.findIndex((l) => /^Passageiros$/i.test(l));
  if (paxIdx >= 0) {
    let current = [];
    for (let i = paxIdx + 1; i < ls.length; i++) {
      const l = ls[i];
      if (/^PASSAGEIRO\s*\d+$/i.test(l)) { if (current.length) out.passengers.push(current.join(' ')); current = []; continue; }
      if (/^Bagagens$/i.test(l) || /^CNPJ/i.test(l)) break;
      if (/^[A-ZÀ-Ü][A-ZÀ-Ü' ]+$/.test(l)) current.push(l);
      else break;
    }
    if (current.length) out.passengers.push(current.join(' '));
  }

  out.airline = airlineFromFlight(out.segments[0] && out.segments[0].flight_number);
  out.segments = classifyDirections(out.segments);
  return out.segments.length || out.locator ? out : null;
}

// ── B. Bilhete GOL detalhado ─────────────────────────────────────────────────
// Blocos: <SSA> / <Salvador> / <13/07/26 05h45> / DIRETO / <2h00> / <BSB> /
// <Brasília> / <13/07/26 07h45>; localizador em linha isolada; "VOO 1721";
// passageiro após "Passageiro"/"Assento".
function parseGolDetailedTicket(text) {
  if (!/^\s*Bilhete/m.test(text) || !/Localizador/i.test(text) || !/VOO\s*\d{3,4}/i.test(text)) return null;
  const ls = lines(text);
  const out = { passengers: [], locator: '', airline: 'GOL', segments: [] };

  const isIata = (l) => /^[A-Z]{3}$/.test(l);
  const dtRe = /^(\d{2}\/\d{2}\/\d{2,4})\s+(\d{1,2}h\d{2})$/;

  for (let i = 0; i < ls.length - 6; i++) {
    if (!isIata(ls[i])) continue;
    const dep = (ls[i + 2] || '').match(dtRe);
    if (!dep) continue;
    // procura o bloco de chegada nas próximas linhas
    for (let j = i + 3; j <= i + 8 && j < ls.length - 2; j++) {
      if (isIata(ls[j])) {
        const arr = (ls[j + 2] || '').match(dtRe);
        if (arr) {
          out.segments.push(seg({
            date: brDate(dep[1]), origin: ls[i], destination: ls[j],
            departure_time: hhmm(dep[2]), arrival_time: hhmm(arr[2]),
          }));
          i = j + 2;
        }
        break;
      }
    }
  }

  // números de voo, na ordem
  const flights = [...text.matchAll(/VOO\s*(\d{3,4})/gi)].map((m) => 'G3' + m[1]);
  out.segments.forEach((s, i) => { if (flights[i]) s.flight_number = flights[i]; });

  // localizador: linha isolada de 6 caracteres que não seja palavra comum
  const stop = new Set(['DIRETO', 'CABINE', 'VOLTA', 'ESCALA']);
  const loc = ls.find((l) => /^[A-Z0-9]{6}$/.test(l) && !stop.has(l) && !/^\d+$/.test(l));
  if (loc) out.locator = loc;

  // passageiros: linhas em maiúsculas após "Passageiro..."/"Assento"
  for (let i = 0; i < ls.length; i++) {
    if (/^Passageiro/i.test(ls[i])) {
      const current = [];
      for (let j = i + 1; j < ls.length && j <= i + 5; j++) {
        const l = ls[j];
        if (/^Assento$/i.test(l)) continue;
        if (/^[A-ZÀ-Ü][A-ZÀ-Ü' ]{3,}$/.test(l)) current.push(l);
        else if (current.length) break;
      }
      if (current.length) {
        const name = current.join(' ');
        if (!out.passengers.includes(name)) out.passengers.push(name);
      }
    }
  }

  out.segments = classifyDirections(out.segments);
  return out.segments.length || out.locator ? out : null;
}

// ── C. Comprovante de compra LATAM ───────────────────────────────────────────
// "Código da reservaSKCRZJ..." + itinerário "LA 8068 ... 28/07/2618:2029/07/2610:35"
function parseLatamReceipt(text) {
  if (!/C[óo]digo\s+da\s+reserva/i.test(text)) return null;
  const out = { passengers: [], locator: '', airline: 'LATAM', segments: [] };

  const loc = text.match(/C[óo]digo\s+da\s+reserva\s*:?\s*([A-Z0-9]{6})/i);
  if (loc) out.locator = loc[1].toUpperCase();

  // passageiro: linha após o cabeçalho, nome em maiúsculas colado em "Adulto/Criança/Bebê"
  const paxBlock = text.match(/Nome\s+do\s+Passageiro[\s\S]{0,120}?\n\s*([A-ZÀ-Ü][A-ZÀ-Ü' ]{4,60}?)(?:Adulto|Crian[çc]a|Beb[êe]|Menor|\d)/);
  if (paxBlock) out.passengers.push(paxBlock[1].trim());

  // trechos: "LA 8068" ... cidades ... "28/07/2618:2029/07/2610:35"
  // (ano com alternância 4|2 dígitos para não "roubar" o primeiro dígito da hora)
  const segRe = /\b([A-Z]{2})\s?(\d{3,4})\b([\s\S]{0,300}?)(\d{2}\/\d{2}\/(?:\d{4}|\d{2}))(\d{1,2}:\d{2})(\d{2}\/\d{2}\/(?:\d{4}|\d{2}))(\d{1,2}:\d{2})/g;
  for (const m of text.matchAll(segRe)) {
    const cities = m[3].replace(/\s+/g, ' ').trim();
    let origin = '', destination = '';
    const two = cities.match(/^(.+?\))\s*(.+?\))/);      // "São Paulo (Guarulhos Intl.) París (Charles De Gaulle)"
    if (two) { origin = two[1].trim(); destination = two[2].trim(); }
    else {
      const words = cities.split(' ');
      origin = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      destination = words.slice(Math.ceil(words.length / 2)).join(' ');
    }
    out.segments.push(seg({
      date: brDate(m[4]), origin, destination,
      departure_time: hhmm(m[5]), arrival_time: hhmm(m[7]),
      flight_number: `${m[1]}${m[2]}`,
    }));
  }

  if (out.segments[0]) out.airline = airlineFromFlight(out.segments[0].flight_number) || 'LATAM';
  // ida/volta: origem textual do 1º == destino do último
  if (out.segments.length >= 2) {
    const first = out.segments[0], last = out.segments[out.segments.length - 1];
    if (first.origin && first.origin === last.destination) {
      out.segments = classifyDirections(out.segments);
    } else {
      out.segments = classifyDirections(out.segments);
    }
  }
  return out.segments.length || out.locator ? out : null;
}

// ── D. E-ticket internacional (Amadeus — ex. Qatar Airways) ──────────────────
// Texto vem sem espaços: "Passenger:PaivaCorreiaFernandaMiss(ADT)",
// "Bookingref:\n1A/7MHNHH", trechos "QR101922:50 / 17Mar2026 / 23:05 / 17Mar2026".
function parseAmadeusReceipt(text) {
  if (!/ELECTRONICTICKET|Bookingref|ELECTRONIC\s*TICKET\s*RECEIPT/i.test(text)) return null;
  const ls = lines(text);
  const out = { passengers: [], locator: '', airline: '', segments: [] };

  const loc = text.match(/Booking\s*ref\s*:?\s*(?:[A-Z0-9]{2}\/)?([A-Z0-9]{6})/i);
  if (loc) out.locator = loc[1].toUpperCase();

  // nome colado em camel case + título + (ADT)
  const pax = text.match(/Passenger\s*:?\s*([A-Za-z]+?)(?:Mr|Mrs|Ms|Miss|Mstr|Chd|Inf)?\s*\((?:ADT|CHD|INF)\)/);
  if (pax) {
    const name = pax[1].replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase().trim();
    if (name) out.passengers.push(name);
  }

  // trechos: "QR101922:50" + "17Mar2026" + "23:05" + "18Mar2026"
  const flightRe = /^([A-Z]{2})(\d{3,4})(\d{1,2}:\d{2})$/;
  const dateRe = /^(\d{1,2})([A-Za-z]{3})(\d{4})$/;
  const isAirportish = (l) => /^[A-Z][A-Z\s]{3,}$/.test(l) && !/^(TERMINAL|FLIGHT|CLASS|CABIN|DURATION|SPECIAL)/.test(l);
  const CONTINUATION = /^(INTERNATIONAL|INTL|AIRPORT)$/;

  for (let i = 0; i < ls.length; i++) {
    const fm = ls[i].replace(/\s+/g, '').match(flightRe);
    if (!fm) continue;
    const dm1 = (ls[i + 1] || '').match(dateRe);
    const arrTime = hhmm(ls[i + 2]);
    const dm2 = (ls[i + 3] || '').match(dateRe);
    if (!dm1) continue;

    // aeroportos: agrupa as linhas anteriores (continuações como "INTERNATIONAL" se juntam)
    const groups = [];
    for (let j = Math.max(0, i - 6); j < i; j++) {
      const l = ls[j].replace(/\s+/g, '');
      if (/^Terminal:/i.test(ls[j]) || /Departure|Arrival|check-?in/i.test(ls[j])) continue;
      if (!/^[A-Z]{3,}$/.test(l)) { groups.length = 0; continue; }
      if (CONTINUATION.test(l) && groups.length) groups[groups.length - 1] += ' ' + l;
      else groups.push(l);
    }
    const origin = groups.length >= 2 ? groups[groups.length - 2] : (groups[0] || '');
    const destination = groups.length >= 2 ? groups[groups.length - 1] : '';

    out.segments.push(seg({
      date: enDate(dm1[1], dm1[2], dm1[3]),
      origin, destination,
      departure_time: hhmm(fm[3]),
      arrival_time: arrTime,
      flight_number: `${fm[1]}${fm[2]}`,
    }));
    void dm2; void isAirportish;
  }

  const op = text.match(/Operatedby\s*:?\s*([A-Z][A-Z ]{3,30})/);
  out.airline = airlineFromFlight(out.segments[0] && out.segments[0].flight_number)
    || (op ? op[1].replace(/([A-Z])([A-Z]+)/g, (w) => w[0] + w.slice(1).toLowerCase()) : '');

  out.segments = classifyDirections(out.segments);
  return out.segments.length || out.locator ? out : null;
}

const PARSERS = [
  ['bilhete-77travels', parse77TravelsTicket],
  ['bilhete-gol-detalhado', parseGolDetailedTicket],
  ['comprovante-latam', parseLatamReceipt],
  ['eticket-amadeus', parseAmadeusReceipt],
];

// Tenta os parsers calibrados na ordem; devolve null se nenhum reconhecer.
function parseKnownFormats(text) {
  for (const [name, fn] of PARSERS) {
    try {
      const result = fn(text);
      if (result && (result.segments.length || result.locator)) {
        return { ...result, format: name };
      }
    } catch (e) {
      console.error(`[parser:${name}]`, e.message);
    }
  }
  return null;
}

module.exports = { parseKnownFormats, classifyDirections, airlineFromFlight, brDate, hhmm };
