@echo off
title Diet Tracker - quick commit + push
rem Usage:  deploy.bat [message]
rem Example:  deploy.bat "fix: update gradle wrapper"
setlocal
cd /d "%~dp0.."

set MSG=%~1
if "%MSG%"=="" set MSG=chore: auto-commit from deploy script

echo Staging changes...
git add -A

for /f "tokens=*" %%i in ('git status --porcelain 2^>nul') do set HAS_CHANGES=1

if not defined HAS_CHANGES (
  echo No changes to commit.
  exit /b 0
)

echo Committing: "%MSG%"
git commit -m "%MSG%"

echo Pushing to origin...
git push

echo Done.
exit /b 0
