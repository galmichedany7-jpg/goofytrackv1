@echo off
rem Rebuilds the game from the code in sources/ (see sources/build.js). The very first time, it takes the
rem PolyTrack 0.6.3 folder: found next to this one, or given as argument
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable : installez-le depuis https://nodejs.org & pause & exit /b 1)
rem Kept on one line: an update can rewrite this file while it runs
node sources\build.js %* & pause & exit /b
