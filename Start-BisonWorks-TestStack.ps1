param(
    [string]$BackendRoot = "",
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5174,
    [switch]$InstallDependencies
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$FrontendRoot = $PSScriptRoot

function ConvertTo-QuotedValue {
    param([Parameter(Mandatory = $true)][string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Test-PortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

function Get-AvailablePort {
    param(
        [Parameter(Mandatory = $true)][int]$PreferredPort,
        [int]$SearchCount = 20
    )
    for ($offset = 0; $offset -lt $SearchCount; $offset++) {
        $candidate = $PreferredPort + $offset
        if (Test-PortAvailable -Port $candidate) {
            return $candidate
        }
    }
    throw "No free port found from $PreferredPort through $($PreferredPort + $SearchCount - 1)."
}

function Resolve-BackendPath {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($BackendRoot)) {
        $candidates += $BackendRoot
    }
    if (-not [string]::IsNullOrWhiteSpace($env:BISONWORKS_BACKEND_ROOT)) {
        $candidates += $env:BISONWORKS_BACKEND_ROOT
    }
    $candidates += "C:\Users\samma\Desktop\PipelineServer\backend"
    $candidates += (Join-Path (Split-Path $FrontendRoot -Parent) "PipelineServer\backend")

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $mainPath = Join-Path $candidate "app\main.py"
        if (Test-Path $mainPath) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw "Backend app not found. Pass -BackendRoot or set BISONWORKS_BACKEND_ROOT to the folder containing app\main.py."
}

function Resolve-PythonPath {
    param([Parameter(Mandatory = $true)][string]$ResolvedBackendRoot)

    $repoRoot = Split-Path $ResolvedBackendRoot -Parent
    $candidates = @(
        (Join-Path $ResolvedBackendRoot ".venv\Scripts\python.exe"),
        (Join-Path $repoRoot ".venv\Scripts\python.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }

    throw "Python was not found. Install Python or create a backend venv first."
}

function Start-ConsoleCommand {
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
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapped))
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        $encoded
    ) | Out-Null
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 750
        }
    }
    return $false
}

$backendPath = Resolve-BackendPath
$pythonPath = Resolve-PythonPath -ResolvedBackendRoot $backendPath
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $npmCommand) {
    throw "npm was not found. Install Node.js first."
}

$backendPort = Get-AvailablePort -PreferredPort $BackendPort
$frontendPort = Get-AvailablePort -PreferredPort $FrontendPort
$backendUrl = "http://127.0.0.1:$backendPort"
$frontendUrl = "http://127.0.0.1:$frontendPort"

if ($InstallDependencies) {
    Write-Host "Installing frontend dependencies..."
    Push-Location $FrontendRoot
    try {
        & $npmCommand.Source install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }

    Write-Host "Installing backend dependencies..."
    Push-Location $backendPath
    try {
        & $pythonPath -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) {
            throw "pip install failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
}

$quotedBackendPath = ConvertTo-QuotedValue -Value $backendPath
$quotedFrontendRoot = ConvertTo-QuotedValue -Value $FrontendRoot
$quotedPythonPath = ConvertTo-QuotedValue -Value $pythonPath
$quotedNpmPath = ConvertTo-QuotedValue -Value $npmCommand.Source
$localJwtSecret = "local-testing-secret-for-bisonworks-dev-only-2026"
$corsOrigins = "http://localhost:$frontendPort,http://127.0.0.1:$frontendPort"

$backendCommand = @"
Set-Location $quotedBackendPath
`$env:JWT_SECRET = '$localJwtSecret'
`$env:PIPELINE_DB_URL = 'sqlite:///./pipeline.db'
`$env:PIPELINE_SKIP_SCHEMA = 'false'
`$env:PIPELINE_CORS_ORIGINS = '$corsOrigins'
Write-Host 'Backend: $backendUrl'
& $quotedPythonPath -m uvicorn app.main:app --host 127.0.0.1 --port $backendPort
"@

$frontendCommand = @"
Set-Location $quotedFrontendRoot
`$env:VITE_LOCAL_API_TARGET = '$backendUrl'
`$env:VITE_API_URL = ''
`$env:VITE_PIPELINE_API_URL = ''
Write-Host 'Frontend: $frontendUrl'
Write-Host 'API proxy target: $backendUrl'
& $quotedNpmPath run dev -- --host 127.0.0.1 --port $frontendPort
"@

Write-Host "Starting BisonWorks local testing stack..."
Write-Host "Backend root: $backendPath"
Write-Host "Frontend root: $FrontendRoot"

Start-ConsoleCommand -Title "BisonWorks Backend $backendPort" -CommandText $backendCommand
if (Wait-ForHttp -Url "$backendUrl/health" -TimeoutSeconds 45) {
    Write-Host "Backend ready: $backendUrl/health"
} else {
    Write-Warning "Backend did not answer $backendUrl/health yet. Check the backend window for errors."
}

Start-ConsoleCommand -Title "BisonWorks Frontend $frontendPort" -CommandText $frontendCommand
if (Wait-ForHttp -Url $frontendUrl -TimeoutSeconds 45) {
    Write-Host "Frontend ready: $frontendUrl"
} else {
    Write-Warning "Frontend did not answer $frontendUrl yet. Check the frontend window for errors."
}

Write-Host ""
Write-Host "Testing stack URLs"
Write-Host "Frontend: $frontendUrl"
Write-Host "Backend:  $backendUrl"
Write-Host "API proxy: $frontendUrl/api -> $backendUrl"
Write-Host ""
Write-Host "Close the backend and frontend PowerShell windows to stop the servers."
