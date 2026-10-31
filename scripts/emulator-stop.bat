@echo off
title Diet Tracker - Stop Android Emulator
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%
setlocal enabledelayedexpansion

rem Pick the first emulator serial regardless of its adb state (device/offline).
set SERIAL=
for /f "skip=1 tokens=1,2" %%a in ('adb devices 2^>nul') do (
  set T1=%%a
  if "!T1:~0,9!"=="emulator-" if not defined SERIAL set SERIAL=%%a
)

if not defined SERIAL (
  echo No running emulator found - nothing to stop.
  ping -n 4 127.0.0.1 >nul
  exit /b 0
)

echo Gracefully shutting down %SERIAL% (adb emu kill) ...
adb -s %SERIAL% emu kill >nul 2>&1

rem Wait up to ~20 s for the emulator to disappear from adb.
set /a tries=0
:wait
ping -n 3 127.0.0.1 >nul
set STILL=
for /f "skip=1 tokens=1" %%a in ('adb devices 2^>nul') do (
  if /I "%%a"=="%SERIAL%" set STILL=1
)
if defined STILL (
  set /a tries+=1
  if !tries! lss 10 goto wait
  echo The emulator is still listed after ~20 s - close its console window as a last resort.
  ping -n 4 127.0.0.1 >nul
  exit /b 1
)

echo Emulator stopped cleanly. Start it again any time with: npm run emulator
ping -n 3 127.0.0.1 >nul
exit /b 0