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

### OCR inteligente (recomendado)

Defina `ANTHROPIC_API_KEY` no `.env` (chave em <https://platform.claude.com>). Com a
chave, qualquer voucher (PDF ou imagem, de qualquer companhia) é lido com alta precisão.
Sem a chave, o sistema usa OCR local (Tesseract) com regras de extração — funciona, mas
exige mais conferência manual.

**Como o sistema “aprende”:** quando o OCR errar em algum modelo de voucher, registre a
regra correta em *Configurações → Aprendizado do OCR* (ex.: “No voucher da GOL o
localizador aparece após ‘eTicket’”). As regras são aplicadas em todas as leituras
seguintes.

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

O sistema é um único serviço Node.js com banco SQLite (arquivo `data/emissoes.db`).
Qualquer host com Node 18+ e disco persistente funciona — por exemplo Railway, Render,
Fly.io ou uma VPS:

```bash
# em produção
NODE_ENV=production PORT=3000 node server.js
```

Recomendações: use HTTPS (o cookie de sessão fica `secure` automaticamente atrás de
proxy), defina um `SESSION_SECRET` forte e faça backup periódico da pasta `data/`.

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
