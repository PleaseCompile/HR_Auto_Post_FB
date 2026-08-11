# HR Auto launcher for the packaged (installed) build.
# Keeps the console window open so closing it stops the app.

$ErrorActionPreference = "Stop"

$AppDirectory = $PSScriptRoot
$DataDirectory = Join-Path $env:LOCALAPPDATA "HR-Auto\data"

$env:HR_AUTO_DATA_DIR = $DataDirectory
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $AppDirectory "browsers"

$Port = if ($env:PORT) { $env:PORT } else { "4173" }
$AppUrl = "http://127.0.0.1:$Port"

$NodeExe = Join-Path $AppDirectory "node.exe"
$ServerJs = Join-Path $AppDirectory "dist\server.js"

try { $Host.UI.RawUI.WindowTitle = "HR Auto" } catch { }

function Get-HrAutoHealth {
  try {
    $Health = Invoke-RestMethod -Uri "$AppUrl/api/health" -TimeoutSec 2
    if ($Health.ok -eq $true) { return $Health }
    return $null
  } catch {
    return $null
  }
}

if (-not (Test-Path -LiteralPath $NodeExe)) {
  Write-Host "ไม่พบไฟล์โปรแกรมที่ $NodeExe" -ForegroundColor Red
  Write-Host "กรุณาติดตั้ง HR Auto ใหม่อีกครั้ง"
  Read-Host "กด Enter เพื่อปิดหน้าต่างนี้"
  exit 1
}

$Existing = Get-HrAutoHealth
if ($Existing) {
  if ($Existing.dataDirectory -eq $DataDirectory) {
    Write-Host "HR Auto เปิดอยู่แล้ว กำลังเปิดหน้าเว็บให้..." -ForegroundColor Yellow
    Start-Process $AppUrl
    Start-Sleep -Seconds 2
    exit 0
  }

  # Another HR Auto (different install or a dev checkout) already owns the port.
  # Opening the browser here would silently show that other copy's data.
  Write-Host ""
  Write-Host "  พบ HR Auto คนละชุดกำลังทำงานอยู่บนพอร์ต $Port" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  ชุดที่กำลังทำงาน : $($Existing.dataDirectory)"
  Write-Host "  ชุดที่คุณเพิ่งกด  : $DataDirectory"
  Write-Host ""
  Write-Host "  ข้อมูลคนละชุดกัน ระบบจึงไม่เปิดทับให้"
  Write-Host "  ถ้าต้องการใช้ชุดนี้ ให้ปิดหน้าต่าง HR Auto เดิมก่อน แล้วกดเปิดใหม่อีกครั้ง"
  Write-Host ""
  $Answer = Read-Host "พิมพ์ y แล้วกด Enter เพื่อเปิดหน้าเว็บของชุดที่กำลังทำงานอยู่ (หรือกด Enter เพื่อปิด)"
  if ($Answer -eq "y") { Start-Process $AppUrl }
  exit 0
}

New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null

Write-Host ""
Write-Host "  HR Auto กำลังเริ่มทำงาน..." -ForegroundColor Cyan
Write-Host ""
Write-Host "  ข้อมูลของคุณเก็บที่: $DataDirectory"
Write-Host ""
Write-Host "  *** อย่าปิดหน้าต่างนี้ขณะใช้งาน ***" -ForegroundColor Yellow
Write-Host "  ปิดหน้าต่างนี้เมื่อไหร่ HR Auto จะหยุดทำงานทันที"
Write-Host ""

$ServerProcess = Start-Process `
  -FilePath $NodeExe `
  -ArgumentList $ServerJs `
  -WorkingDirectory $AppDirectory `
  -NoNewWindow `
  -PassThru

try {
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 80; $Attempt += 1) {
    if ($ServerProcess.HasExited) {
      throw "HR Auto หยุดทำงานก่อนเริ่มเสร็จ กรุณาดูข้อความผิดพลาดด้านบน"
    }
    if (Get-HrAutoHealth) {
      $Ready = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }

  if (-not $Ready) {
    throw "HR Auto ไม่ตอบสนองภายใน 20 วินาที กรุณาปิดโปรแกรมเดิมที่ใช้พอร์ต $Port แล้วลองใหม่"
  }

  Write-Host "  พร้อมใช้งานแล้ว กำลังเปิด $AppUrl" -ForegroundColor Green
  Write-Host ""
  Start-Process $AppUrl
  Wait-Process -Id $ServerProcess.Id
} catch {
  Write-Host ""
  Write-Host "เกิดข้อผิดพลาด: $_" -ForegroundColor Red
  Write-Host ""
  Read-Host "กด Enter เพื่อปิดหน้าต่างนี้"
} finally {
  if (-not $ServerProcess.HasExited) {
    Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
