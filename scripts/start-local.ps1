param(
  [string]$SqlServer = "localhost",
  [string]$DatabaseName = "Clivelle",
  [string]$DatabaseRepositoryPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "..\Clivelle-Database")
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendPath = Join-Path $repoRoot "backend"
$databaseRoot = (Resolve-Path $DatabaseRepositoryPath).Path
$migrationPath = Join-Path $databaseRoot "database\migrations\001_initial_schema.sql"
$seedPath = Join-Path $databaseRoot "database\seeds\development_seed.sql"

if ($DatabaseName -notmatch '^[A-Za-z0-9_]+$') {
  throw "DatabaseName may contain only letters, numbers and underscores."
}
if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
  throw "sqlcmd was not found. Install SQL Server command-line utilities and ODBC Driver 18, then reopen PowerShell."
}
if (-not (Test-Path $migrationPath)) { throw "Schema migration not found: $migrationPath" }
if (-not (Test-Path $seedPath)) { throw "Development seed not found: $seedPath" }
if (-not (Test-Path (Join-Path $backendPath "package-lock.json"))) { throw "backend/package-lock.json is missing." }

Write-Host "Checking SQL Server connection: $SqlServer" -ForegroundColor Cyan
$createDatabase = "IF DB_ID(N'$DatabaseName') IS NULL BEGIN CREATE DATABASE [$DatabaseName]; END"
& sqlcmd -S $SqlServer -E -C -d master -b -Q $createDatabase
if ($LASTEXITCODE -ne 0) { throw "Could not connect to SQL Server or create database '$DatabaseName'." }

Write-Host "Applying the 26-table schema..." -ForegroundColor Cyan
& sqlcmd -S $SqlServer -E -C -d $DatabaseName -b -i $migrationPath
if ($LASTEXITCODE -ne 0) { throw "Schema migration failed. Review the sqlcmd output above." }

Write-Host "Seeding categories, products, images, inventory and admin roles..." -ForegroundColor Cyan
& sqlcmd -S $SqlServer -E -C -d $DatabaseName -b -i $seedPath
if ($LASTEXITCODE -ne 0) { throw "Development seed failed. Review the sqlcmd output above." }

if (-not (Test-Path (Join-Path $backendPath "node_modules"))) {
  Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
  Push-Location $backendPath
  try { npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed." } }
  finally { Pop-Location }
}

# Force this local dev process to use the SQL Server 2019 database with Windows Authentication.
$env:NODE_ENV = "development"
$env:PORT = "4000"
$env:API_BASE_PATH = "/api/v1"
$env:DB_AUTH = "windows"
$env:DB_SERVER = $SqlServer
$env:DB_NAME = $DatabaseName
$env:DB_ODBC_DRIVER = "ODBC Driver 18 for SQL Server"
$env:DB_ENCRYPT = "true"
$env:DB_TRUST_SERVER_CERTIFICATE = "true"
$env:CORS_ORIGINS = "http://localhost:4173,http://127.0.0.1:4173,http://localhost:5500,http://127.0.0.1:5500"

if (Get-Command python -ErrorAction SilentlyContinue) {
  $staticCommand = "Set-Location '$($repoRoot.Replace("'","''"))'; python -m http.server 4173 --bind 127.0.0.1"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $staticCommand | Out-Null
  Start-Sleep -Seconds 2
  Start-Process "http://127.0.0.1:4173" | Out-Null
} else {
  Write-Warning "Python was not found. Start a static server in the repository root on port 4173 to open the storefront."
}

Write-Host "Starting Clivelle API on http://127.0.0.1:4000" -ForegroundColor Green
Write-Host "Health check: http://127.0.0.1:4000/health/ready" -ForegroundColor Green
Write-Host "Storefront:   http://127.0.0.1:4173" -ForegroundColor Green
Push-Location $backendPath
try { npm run dev }
finally { Pop-Location }
