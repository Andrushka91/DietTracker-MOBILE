@echo off
title Diet Tracker - Android setup (local.properties)
rem Generates android\local.properties if it is missing.
rem Run this after cloning the repo or after deleting local.properties.
setlocal
cd /d "%~dp0.."

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

if exist android\local.properties (
  echo android\local.properties already exists - nothing to do.
  echo sdk.dir=%ANDROID_HOME%
  exit /b 0
)

echo Generating android\local.properties ...
echo sdk.dir=%ANDROID_HOME%> android\local.properties
echo Done - android\local.properties created.
exit /b 0
