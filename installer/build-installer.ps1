# Build HR-Auto-Setup-<version>.exe
#
# Produces a self-contained per-user installer: bundled Node runtime, production
# dependencies and Playwright's Chromium, so the target machine needs nothing
# preinstalled.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\installer\build-installer.ps1

$ErrorActionPreference = "Stop"

$InstallerDirectory = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $InstallerDirectory
$StagingDirectory = Join-Path $InstallerDirectory "staging"
$OutputDirectory = Join-Path $InstallerDirectory "output"
$BrowserCache = Join-Path $env:LOCALAPPDATA "ms-playwright"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Copy-Tree($Source, $Destination) {
  robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Failed to copy $Source (robocopy exit $LASTEXITCODE)"
  }
  $global:LASTEXITCODE = 0
}

# --- Preflight -------------------------------------------------------------

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCommand) { throw "Node.js was not found on PATH." }
$NodeExe = $NodeCommand.Source

$Iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Iscc) { throw "Inno Setup 6 (ISCC.exe) was not found. Install it with: winget install JRSoftware.InnoSetup" }

if (-not (Test-Path -LiteralPath $BrowserCache)) {
  throw "Playwright browsers were not found at $BrowserCache. Run: npm run install-browser"
}

# Ship the headful Chromium plus winldd (Windows dependency probe). The headless
# shell (~270 MB) and ffmpeg are skipped: the packaged build always runs headful.
$BrowserFolders = Get-ChildItem -LiteralPath $BrowserCache -Directory |
  Where-Object { $_.Name -like "chromium-*" -or $_.Name -like "winldd-*" }
if (-not ($BrowserFolders | Where-Object { $_.Name -like "chromium-*" })) {
  throw "No chromium-* build found in $BrowserCache. Run: npm run install-browser"
}

# Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, which mangles the Thai
# text in launcher.ps1 badly enough that the script no longer parses. Catch that
# here instead of shipping a launcher that cannot start.
$LauncherPath = Join-Path $InstallerDirectory "launcher.ps1"
$LauncherBytes = [System.IO.File]::ReadAllBytes($LauncherPath)
if (-not ($LauncherBytes.Length -ge 3 -and $LauncherBytes[0] -eq 0xEF -and $LauncherBytes[1] -eq 0xBB -and $LauncherBytes[2] -eq 0xBF)) {
  throw "launcher.ps1 must be saved as UTF-8 with BOM, otherwise its Thai text breaks under Windows PowerShell."
}
$LauncherErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($LauncherPath, [ref]$null, [ref]$LauncherErrors)
if ($LauncherErrors) {
  throw "launcher.ps1 has syntax errors: " + (($LauncherErrors | ForEach-Object { $_.Message }) -join "; ")
}

$PackageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$Version = $PackageJson.version

Write-Host "HR Auto installer build" -ForegroundColor Green
Write-Host "  version : $Version"
Write-Host "  node    : $NodeExe"
Write-Host "  iscc    : $Iscc"
Write-Host "  browsers: $(($BrowserFolders | ForEach-Object { $_.Name }) -join ', ')"

# --- Stage -----------------------------------------------------------------

Write-Step "Cleaning staging directory"
if (Test-Path -LiteralPath $StagingDirectory) {
  Remove-Item -LiteralPath $StagingDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $StagingDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

Write-Step "Compiling TypeScript"
Push-Location $ProjectRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
} finally {
  Pop-Location
}

Write-Step "Copying application files"
Copy-Tree (Join-Path $ProjectRoot "dist") (Join-Path $StagingDirectory "dist")
Copy-Tree (Join-Path $ProjectRoot "public") (Join-Path $StagingDirectory "public")
Copy-Item (Join-Path $ProjectRoot "package.json") $StagingDirectory
Copy-Item (Join-Path $ProjectRoot "package-lock.json") $StagingDirectory
Copy-Item (Join-Path $InstallerDirectory "launcher.ps1") $StagingDirectory
Copy-Item (Join-Path $InstallerDirectory "HR Auto.cmd") $StagingDirectory
Copy-Item $NodeExe (Join-Path $StagingDirectory "node.exe")

Write-Step "Installing production dependencies"
Push-Location $StagingDirectory
try {
  # Browsers are copied in from the local cache below, so skip the download that
  # the playwright package would otherwise trigger on install.
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci --omit=dev failed." }
} finally {
  Remove-Item Env:\PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Step "Bundling Chromium (this takes a moment)"
$StagedBrowsers = Join-Path $StagingDirectory "browsers"
New-Item -ItemType Directory -Path $StagedBrowsers -Force | Out-Null
foreach ($Folder in $BrowserFolders) {
  Write-Host "    $($Folder.Name)"
  Copy-Tree $Folder.FullName (Join-Path $StagedBrowsers $Folder.Name)
}

$StagingSize = (Get-ChildItem $StagingDirectory -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("    staging total: {0:N0} MB" -f ($StagingSize / 1MB))

# --- Compile ---------------------------------------------------------------

Write-Step "Compiling installer"
& $Iscc "/DMyAppVersion=$Version" (Join-Path $InstallerDirectory "HR-Auto.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }

$Setup = Join-Path $OutputDirectory "HR-Auto-Setup-$Version.exe"
$SetupSize = (Get-Item $Setup).Length

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ("  $Setup ({0:N0} MB)" -f ($SetupSize / 1MB))
