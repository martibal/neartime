$ErrorActionPreference = "Stop"

$ExpectedBuild = "2026-09-16-places-v3-stable"
$Root = "C:\neartime-server"
$Server = Join-Path $Root "server.js"
$Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

Write-Host ""
Write-Host "=== NearTime verified start ===" -ForegroundColor Cyan

if (-not (Test-Path $Server)) {
    throw "Missing $Server"
}

Get-Process node -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 700

Push-Location $Root
try {
    node --check .\server.js

    if ($LASTEXITCODE -ne 0) {
        throw "server.js syntax check failed"
    }

    $Process = Start-Process `
        -FilePath "node" `
        -ArgumentList "--env-file=.env", "server.js" `
        -WorkingDirectory $Root `
        -PassThru

    $Status = $null

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500

        try {
            $Status = Invoke-RestMethod `
                -Uri "http://127.0.0.1:8081/status" `
                -Method Get `
                -TimeoutSec 2

            if ($Status.ok -eq $true) {
                break
            }
        }
        catch {
            $Status = $null
        }
    }

    if ($null -eq $Status) {
        throw "Backend did not start on port 8081"
    }

    if ($Status.buildId -ne $ExpectedBuild) {
        throw "Wrong backend. Expected $ExpectedBuild but got $($Status.buildId)"
    }

    if ($Status.searchApiV2Used -ne $false) {
        throw "Wrong backend: Search API v2 is active"
    }

    $Categories = Invoke-RestMethod `
        -Uri "http://127.0.0.1:8081/categories" `
        -Method Get `
        -TimeoutSec 10

    if ($Categories.buildId -ne $ExpectedBuild) {
        throw "Wrong /categories endpoint"
    }

    if (@($Categories.categories).Count -lt 1) {
        throw "/categories is empty"
    }

    if (Test-Path $Adb) {
        & $Adb reverse tcp:8081 tcp:8081 | Out-Null
    }

    Write-Host ""
    Write-Host "BACKEND VERIFIED" -ForegroundColor Green
    Write-Host "Build: $($Status.buildId)"
    Write-Host "Search: $($Status.placeSearch)"
    Write-Host "Search API v2 used: $($Status.searchApiV2Used)"
    Write-Host "Categories: $(@($Categories.categories).Count)"
    Write-Host "Valhalla: $($Status.valhalla)"
    Write-Host "ADB reverse: OK"
    Write-Host ""
    Write-Host "NOW RUN THE ANDROID APP" -ForegroundColor Cyan
}
finally {
    Pop-Location
}
