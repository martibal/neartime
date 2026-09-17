$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== NearTime cost-gated start ===" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($env:TOMTOM_API_KEY)) {
    throw "TOMTOM_API_KEY is not loaded in this PowerShell session."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not available in PATH."
}

Write-Host "Starting local Valhalla..." -ForegroundColor Cyan
docker compose up -d valhalla
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed."
}

$valhallaReady = $false
for ($i = 0; $i -lt 300; $i++) {
    try {
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:8002/status" -UseBasicParsing -TimeoutSec 2
        $valhallaReady = $true
        break
    }
    catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $valhallaReady) {
    Write-Host ""
    Write-Host "Valhalla did not become ready in 10 minutes." -ForegroundColor Red
    Write-Host "Inspect with: docker logs -f neartime-valhalla"
    throw "LOCAL_VALHALLA_NOT_READY"
}

Write-Host "Local Valhalla: READY" -ForegroundColor Green

& node --check ".\server.js"
if ($LASTEXITCODE -ne 0) {
    throw "node --check failed."
}

Write-Host "Backend syntax: OK" -ForegroundColor Green

$listener = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $pids = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($pidValue in $pids) {
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

$node = Start-Process -FilePath "node" -ArgumentList ".\server.js" -WorkingDirectory $root -PassThru -WindowStyle Normal
Write-Host "Started backend PID $($node.Id)"

$backendReady = $false
$status = $null

for ($i = 0; $i -lt 30; $i++) {
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:8081/status" -TimeoutSec 2
        if ($status.ok -eq $true -and $status.buildId -eq "2026-09-18-discover-valhalla-v1") {
            $backendReady = $true
            break
        }
    }
    catch {
    }
    Start-Sleep -Milliseconds 500
}

if (-not $backendReady) {
    Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
    throw "Current NearTime backend did not become ready."
}

Write-Host ""
Write-Host "Backend: READY" -ForegroundColor Green
Write-Host "Build: $($status.buildId)"
Write-Host "Discovery: $($status.placeDiscovery)"
Write-Host "Walking: $($status.pedestrianRouting)"
Write-Host "Paid discovery calls/search: $($status.hardRules.paidPlaceDiscoveryCallsPerExplicitSearch)"
Write-Host "Paid routing calls/search: $($status.hardRules.paidPedestrianRoutingCallsPerExplicitSearch)"
Write-Host "Google Places calls/search: $($status.hardRules.googlePlacesCallsPerExplicitSearch)"

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adb) {
    & $adb reverse tcp:8081 tcp:8081 | Out-Null
    Write-Host "ADB reverse tcp:8081 -> tcp:8081: OK" -ForegroundColor Green
}
else {
    Write-Host "ADB not found; run adb reverse manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "NearTime is ready: max 1 paid place-discovery request and 0 paid routing requests per explicit search." -ForegroundColor Cyan
