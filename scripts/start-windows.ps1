$ErrorActionPreference = "Stop"

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectDirectory

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 22 or newer."
}

if (-not (Test-Path -LiteralPath "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
  npm run install-browser
}

if (-not (Test-Path -LiteralPath "dist/server.js")) {
  Write-Host "Building HR Auto..."
  npm run build
}

Write-Host ""
Write-Host "HR Auto is starting at http://127.0.0.1:4173"
Write-Host "Press Ctrl+C in this window to stop the app."
Write-Host ""

Start-Process "http://127.0.0.1:4173"
npm start
