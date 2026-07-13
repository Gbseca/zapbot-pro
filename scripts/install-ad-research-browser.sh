#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

echo "[Pesquisa Ads] Instalando Chromium e dependencias do sistema..."
npx playwright install --with-deps chromium

node --input-type=module <<'NODE'
import { inspectCollectorRuntime } from './backend/ad-research/meta-collector.js';

const runtime = inspectCollectorRuntime();
console.log(JSON.stringify(runtime, null, 2));
if (!runtime.executablePresent) {
  console.error('[Pesquisa Ads] O executavel do Chromium nao foi encontrado apos a instalacao.');
  process.exit(1);
}
NODE

echo "[Pesquisa Ads] Chromium pronto."
