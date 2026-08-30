# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Emissões 77 Travels** — Portal de gestão de emissões de passagens. The system includes:
- OCR processing of ticket vouchers using Tesseract.js
- Profit calculations from travel bookings
- WhatsApp messaging integration
- Multi-user authentication with session management
- SQLite database via libsql

## Quick Start

```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Start production server
npm start

# Run tests
npm test
```

## Tech Stack

- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Database**: SQLite (libsql client)
- **OCR**: Tesseract.js
- **PDF Processing**: pdf-parse
- **Authentication**: bcryptjs + express-session
- **AI**: Anthropic Claude API
- **APIs**: Google APIs (Gmail, Calendar, Drive)
- **File Upload**: Multer

## Key Architecture

### Server Structure
- `server.js` — Main Express app entry point
- `test/parsers.test.js` — Test suite for data parsers

### Core Features
1. **OCR Processing** — Extracts text and data from ticket voucher images/PDFs
2. **Profit Calculation** — Computes margins and profits from ticket sales
3. **WhatsApp Integration** — Sends automated messages via WhatsApp API
4. **Authentication** — User login/session management with bcrypt hashing
5. **Multi-provider APIs** — Integrates Google services and Anthropic's Claude

## Environment Setup

The app requires a `.env` file with:
- Database credentials (TURSO_CONNECTION_URL, TURSO_AUTH_TOKEN)
- API keys (Anthropic, Google)
- WhatsApp API credentials
- Session secret for authentication

## Installed Skills

The project has the following Claude Code skills installed:

- **find-skills** — Discover and install agent skills for extending capabilities

Use `/find-skills` in the chat to search for skills that can help with your development tasks.

## Common Tasks

- **Adding API endpoints** — Extend `server.js` with new route handlers
- **Processing documents** — Use Tesseract.js for OCR and pdf-parse for PDF data extraction
- **Database queries** — Use libsql client for SQLite operations
- **Testing** — Add tests to `test/parsers.test.js` and run `npm test`
