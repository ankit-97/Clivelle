# Clivelle API

Node.js 20+ / Express API foundation for the Clivelle website and Capacitor app.

## Local setup

1. Install Node.js 20 or newer.
2. From this folder run `npm install`.
3. Copy `.env.example` to `.env` and fill in your development SQL Server details.
4. Start the API with `npm run dev`.

The API listens on `http://localhost:4000` by default.

## Current endpoints

- `GET /health/live` — process liveness; does not require the database.
- `GET /health/ready` — readiness check; runs `SELECT 1` against SQL Server.
- `GET /api/v1` — API version and foundation status.

## Security baseline

- Helmet security headers, strict CORS allowlist, JSON body size limit and request rate limit.
- SQL Server connection pool with encryption enabled by default.
- No secrets are stored in source control.
- Do not expose database credentials or payment/OTP provider secrets to browser or mobile code.

## Not implemented yet

Customer OTP delivery/verification, access-token/session issuance, catalog and inventory endpoints, cart/order workflows, payment gateway webhooks, shipping integrations and admin authorization are not live yet. These must be implemented and tested before taking real customer orders.

## Database

The SQL Server schema is maintained in the separate [Clivelle-Database repository](https://github.com/ankit-97/Clivelle-Database). Apply and validate its migration on a fresh development database before connecting production traffic.
