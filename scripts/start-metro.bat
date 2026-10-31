@echo off
title Diet Tracker - Metro dev server
rem Keep this window open while testing - it serves the JS bundle to the app.
cd /d "%~dp0.."
npm start
