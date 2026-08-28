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
set "PYARGS="

if exist "%ProgramFiles%\Python314\python.exe" set "PY=%ProgramFiles%\Python314\python.exe"
if not defined PY if exist "%ProgramFiles%\Python313\python.exe" set "PY=%ProgramFiles%\Python313\python.exe"
if not defined PY if exist "%ProgramFiles%\Python312\python.exe" set "PY=%ProgramFiles%\Python312\python.exe"

if not defined PY (
  for /d %%D in ("%ProgramFiles%\Python3*") do (
    if exist "%%D\python.exe" if not defined PY set "PY=%%D\python.exe"
  )
)

if not defined PY (
  for /f "delims=" %%I in ('where python 2^>nul') do (
    echo %%I | find /i "\WindowsApps\" >nul
    if errorlevel 1 if not defined PY set "PY=%%I"
  )
)

if not defined PY (
  where py >nul 2>&1
  if not errorlevel 1 (
    set "PY=py"
    set "PYARGS=-3"
  )
)

if not defined PY (
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

echo Checking port 5000 for a leftover Python file server...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python' -and $_.CommandLine -match 'http\.server\s+(5000|5001|8000|8080|8765)' } | ForEach-Object { Write-Host ('Stopping leftover server PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500"

set "PORT="
for %%P in (5000 5001 8000 8080 8765) do (
  if not defined PORT (
    powershell -NoProfile -Command "try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', %%P); $c.Close(); exit 1 } catch { exit 0 }"
    if not errorlevel 1 set "PORT=%%P"
  )
)

if not defined PORT (
  echo Could not find a free local port.
  echo Close other copies of this window, then try again.
  echo.
  pause
  exit /b 1
)

echo Serving this folder at http://127.0.0.1:%PORT%
echo Close this window to stop the server.
echo.

start "" powershell -NoProfile -Command "for ($i=0; $i -lt 30; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { Start-Process 'http://127.0.0.1:%PORT%/'; break } } catch { Start-Sleep -Milliseconds 400 } }"

if defined PYARGS (
  "%PY%" %PYARGS% -m http.server %PORT% --bind 127.0.0.1
) else (
  "%PY%" -m http.server %PORT% --bind 127.0.0.1
)

echo.
echo Server stopped.
pause
exit /b %ERRORLEVEL%
