# Syncr update — one script to build, sign, commit, push, and publish.
#
# Usage:
#   .\update.ps1                Full update + GitHub release
#   .\update.ps1 -PublishOnly   Re-fetch signed XPI from AMO (waits for review), then publish
#   .\update.ps1 -HostOnly      Host-only update (no extension/AMO) — see below
#   .\update.ps1 -SetupOnly     Rebuild Syncr Setup (signed if cert available) and upload to latest release
#
# Host-only release (native-host/version.json only, no extension bump):
#   1. Bump native-host/version.json (e.g. 1.0.4)
#   2. bun run update:host
#   Pushes host source to main and uploads syncr-host.exe to the current latest GitHub release.
#   Users detect the update via version.json on main; they download the exe from releases/latest.
#
# Prerequisites:
#   - .env with AMO_JWT_ISSUER and AMO_JWT_SECRET (full update only)
#   - Bump extension/manifest.json version before a full update
#   - git (GitHub Desktop includes git) and gh CLI for publishing
#
# Note: GitHub Desktop has no scriptable API. This uses the same git repo
# GitHub Desktop manages — you'll see commits appear in Desktop after push.

param(
  [switch]$BuildOnly,
  [switch]$PublishOnly,
  [switch]$HostOnly,
  [switch]$SetupOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host ""; Write-Host "> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ERROR: $msg" -ForegroundColor Red; exit 1 }

function Find-Tool {
  param([string]$Name, [string[]]$ExtraPaths)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  foreach ($p in $ExtraPaths) {
    if ($p -match '\*') {
      $resolved = Get-ChildItem $p -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($resolved) { return $resolved.FullName }
    } elseif (Test-Path $p) { return $p }
  }
  return $null
}

function Get-GitExe {
  $gd = Join-Path $env:LOCALAPPDATA 'GitHubDesktop\app-*\resources\app\git\cmd\git.exe'
  Find-Tool 'git' @(
    'C:\Program Files\Git\bin\git.exe'
    'C:\Program Files (x86)\Git\bin\git.exe'
    $gd
  )
}

function Get-GhExe {
  Find-Tool 'gh' @(
    'C:\Program Files\GitHub CLI\gh.exe'
    (Join-Path $env:LOCALAPPDATA 'Programs\GitHub CLI\gh.exe')
  )
}

function Invoke-Git {
  param(
    [switch]$AllowFailure,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArguments
  )
  if (-not $script:GitExe) { Write-Err "git not found. Install Git or GitHub Desktop." }
  & $script:GitExe -C $root @GitArguments
  if (-not $AllowFailure -and $LASTEXITCODE -ne 0) {
    Write-Err "git $($GitArguments -join ' ') failed (exit $LASTEXITCODE)"
  }
}

function Invoke-Gh {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GhArguments)
  if (-not $script:GhExe) { Write-Err "gh not found. Install: https://cli.github.com/ then run 'gh auth login'" }
  & $script:GhExe @GhArguments
  if ($LASTEXITCODE -ne 0) { Write-Err "gh $($GhArguments -join ' ') failed (exit $LASTEXITCODE)" }
}

function Load-DotEnv {
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

function Get-AmoCredentials {
  $envFile = Load-DotEnv (Join-Path $root '.env')
  $key = $null
  $secret = $null
  if ($env:WEB_EXT_API_KEY)    { $key = $env:WEB_EXT_API_KEY }
  elseif ($env:AMO_JWT_ISSUER) { $key = $env:AMO_JWT_ISSUER }
  elseif ($envFile['AMO_JWT_ISSUER']) { $key = $envFile['AMO_JWT_ISSUER'] }
  elseif ($envFile['WEB_EXT_API_KEY']) { $key = $envFile['WEB_EXT_API_KEY'] }

  if ($env:WEB_EXT_API_SECRET)    { $secret = $env:WEB_EXT_API_SECRET }
  elseif ($env:AMO_JWT_SECRET)    { $secret = $env:AMO_JWT_SECRET }
  elseif ($envFile['AMO_JWT_SECRET']) { $secret = $envFile['AMO_JWT_SECRET'] }
  elseif ($envFile['WEB_EXT_API_SECRET']) { $secret = $envFile['WEB_EXT_API_SECRET'] }

  if (-not $key -or -not $secret) {
    Write-Err "AMO credentials missing. Copy .env.example to .env and fill in AMO_JWT_ISSUER + AMO_JWT_SECRET"
  }
  return @{ Key = $key; Secret = $secret }
}

function Sync-PopupVersion {
  param([string]$Version)
  $popup = Join-Path $root 'extension\popup\popup.html'
  $html = Get-Content $popup -Raw
  $updated = $html -replace '(<span class="settings-value">)[^<]+(</span>)', "`${1}$Version`${2}"
  if ($updated -ne $html) {
    Set-Content $popup $updated -NoNewline
    Write-Ok "Synced popup version to $Version"
  }
}

function Sync-LauncherVersion {
  param([string]$Version)
  $pkgPath = Join-Path $root 'launcher\package.json'
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  if ($pkg.version -ne $Version) {
    $pkg.version = $Version
    ($pkg | ConvertTo-Json -Depth 10) + "`n" | Set-Content $pkgPath -NoNewline
    Write-Ok "Synced launcher version to $Version"
  }
}

function Get-SetupExeName {
  param([string]$Version)
  return "Syncr-Setup-$Version.exe"
}

function Get-SetupExePath {
  param([string]$Version)
  Join-Path $root "launcher\dist\$(Get-SetupExeName $Version)"
}

function Get-RepoSlug {
  $url = & $script:GitExe -C $root remote get-url origin 2>$null
  if ($url -match 'github\.com[:/](.+?)(?:\.git)?$') { return $Matches[1] }
  return 'Clawb1t/Syncr'
}

function Stop-LockingProcesses {
  $names = @(
    'Syncr Setup', 'electron', 'web-ext', 'app-builder',
    'Syncr Setup.exe', 'Syncr-Setup'
  )
  foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
  }

  Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $path = $_.Path
      if ($path -and ($path -like '*\launcher\dist\*' -or $path -like '*Syncr Setup*')) {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }

  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  taskkill /F /IM 'Syncr Setup.exe' /T 2>&1 | Out-Null
  taskkill /F /IM electron.exe /T 2>&1 | Out-Null
  $ErrorActionPreference = $prevEap
  Start-Sleep -Seconds 2
}

function Clear-LauncherDist {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $true }

  for ($i = 1; $i -le 5; $i++) {
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return $true
    } catch {
      if ($i -lt 5) {
        Write-Warn "launcher/dist locked (attempt $i/5) - stopping processes and retrying..."
        Stop-LockingProcesses
        Start-Sleep -Seconds 2
      }
    }
  }
  return $false
}

function Sign-Extension {
  param([string]$Version, [hashtable]$Amo)

  if (-not (Test-Path (Join-Path $root 'node_modules'))) { bun install }
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'dist') | Out-Null

  Write-Step "Signing extension via AMO"
  $webExt = Join-Path $root 'node_modules\.bin\web-ext.cmd'
  if (-not (Test-Path $webExt)) { Write-Err "web-ext not installed. Run: bun install" }

  & $webExt sign `
    --source-dir extension `
    --artifacts-dir dist `
    --api-key $Amo.Key `
    --api-secret $Amo.Secret `
    --channel unlisted `
    --approval-timeout 30

  $syncrXpi = Join-Path $root 'dist\syncr.xpi'
  $gotXpi   = $false

  if ($LASTEXITCODE -eq 0) {
    $signed = Get-ChildItem (Join-Path $root 'dist') -Filter *.xpi |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($signed) {
      Copy-Item $signed.FullName $syncrXpi -Force
      $gotXpi = $true
      Write-Ok "web-ext produced signed XPI"
    }
  }

  if (-not $gotXpi) {
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "web-ext sign exited with code $LASTEXITCODE (often 'already submitted') - waiting for AMO review"
    } else {
      Write-Warn "web-ext finished but no XPI in dist - waiting for AMO review"
    }
    node (Join-Path $root 'scripts\fetch-signed-xpi.js') $Version --wait --wait-minutes 25
    if ($LASTEXITCODE -ne 0) { Write-Err "Could not sign or fetch signed XPI" }
  }

  if (-not (Test-Path $syncrXpi)) {
    Write-Err "dist/syncr.xpi not found after signing"
  }
  Write-Ok "dist/syncr.xpi"
}

function Build-Host {
  Write-Step "Building native host"
  Push-Location (Join-Path $root 'native-host')
  if (-not (Test-Path node_modules)) { bun install } else { bun install --prefer-offline }
  bun run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "native-host build failed" }
  Pop-Location
  Write-Ok "dist/syncr-host.exe"
}

function Build-Launcher {
  param([string]$Version)

  Write-Step "Building Syncr Setup"
  Stop-LockingProcesses

  $launcherDist = Join-Path $root 'launcher\dist'
  $setupName    = Get-SetupExeName $Version
  $setupOut     = Join-Path $launcherDist $setupName
  $tempBuild    = Join-Path $env:TEMP 'syncr-launcher-build'

  Remove-Item -Recurse -Force $tempBuild -ErrorAction SilentlyContinue

  if (Clear-LauncherDist $launcherDist) {
    $buildOutput = $launcherDist
  } else {
    Write-Warn "launcher/dist is locked - building to $tempBuild"
    New-Item -ItemType Directory -Force -Path $tempBuild | Out-Null
    $buildOutput = $tempBuild
  }

  $outputArg = ($buildOutput -replace '\\', '/')

  . (Join-Path $root 'scripts\configure-win-codesign.ps1')
  Configure-WinCodeSign -Root $root

  Push-Location (Join-Path $root 'launcher')
  if (-not (Test-Path node_modules)) { bun install } else { bun install --prefer-offline }

  bun run build -- "-c.directories.output=$outputArg"
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Err @"
launcher build failed - app.asar is locked by another process.

Close Syncr Setup if it's open, then run:
  taskkill /F /IM "Syncr Setup.exe" /T
  taskkill /F /IM electron.exe /T

Then re-run: bun run update
"@
  }
  Pop-Location

  $builtSetup = Get-ChildItem $buildOutput -Filter 'Syncr-Setup-*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $builtSetup) {
    $builtSetup = Get-ChildItem $buildOutput -Filter 'Syncr-Setup.exe' -ErrorAction SilentlyContinue |
      Select-Object -First 1
  }
  if (-not $builtSetup) {
    Write-Err "Syncr-Setup-*.exe not found in $buildOutput"
  }

  New-Item -ItemType Directory -Force -Path $launcherDist | Out-Null
  Copy-Item $builtSetup.FullName $setupOut -Force
  Write-Ok "launcher/dist/$setupName"
}

function Ensure-SignedXpi {
  param(
    [string]$Version,
    [switch]$Wait
  )

  Write-Step "Fetching signed XPI from AMO (v$Version)"
  if ($Wait) {
    Write-Host "  Will poll AMO every 30s until review finishes (up to 25 min)..." -ForegroundColor DarkGray
  }

  $fetchScript = Join-Path $root 'scripts\fetch-signed-xpi.js'
  if ($Wait) {
    node $fetchScript $Version --wait --wait-minutes 25
  } else {
    node $fetchScript $Version
  }
  if ($LASTEXITCODE -ne 0) { Write-Err "Could not fetch signed XPI from AMO" }

  $syncrXpi = Join-Path $root 'dist\syncr.xpi'
  if (-not (Test-Path $syncrXpi)) { Write-Err "dist/syncr.xpi not found after AMO fetch" }
  Write-Ok "dist/syncr.xpi"
}

function Verify-SignedXpi {
  param([string]$Version)
  Write-Step "Verifying syncr.xpi is Mozilla-signed"
  node (Join-Path $root 'scripts\verify-xpi.js') (Join-Path $root 'dist\syncr.xpi') $Version
  if ($LASTEXITCODE -ne 0) {
    Write-Err "dist/syncr.xpi failed verification - refusing to publish unsigned or mismatched XPI"
  }
  Write-Ok "Mozilla-signed v$Version"
}

function Update-UpdatesJson {
  param([string]$Version)
  Write-Step "Updating updates.json"
  node (Join-Path $root 'scripts\update-updates-json.js') $Version (Join-Path $root 'dist\syncr.xpi') (Get-RepoSlug)
  Write-Ok "updates.json patched for v$Version"
}

function Upload-SetupRelease {
  param([string]$Version, [string]$Tag, [string]$Repo)

  $setupPath = Get-SetupExePath $Version
  if (-not (Test-Path $setupPath)) { Write-Err "Missing $setupPath" }

  Write-Step "Uploading Syncr Setup to GitHub release $Tag"
  node (Join-Path $root 'scripts\upload-release-asset.js') $Tag $Repo $setupPath
  if ($LASTEXITCODE -ne 0) { Write-Err "Setup upload failed" }
  Write-Ok "Uploaded $(Split-Path $setupPath -Leaf)"
}

function Publish-ToGitHub {
  param([string]$Version, [string]$Tag)

  $xpiPath   = Join-Path $root 'dist\syncr.xpi'
  $hostPath  = Join-Path $root 'dist\syncr-host.exe'
  $setupPath = Get-SetupExePath $Version

  foreach ($f in @($xpiPath, $hostPath, $setupPath)) {
    if (-not (Test-Path $f)) { Write-Err "Missing release asset: $f" }
  }

  Verify-SignedXpi -Version $Version

  Write-Step "Committing release files"
  Invoke-Git add extension/manifest.json extension/popup/ extension/background/background.js native-host/version.json native-host/updater.js native-host/host.js launcher/package.json updates.json
  Invoke-Git -AllowFailure diff --staged --quiet
  if ($LASTEXITCODE -ne 0) {
    Invoke-Git commit -m "Release v$Version"
    Write-Ok "Committed"
  } else {
    Write-Warn "Nothing new to commit"
  }

  Write-Step "Pushing to GitHub"
  $branch = (& $script:GitExe -C $root rev-parse --abbrev-ref HEAD).Trim()
  Invoke-Git push origin $branch
  Write-Ok "Pushed $branch"

  Write-Step "Tagging $Tag"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  & $script:GitExe -C $root rev-parse --verify "refs/tags/$Tag" 2>$null | Out-Null
  $tagExists = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $prevEap

  if ($tagExists) {
    Write-Warn "Tag $Tag already exists - continuing to release upload"
  } else {
    Invoke-Git tag -a $Tag -m "Syncr v$Version"
    Invoke-Git push origin $Tag
    Write-Ok "Pushed tag $Tag"
  }

  Publish-ReleaseAssets -Version $Version -Tag $Tag -Repo (Get-RepoSlug)
  Write-Host ""
  Write-Host "  GitHub Desktop will show the new commit after you fetch/pull." -ForegroundColor DarkGray
}

function Get-GithubToken {
  $envFile = Load-DotEnv (Join-Path $root '.env')
  if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
  if ($env:GH_TOKEN)       { return $env:GH_TOKEN }
  if ($envFile['GITHUB_TOKEN']) { return $envFile['GITHUB_TOKEN'] }
  if ($envFile['GH_TOKEN'])     { return $envFile['GH_TOKEN'] }
  return $null
}

function Publish-ReleaseAssets {
  param([string]$Version, [string]$Tag, [string]$Repo)

  $xpiPath   = Join-Path $root 'dist\syncr.xpi'
  $hostPath  = Join-Path $root 'dist\syncr-host.exe'
  $setupPath = Get-SetupExePath $Version

  Publish-AssetsToRelease -Tag $Tag -Repo $Repo -AssetPaths @($xpiPath, $hostPath, $setupPath) -CreateIfMissing -Title "Syncr v$Version"
}

function Get-LatestReleaseTag {
  param([string]$Repo)

  if ($script:GhExe) {
    & $script:GhExe auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $tag = & $script:GhExe release list --repo $Repo --limit 1 --json tagName -q '.[0].tagName' 2>$null
      if ($tag) { return $tag.Trim() }
    }
  }

  $manifest = Get-Content (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json
  return "v$($manifest.version)"
}

function Publish-AssetsToRelease {
  param(
    [string]$Tag,
    [string]$Repo,
    [string[]]$AssetPaths,
    [switch]$CreateIfMissing,
    [string]$Title = ''
  )

  foreach ($f in $AssetPaths) {
    if (-not (Test-Path $f)) { Write-Err "Missing release asset: $f" }
  }

  Write-Step "Uploading to GitHub release $Tag"
  if ($script:GhExe) {
    & $script:GhExe auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & $script:GhExe release upload $Tag @AssetPaths --repo $Repo --clobber 2>$null
      if ($LASTEXITCODE -ne 0 -and $CreateIfMissing) {
        $args = @('release', 'create', $Tag, '--repo', $Repo, '--title', $Title, '--generate-notes') + $AssetPaths
        Invoke-Gh @args
      } elseif ($LASTEXITCODE -ne 0) {
        Write-Err "gh release upload $Tag failed - does the release exist?"
      }
      $url = & $script:GhExe release view $Tag --repo $Repo --json url -q '.url'
      Write-Ok "Live at $url"
      return
    }
  }

  if (Get-GithubToken) {
    Write-Warn "Using GITHUB_TOKEN from .env (gh CLI not available)"
    $uploadScript = if ($CreateIfMissing) {
      Join-Path $root 'scripts\publish-github-release.js'
    } else {
      Join-Path $root 'scripts\publish-release-assets.js'
    }
    if ($CreateIfMissing -and $AssetPaths.Count -eq 3) {
      node $uploadScript $Tag $Repo $AssetPaths[0] $AssetPaths[1] $AssetPaths[2]
    } else {
      node $uploadScript $Tag $Repo @AssetPaths
    }
    if ($LASTEXITCODE -ne 0) { Write-Err "GitHub release upload failed" }
    return
  }

  Write-Warn "No gh CLI or GITHUB_TOKEN - release assets not uploaded automatically"
  Write-Host ""
  Write-Host "  Upload manually to release ${Tag}:" -ForegroundColor Yellow
  Write-Host "  https://github.com/$Repo/releases/tag/$Tag" -ForegroundColor White
  Write-Host ""
  foreach ($f in $AssetPaths) { Write-Host "    $f" -ForegroundColor Yellow }
  Write-Host ""
  Write-Host "  Or add GITHUB_TOKEN to .env for fully automatic uploads." -ForegroundColor DarkGray
}

function Get-HostVersion {
  $hostVersionFile = Join-Path $root 'native-host\version.json'
  return (Get-Content $hostVersionFile -Raw | ConvertFrom-Json).version
}

function Publish-HostOnly {
  param([string]$HostVersion, [string]$Repo)

  $hostPath = Join-Path $root 'dist\syncr-host.exe'
  if (-not (Test-Path $hostPath)) { Write-Err "Missing dist/syncr-host.exe - build failed?" }

  Write-Step "Committing host files (v$HostVersion)"
  Invoke-Git add native-host/
  Invoke-Git -AllowFailure diff --staged --quiet
  if ($LASTEXITCODE -ne 0) {
    Invoke-Git commit -m "Host v$HostVersion"
    Write-Ok "Committed"
  } else {
    Write-Warn "Nothing new to commit"
  }

  Write-Step "Pushing to GitHub"
  $branch = (& $script:GitExe -C $root rev-parse --abbrev-ref HEAD).Trim()
  Invoke-Git push origin $branch
  Write-Ok "Pushed $branch (version.json on main drives update detection)"

  $releaseTag = Get-LatestReleaseTag -Repo $Repo
  Write-Ok "Uploading syncr-host.exe to latest release: $releaseTag"

  Publish-AssetsToRelease -Tag $releaseTag -Repo $Repo -AssetPaths @($hostPath)
}

# ── Main ──────────────────────────────────────────────────────────────────────

$script:GitExe = Get-GitExe
$script:GhExe  = Get-GhExe

if ($HostOnly -and ($PublishOnly -or $SetupOnly)) {
  Write-Err "-HostOnly cannot be combined with -PublishOnly or -SetupOnly"
}

if ($SetupOnly) {
  $manifest = Get-Content (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json
  $version  = $manifest.version
  $tag      = "v$version"
  $repo     = Get-RepoSlug

  Write-Host ""
  Write-Host "  Syncr Setup rebuild v$version"
  Write-Host "  =============================="

  Sync-LauncherVersion $version
  Build-Launcher -Version $version
  Upload-SetupRelease -Version $version -Tag $tag -Repo $repo

  Write-Host ""
  Write-Host "  Done! Syncr Setup uploaded to $tag." -ForegroundColor Green
  Write-Host ""
  exit 0
}

if ($HostOnly) {
  $hostVersion = Get-HostVersion
  $repo        = Get-RepoSlug

  Write-Host ""
  Write-Host "  Syncr host-only update v$hostVersion"
  Write-Host "  ===================================="
  if ($script:GitExe) { Write-Host "  git: $($script:GitExe)" -ForegroundColor DarkGray }
  if ($script:GhExe)   { Write-Host "  gh:  $($script:GhExe)" -ForegroundColor DarkGray }

  Build-Host

  if ($BuildOnly) {
    Write-Host ""
    Write-Host "  Host build complete (skipped git/GitHub)." -ForegroundColor Green
    Write-Host ""
    exit 0
  }

  if (-not $script:GitExe) { Write-Err "git not found. Install Git or GitHub Desktop." }

  Publish-HostOnly -HostVersion $hostVersion -Repo $repo

  Write-Host ""
  Write-Host "  Done! Host v$hostVersion is published." -ForegroundColor Green
  Write-Host "  Users on older hosts will see an update after the next check." -ForegroundColor DarkGray
  Write-Host ""
  exit 0
}

$manifest = Get-Content (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json
$version  = $manifest.version
$tag      = "v$version"

Write-Host ""
Write-Host "  Syncr update v$version"
Write-Host "  ======================"
if ($script:GitExe) { Write-Host "  git: $($script:GitExe)" -ForegroundColor DarkGray }
if ($script:GhExe)   { Write-Host "  gh:  $($script:GhExe)" -ForegroundColor DarkGray }

Sync-PopupVersion $version
Sync-LauncherVersion $version

if (-not $PublishOnly) {
  $amo = Get-AmoCredentials
  Sign-Extension -Version $version -Amo $amo
  Verify-SignedXpi -Version $version
  Build-Host
  Build-Launcher -Version $version
  Update-UpdatesJson -Version $version
} else {
  Write-Warn "PublishOnly - skipping host/launcher builds"
  Ensure-SignedXpi -Version $version -Wait
  Verify-SignedXpi -Version $version
  Update-UpdatesJson -Version $version
}

if ($BuildOnly) {
  Write-Host ""
  Write-Host "  Build complete (skipped git/GitHub)." -ForegroundColor Green
  Write-Host ""
  exit 0
}

if (-not $script:GitExe) { Write-Err "git not found. Install Git or GitHub Desktop." }

Publish-ToGitHub -Version $version -Tag $tag

Write-Host ""
Write-Host "  Done! Syncr v$version is published." -ForegroundColor Green
Write-Host ""
