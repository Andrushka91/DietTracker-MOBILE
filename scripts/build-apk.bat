@echo off
title Diet Tracker - standalone release APK
rem Builds the installable APK (release variant, JavaScript bundled inside, no Metro needed) into
rem the release\ folder:
rem
rem   DietTracker-<version>-arm64-v8a.apk   every modern phone (64-bit ARM), ~30 MB
rem   DietTracker-<version>-universal.apk   any device, including 32-bit ARM and x86 emulators, ~87 MB
rem
rem The release variant is signed with the standard Android debug key (see android/app/build.gradle),
rem which is what makes sideloading work. It is not a Google Play upload: Play needs its own keystore.
setlocal
cd /d "%~dp0.."

set VERSION=1.0.0.1
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined JAVA_HOME if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-ninja.ps1"
if errorlevel 1 (
  echo.
  echo Could not prepare a long-path capable ninja - see the message above.
  pause
  exit /b 1
)

if not exist release mkdir release

echo Building the universal APK...
pushd android
call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 goto :failed
if not exist ..\release mkdir ..\release
copy /y app\build\outputs\apk\release\app-release.apk ..\release\DietTracker-%VERSION%-universal.apk >nul

echo Building the arm64-v8a APK...
call gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
if errorlevel 1 goto :failed
copy /y app\build\outputs\apk\release\app-release.apk ..\release\DietTracker-%VERSION%-arm64-v8a.apk >nul

rem Windows `copy` keeps the SOURCE file's timestamp, so when Gradle is already
rem up to date the copied APK still looks older than this run and scripts\dev.js
rem rejects it ("finished but did not rewrite"). Stamp both copies with the time
rem of THIS build - the bytes are untouched - so that freshness check means what
rem it says: the artifact was produced by this run.
powershell -NoProfile -Command "Get-Item -LiteralPath '..\release\DietTracker-%VERSION%-universal.apk','..\release\DietTracker-%VERSION%-arm64-v8a.apk' | ForEach-Object { $_.LastWriteTime = Get-Date }"
if errorlevel 1 goto :failed
popd

echo.
echo Done - artifacts in release\
for %%f in (release\DietTracker-%VERSION%-*.apk) do (
  for /f "tokens=2,*" %%a in ('dir /-c "%%f" ^| findstr /i "%%~nxf"') do echo   %%~nxf  %%a bytes
)
echo.
echo SHA-256:
certutil -hashfile "release\DietTracker-%VERSION%-arm64-v8a.apk" SHA256 | findstr /v ":"
certutil -hashfile "release\DietTracker-%VERSION%-universal.apk" SHA256 | findstr /v ":"
exit /b 0

:failed
popd
echo.
echo The build failed - see the Gradle output above.
exit /b 1
