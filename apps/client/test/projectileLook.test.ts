/**
 * Testes da aparência do disparo.
 *
 * O que se está protegendo: o jogador tem que PERCEBER, olhando, que
 * (a) a arma equipada é outra e (b) o gatilho ficou segurado. Antes todo
 * tiro era a mesma esfera amarela de raio 0.42 — a Lança Singular
 * carregada 2,5s e um toque de laser saíam idênticos do cano.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three/webgpu';
import {
  chargeScale,
  createProjectileVisual,
  familyName,
  familyOf,
} from '../src/render/ProjectileLook.js';
import {
  chargeMultiplier,
  primaryWeapon,
  weaponIds,
  weaponUiInfo,
} from '../src/data/weapons.js';

/** Maior dimensão do objeto, já com escalas aplicadas. */
function tamanho(obj: THREE.Object3D): number {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const t = new THREE.Vector3();
  b.getSize(t);
  return Math.max(t.x, t.y, t.z);
}

describe('aparência por família de arma', () => {
  it('as quatro famílias têm nomes distintos', () => {
    const nomes = [0, 1, 2, 3].map(familyName);
    expect(new Set(nomes).size).toBe(4);
  });

  it('um índice desconhecido cai no padrão em vez de quebrar', () => {
    // Servidor mais novo que o cliente não pode derrubar o render.
    expect(() => familyOf(99)).not.toThrow();
    expect(familyOf(99)).toEqual(familyOf(0));
  });

  it('laser e plasma produzem silhuetas diferentes com o mesmo raio', () => {
    // Mesmo raio de propósito: a diferença tem que vir da FORMA, não
    // só do tamanho, senão duas armas de calibre parecido ficam iguais.
    const laser = createProjectileVisual({ visual: 1, charge: 0, radius: 1 });
    const plasma = createProjectileVisual({ visual: 2, charge: 0, radius: 1 });
    expect(tamanho(laser.group)).not.toBeCloseTo(tamanho(plasma.group), 1);
    laser.dispose();
    plasma.dispose();
  });

  it('sem payload ainda desenha um projétil', () => {
    // Entidade sem dados (servidor antigo) não pode virar tiro invisível.
    const v = createProjectileVisual(null);
    expect(v.group.children.length).toBeGreaterThan(0);
    expect(tamanho(v.group)).toBeGreaterThan(0);
    v.dispose();
  });
});

describe('carga muda o disparo', () => {
  it('tiro carregado é visivelmente maior que o mesmo tiro sem carga', () => {
    const seco = createProjectileVisual({ visual: 3, charge: 0, radius: 1.6 });
    // O servidor já manda o raio maior; aqui vem só o extra visual.
    const cheio = createProjectileVisual({ visual: 3, charge: 1, radius: 3.04 });
    expect(tamanho(cheio.group)).toBeGreaterThan(tamanho(seco.group) * 1.5);
    seco.dispose();
    cheio.dispose();
  });

  it('a carga acrescenta o halo, que não existe no tiro seco', () => {
    const seco = createProjectileVisual({ visual: 2, charge: 0, radius: 1 });
    const cheio = createProjectileVisual({ visual: 2, charge: 1, radius: 1 });
    expect(cheio.group.children.length).toBeGreaterThan(seco.group.children.length);
    seco.dispose();
    cheio.dispose();
  });

  it('a escala visual cresce menos que o dano', () => {
    // Dano vai a 3.4x; se o tamanho acompanhasse, a Lança carregada
    // viraria uma bola do tamanho de uma nave e o combate ficaria
    // ilegível.
    expect(chargeScale(1)).toBeLessThan(3.4);
    expect(chargeScale(1)).toBeGreaterThan(chargeScale(0));
    expect(chargeScale(0)).toBe(1);
  });

  it('a escala é monotônica e tolera valores fora de faixa', () => {
    expect(chargeScale(-1)).toBe(chargeScale(0));
    expect(chargeScale(5)).toBe(chargeScale(1));
    expect(chargeScale(0.7)).toBeGreaterThan(chargeScale(0.3));
  });
});

describe('catálogo de armas da interface', () => {
  it('toda arma tem uma família visual válida', () => {
    for (const id of weaponIds()) {
      const w = weaponUiInfo(id)!;
      expect([0, 1, 2, 3], id).toContain(w.visual);
    }
  });

  it('a primária é a PRIMEIRA arma do loadout, como no servidor', () => {
    // `resolve_loadout` no servidor usa a primeira; se as pontas
    // discordassem, a barra mostraria uma arma e o tiro sairia de outra.
    const w = primaryWeapon(['shield_bio', 'plasma_m', 'railgun_s']);
    expect(w?.nome).toBe('Canhão de Plasma');
  });

  it('loadout sem arma nenhuma não tem primária', () => {
    expect(primaryWeapon(['shield_bio', 'cargo_x2'])).toBeUndefined();
  });

  it('o multiplicador é quadrático, igual ao do servidor', () => {
    const lanca = weaponUiInfo('lance_singular')!;
    // Metade do tempo dá um QUARTO do bônus (t²), não metade.
    const meio = chargeMultiplier(lanca, 0.5);
    const cheio = chargeMultiplier(lanca, 1);
    expect(cheio).toBeCloseTo(3.4, 5);
    expect(meio).toBeCloseTo(1 + 2.4 * 0.25, 5);
    // O ponto que interessa ao jogador: soltar na metade rende bem menos
    // que metade do ganho.
    expect(meio - 1).toBeLessThan((cheio - 1) / 2);
  });

  it('arma que não carrega fica sempre em 1x', () => {
    const laser = weaponUiInfo('laser_burst')!;
    expect(laser.tempoDeCarga).toBe(0);
    expect(chargeMultiplier(laser, 1)).toBe(1);
  });
});

describe('paridade com o catálogo do servidor', () => {
  // O cliente duplica os números das armas para desenhar a barra de
  // carga. Duplicação necessária (o cliente não fala Rust) e portanto
  // uma chance de divergir em silêncio: um rebalanceamento no servidor
  // deixaria a interface mentindo sobre o dano, sem erro nenhum.
  //
  // Os valores abaixo saem do próprio catálogo em Rust, via
  // `cargo test -p game-server --lib weapon_fixture`.
  const FIXTURE = join(process.cwd(), 'src/net/__fixtures__/weapons.json');

  it('a fixture existe (gerada pelo servidor)', () => {
    expect(existsSync(FIXTURE), `gere com \`cargo test -p game-server --lib weapon_fixture\``)
      .toBe(true);
  });

  it('tempo de carga, multiplicador e família batem com o servidor', () => {
    const servidor: Record<
      string,
      { chargeTime: number; chargeDamageMult: number; visual: number }
    > = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    for (const [id, esperado] of Object.entries(servidor)) {
      const cliente = weaponUiInfo(id);
      expect(cliente, `${id} falta no catálogo do cliente`).toBeDefined();
      expect(cliente!.tempoDeCarga, `${id}: tempo de carga`).toBeCloseTo(esperado.chargeTime, 5);
      expect(cliente!.danoMax, `${id}: multiplicador de dano`).toBeCloseTo(
        esperado.chargeDamageMult,
        5,
      );
      expect(cliente!.visual, `${id}: família visual`).toBe(esperado.visual);
    }
  });

  it('o cliente não inventa armas que o servidor não tem', () => {
    const servidor = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    for (const id of weaponIds()) {
      expect(Object.keys(servidor), `${id} só existe no cliente`).toContain(id);
    }
  });
});
