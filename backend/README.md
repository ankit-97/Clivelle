# Clivelle API

Node.js 20+ / Express API foundation for the Clivelle website and Capacitor app.

## Local setup

1. Install Node.js 20 or newer.
2. From this folder run `npm install`.
3. Copy `.env.example` to `.env`. For a local Windows SQL Server, use `DB_AUTH=windows`, `DB_SERVER=localhost`, and `DB_NAME=Clivelle`; the API uses your Windows account. For SQL authentication, set `DB_AUTH=sql` and provide `DB_USER` / `DB_PASSWORD`.
4. Start the API with `npm run dev`.

For local storefront verification, allow the storefront origin in `CORS_ORIGINS` (the default includes `http://127.0.0.1:4173`). The browser app reads `http://localhost:4000/api/v1` when served on localhost; set `window.CLIVELLE_API_BASE_URL` before `app.js` to use a different API URL. Non-local hosts default to the same-origin `/api/v1` path.

The API listens on `http://localhost:4000` by default.

## Current endpoints

- `GET /health/live` — process liveness; does not require the database.
- `GET /health/ready` — readiness check; runs `SELECT 1` against SQL Server.
- `GET /api/v1` — API version and foundation status.
- `GET /api/v1/categories` — active product categories.
- `GET /api/v1/products` — active products with category, available stock and primary image. Supports `page`, `limit`, `category`, `search` and `featured` filters.

## Security baseline

- Helmet security headers, strict CORS allowlist, JSON body size limit and request rate limit.
- SQL Server connection pool with encryption enabled by default.
- No secrets are stored in source control.
- Do not expose database credentials or payment/OTP provider secrets to browser or mobile code.

## Not implemented yet

Customer OTP delivery/verification, access-token/session issuance, cart/order workflows, payment gateway webhooks, shipping integrations and admin authorization are not live yet. These must be implemented and tested before taking real customer orders.

## Database

The SQL Server schema is maintained in the separate [Clivelle-Database repository](https://github.com/ankit-97/Clivelle-Database). Apply and validate its migration on a fresh development database before connecting production traffic. At the currently referenced revision, that repository contains only a README and no migration files, so the catalog SQL cannot yet be validated against the schema or a real database.
