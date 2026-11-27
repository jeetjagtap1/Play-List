@echo off
rem Double-click to run Highway Player locally.
rem Starts a small web server in this folder and opens the site in your browser.
setlocal
cd /d "%~dp0"
set "PORT=5500"
set "URL=http://localhost:%PORT%"

echo.
echo   Highway Player is starting at %URL%
echo   Keep this window open while you listen. Close it to stop the server.
echo.

rem Open the browser after a short delay so the server is ready first.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" %URL%"

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto :end
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT%
  goto :end
)

where npx >nul 2>nul
if %errorlevel%==0 (
  npx --yes serve -l %PORT% .
  goto :end
)

echo   Could not find Python or Node.js.
echo   Install one of them, from https://www.python.org or https://nodejs.org, then run this again.

:end
echo.
pause
