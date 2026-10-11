@echo off
rem Checks GitHub for a new GoofyTrack version and installs it into the game (see update.js)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable : installez-le depuis https://nodejs.org & pause & exit /b 1)
rem Kept on one line: the update can rewrite this file while it runs
node update.js %* & pause & exit /b
