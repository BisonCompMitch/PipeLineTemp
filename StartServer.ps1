# StartServer.ps1
# Launches the BisonWorks backend (FastAPI/uvicorn, port 8000) and frontend
# (Vite, port 5174) dev servers in separate windows so both keep running and
# log independently.

$ErrorActionPreference = "Stop"

$root = (Resolve-Path $PSScriptRoot).Path
$backendRoot = $env:BISONWORKS_BACKEND_ROOT
if ([string]::IsNullOrWhiteSpace($backendRoot)) {
  $backendRoot = "C:\Users\samma\Desktop\PipelineServer\backend"
}
$backendRoot = (Resolve-Path $backendRoot).Path

$backendPort = 8000
$frontendPort = 5174
$backendUrl = "http://127.0.0.1:$backendPort"
$frontendUrl = "http://localhost:$frontendPort"
$localAdminUsername = "admin"
$localAdminPassword = "Admin123!"
$seedScript = Join-Path $root "scripts\seed_local_admin.py"

function ConvertTo-QuotedValue {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Start-ServerWindow {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$CommandText
  )

  $safeTitle = $Title.Replace("'", "''")
  $wrapped = @"
`$Host.UI.RawUI.WindowTitle = '$safeTitle'
`$ErrorActionPreference = 'Stop'
$CommandText
"@
  $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapped))
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    $encodedCommand
  ) -WindowStyle Normal
}

$python = Join-Path $backendRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  $repoPython = Join-Path (Split-Path $backendRoot -Parent) ".venv\Scripts\python.exe"
  if (Test-Path $repoPython) {
    $python = $repoPython
  } else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
      throw "Python was not found. Install Python or create a backend venv first."
    }
    $python = $pythonCommand.Source
  }
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $npmCommand) {
  throw "npm was not found. Install Node.js first."
}

if (-not (Test-Path (Join-Path $backendRoot "app\main.py"))) {
  throw "Backend app not found at $backendRoot. Set BISONWORKS_BACKEND_ROOT to the folder containing app\main.py."
}
if (-not (Test-Path $seedScript)) {
  throw "Local admin seed script not found at $seedScript."
}

$quotedBackendRoot = ConvertTo-QuotedValue -Value $backendRoot
$quotedRoot = ConvertTo-QuotedValue -Value $root
$quotedPython = ConvertTo-QuotedValue -Value $python
$quotedNpm = ConvertTo-QuotedValue -Value $npmCommand.Source
$quotedSeedScript = ConvertTo-QuotedValue -Value $seedScript

$backendCommand = @"
Set-Location $quotedBackendRoot
`$env:JWT_SECRET = 'local-testing-secret-for-bisonworks-dev-only-2026'
`$env:PIPELINE_DB_URL = 'sqlite:///./pipeline.db'
`$env:PIPELINE_SKIP_SCHEMA = 'false'
`$env:PIPELINE_CORS_ORIGINS = 'http://localhost:$frontendPort,http://127.0.0.1:$frontendPort'
Write-Host 'Installing local backend bcrypt compatibility pin...'
& $quotedPython -m pip install 'bcrypt==4.0.1'
if (`$LASTEXITCODE -ne 0) { throw 'bcrypt compatibility install failed.' }
& $quotedPython $quotedSeedScript --username '$localAdminUsername' --password '$localAdminPassword'
if (`$LASTEXITCODE -ne 0) { throw 'Local admin seed failed.' }
Write-Host 'Backend: $backendUrl'
& $quotedPython -m uvicorn app.main:app --host 127.0.0.1 --port $backendPort
"@

$frontendCommand = @"
Set-Location $quotedRoot
`$env:VITE_LOCAL_API_TARGET = '$backendUrl'
`$env:VITE_API_URL = ''
`$env:VITE_PIPELINE_API_URL = ''
Write-Host 'Frontend: $frontendUrl'
Write-Host 'API proxy target: $backendUrl'
& $quotedNpm run dev -- --host 127.0.0.1 --port $frontendPort
"@

Start-ServerWindow -Title "BisonWorks Backend $backendPort" -CommandText $backendCommand
Start-ServerWindow -Title "BisonWorks Frontend $frontendPort" -CommandText $frontendCommand

Start-Sleep -Seconds 3
Start-Process $frontendUrl

Write-Host "Backend starting on $backendUrl"
Write-Host "Frontend starting on $frontendUrl"
Write-Host "Frontend API proxy: $frontendUrl/api -> $backendUrl"
Write-Host "Local test login: $localAdminUsername / $localAdminPassword"
