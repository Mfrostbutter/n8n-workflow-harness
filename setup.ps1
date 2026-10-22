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
# isolated-vm (via @n8n/expression-runtime) ships Windows prebuilds for Node 24 only.
# Older lines compile it with node-gyp, which needs Visual Studio Build Tools (C++) and Python.
if ($maj -lt 24) {
  Note "node $v on Windows: npm ci will compile isolated-vm from source and needs Visual Studio"
  Note "Build Tools (Desktop development with C++) plus Python. Node 24 installs a prebuilt binary"
  Note "in seconds. If npm ci fails on isolated-vm below, install Node 24 and re-run."
}

Step 'n8n-mcp (the engine: node schemas, validation, templates)'
$pin = (& node -p "require('./package.json').dependencies['n8n-mcp']")
$have = $null
if (Test-Path node_modules\n8n-mcp\package.json) { $have = (& node -p "require('./node_modules/n8n-mcp/package.json').version") }
if ($have -eq $pin) {
  Note "n8n-mcp $have already installed (pinned $pin)"
} elseif ($DryRun) {
  Note "would: npm ci  (n8n-mcp $pin, ~100 MB: it carries the prebuilt node database)"
} else {
  if ($have) { Note "installed $have but pinned ${pin}: reinstalling" } else { Note "installing n8n-mcp $pin (~100 MB)" }
  if (Test-Path vendor\npm-cache) {
    Note 'using vendor\npm-cache (offline)'
    & npm ci --offline --cache vendor/npm-cache --no-fund --no-audit
  } else {
    & npm ci --no-fund --no-audit
  }
  if ($LASTEXITCODE -ne 0) { Write-Error "npm ci failed (exit $LASTEXITCODE). Behind a proxy? See docs\10-MAINTENANCE.md."; exit 2 }
}

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
if (-not $DryRun) {
  & git config diff.n8n-workflow.textconv 'node scripts/wf-textconv.mjs'
  Note 'workflow textconv wired: git diff on workflows\ shows behavior, not canvas moves'
}

Step 'skills and agent configs'
# The committed .claude\skills\ entries are symlinks. With core.symlinks=false
# (the Windows default) git checks them out as text files and Claude Code sees
# no skills. The generator replaces them with copies and hides those from git.
$symlinks = (& git config core.symlinks)
if ($symlinks -eq 'true') { Note 'core.symlinks=true: skill links are real; regenerating as links' }
else { Note 'core.symlinks is off: skills become copies (marked skip-worktree, never committed)' }
if ($DryRun) {
  Note 'would: node scripts\gen-agent-configs.mjs'
} else {
  if ($symlinks -eq 'true') { & node scripts/gen-agent-configs.mjs --link } else { & node scripts/gen-agent-configs.mjs --copy }
  if ($LASTEXITCODE -ne 0) { Write-Error 'gen-agent-configs failed; see the output above.'; exit 2 }
  $dirs = @(Get-ChildItem -Directory .claude\skills -ErrorAction SilentlyContinue).Count
  Note "$dirs skill directories under .claude\skills"
}

if ($GlobalSkills) {
  Step 'global skills'
  $base = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
  $dest = Join-Path $base 'skills'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
  Get-ChildItem -Directory '.agents/skills' | ForEach-Object {
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

Step 'preflight'
$bash = Get-Command bash -ErrorAction SilentlyContinue
if ($bash) {
  & bash scripts/verify-setup.sh --fast
} else {
  Note 'bash not found (Git for Windows): skipping verify-setup.sh. The hooks and .mjs tools do not need it.'
  & node scripts/gen-agent-configs.mjs --check
}

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
     disk. Approve the MCP servers when prompted.
  3. Confirm the instance is reachable:  node scripts\doctor.mjs
  4. Snapshot before changing anything:  node scripts\export-all.mjs

  Behind a corporate proxy or TLS inspection: set NODE_USE_ENV_PROXY=1 and
  NODE_EXTRA_CA_CERTS=<path to the CA bundle .pem> before launching
  (docs\09-TROUBLESHOOTING.md, "Behind a corporate proxy").

  The .sh wrappers need Git Bash. The .mjs tools and the hooks run natively.
  Handing this to Claude instead? Paste AI_SETUP_PROMPT.md into a fresh session.
'@
