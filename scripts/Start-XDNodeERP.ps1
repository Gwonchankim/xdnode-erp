$ErrorActionPreference = "Stop"

$ProjectPath = Split-Path -Parent $PSScriptRoot
$Port = 3000
$Url = "http://localhost:$Port"

function Test-LocalPort([int]$TestPort) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect("localhost", $TestPort)
    return $true
  }
  catch {
    return $false
  }
  finally {
    $client.Dispose()
  }
}

function Remove-StaleDevLock {
  $lockPath = Join-Path $ProjectPath ".vinext\dev\lock.json"
  if ((Test-LocalPort $Port) -or -not (Test-Path -LiteralPath $lockPath)) {
    return
  }

  try {
    $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
    $owner = Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue
    if (-not $owner -or $owner.ProcessName -ne "node") {
      Remove-Item -LiteralPath $lockPath -Force
    }
  }
  catch {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}

$LogDir = Join-Path $ProjectPath ".vinext\dev"
$LogPath = Join-Path $LogDir "launcher.log"

if (-not (Test-LocalPort $Port)) {
  Write-Host "Starting XD NODE ERP. The first launch may take up to a few minutes (longer if project files changed since the last run)..." -ForegroundColor Cyan
  Remove-StaleDevLock
  if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  }
  $serverProcess = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/c", "cd /d `"$ProjectPath`" && npm.cmd run dev -- --port $Port --hostname 0.0.0.0") `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogPath `
    -RedirectStandardError "$LogPath.err" `
    -PassThru

  # Cold starts (e.g. after a vite.config.ts change forces dependency re-optimization,
  # or antivirus scanning a freshly-touched node_modules) can take well over a minute,
  # so keep polling for up to 5 minutes rather than giving up too early.
  $deadline = (Get-Date).AddSeconds(300)
  while ((Get-Date) -lt $deadline -and -not (Test-LocalPort $Port)) {
    if ($serverProcess.HasExited) {
      break
    }
    Start-Sleep -Milliseconds 500
  }
}

if (-not (Test-LocalPort $Port)) {
  Write-Host "`nXD NODE ERP could not start the local server." -ForegroundColor Red
  Write-Host "Please verify Node.js and the project dependencies, then try again." -ForegroundColor Yellow
  foreach ($candidate in @($LogPath, "$LogPath.err")) {
    if (Test-Path -LiteralPath $candidate) {
      $tail = Get-Content -LiteralPath $candidate -Tail 20 -ErrorAction SilentlyContinue
      if ($tail) {
        Write-Host "`n--- $candidate (last 20 lines) ---" -ForegroundColor DarkGray
        $tail | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
      }
    }
  }
  Read-Host "`nPress Enter to close" | Out-Null
  exit 1
}

Write-Host "Ready. Opening the browser..." -ForegroundColor Green
Start-Process $Url
