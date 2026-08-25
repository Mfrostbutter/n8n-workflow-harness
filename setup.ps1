# One-time setup for a fresh clone, native Windows PowerShell. Idempotent.
#
# Usage:
#   .\setup.ps1
#   .\setup.ps1 -GlobalSkills
#   .\setup.ps1 -DryRun
#
# Does NOT write credentials and does NOT touch an n8n instance.
[CmdletBinding()]
param(
  [switch]$GlobalSkills,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Repo

function Step($m) { Write-Host "== $m" }
function Note($m) { Write-Host "  $m" }

Step 'node'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'node not found. Install Node 20+ and re-run.'; exit 2 }
$v = (& node --version) -replace '^v', ''
$maj = [int]($v -split '\.')[0]
if ($maj -lt 20) { Write-Error "node $v is too old. Install Node 20+ and re-run."; exit 2 }
Note "node $v"

Step '.env'
if (Test-Path .env) {
  Note '.env already exists, left alone'
} elseif ($DryRun) {
  Note 'would: copy .env.example -> .env'
} else {
  Copy-Item .env.example .env
  Note 'created .env from .env.example (fill it in; it is gitignored)'
}

Step 'git'
if (Test-Path .git) {
  Note 'git repository present'
} elseif ($DryRun) {
  Note 'would: git init'
} else {
  & git init -q
  Note 'git initialized. Commit before your first change: that is the rollback point.'
}

if ($GlobalSkills) {
  Step 'global skills'
  $base = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
  $dest = Join-Path $base 'skills'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
  Get-ChildItem -Directory '.claude/skills' | ForEach-Object {
    $target = Join-Path $dest $_.Name
    if ($DryRun) { Note "would: install $($_.Name)"; return }
    if (Test-Path $target) {
      $bk = Join-Path $base "skills-backup-$stamp"
      New-Item -ItemType Directory -Force -Path $bk | Out-Null
      Copy-Item $target (Join-Path $bk $_.Name) -Recurse -Force
      Remove-Item $target -Recurse -Force
      Note "replaced $($_.Name) (backup in skills-backup-$stamp\)"
    } else {
      Note "installed $($_.Name)"
    }
    Copy-Item $_.FullName $target -Recurse -Force
  }
}

if ($DryRun) { Write-Host ''; Note '(dry run: nothing changed)'; exit 0 }

Write-Host ''
Write-Host @'
Next:
  1. Fill .env with your dev instance URL and API key.
  2. Load the environment, then launch Claude Code:

       Get-Content .env | Where-Object { $_ -match '^\s*[A-Z]' } | ForEach-Object {
         $k,$val = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $val.Trim())
       }
       claude

     .mcp.json reads N8N_API_URL from the process environment, not the file on
     disk. Approve both MCP servers when prompted.
  3. Confirm the instance is reachable:  node scripts\doctor.mjs
  4. Snapshot before changing anything:  node scripts\export-all.mjs

  The .sh wrappers need Git Bash. The .mjs tools run natively under PowerShell.
  Handing this to Claude instead? Paste AI_SETUP_PROMPT.md into a fresh session.
'@
