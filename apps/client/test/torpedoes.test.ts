/**
 * Lançamento de torpedo: quando dá, e por que não dá.
 *
 * O servidor descarta o pedido em SILÊNCIO quando falta lançador, o
 * alvo está longe demais ou o lançador está em espera. Do lado do
 * jogador isso é indistinguível de um bug: a tecla não faz nada e não
 * há o que aprender. Estes testes fixam o motivo — é ele que ensina.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  equippedTorpedo,
  torpedoBlock,
  torpedoBlockMessage,
  torpedoIds,
  torpedoUiInfo,
} from '../src/data/torpedoes.js';

describe('lançador equipado', () => {
  it('encontra o lançador no loadout', () => {
    const t = equippedTorpedo(['railgun_s', 'engine_mk3', 'torpedo_seeker']);
    expect(t?.nome).toBe('Torpedo Perseguidor');
  });

  it('usa o PRIMEIRO lançador, como o servidor', () => {
    // Se as pontas discordassem sobre qual vale, a interface anunciaria
    // um alcance e o servidor usaria outro.
    const t = equippedTorpedo(['torpedo_heavy', 'torpedo_seeker']);
    expect(t?.nome).toBe('Torpedo Pesado');
  });

  it('loadout sem lançador não tem torpedo', () => {
    expect(equippedTorpedo(['railgun_s', 'shield_bio'])).toBeUndefined();
  });
});

describe('motivo do bloqueio', () => {
  const seeker = torpedoUiInfo('torpedo_seeker')!;

  it('sem lançador equipado', () => {
    expect(torpedoBlock(undefined, 200)).toBe('sem-lancador');
  });

  it('sem alvo', () => {
    // O caso que mais confundia: o HUD mostrava um alvo automático, mas
    // o pedido saía com alvo nulo e nada acontecia.
    expect(torpedoBlock(seeker, null)).toBe('sem-alvo');
  });

  it('alvo além do alcance de travamento', () => {
    expect(torpedoBlock(seeker, seeker.lockRange + 1)).toBe('fora-de-alcance');
  });

  it('dentro do alcance, nada bloqueia', () => {
    expect(torpedoBlock(seeker, seeker.lockRange - 1)).toBeNull();
    expect(torpedoBlock(seeker, 10)).toBeNull();
  });

  it('o limite exato ainda passa', () => {
    // Recusar no limite exato pareceria bug para quem está a 900.0 u.
    expect(torpedoBlock(seeker, seeker.lockRange)).toBeNull();
  });

  it('cada motivo tem uma mensagem própria e útil', () => {
    // "Não dá" repetido não ensina nada; "fora de alcance" diz para se
    // aproximar.
    const msgs = (['sem-lancador', 'sem-alvo', 'fora-de-alcance'] as const).map((m) =>
      torpedoBlockMessage(m, seeker),
    );
    expect(new Set(msgs).size).toBe(3);
    for (const m of msgs) expect(m.length).toBeGreaterThan(10);
    expect(torpedoBlockMessage('fora-de-alcance', seeker)).toContain(String(seeker.lockRange));
  });

  it('sem bloqueio, a mensagem é vazia', () => {
    expect(torpedoBlockMessage(null)).toBe('');
  });
});

describe('paridade com o catálogo do servidor', () => {
  // Gerado por `cargo test -p game-server --lib torpedo_fixture`.
  const FIXTURE = join(process.cwd(), 'src/net/__fixtures__/torpedoes.json');

  it('a fixture existe', () => {
    expect(existsSync(FIXTURE), 'gere com `cargo test -p game-server --lib torpedo_fixture`')
      .toBe(true);
  });

  it('alcance, dano, velocidade e casco batem com o servidor', () => {
    // Um alcance divergente faria a interface prometer travamento onde o
    // servidor recusa — pior que não avisar nada.
    const servidor: Record<
      string,
      { damage: number; lockRange: number; speed: number; hp: number }
    > = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    for (const [id, esperado] of Object.entries(servidor)) {
      const c = torpedoUiInfo(id);
      expect(c, `${id} falta no catálogo do cliente`).toBeDefined();
      expect(c!.lockRange, `${id}: alcance`).toBeCloseTo(esperado.lockRange, 3);
      expect(c!.damage, `${id}: dano`).toBeCloseTo(esperado.damage, 3);
      expect(c!.speed, `${id}: velocidade`).toBeCloseTo(esperado.speed, 3);
      expect(c!.hp, `${id}: casco`).toBeCloseTo(esperado.hp, 3);
    }
  });

  it('o cliente não inventa torpedos', () => {
    const servidor = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    for (const id of torpedoIds()) {
      expect(Object.keys(servidor), `${id} só existe no cliente`).toContain(id);
    }
  });
});
