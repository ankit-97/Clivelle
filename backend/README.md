# Clivelle API

Node.js 20+ / Express API for the Clivelle website and Capacitor app.

## Production deployment (Render + PostgreSQL)

The production start command is `npm start`. If `DATABASE_URL` is present, `src/start.js` starts `src/postgres-server.js`; otherwise it starts the original SQL Server implementation.

Configure these Render environment variables (use the Render PostgreSQL **Internal Database URL** when the API service and database are in the same Render region):

- `DATABASE_URL` — required PostgreSQL connection string. Keep it private.
- `NODE_ENV=production`
- `CORS_ORIGINS=https://ankit-97.github.io,https://clivelle.onrender.com` — add every real storefront origin, comma-separated.
- `TRUST_PROXY=1`
- `DB_POOL_MAX=10`

Render supplies `PORT`. The PostgreSQL server creates its tables on first boot and upgrades the earlier lightweight PostgreSQL tables in place; it does not delete existing users or catalogue rows. Back up the database before production schema changes.

Health checks:
- `GET /health/live` — process liveness.
- `GET /health/ready` or `GET /health` — confirms PostgreSQL connectivity.

## Implemented API

- `GET /api/v1/products` — PostgreSQL-backed catalogue and pagination.
- `POST /api/v1/auth/signup` — email and/or Indian mobile number plus password; duplicate accounts return HTTP 409.
- `POST /api/v1/auth/signin` — sign in using email or phone.
- `GET /api/v1/auth/me`, `POST /api/v1/auth/signout` — persistent, revocable 30-day sessions.
- `GET /api/v1/customer/me` — current customer profile.
- `GET /api/v1/customer/cart`, `PUT /api/v1/customer/cart/items`, `DELETE /api/v1/customer/cart/items/:id` — server-side cart.
- `GET /api/v1/customer/addresses`, `POST /api/v1/customer/addresses` — saved delivery addresses.
- `GET /api/v1/customer/orders`, `POST /api/v1/customer/orders` — persisted orders with idempotency protection and stock checks.

Authenticated requests accept `Authorization: Bearer <token>`. The browser storefront stores the issued session token locally and sends it on authenticated requests; do not log or share this token. Passwords are hashed with bcrypt. Session tokens are stored only as SHA-256 hashes in PostgreSQL.

## Important payment limitation

Checkout currently creates and stores an order record and reserves/decrements catalogue stock. It does **not** collect money. A real payment provider (for example Razorpay) must be integrated with signed webhooks, payment status transitions, refunds and reconciliation before accepting live paid orders. Shipping labels, courier tracking, transactional email/SMS, admin roles and production-grade inventory reservation/expiry are also not enabled.

## Local setup

1. Install Node.js 20 or newer.
2. From this folder run `npm install`.
3. For PostgreSQL testing, set `DATABASE_URL` in your local environment.
4. Start with `npm run dev` (watch mode) or `npm start`.
5. The browser app uses `http://localhost:4000/api/v1` on localhost. For another API host, define `window.CLIVELLE_API_BASE_URL` before loading `app.js`.

The SQL Server fallback still uses the SQL Server schema in the separate [Clivelle-Database repository](https://github.com/ankit-97/Clivelle-Database). The PostgreSQL production path uses the schema in `src/postgres-server.js`.

## Security notes

- Helmet, strict CORS allowlist, JSON body-size limit and API rate limiting are enabled.
- Keep database credentials and provider secrets in Render environment variables, never in browser code or Git.
- Use HTTPS in production. Review the CORS allowlist whenever the storefront domain changes.
