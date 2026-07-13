# 77 Travels — Gestão de Emissões de Passagens

Portal web da 77 Travels para registrar emissões de passagens com milhas:

- **OCR do voucher/confirmação de compra** — arraste o PDF ou a foto e o sistema extrai
  passageiros, localizador, companhia aérea e todos os trechos (datas, horários, origem
  e destino, ida e volta). Todos os campos podem ser corrigidos manualmente.
- **Campos manuais** — programa de fidelidade, fornecedor e telefone (com preenchimento
  automático a partir das emissões anteriores), quantidade de milhas, custo do milheiro,
  taxas, valor cobrado e forma de pagamento.
- **Cálculo automático** — Pix ou cartão de crédito; no cartão você escolhe o link de
  pagamento (**Mercado Pago** ou **Cielo**) e o número de parcelas, e o sistema aplica a
  taxa configurada e calcula **lucro bruto** (sem descontar taxa do cartão) e
  **lucro líquido** (descontando a taxa do cartão).
- **Mensagem de WhatsApp** — ao salvar, o sistema gera a mensagem completa para o grupo
  de emissões (base para a nota fiscal), com botões *Copiar* e *Abrir no WhatsApp*.
- **Botão “Alterações”** — em cada emissão, abre o WhatsApp do fornecedor com a mensagem
  “Preciso resolver uma alteração na emissão. Localizador: XXX”.
- **Google Drive** — cria a pasta **Emissões 77 Travels** na conta da agência, com
  planilhas mensais (uma linha por emissão, uma coluna por campo, incluindo a coluna
  “Alterações” com o link do WhatsApp do fornecedor).
- **Login e permissões** — usuário master `gestao@77travels.com.br`, que define o tipo
  de cada usuário (administrador ou usuário comum).

## Como rodar

```bash
cp .env.example .env    # edite o arquivo com suas chaves
npm install
npm start               # http://localhost:3000
```

**Primeiro acesso:** entre com `gestao@77travels.com.br` e a senha definida em
`MASTER_INITIAL_PASSWORD` no `.env` (padrão: `77travels`). Troque a senha em
*Configurações → Minha senha*.

## Configurações importantes

### OCR (local e gratuito — padrão)

O motor padrão é **100% local e gratuito**: `pdf-parse` para PDFs e `Tesseract` para
fotos/imagens, seguido de **parsers calibrados com os modelos reais da agência**
(`src/services/parsers.js`):

| Formato | Reconhecido por |
| --- | --- |
| Bilhete 77 Travels (LATAM/GOL) | `LOCALIZADOR` + `VISUALIZAR RESERVA` |
| Bilhete GOL detalhado | `Bilhete` + `Localizador` + `VOO NNNN` |
| Comprovante de compra LATAM | `Código da reserva` |
| E-ticket internacional (Amadeus, ex. Qatar) | `Bookingref` / `ELECTRONIC TICKET RECEIPT` |

Formatos desconhecidos caem em heurísticas genéricas (localizador, pares de aeroportos,
datas e horários) — e os campos são sempre editáveis na tela.

**Como o sistema “aprende” novos modelos:** envie uma amostra do novo
voucher/comprovante para calibrarmos um parser dedicado em `src/services/parsers.js` —
foi assim que os quatro formatos acima foram criados, todos validados com arquivos
reais da agência.

*(Opcional)* Para layouts nunca vistos, é possível ativar a leitura com IA definindo
`OCR_ENGINE=claude` e `ANTHROPIC_API_KEY` no `.env` — é um serviço pago e fica
**desligado** por padrão.

### Taxas do cartão

Em *Configurações → Taxas do cartão por parcela*, informe o percentual de cada
transação (1x a 12x) do **Mercado Pago** e da **Cielo**. Esses percentuais são usados
para calcular a taxa do cartão e o lucro líquido de cada emissão.

### Google Drive

1. Acesse <https://console.cloud.google.com>, crie um projeto e ative as APIs
   **Google Drive API** e **Google Sheets API**.
2. Em *Credenciais*, crie um **ID do cliente OAuth 2.0** (tipo *Aplicativo da Web*) com
   o redirect URI `https://SEU-DOMINIO/api/drive/callback`
   (em teste local: `http://localhost:3000/api/drive/callback`).
3. Preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no `.env`.
4. No portal, vá em *Configurações → Google Drive → Conectar* e autorize com o e-mail
   da agência (`agencia@77travels.com.br`).

A partir daí, cada emissão salva vai automaticamente para a planilha do mês
(`Emissões 77 Travels/2026/Emissões 2026-07 (Julho)` etc.). O botão *Reenviar todas as
emissões* refaz a sincronização quando necessário.

## Hospedagem online

O sistema é um único serviço Node.js. O banco usa libsql/SQLite: **arquivo local**
(`data/emissoes.db`) por padrão, ou **Turso** (SQLite na nuvem) quando
`TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` estão definidos.

### Opção gratuita (recomendada): Render Free + Turso Free

No plano gratuito do Render o disco é apagado a cada reinício — por isso o banco
vai para o Turso, que guarda os dados de forma permanente (plano gratuito de 5 GB,
sem cartão de crédito). Passo a passo:

1. **Turso** — acesse <https://turso.tech>, entre com o GitHub, crie um banco
   (ex.: `emissoes-77travels`) e copie a **URL** (`libsql://...turso.io`) e um
   **token** do banco (botão *Create Token*).
2. **Render** — acesse <https://render.com>, entre com o GitHub e abra
   <https://render.com/deploy?repo=https://github.com/77travels/emissoes>.
   O Render lê o `render.yaml` e pede os dois valores do Turso; cole-os e confirme.
3. Em ~3 minutos o sistema está no ar em `https://emissoes-77travels.onrender.com`.

Observação do plano gratuito: o serviço "dorme" após ~15 min sem uso e a primeira
visita seguinte demora ~30-60 s para acordar. Os dados ficam seguros no Turso.

### Outras opções

Qualquer host com Node 18+ (ou Docker, via `Dockerfile` incluído) funciona —
Railway, Fly.io, VPS. Com disco persistente, o Turso é dispensável (o banco fica
no arquivo local).

```bash
NODE_ENV=production PORT=3000 node server.js
```

Recomendações: HTTPS (o cookie de sessão fica `secure` automaticamente atrás de
proxy) e um `SESSION_SECRET` forte.

## Estrutura

```
server.js               # servidor Express
src/db.js               # banco SQLite (esquema + seeds)
src/routes/             # API: auth, users, emissions, suppliers, settings, ocr, drive
src/services/extract.js # OCR (Claude + fallback Tesseract/pdf-parse)
src/services/calc.js    # regras de cálculo (lucros e taxa de cartão)
src/services/whatsapp.js# mensagens do grupo e de alterações
src/services/drive.js   # pasta e planilhas mensais no Google Drive
public/                 # interface (SPA)
```
