/**
 * Animações de habilidade e consumíveis equipados.
 *
 * O que se protege aqui: ativar uma habilidade produzia ZERO efeito na
 * tela — `SkillActivated` só mexia no cooldown do HUD, e nem isso para
 * naves alheias. E os consumíveis da loja não apareciam em lugar nenhum
 * do jogo.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createSkillFx, skillFxProfile, type SkillFxKind } from '../src/render/SkillFx.js';
import {
  consumableIds,
  consumableUiInfo,
  equippedFromInventory,
  MAX_CONSUMABLE_SLOTS,
} from '../src/data/consumables.js';

const TIPOS: SkillFxKind[] = [
  'Dash',
  'Emp',
  'Repair',
  'consumable-repair',
  'consumable-shield',
];

describe('animações de habilidade', () => {
  it('o efeito fica PRESO à nave, não à cena', () => {
    // É a razão de o gatilho ser `SkillActivated` (que traz entity_id) e
    // não uma mensagem `Vfx`, que levaria só uma posição: a nave sairia
    // de dentro do próprio efeito ao se mover.
    const fx = createSkillFx();
    const nave = new THREE.Group();
    fx.play('Emp', nave);
    expect(nave.children.length).toBe(1);

    nave.position.set(100, 0, 0);
    nave.updateMatrixWorld(true);
    const efeito = nave.children[0]!;
    const pos = new THREE.Vector3();
    efeito.getWorldPosition(pos);
    expect(pos.x).toBeCloseTo(100, 3);
    fx.dispose();
  });

  it('as três habilidades se distinguem por forma, não só por cor', () => {
    // Cor sozinha se perde contra o fundo e não serve para quem enxerga
    // cores de outro jeito. O que separa os efeitos é o achatamento, o
    // raio e o SENTIDO da animação.
    const dash = skillFxProfile('Dash');
    const emp = skillFxProfile('Emp');
    const repair = skillFxProfile('Repair');

    // PEM é um disco largo; Reparo é uma casca próxima e contraindo.
    expect(emp.achatamento).toBeLessThan(repair.achatamento);
    expect(emp.raio).toBeGreaterThan(repair.raio * 3);
    expect(emp.expande).toBe(true);
    expect(repair.expande).toBe(false);
    // A dobra sai por trás da nave.
    expect(dash.offsetZ).toBeLessThan(0);
  });

  it('a duração do visual bate com a do servidor', () => {
    // Se o efeito sumisse antes, o jogador acharia que a paralisia
    // acabou e avançaria no meio dela.
    expect(skillFxProfile('Emp').duracao).toBeCloseTo(3.0, 3);
    expect(skillFxProfile('Repair').duracao).toBeCloseTo(5.0, 3);
  });

  it('consumível é um flash curto, não um estado', () => {
    // O efeito é instantâneo; uma animação longa sugeriria um buff.
    expect(skillFxProfile('consumable-repair').duracao).toBeLessThan(1);
    expect(skillFxProfile('consumable-shield').duracao).toBeLessThan(1);
  });

  it.each(TIPOS)('%s produz geometria e é limpo ao terminar', (kind) => {
    const fx = createSkillFx();
    const nave = new THREE.Group();
    fx.play(kind, nave);
    expect(fx.activeCount()).toBe(1);
    expect(nave.children.length).toBe(1);

    // Avança além da duração.
    fx.update(skillFxProfile(kind).duracao + 0.1);
    expect(fx.activeCount(), 'efeito expirado deve ser removido').toBe(0);
    expect(nave.children.length, 'não pode vazar objeto na nave').toBe(0);
    fx.dispose();
  });

  it('reativar reinicia em vez de empilhar', () => {
    // Dois PEMs sobrepostos viram só brilho ilegível.
    const fx = createSkillFx();
    const nave = new THREE.Group();
    fx.play('Emp', nave);
    fx.update(1.0);
    fx.play('Emp', nave);
    expect(fx.activeCount()).toBe(1);
    // Reiniciou: ainda vivo depois de mais 2.5s (duração é 3s).
    fx.update(2.5);
    expect(fx.activeCount()).toBe(1);
    fx.dispose();
  });

  it('naves diferentes têm efeitos independentes', () => {
    const fx = createSkillFx();
    const a = new THREE.Group();
    const b = new THREE.Group();
    fx.play('Emp', a);
    fx.play('Emp', b);
    expect(fx.activeCount()).toBe(2);
    fx.dispose();
  });

  it('clear remove tudo', () => {
    const fx = createSkillFx();
    const nave = new THREE.Group();
    fx.play('Dash', nave);
    fx.play('Repair', nave);
    fx.clear();
    expect(fx.activeCount()).toBe(0);
    expect(nave.children.length).toBe(0);
    fx.dispose();
  });
});

describe('consumíveis equipados', () => {
  // O inventário da API devolve APENAS `{ accountId, itemId, quantity }`
  // — sem `code`. Estes ids espelham o catálogo real.
  // Os ids vêm como STRING de propósito: é o que `/economy/items`
  // devolve, porque o driver do Postgres serializa BIGINT como string.
  // O inventário devolve `itemId` numérico. Um Map montado sem
  // normalizar nunca acha a chave, e o cinto sai vazio em silêncio.
  const CATALOGO = [
    { id: '25', code: 'repair_kit' },
    { id: '26', code: 'shield_cell' },
    { id: '1', code: 'railgun_s' },
    { id: '2', code: 'ship_interceptor' },
  ];

  it('pega do inventário e respeita o limite de slots', () => {
    const equipados = equippedFromInventory(
      [
        { itemId: 25, quantity: 3 },
        { itemId: 26, quantity: 2 },
        { itemId: 25, quantity: 5 },
      ],
      CATALOGO,
    );
    expect(equipados).toHaveLength(MAX_CONSUMABLE_SLOTS);
    expect(equipados[0]!.templateId).toBe('repair_kit');
    expect(equipados[0]!.charges).toBe(3);
  });

  it('ignora itens que não são consumíveis', () => {
    // O inventário traz peças e naves também.
    const equipados = equippedFromInventory(
      [
        { itemId: 1, quantity: 1 },
        { itemId: 2, quantity: 1 },
        { itemId: 25, quantity: 2 },
      ],
      CATALOGO,
    );
    expect(equipados).toHaveLength(1);
    expect(equipados[0]!.templateId).toBe('repair_kit');
  });

  it('descarta quantidade zero, igual ao servidor', () => {
    expect(equippedFromInventory([{ itemId: 25, quantity: 0 }], CATALOGO)).toEqual([]);
  });

  it('inventário vazio não quebra', () => {
    expect(equippedFromInventory([], CATALOGO)).toEqual([]);
  });

  it('itemId ausente do catálogo é ignorado, não quebra', () => {
    // Catálogo desatualizado em relação ao inventário não pode derrubar
    // o lançamento.
    expect(equippedFromInventory([{ itemId: 999, quantity: 4 }], CATALOGO)).toEqual([]);
  });

  it('casa id string do catálogo com itemId numérico do inventário', () => {
    // O BIGINT do Postgres chega como string no catálogo e como número
    // no inventário. Sem normalizar, o jogador compra kits e entra na
    // arena sem nada — sem erro nenhum aparecendo.
    const equipados = equippedFromInventory([{ itemId: 25, quantity: 2 }], CATALOGO);
    expect(equipados).toHaveLength(1);
    expect(equipados[0]!.templateId).toBe('repair_kit');
  });

  it('resolve pelo itemId, não por um campo `code` que não existe', () => {
    // A primeira versão lia `linha.code` e produzia um cinto SEMPRE
    // vazio, sem erro nenhum — o jogador compraria kits e entraria na
    // arena sem nada.
    const equipados = equippedFromInventory([{ itemId: 26, quantity: 4 }], CATALOGO);
    expect(equipados).toHaveLength(1);
    expect(equipados[0]!.templateId).toBe('shield_cell');
    expect(equipados[0]!.charges).toBe(4);
  });

  it('todo consumível conhecido tem nome e efeito visual', () => {
    for (const id of consumableIds()) {
      const info = consumableUiInfo(id)!;
      expect(info.nome, id).toBeTruthy();
      expect(info.descricao, id).toBeTruthy();
      expect([0, 1, 2], id).toContain(info.vfx);
    }
  });

  it('cada consumível tem um efeito visual distinto', () => {
    // Se desenhassem igual, o jogador não saberia qual carga gastou.
    const vfxs = consumableIds().map((id) => consumableUiInfo(id)!.vfx);
    expect(new Set(vfxs).size).toBe(vfxs.length);
  });
});
