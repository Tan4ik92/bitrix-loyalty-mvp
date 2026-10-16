# Source control and production snapshots

This repository contains application source code, tests, documentation, and
maintenance scripts. Production credentials and customer data must never be
committed.

## Branches

- `main` is the reviewed development line.
- `production-sync-2026-10-16` records the source files verified against the
  running VibeCode server on 2026-10-16.
- `archive/local-development-2026-10-16` preserves the local development state
  that existed before the production source was synchronized.

The production and local branches differ because several historical changes
were deployed directly to the server. Merge them through review; do not copy a
whole `backend/server.js` over production without checking the diff.

## Secrets and runtime data

Keep real values only in local `.env` files or the deployment environment.
Commit `.env.example` with empty values. Do not commit API keys, webhooks,
passwords, OAuth sessions, customer exports, logs, catalog caches, or automation
state files.

Before every push, inspect staged files and scan them for `vibe_api_`,
`vibe_app_`, webhook URLs, access tokens, passwords, and private keys.

## Deployment

Production deployment is a separate reviewed operation. GitHub access does not
grant access to VibeCode, Bitrix24, or the production server. Runtime secrets
are supplied only through the server environment.
