/**
 * Verifica o tamanho do bundle gzipped do client.
 *
 * Soma o tamanho gzip de todos os arquivos em `apps/client/dist` e
 * falha (exit 1) se ultrapassar 5 MB. Se `dist/` não existir, sai
 * com 0 e um warning (caso comum em dev local, antes de `vite build`).
 *
 * Apenas módulos nativos do Node — sem deps novas.
 *
 * Uso:
 *   node scripts/check-bundle-size.mjs
 *   # ou via apps/client/package.json:
 *   pnpm --filter @batle/client check:bundle  (que faz vite build + este script)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_GZIP_BYTES = 5 * 1024 * 1024; // 5 MB

// Resolve a partir do diretório do script (raiz do monorepo), não do CWD,
// para que funcione tanto via `node scripts/check-bundle-size.mjs` (raiz)
// quanto via `pnpm --filter @batle/client check:bundle` (cwd = apps/client).
const BUNDLE_DIR = resolve(__dirname, '..', 'apps', 'client', 'dist');

/**
 * Retorna recursivamente os caminhos de todos os arquivos em `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(BUNDLE_DIR)) {
  console.warn(`⚠ build não encontrado em ${BUNDLE_DIR}, pulando check de tamanho.`);
  process.exit(0);
}

const files = walk(BUNDLE_DIR);
let totalGzip = 0;
for (const f of files) {
  const buf = readFileSync(f);
  const gz = gzipSync(buf);
  totalGzip += gz.length;
}

const totalMb = (totalGzip / 1024 / 1024).toFixed(2);
const limitMb = (MAX_GZIP_BYTES / 1024 / 1024).toFixed(0);

if (totalGzip > MAX_GZIP_BYTES) {
  console.error(`❌ bundle ${totalMb} MB > ${limitMb} MB (limite gzip)`);
  process.exit(1);
}

console.log(`✅ bundle ${totalMb} MB / ${limitMb} MB`);
