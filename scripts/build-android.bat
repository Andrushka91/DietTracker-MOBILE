@echo off
title Diet Tracker - Android build + install
rem Local debug build for the emulator or a USB device.
rem
rem History: this used to run on a SUBST drive (R:) because Windows refused the
rem longer-than-260-character codegen paths. The real fix is a long-path aware
rem ninja (>= 1.11) - scripts\ensure-ninja.ps1 installs one into the Android
rem SDK, so the build now runs on the real project folder and Metro, Gradle and
rem Android Studio all see the same files.
setlocal
cd /d "%~dp0.."

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined JAVA_HOME if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-ninja.ps1"
if errorlevel 1 (
  echo.
  echo Could not prepare a long-path capable ninja - see the message above.
  pause
  exit /b 1
)

echo STARTED %DATE% %TIME% > android-build.log
echo Building in %CD% - log: android-build.log >> android-build.log
call node scripts\patch-autolinking.js >> android-build.log 2>&1
call npx expo run:android >> android-build.log 2>&1
echo EXITCODE=%errorlevel% >> android-build.log
echo.
echo Build finished - see android-build.log for the full output.
echo (this window owns the Metro bundler; press any key to close it)
pause >nul
