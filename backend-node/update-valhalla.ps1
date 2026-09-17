$ErrorActionPreference = "Stop"

Set-Location "C:\neartime-server"

Write-Host ""
Write-Host "=========================================="
Write-Host "NearTime - updating pedestrian map data"
Write-Host "=========================================="
Write-Host ""

docker compose down

$custom = "C:\neartime-server\valhalla-data"

if (Test-Path $custom) {
    Get-ChildItem $custom -Recurse -Force |
        Where-Object {
            $_.Name -match "valhalla_tiles|norway-latest\.osm\.pbf"
        } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

docker compose pull
docker compose up -d

Write-Host ""
Write-Host "Valhalla rebuild started."
Write-Host "Check progress with:"
Write-Host "docker logs -f neartime-valhalla"