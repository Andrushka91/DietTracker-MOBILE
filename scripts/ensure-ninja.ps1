# Android SDK CMake ships ninja 1.10, which hard-fails on every path longer
# than 260 characters ("ninja: error: Stat(...): Filename longer than 260
# characters"). React Native 0.88 codegen objects in this project are ~360
# characters long, so the native build cannot start with that ninja.
#
# Ninja 1.11 and newer understand long paths on Windows. This script checks
# every CMake package installed in the Android SDK and, when the bundled ninja
# is older than 1.11, replaces it with the official 1.12.1 build. The original
# binary is kept next to it as ninja-<version>-original.exe.bak, so the change
# is reversible and idempotent.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ensure-ninja.ps1

$ErrorActionPreference = 'Stop'

$required = [version]'1.11.0'
$downloadUrl = 'https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip'

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$cmakeRoot = Join-Path $sdk 'cmake'
if (-not (Test-Path $cmakeRoot)) {
  Write-Host "[ninja] no CMake package under $cmakeRoot - nothing to prepare."
  exit 0
}

$newZip = $null
$failures = 0

foreach ($package in Get-ChildItem $cmakeRoot -Directory) {
  $ninja = Join-Path $package.FullName 'bin\ninja.exe'
  if (-not (Test-Path $ninja)) {
    continue
  }

  $current = (& $ninja --version 2>$null)
  $current = ($current | Out-String).Trim()
  $parsed = $null
  if (-not [version]::TryParse($current, [ref]$parsed)) {
    Write-Warning "[ninja] could not read the version of $ninja - leaving it alone."
    continue
  }

  if ($parsed -ge $required) {
    Write-Host "[ninja] $($package.Name): $current supports long paths - OK."
    continue
  }

  Write-Host "[ninja] $($package.Name): $current cannot build long paths - installing 1.12.1."

  if ($null -eq $newZip) {
    $zipPath = Join-Path $env:TEMP 'ninja-win-1.12.1.zip'
    $extractPath = Join-Path $env:TEMP 'ninja-win-1.12.1'
    try {
      if (-not (Test-Path $zipPath)) {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
      }
      if (Test-Path $extractPath) {
        Remove-Item $extractPath -Recurse -Force
      }
      Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
      $newZip = Join-Path $extractPath 'ninja.exe'
    } catch {
      Write-Warning "[ninja] download failed: $($_.Exception.Message)"
      Write-Warning '[ninja] fetch https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip manually and copy ninja.exe over:'
      Write-Warning "[ninja]   $ninja"
      $failures += 1
      continue
    }
  }

  $backup = Join-Path $package.FullName "bin\ninja-$current-original.exe.bak"
  if (-not (Test-Path $backup)) {
    Copy-Item $ninja $backup
  }
  Copy-Item $newZip $ninja -Force
  $installed = ((& $ninja --version) | Out-String).Trim()
  Write-Host "[ninja] $($package.Name): now $installed (original kept at $backup)."
}

if ($failures -gt 0) {
  exit 1
}
Write-Host '[ninja] all CMake packages are long-path capable.'
exit 0
