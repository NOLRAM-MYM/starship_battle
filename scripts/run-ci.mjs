/**
 * Orquestrador do CI (Task 5.5).
 *
 * Detecta a plataforma e delega para `scripts/ci.sh` (Unix) ou
 * `scripts/ci.ps1` (Windows), herdando stdio. Propaga o exit code
 * do filho para o processo do pnpm.
 *
 * Uso:
 *   pnpm ci
 *   # ou diretamente:
 *   node scripts/run-ci.mjs
 */

import { spawnSync } from 'node:child_process';
import { platform as getPlatform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// `platform` de node:os é uma função (`os.platform()`), não uma string.
const platform = getPlatform();
const isWindows = platform === 'win32';
const scriptName = isWindows ? 'ci.ps1' : 'ci.sh';
const scriptPath = join(__dirname, scriptName);

const command = isWindows ? 'powershell' : 'bash';
const args = isWindows
  ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]
  : [scriptPath];

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(`Falha ao executar ${command} ${args.join(' ')}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
