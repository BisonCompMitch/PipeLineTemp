# StartServer.ps1
# Launches the BisonWorks backend (FastAPI/uvicorn, port 8000) and frontend
# (Vite, port 5174) dev servers in separate windows so both keep running and
# log independently.

$root = $PSScriptRoot
$backendRoot = $env:BISONWORKS_BACKEND_ROOT
if ([string]::IsNullOrWhiteSpace($backendRoot)) {
  $backendRoot = "C:\Users\samma\Desktop\PipelineServer\backend"
}

$backendPort = 8000
$frontendPort = 5174
$backendUrl = "http://127.0.0.1:$backendPort"
$frontendUrl = "http://localhost:$frontendPort"

$python = Join-Path $backendRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  $repoPython = Join-Path (Split-Path $backendRoot -Parent) ".venv\Scripts\python.exe"
  if (Test-Path $repoPython) {
    $python = $repoPython
  } else {
    $python = "python"
  }
}

$npm = "npm"
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) {
  $npm = $npmCommand.Source
}

if (-not (Test-Path (Join-Path $backendRoot "app\main.py"))) {
  throw "Backend app not found at $backendRoot. Set BISONWORKS_BACKEND_ROOT to the folder containing app\main.py."
}

$backendCommand = @"
`$Host.UI.RawUI.WindowTitle = "BisonWorks Backend"
cd "$backendRoot"
`$env:JWT_SECRET = "local-testing-secret-for-bisonworks-dev-only-2026"
`$env:PIPELINE_DB_URL = "sqlite:///./pipeline.db"
`$env:PIPELINE_SKIP_SCHEMA = "false"
`$env:PIPELINE_CORS_ORIGINS = "http://localhost:$frontendPort,http://127.0.0.1:$frontendPort"
& "$python" -m uvicorn app.main:app --host 127.0.0.1 --port $backendPort
"@

$frontendCommand = @"
`$Host.UI.RawUI.WindowTitle = "BisonWorks Frontend"
cd "$root"
`$env:VITE_LOCAL_API_TARGET = "$backendUrl"
`$env:VITE_API_URL = ""
`$env:VITE_PIPELINE_API_URL = ""
& "$npm" run dev -- --host 127.0.0.1 --port $frontendPort
"@

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $backendCommand
) -WindowStyle Normal

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $frontendCommand
) -WindowStyle Normal

Start-Sleep -Seconds 3
Start-Process $frontendUrl

Write-Host "Backend starting on $backendUrl"
Write-Host "Frontend starting on $frontendUrl"
Write-Host "Frontend API proxy: $frontendUrl/api -> $backendUrl"
