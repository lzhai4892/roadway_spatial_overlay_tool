@echo off
setlocal EnableExtensions
title Roadway Line-to-Line Overlay Tool v1.0
cd /d "%~dp0"

echo ======================================================================
echo Roadway Line-to-Line Overlay Tool v1.0
echo Developed by lzhai4892  https://github.com/lzhai4892
echo ======================================================================
echo.

set "PY="
set "USE_PY_LAUNCHER="

for /f "delims=" %%I in ('where python 2^>nul') do (
  echo %%I | find /i "\WindowsApps\" >nul
  if errorlevel 1 if not defined PY set "PY=%%I"
)

if not defined PY (
  where py >nul 2>&1
  if not errorlevel 1 (
    set "USE_PY_LAUNCHER=1"
  )
)

if not defined PY if not defined USE_PY_LAUNCHER (
  for /f "delims=" %%I in ('where python3 2^>nul') do (
    echo %%I | find /i "\WindowsApps\" >nul
    if errorlevel 1 if not defined PY set "PY=%%I"
  )
)

if not defined PY if not defined USE_PY_LAUNCHER (
  echo Could not find Python on PATH.
  echo Install Python from https://www.python.org/downloads/
  echo and check "Add python.exe to PATH", then run this again.
  echo.
  echo Or open this folder with VS Code Live Server and browse to index.html
  echo over http:// so Sample can load example_case files.
  echo.
  pause
  exit /b 1
)

echo Serving this folder at http://127.0.0.1:5000
echo Close this window to stop the server.
echo.

start "" cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:5000/"

if defined USE_PY_LAUNCHER (
  py -3 -m http.server 5000
) else (
  "%PY%" -m http.server 5000
)

echo.
echo Server stopped. If the page did not open, check that port 5000 is free.
pause
exit /b %ERRORLEVEL%
