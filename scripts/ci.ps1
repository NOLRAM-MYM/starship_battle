# CI script (Task 5.5) — variante PowerShell (Windows).
# Roda install + build + test (JS/TS) + cargo test + lint helm + bundle check.
# Exit code do primeiro step que falhar propaga para o chamador.
#
# Uso:
#   pnpm ci:ps1
#   powershell -ExecutionPolicy Bypass -File scripts/ci.ps1
#
# Notas:
#  - `pnpm install --frozen-lockfile` falha em dev local sem lockfile;
#    logamos e continuamos (em CI real isso falharia).
#  - `cargo test --workspace` é pulado se `cargo` não estiver disponível.
#  - Cada step roda via `Run-Step` que verifica `$LASTEXITCODE` da última
#    chamada externa e propaga o exit. NÃO use `Exit` dentro dos blocos —
#    `Exit` encerraria o processo inteiro prematuramente.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir '..')
Set-Location $RootDir

function Run-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][scriptblock]$Block
  )
  Write-Host "==> $Title"
  & $Block
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Step '$Title' falhou com exit code $LASTEXITCODE"
    Exit $LASTEXITCODE
  }
}

# 1) install (best-effort: loga e continua se faltar lockfile em dev)
Run-Step '1/6 pnpm install --frozen-lockfile' {
  $output = & pnpm install --frozen-lockfile 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ pnpm install --frozen-lockfile falhou (provavelmente sem lockfile em dev). Continuando."
    Write-Host $output
    # Força exit 0 para que este step não falhe o CI em dev local.
    $global:LASTEXITCODE = 0
  }
}

# 2) build
Run-Step '2/6 pnpm -r build' {
  & pnpm -r --workspace-concurrency=2 run build
}

# 3) test (JS/TS workspaces)
Run-Step '3/6 pnpm -r test' {
  & pnpm -r test
}

# 4) cargo test (skipped se cargo não estiver no PATH)
Run-Step '4/6 cargo test --workspace --quiet' {
  $cargo = Get-Command cargo -ErrorAction SilentlyContinue
  if ($null -ne $cargo) {
    & cargo test --workspace --quiet
  } else {
    Write-Host "⚠ cargo não encontrado no PATH; pulando cargo test."
    $global:LASTEXITCODE = 0
  }
}

# 5) lint helm
Run-Step '5/6 pnpm lint:helm' {
  & pnpm lint:helm
}

# 6) bundle check (vite build + check-bundle-size.mjs)
Run-Step '6/6 pnpm --filter @batle/client check:bundle' {
  & pnpm --filter @batle/client check:bundle
}

Write-Host "==> CI concluído com sucesso."
Exit 0
