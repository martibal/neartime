$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=========================================="
Write-Host "NearTime - updating pedestrian map data"
Write-Host "=========================================="
Write-Host ""

docker compose down
if ($LASTEXITCODE -ne 0) {
    throw "docker compose down failed."
}

$custom = Join-Path $root "valhalla-data"
if (Test-Path $custom) {
    Get-ChildItem $custom -Recurse -Force |
        Where-Object {
            $_.Name -match "valhalla_tiles|norway-latest\.osm\.pbf"
        } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

docker compose pull valhalla
if ($LASTEXITCODE -ne 0) {
    throw "docker compose pull failed."
}

docker compose up -d valhalla
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed."
}

Write-Host ""
Write-Host "Valhalla rebuild started."
Write-Host "Check progress with:"
Write-Host "docker logs -f neartime-valhalla"
