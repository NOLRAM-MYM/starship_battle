/**
 * O hangar tem que mostrar o que o jogo faz.
 *
 * A auditoria de equipamentos achou o hangar exibindo números que o
 * servidor não aplicava: "Varredura Profunda: alcance +1500", "Manto
 * Umbra: furtividade 45%" — e no servidor os dois só somavam massa. Na
 * outra direção, torpedos e bobina de dobra pesavam no estaleiro e não
 * pesavam em voo, então a aceleração mostrada não era a sentida.
 *
 * A tabela de referência sai do próprio servidor
 * (`cargo test -p game-server escreve_equipamentos_para_o_cliente`).
 * Este teste compara as duas pontas atributo por atributo e exige que
 * conheçam exatamente os mesmos módulos.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPONENT_LIBRARY, type ComponentStats } from '../src/ui/componentLibrary.js';

type Servidor = Record<
  string,
  {
    mass: number;
    sensorRange: number;
    stealth: number;
    shield: number | null;
    shieldRegen: number | null;
    hull: number | null;
    damage: number | null;
    fireRate: number | null;
    thrust: number | null;
  }
>;

const FIXTURE = join(process.cwd(), 'src/net/__fixtures__/equipment.json');
const servidor = (): Servidor => JSON.parse(readFileSync(FIXTURE, 'utf8'));

/** Atributos que o hangar exibe e o servidor aplica. */
const ATRIBUTOS = [
  'sensorRange',
  'stealth',
  'shield',
  'shieldRegen',
  'hull',
  'damage',
  'fireRate',
  'thrust',
] as const;

/**
 * Atributos que o hangar exibe e o jogo ainda NÃO aplica.
 *
 * Declarados aqui, e não escondidos: a carga não tem onde agir porque o
 * servidor não tem coleta nem mineração. Quando tiver, sai desta lista e
 * passa a ser conferida como os outros.
 */
const SEM_EFEITO_EM_COMBATE = new Set<keyof ComponentStats>(['cargo']);

describe('equipamentos: hangar × servidor', () => {
  it('a tabela existe (gerada pelo servidor)', () => {
    expect(
      existsSync(FIXTURE),
      'gere com `cargo test -p game-server escreve_equipamentos_para_o_cliente`',
    ).toBe(true);
  });

  it('os dois conhecem exatamente os mesmos módulos', () => {
    const noHangar = COMPONENT_LIBRARY.map((c) => c.id).sort();
    const noServidor = Object.keys(servidor()).sort();
    expect(noHangar).toEqual(noServidor);
  });

  it('a massa do hangar é a massa do voo', () => {
    const s = servidor();
    for (const c of COMPONENT_LIBRARY) {
      expect(s[c.id]!.mass, `${c.id}: massa`).toBe(c.mass);
    }
  });

  it('todo número exibido no hangar é aplicado pelo servidor', () => {
    const s = servidor();
    for (const c of COMPONENT_LIBRARY) {
      const stats = c.stats as Record<string, number | undefined>;
      for (const attr of ATRIBUTOS) {
        const noHangar = stats[attr] ?? 0;
        const noServidor = s[c.id]![attr] ?? 0;
        expect(noServidor, `${c.id}: ${attr}`).toBeCloseTo(noHangar, 2);
      }
    }
  });

  it('o hangar não exibe atributo que ninguém confere', () => {
    // Um atributo novo no hangar precisa entrar em ATRIBUTOS (e ter
    // efeito no servidor) ou em SEM_EFEITO_EM_COMBATE (e ser declarado).
    const conhecidos = new Set<string>([...ATRIBUTOS, ...SEM_EFEITO_EM_COMBATE]);
    for (const c of COMPONENT_LIBRARY) {
      for (const attr of Object.keys(c.stats)) {
        expect(conhecidos.has(attr), `${c.id}: atributo "${attr}" sem conferência`).toBe(true);
      }
    }
  });

  it('nenhum módulo é só peso morto — exceto a carga, declarada', () => {
    // Era o defeito: cinco módulos que só deixavam a nave mais lenta.
    const s = servidor();
    const mortos = COMPONENT_LIBRARY.filter((c) => {
      const e = s[c.id]!;
      const temEfeito =
        e.sensorRange !== 0 ||
        e.stealth !== 0 ||
        ATRIBUTOS.some((a) => (e[a] ?? 0) !== 0);
      return !temEfeito;
    }).map((c) => c.id);
    // Bobina de dobra: o efeito é a dobra, que não é um número desta
    // tabela (coberta nos testes de dobra do servidor).
    expect(mortos.sort()).toEqual(['cargo_x2', 'warp_coil']);
  });
});

describe('classes de piloto: hangar × servidor', () => {
  // As classes existiam só no hangar: mudavam as barras do estaleiro e
  // nada em combate, porque o servidor nunca recebia a escolha. Agora ele
  // recebe (protocolo v15) e aplica esta mesma tabela.
  const FIX = join(process.cwd(), 'src/net/__fixtures__/pilots.json');

  it('as duas pontas conhecem as mesmas classes', async () => {
    const { PILOT_CLASSES } = await import('../src/data/pilots.js');
    const servidor = JSON.parse(readFileSync(FIX, 'utf8')) as Record<string, unknown>;
    expect(PILOT_CLASSES.map((p) => p.id).sort()).toEqual(Object.keys(servidor).sort());
  });

  it('cada multiplicador do hangar é o do combate', async () => {
    const { PILOT_CLASSES } = await import('../src/data/pilots.js');
    const servidor = JSON.parse(readFileSync(FIX, 'utf8')) as Record<
      string,
      Record<string, number>
    >;
    const neutro: Record<string, number> = {
      thrust: 1, damage: 1, fireRate: 1, shield: 1, shieldRegen: 1,
      hull: 1, sensorRange: 1, cargo: 1, stealthBonus: 0,
    };
    for (const p of PILOT_CLASSES) {
      const m = p.modifiers as Record<string, number | undefined>;
      for (const k of Object.keys(neutro)) {
        expect(servidor[p.id]![k], `${p.id}.${k}`).toBeCloseTo(m[k] ?? neutro[k]!, 4);
      }
    }
  });

  it('o cliente envia a classe ao entrar na arena', async () => {
    // A causa do defeito: a classe nunca saía do cliente.
    const { encodeClientMsg, PROTOCOL_VERSION } = await import('../src/net/protocol.js');
    const bytes = encodeClientMsg({
      type: 'Join',
      payload: {
        name: 'p', protocol: PROTOCOL_VERSION, loadout: [], skills: [],
        consumables: [], practice: false, pilotClass: 'ghost',
      },
    });
    expect(new TextDecoder().decode(bytes)).toContain('ghost');
  });
});
