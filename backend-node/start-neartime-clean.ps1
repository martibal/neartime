$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== NearTime clean start ===" -ForegroundColor Cyan

# 1) Stop every stale Node process so port 8081 cannot point to old code.
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# 2) Verify backend file exists.
$server = "C:\neartime-server\server.js"
if (-not (Test-Path $server)) {
    throw "Missing $server"
}

# 3) Verify this is the expected backend generation.
$serverText = Get-Content $server -Raw

if ($serverText -notmatch 'app\.get\("/categories"') {
    throw "server.js is not the current NearTime backend: /categories endpoint is missing."
}

if ($serverText -notmatch 'TOMTOM PLACES v3 POI TYPES') {
    throw "server.js is not the expected NearTime Places-v3 build."
}

# 4) Syntax check.
Push-Location "C:\neartime-server"
try {
    & node --check ".\server.js"
    if ($LASTEXITCODE -ne 0) {
        throw "node --check failed"
    }

    # 5) Start exactly one backend process.
    $node = Start-Process `
        -FilePath "node" `
        -ArgumentList "--env-file=.env", "server.js" `
        -WorkingDirectory "C:\neartime-server" `
        -PassThru `
        -WindowStyle Normal

    Write-Host "Started Node PID $($node.Id)" -ForegroundColor Green

    # 6) Wait until backend answers.
    $ready = $false

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500

        try {
            $status = Invoke-RestMethod `
                -Uri "http://127.0.0.1:8081/status" `
                -Method Get `
                -TimeoutSec 2

            if ($status.ok -eq $true) {
                $ready = $true
                break
            }
        }
        catch {
        }
    }

    if (-not $ready) {
        Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
        throw "Backend did not become ready on port 8081."
    }

    # 7) Verify /categories BEFORE Android is allowed to use the backend.
    $categories = Invoke-RestMethod `
        -Uri "http://127.0.0.1:8081/categories" `
        -Method Get `
        -TimeoutSec 10

    if (-not $categories.categories) {
        Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
        throw "/categories returned no category list."
    }

    $count = @($categories.categories).Count

    Write-Host ""
    Write-Host "Backend OK" -ForegroundColor Green
    Write-Host "Status endpoint: OK"
    Write-Host "Categories endpoint: OK ($count categories)"
    Write-Host "Node PID: $($node.Id)"

    # 8) Recreate ADB reverse so emulator always reaches this backend.
    $adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

    if (Test-Path $adb) {
        & $adb reverse tcp:8081 tcp:8081 | Out-Null
        Write-Host "ADB reverse tcp:8081 -> tcp:8081: OK" -ForegroundColor Green
    }
    else {
        Write-Host "ADB not found; run adb reverse manually." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "NOW run the Android app." -ForegroundColor Cyan
}
finally {
    Pop-Location
}
