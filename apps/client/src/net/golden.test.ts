/**
 * Confere o decodificador contra bytes gerados pelo bincode DE VERDADE.
 *
 * Os outros testes de protocolo montam a fixture à mão em TypeScript, o
 * que os deixa cegos para uma classe inteira de erro: se o decodificador
 * entende o formato errado, a fixture escrita com a mesma cabeça
 * concorda com ele e o teste passa. Foi exatamente o que aconteceu com
 * `Option<EntityPayload>` — lido como 1 byte quando o bincode escreve
 * 1 byte de Option + 4 de discriminante.
 *
 * Estes bytes vêm de `crates/game-server/src/net/protocol.rs`
 * (teste `escreve_fixture_para_o_cliente`), então nenhum dos lados pode
 * se enganar sozinho.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeServerMsg } from './protocol';

// Caminho a partir da raiz do vitest (apps/client): sob o Vite,
// `import.meta.url` não é um file:// e o `node:fs` recusa.
const FIXTURE = join(process.cwd(), 'src/net/__fixtures__/snapshot_v6.bin');
if (!existsSync(FIXTURE)) {
  throw new Error(
    `fixture ausente: ${FIXTURE} — gere com \`cargo test -p game-server --lib golden\``,
  );
}
const bytes = readFileSync(FIXTURE);

describe('fixture dourada do servidor', () => {
  const msg = decodeServerMsg(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );

  it('decodifica o snapshot inteiro', () => {
    expect(msg.type).toBe('Snapshot');
    if (msg.type !== 'Snapshot') throw new Error('unreachable');
    expect(msg.payload.tick).toBe(4242);
    expect(msg.payload.entities).toHaveLength(3);
  });

  it('lê a nave com hp e nome', () => {
    if (msg.type !== 'Snapshot') throw new Error('unreachable');
    const nave = msg.payload.entities[0]!;
    expect(nave.kind).toBe('Ship');
    expect(nave.hp_ratio).toBeCloseTo(0.5, 5);
    expect(nave.display_name).toBe('alice');
    expect(nave.payload).toBeNull();
  });

  it('lê o payload do vórtice', () => {
    if (msg.type !== 'Snapshot') throw new Error('unreachable');
    const v = msg.payload.entities[1]!;
    expect(v.kind).toBe('Vortex');
    expect(v.payload?.type).toBe('Vortex');
    if (v.payload?.type !== 'Vortex') throw new Error('unreachable');
    expect(v.payload.payload.dir).toEqual([0, 0, 1]);
    expect(v.payload.payload.radius).toBeCloseTo(26, 5);
    expect(v.payload.payload.strength).toBeCloseTo(0.75, 5);
  });

  it('a entidade DEPOIS do vórtice continua alinhada', () => {
    // O canário: um payload lido com o tamanho errado não estraga a
    // própria entidade, estraga a seguinte.
    if (msg.type !== 'Snapshot') throw new Error('unreachable');
    const p = msg.payload.entities[2]!;
    expect(p.id).toBe(3);
    expect(p.kind).toBe('Projectile');
    expect(p.pos).toEqual([7, 8, 9]);
  });
});
