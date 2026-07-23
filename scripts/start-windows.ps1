$ErrorActionPreference = "Stop"

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectDirectory

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "ไม่พบ Node.js กรุณาติดตั้ง Node.js 22 หรือใหม่กว่า"
}

if (-not (Test-Path -LiteralPath "node_modules")) {
  Write-Host "กำลังติดตั้ง dependencies..."
  npm install
  npm run install-browser
}

if (-not (Test-Path -LiteralPath "dist/server.js")) {
  Write-Host "กำลัง build แอป..."
  npm run build
}

Write-Host ""
Write-Host "HR Auto กำลังเปิดที่ http://127.0.0.1:4173"
Write-Host "กด Ctrl+C ในหน้าต่างนี้เมื่อต้องการปิดแอป"
Write-Host ""

Start-Process "http://127.0.0.1:4173"
npm start
