$ErrorActionPreference = "Stop"

$ProjectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectDirectory
$AppUrl = "http://127.0.0.1:4173"

function Test-HrAutoHealth {
  try {
    $Health = Invoke-RestMethod -Uri "$AppUrl/api/health" -TimeoutSec 2
    return $Health.ok -eq $true
  } catch {
    return $false
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 22 or newer."
}

if (Test-HrAutoHealth) {
  Write-Host ""
  Write-Host "HR Auto is already running at $AppUrl"
  Write-Host "Opening the existing app without starting another server."
  Start-Process $AppUrl
  exit 0
}

if (-not (Test-Path -LiteralPath "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
  npm run install-browser
}

Write-Host "Building HR Auto..."
npm run build
if ($LASTEXITCODE -ne 0) {
  throw "HR Auto build failed."
}

Write-Host ""
Write-Host "HR Auto is starting at $AppUrl"
Write-Host "Press Ctrl+C in this window to stop the app."
Write-Host ""

$ServerProcess = Start-Process `
  -FilePath "node" `
  -ArgumentList "dist/server.js" `
  -WorkingDirectory $ProjectDirectory `
  -NoNewWindow `
  -PassThru

try {
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 40; $Attempt += 1) {
    if ($ServerProcess.HasExited) {
      throw "HR Auto server stopped before it became ready. Check the error above."
    }
    if (Test-HrAutoHealth) {
      $Ready = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }

  if (-not $Ready) {
    throw "HR Auto did not respond within 10 seconds. Close any stale Node process using port 4173 and try again."
  }

  Write-Host ""
  Write-Host "HR Auto is ready. Opening $AppUrl"
  Start-Process $AppUrl
  Wait-Process -Id $ServerProcess.Id
} finally {
  if (-not $ServerProcess.HasExited) {
    Stop-Process -Id $ServerProcess.Id
  }
}
