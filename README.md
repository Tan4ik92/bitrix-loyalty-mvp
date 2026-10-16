# Bitrix Loyalty MVP

Local manager UI and public Tilda adapters for the V2SD loyalty program.

## Run locally

Create `.env` from `.env.example` and put real secrets there. At minimum the server needs:

```text
VIBECODE_API_BASE=https://vibecode.bitrix24.tech
VIBECODE_API_KEY=<personal vibe_api key>
```

Then run:

```powershell
npm start
```

Open:

```text
http://127.0.0.1:3100
```

The server reads only this project's `.env` by default. `LEGACY_ENV_FILE` can be set explicitly for old local workflows, but there is no automatic fallback to another project's `.env`.

## Public API

```text
GET /api/health
GET /api/contacts/search?q=<phone-or-email>
GET /api/account/profile?email=<email>
GET /api/promocodes/lookup?code=<code>
```

The Bitrix24/VibeCode API key stays server-side and is never sent to browser scripts.

## Current production server

```text
name: Loyalty_program
server id: 0b1c98f9-a798-4eda-818b-9b107cecc6b2
url: https://app-593caafbe7fb.vibecode.bitrix24.tech
start: node backend/server.js
workdir: /opt/app
```
