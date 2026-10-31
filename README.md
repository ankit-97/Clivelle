# Clivelle

Clivelle is a responsive storefront and Node.js/Express API backed by SQL Server.

## Local development

### 1. Prepare the database

Use SQL Server 2019+ with a development database named `Clivelle`. From PowerShell:

```powershell
sqlcmd -S localhost -E -C -Q "IF DB_ID('Clivelle') IS NULL CREATE DATABASE Clivelle"
sqlcmd -S localhost -E -C -d Clivelle -i ..\Clivelle-Database\database\migrations\001_initial_schema.sql
sqlcmd -S localhost -E -C -d Clivelle -i ..\Clivelle-Database\database\seeds\development_seed.sql
```

The development seed creates eight catalogue products, images pointing at the local storefront atlas, inventory, categories and admin role definitions. Replace the development image URLs with approved storage URLs before production use.

### 2. Install dependencies and configure the API

```powershell
cd C:\codex\Clivelle\backend
Copy-Item .env.example .env
npm install
```

The Windows-authenticated example uses `localhost`, database `Clivelle` and ODBC Driver 18. Keep `.env` local and never commit it.

### 3. Run the application

In one PowerShell window:

```powershell
cd C:\codex\Clivelle\backend
npm run dev
```

In another:

```powershell
cd C:\codex\Clivelle
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`. The browser loads products from `http://localhost:4000/api/v1` and falls back to the local demo catalogue if the API is unavailable.

### 4. Verify

```powershell
cd C:\codex\Clivelle\backend
npm test
cd ..
npm run build:web
node tests/smoke.mjs
```

Health endpoints are `GET /health/live` and `GET /health/ready`. The readiness endpoint only reports ready after a real `SELECT 1` succeeds against SQL Server.

## Current scope

The SQL-backed catalogue, inventory availability, responsive storefront and local development flow are implemented. Customer authentication, server-side carts, checkout/order transactions, payments and admin APIs still require the next implementation stage; the current UI keeps its clearly labelled local demo flows for those features. No payment provider or messaging provider is configured.
