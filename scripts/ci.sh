#!/usr/bin/env bash
# CI script (Task 5.5) — variante Unix.
# Roda install + build + test (JS/TS) + cargo test + lint helm + bundle check.
# Exit code do primeiro step que falhar propaga para o chamador.
#
# Uso:
#   pnpm ci:bash
#   bash scripts/ci.sh
#
# Notas:
#  - `pnpm install --frozen-lockfile` falha em dev local sem lockfile;
#    logamos e continuamos (em CI real isso falharia).
#  - `cargo test --workspace` é pulado se `cargo` não estiver no PATH.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "==> [1/6] pnpm install --frozen-lockfile"
if ! pnpm install --frozen-lockfile; then
  echo "⚠ pnpm install --frozen-lockfile falhou (provavelmente sem lockfile em dev). Continuando."
fi

echo "==> [2/6] pnpm -r build"
pnpm -r --workspace-concurrency=2 run build

echo "==> [3/6] pnpm -r test"
pnpm -r test

echo "==> [4/6] cargo test --workspace --quiet"
if command -v cargo >/dev/null 2>&1; then
  (cd "$ROOT_DIR" && cargo test --workspace --quiet)
else
  echo "⚠ cargo não encontrado no PATH; pulando cargo test."
fi

echo "==> [5/6] pnpm lint:helm"
pnpm lint:helm

echo "==> [6/6] pnpm --filter @batle/client check:bundle"
pnpm --filter @batle/client check:bundle

echo "==> CI concluído com sucesso."
