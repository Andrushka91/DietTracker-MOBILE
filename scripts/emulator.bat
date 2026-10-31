@echo off
title Diet Tracker - Android Emulator
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%

setlocal enabledelayedexpansion

rem adb separates columns with a TAB, so detect the serial by prefix instead
rem of findstr whitespace classes (robust whether adb pads with spaces or not).
set RUNNING=
for /f "skip=1 tokens=1,2" %%a in ('adb devices 2^>nul') do (
  set T1=%%a
  if "!T1:~0,9!"=="emulator-" set RUNNING=1
)
if defined RUNNING (
  echo An emulator is already running.
  timeout /t 5 >nul
  exit /b 0
)

echo Starting Medium_Phone (API 37) - keep this window open...
rem -no-snapshot: always cold boot - the saved 'default_boot' snapshot went
rem corrupt (Error -5 loading VM state) and fails to load on every start.
rem To get quick-boot back later, wipe the stale snapshot (Android Studio >
rem Device Manager > ... > Wipe Data, or delete snapshots\default_boot under
rem %USERPROFILE%\.android\avd\Medium_Phone_API_37.0.avd) and use
rem -no-snapshot-save again.
emulator -avd Medium_Phone_API_37.0 -no-snapshot