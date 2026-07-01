# Configure electron-builder Windows code signing.
# Dot-source from update.ps1 or launcher/build.ps1:
#   . (Join-Path $Root 'scripts\configure-win-codesign.ps1')
#   Configure-WinCodeSign -Root $Root

function Load-DotEnvForSign {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return @{} }
  $vars = @{}
  $text = (Get-Content $Path -Raw) -replace '^\uFEFF', ''
  foreach ($line in $text -split "`r?`n") {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $k, $v = $line -split '=', 2
    $vars[$k.Trim()] = $v.Trim().Trim('"').Trim("'")
  }
  return $vars
}

function Configure-WinCodeSign {
  param(
    [Parameter(Mandatory = $true)][string]$Root
  )

  $envFile = Load-DotEnvForSign (Join-Path $Root '.env')

  $link = $env:WIN_CSC_LINK
  if (-not $link) { $link = $env:CSC_LINK }
  if (-not $link) { $link = $envFile['WIN_CSC_LINK'] }
  if (-not $link) { $link = $envFile['CSC_LINK'] }

  $pass = $env:WIN_CSC_KEY_PASSWORD
  if (-not $pass) { $pass = $env:CSC_KEY_PASSWORD }
  if (-not $pass) { $pass = $envFile['WIN_CSC_KEY_PASSWORD'] }
  if (-not $pass) { $pass = $envFile['CSC_KEY_PASSWORD'] }

  $subject = $env:WIN_CSC_NAME
  if (-not $subject) { $subject = $env:CSC_NAME }
  if (-not $subject) { $subject = $envFile['WIN_CSC_NAME'] }
  if (-not $subject) { $subject = $envFile['CSC_NAME'] }

  Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY -ErrorAction SilentlyContinue

  if ($link) {
    if (Test-Path $link) {
      $env:CSC_LINK = (Resolve-Path $link).Path
    } else {
      $env:CSC_LINK = $link
    }
    if ($pass) { $env:CSC_KEY_PASSWORD = $pass }
    if ($subject) { $env:CSC_NAME = $subject }
    Write-Host "  OK: Code signing via WIN_CSC_LINK" -ForegroundColor Green
    return
  }

  # electron-builder default: search Windows cert store for a code-signing certificate
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'true'
  if ($subject) { $env:CSC_NAME = $subject }
  Write-Host "  OK: Code signing via certificate auto-discovery (Windows cert store)" -ForegroundColor Green
}
