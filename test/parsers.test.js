// Teste de regressão dos parsers de OCR — fixtures anonimizadas que reproduzem
// os layouts reais usados na calibração. Rodar com: npm test

const assert = require('assert');
const { parseKnownFormats } = require('../src/services/parsers');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('✔', name); }
  catch (e) { failures++; console.error('✘', name, '\n ', e.message); }
}

// ── A. Bilhete 77 Travels (LATAM, ida e volta com conexão) ──────────────────
const bilhete77Latam = `
LOCALIZADOR
ZZTOP1
NÚMERO DA COMPRA
LA0000000XXXX
VISUALIZAR RESERVA
IDA
VOLTA
77 Travels - Gestão de Viagens e Milhas
Apresente documento de identidade original no check-in.
LA3231
11h40
28/07/26
BelémBELGRUSão Paulo
15h20
28/07/26
LA8068
18h20
28/07/26
São PauloGRUCDGParis
10h35
29/07/26
LA8067
13h00
04/08/26
ParisCDGGRUSão Paulo
19h50
04/08/26
LA3872
22h20
04/08/26
São PauloGRUBELBelém
2h05
05/08/26
Passageiros
PASSAGEIRO 1
FULANO DE TAL
DOS SANTOS
Bagagens
Item pessoal
1
CNPJ 60.920.172/0001-05
`;

check('bilhete 77 Travels (LATAM)', () => {
  const r = parseKnownFormats(bilhete77Latam);
  assert.equal(r.format, 'bilhete-77travels');
  assert.equal(r.locator, 'ZZTOP1');
  assert.equal(r.airline, 'LATAM');
  assert.deepEqual(r.passengers, ['FULANO DE TAL DOS SANTOS']);
  assert.equal(r.segments.length, 4);
  assert.deepEqual(r.segments.map((s) => s.direction), ['ida', 'ida', 'volta', 'volta']);
  assert.equal(r.segments[0].origin, 'BEL');
  assert.equal(r.segments[0].destination, 'GRU');
  assert.equal(r.segments[0].date, '2026-07-28');
  assert.equal(r.segments[0].departure_time, '11:40');
  assert.equal(r.segments[3].flight_number, 'LA3872');
});

// ── A2. Bilhete 77 Travels (GOL) ─────────────────────────────────────────────
const bilhete77Gol = `
LOCALIZADOR
AAAAAA
VISUALIZAR RESERVA
IDA
VOLTA
77 Travels - Gestão de Viagens e Milhas
G3 1721
05h45
14/07/26
SalvadorSSABSBBrasília
07h45
14/07/26
G3 1720
21h40
16/07/26
BrasíliaBSBSSASalvador
23h35
16/07/26
Passageiros
PASSAGEIRO 1
BELTRANA DE TAL
Bagagens
`;

check('bilhete 77 Travels (GOL)', () => {
  const r = parseKnownFormats(bilhete77Gol);
  assert.equal(r.format, 'bilhete-77travels');
  assert.equal(r.locator, 'AAAAAA');
  assert.equal(r.airline, 'GOL');
  assert.deepEqual(r.passengers, ['BELTRANA DE TAL']);
  assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments.map((s) => s.direction), ['ida', 'volta']);
  assert.equal(r.segments[0].flight_number, 'G31721');
});

// ── B. Bilhete GOL detalhado ─────────────────────────────────────────────────
const bilheteGolDetalhado = `
Bilhete
Localizador
SSA
Salvador
13/07/26 05h45
DIRETO
2h00
BSB
Brasília
13/07/26 07h45
 Cabine Econômica
 1 passageiro
BSB
Brasília
16/07/26 21h40
DIRETO
1h55
SSA
Salvador
16/07/26 23h35
 Cabine Econômica
 1 passageiro
BBBBBB
SEG
13
JUL
SSA
Salvador
05h45
VOO 1721
Cabine Econômica
BSB
Brasília
07h45
SSA/BSB
PassageiroBagagens
Assento
 BELTRANA DE TAL
DOS SANTOS
Comprar
bagagem
VOO 1720
`;

check('bilhete GOL detalhado', () => {
  const r = parseKnownFormats(bilheteGolDetalhado);
  assert.equal(r.format, 'bilhete-gol-detalhado');
  assert.equal(r.locator, 'BBBBBB');
  assert.equal(r.airline, 'GOL');
  assert.deepEqual(r.passengers, ['BELTRANA DE TAL DOS SANTOS']);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].origin, 'SSA');
  assert.equal(r.segments[0].destination, 'BSB');
  assert.equal(r.segments[0].date, '2026-07-13');
  assert.equal(r.segments[0].flight_number, 'G31721');
  assert.deepEqual(r.segments.map((s) => s.direction), ['ida', 'volta']);
});

// ── C. Comprovante de compra LATAM ───────────────────────────────────────────
const comprovanteLatam = `
TAM Linhas Aéreas S.A.
Informação da viagem
Código da reservaQWERTYNª de ordenLA0000000ABCD
Nome do PassageiroTipo de passageiroDocumento de Identificação
FULANO DE TAL SILVAAdulto00000000000
Itinerário
N° de vooOrigemDestino
LA 8068
São
Paulo
(Guarulhos
Intl.)
París
(Charles
De
Gaulle)
28/07/2618:2029/07/2610:35EconomyLight
LA 8067
París
(Charles
De
Gaulle)
São
Paulo
(Guarulhos
Intl.)
04/08/2613:0004/08/2619:50EconomyLight
Detalhe do pagamento
`;

check('comprovante de compra LATAM', () => {
  const r = parseKnownFormats(comprovanteLatam);
  assert.equal(r.format, 'comprovante-latam');
  assert.equal(r.locator, 'QWERTY');
  assert.equal(r.airline, 'LATAM');
  assert.deepEqual(r.passengers, ['FULANO DE TAL SILVA']);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].date, '2026-07-28');
  assert.equal(r.segments[0].departure_time, '18:20');
  assert.equal(r.segments[0].arrival_time, '10:35');
  assert.ok(r.segments[0].origin.includes('São Paulo'));
  assert.ok(r.segments[0].destination.includes('Gaulle'));
  assert.deepEqual(r.segments.map((s) => s.direction), ['ida', 'volta']);
});

// ── D. E-ticket internacional (Amadeus/Qatar) ────────────────────────────────
const eticketAmadeus = `
ItineraryPrintingOffice:
Passenger:SobrenomeNomeMeioMiss(ADT)
Bookingref:
1A/AB1CDE
QR/AB1CDE
Ticketnumber:0000000000000
ELECTRONICTICKETRECEIPT
FlightToDepartureArrivalLastcheck-inFrom
DUBAIDUBAIINTL
Terminal:1
DOHAHAMAD
INTERNATIONAL
QR101922:50
17Mar2026
23:05
17Mar2026
Class:XOperatedby:QATARAIRWAYS
DOHAHAMAD
INTERNATIONAL
SAOPAULOGUARULHOS
INTL
Terminal:3
QR77901:30
18Mar2026
10:40
18Mar2026
Class:XOperatedby:QATARAIRWAYS
`;

check('e-ticket internacional (Amadeus/Qatar)', () => {
  const r = parseKnownFormats(eticketAmadeus);
  assert.equal(r.format, 'eticket-amadeus');
  assert.equal(r.locator, 'AB1CDE');
  assert.equal(r.airline, 'Qatar Airways');
  assert.deepEqual(r.passengers, ['SOBRENOME NOME MEIO']);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].flight_number, 'QR1019');
  assert.equal(r.segments[0].date, '2026-03-17');
  assert.equal(r.segments[0].departure_time, '22:50');
  assert.equal(r.segments[1].date, '2026-03-18');
  assert.deepEqual(r.segments.map((s) => s.direction), ['ida', 'ida']); // só ida (sem retorno)
});

process.exit(failures ? 1 : 0);
