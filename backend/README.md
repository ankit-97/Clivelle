# Clivelle API

Node.js 20+ / Express API for the Clivelle website and Capacitor app.

## Production deployment (Render + PostgreSQL)

The production start command is `npm start`. If `DATABASE_URL` is present, `src/start.js` starts `src/postgres-server.js`; otherwise it starts the original SQL Server implementation.

On Render, set the Root Directory to `backend`, Build Command to `npm run render:build`, and Start Command to `npm start`. The `render:build` script installs production dependencies while omitting optional native ODBC drivers; the PostgreSQL deployment does not use them. For local Windows-auth SQL Server development only, install the optional driver with `npm install --include=optional`. In production, the start script always selects PostgreSQL and fails with a clear `DATABASE_URL is required` message if the connection string is missing; it never falls back to the SQL Server/ODBC implementation.

Configure these Render environment variables (use the Render PostgreSQL **Internal Database URL** when the API service and database are in the same Render region):

- `DATABASE_URL` — required PostgreSQL connection string. Keep it private.
- `NODE_ENV=production`
- `CORS_ORIGINS=https://ankit-97.github.io,https://clivelle.onrender.com,capacitor://localhost` — add every real storefront origin, comma-separated.
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
- `GET /api/v1/customer/addresses`, `POST /api/v1/customer/addresses`, `PUT /api/v1/customer/addresses/:id`, `DELETE /api/v1/customer/addresses/:id` — saved delivery addresses.
- `GET /api/v1/customer/wishlist`, `PUT /api/v1/customer/wishlist/:id`, `DELETE /api/v1/customer/wishlist/:id` — server-side wishlist.
- `GET /api/v1/customer/orders`, `POST /api/v1/customer/orders` — persisted orders, item snapshots, idempotency protection and transactional stock checks.
- `POST /api/v1/newsletter` — persistent newsletter subscriptions.
- `GET /api/v1/reviews`, `POST /api/v1/reviews` — published reviews and customer submissions pending moderation.

Authenticated requests accept `Authorization: Bearer <token>`. The browser storefront stores the issued session token locally and sends it on authenticated requests; do not log or share this token. Passwords are hashed with bcrypt. Session tokens are stored only as SHA-256 hashes in PostgreSQL.

## Important payment limitation

Checkout currently supports **Cash on Delivery only** on the SQL Server API. COD orders, order-item snapshots, inventory movements and pending COD payment records are saved transactionally. UPI, cards and net banking are intentionally disabled until a real payment provider (for example Razorpay) is configured with signed webhooks, payment status transitions, refunds and reconciliation. Do not mark a test order as paid. Shipping labels, courier tracking, transactional email/SMS, admin roles and production-grade inventory reservation/expiry are also not enabled.

## Local setup

1. Install Node.js 20 or newer and SQL Server ODBC Driver 18.
2. Copy `.env.example` to `.env`; keep `DB_AUTH=windows`, set `DB_SERVER` and `DB_NAME=Clivelle` to your local instance.
3. Run the schema migration and development seed scripts from the [Clivelle-Database repository](https://github.com/ankit-97/Clivelle-Database) against the `Clivelle` database.
4. From this folder run `npm install`, then `npm run dev` (watch mode) or `npm start`.
5. Verify `GET http://localhost:4000/health/ready` returns `{\"status\":\"ready\",\"database\":\"connected\"}`.
6. Open the storefront locally and confirm `window.CLIVELLE_API_BASE_URL` points to `http://localhost:4000/api/v1`. For another API host, define it before loading `app.js`.

The SQL Server fallback still uses the SQL Server schema in the separate [Clivelle-Database repository](https://github.com/ankit-97/Clivelle-Database). The PostgreSQL production path uses the schema in `src/postgres-server.js`.

## Security notes

- Helmet, strict CORS allowlist, JSON body-size limit and API rate limiting are enabled.
- Keep database credentials and provider secrets in Render environment variables, never in browser code or Git.
- Use HTTPS in production. Review the CORS allowlist whenever the storefront domain changes.
