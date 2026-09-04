@echo off
setlocal EnableExtensions
title Roadway Line-to-Line Overlay Tool v1.0
cd /d "%~dp0"
echo ======================================================================
echo Roadway Line-to-Line Overlay Tool v1.0
echo Developed by lzhai4892, Jia and AIs  https://github.com/lzhai4892
echo ======================================================================
echo.
set "APP_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$l=Get-Content -LiteralPath $env:APP_BAT; $n=[Array]::IndexOf($l,':::BEGIN_PS'); if($n -lt 0){ Write-Host 'Startup error: server script marker not found in run_app.bat.'; exit 1 }; Invoke-Expression (($l[($n+1)..($l.Length-1)]) -join [Environment]::NewLine)"
echo.
echo Server stopped.
pause
exit /b %ERRORLEVEL%

:::BEGIN_PS
$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath ".").Path
$ports = @(5000, 5001, 8000, 8080, 8765)

Write-Host "Stopping leftover local file servers if any..."
Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and (
    ($_.Name -match "python" -and $_.CommandLine -match "http\.server\s+5000\s*$") -or
    ($_.CommandLine -match "BEGIN_PS" -and $_.CommandLine -match "APP_BAT")
  )
} | ForEach-Object {
  Write-Host ("Stopping leftover server PID " + $_.ProcessId)
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

function Test-PortFree([int]$Port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", $Port)
    $c.Close()
    return $false
  } catch {
    return $true
  }
}

$port = $null
foreach ($p in $ports) {
  if (Test-PortFree $p) { $port = $p; break }
}
if (-not $port) {
  Write-Host "Could not find a free local port. Close other copies of this window, then try again."
  exit 1
}

$prefix = "http://127.0.0.1:$port/"
Write-Host "Serving this folder at $prefix"
Write-Host "Close this window to stop the server."
Write-Host ""

Start-Job -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
      if ($r.StatusCode -ge 200) {
        Start-Process $url
        return
      }
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
} -ArgumentList $prefix | Out-Null

$mimes = @{
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
  ".woff2" = "font/woff2"
  ".zip" = "application/zip"
  ".md" = "text/plain; charset=utf-8"
}

function Get-SafePath([string]$urlPath) {
  $rel = [Uri]::UnescapeDataString($urlPath)
  if ([string]::IsNullOrWhiteSpace($rel) -or $rel -eq "/") { $rel = "index.html" }
  $rel = $rel.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
  $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
  $rootPrefix = $root.TrimEnd("\") + "\"
  if ($full -ne $root -and -not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }
  return $full
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = Get-SafePath $ctx.Request.Url.AbsolutePath
      if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
        $res.ContentType = "text/plain; charset=utf-8"
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
        $res.ContentType = $(if ($mimes.ContainsKey($ext)) { $mimes[$ext] } else { "application/octet-stream" })
        $bytes = [IO.File]::ReadAllBytes($path)
        $res.StatusCode = 200
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
