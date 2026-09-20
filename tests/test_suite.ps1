# Chronos-Scheduler Verification Suite
$base = Resolve-Path (Join-Path $PSScriptRoot "..")
$required = @("package.json", "Dockerfile", "README.md", "src/index.js", "public/index.html")
foreach ($f in $required) {
    if (-not (Test-Path (Join-Path $base $f))) { throw "Missing: $f" }
}
Write-Host "Verification Passed: Chronos-Scheduler"
