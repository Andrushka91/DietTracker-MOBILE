@echo off
title Diet Tracker - dev (emulator + build + Metro)
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%
setlocal enabledelayedexpansion

rem 1/3 - reuse a running emulator or start the AVD in its own window.
set SERIAL=
for /f "skip=1 tokens=1,2" %%a in ('adb devices 2^>nul') do (
  set T1=%%a
  if "!T1:~0,9!"=="emulator-" if not defined SERIAL set SERIAL=%%a
)
if defined SERIAL (
  echo Emulator %SERIAL% is already running - reusing it.
) else (
  echo Starting the AVD "Medium_Phone_API_37.0" in a new window - keep it open...
  start "Diet Tracker - Android Emulator" cmd /c "emulator -avd Medium_Phone_API_37.0 -no-snapshot"
)

rem 2/3 - wait for Android to finish booting (up to ~5 minutes).
echo Waiting for the emulator to finish booting ...
set /a tries=0
:waitboot
if not defined SERIAL (
  for /f "skip=1 tokens=1" %%a in ('adb devices 2^>nul') do (
    set T1=%%a
    if "!T1:~0,9!"=="emulator-" if not defined SERIAL set SERIAL=%%a
  )
)
set BOOTED=
if defined SERIAL (
  for /f "delims=" %%b in ('adb -s %SERIAL% shell getprop sys.boot_completed 2^>nul') do set BOOTED=%%b
)
if "!BOOTED!"=="1" goto booted
set /a tries+=1
if !tries! geq 60 (
  echo The emulator did not finish booting in ~5 minutes - see its window for errors.
  pause
  exit /b 1
)
ping -n 6 127.0.0.1 >nul
goto waitboot

:booted
echo Emulator %SERIAL% is up - building and installing the app ...

rem 3/3 - the usual local build + install + Metro chain (this window owns Metro).
call "%~dp0build-android.bat"