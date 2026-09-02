/**
 * Lint simples do Helm chart: valida Chart.yaml e values.yaml como YAML
 * (templates em templates/*.yaml contêm diretivas Helm `{{...}}` que não
 * são YAML puro; a validação completa requer `helm template` que não está
 * no PATH aqui).
 *
 * Uso:  pnpm --filter @batle/api exec node ../../scripts/lint-helm.mjs
 *       ou:  node scripts/lint-helm.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const chartDir = join(__dirname, '..', 'infra', 'helm', 'batle-api');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let errors = 0;

function checkYaml(path) {
  try {
    const text = readFileSync(path, 'utf-8');
    yaml.load(text, { filename: path });
    console.log(`OK  ${path}`);
  } catch (err) {
    console.error(`FAIL  ${path}: ${err.message}`);
    errors++;
  }
}

function checkHelmTemplate(path) {
  // Verificações simples:
  //  - apiVersion + kind presentes
  //  - Delimitadores balanceados {{ ... }} e {{- ... -}}
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n');
  if (!/^apiVersion:\s/m.test(text) || !/^kind:\s/m.test(text)) {
    console.error(`FAIL  ${path}: falta apiVersion ou kind`);
    errors++;
    return;
  }
  // Conta {{ e }} (heurística simples).
  const opens = (text.match(/\{\{/g) || []).length;
  const closes = (text.match(/\}\}/g) || []).length;
  if (opens !== closes) {
    console.error(`FAIL  ${path}: delimitadores Helm desbalanceados ({{ ${opens} vs }} ${closes})`);
    errors++;
    return;
  }
  console.log(`OK  ${path}  (helm, ${opens} template tokens)`);
}

const files = walk(chartDir);
for (const f of files) {
  if (extname(f) !== '.yaml' && extname(f) !== '.yml') continue;
  if (basename(f) === '_helpers.tpl') {
    console.log(`SKIP  ${f}  (helpers.tpl)`);
    continue;
  }
  if (f.includes(`${'templates'}${sep}`) || f.includes('templates\\')) {
    checkHelmTemplate(f);
  } else {
    checkYaml(f);
  }
}

if (errors > 0) {
  console.error(`\nFalhou: ${errors} arquivo(s).`);
  process.exit(1);
}
console.log(`\nTudo OK.`);
