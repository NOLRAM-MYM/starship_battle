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
  ARMA_DE_SERVICO,
  chargeMultiplier,
  primaryWeapon,
  semCanhao,
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

  it('loadout sem arma nenhuma cai na arma de serviço', () => {
    // Este teste afirmava o contrário — que a primária era `undefined` —
    // e com isso fixava o defeito no lugar: o servidor SEMPRE arma a
    // nave, e devolver nada aqui era o cliente discordando dele.
    expect(primaryWeapon(['shield_bio', 'cargo_x2'])).toEqual(ARMA_DE_SERVICO);
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

  it('tempo de carga, multiplicador, família, velocidade e alcance batem', () => {
    const servidor: Record<
      string,
      {
        chargeTime: number;
        chargeDamageMult: number;
        visual: number;
        speed: number;
        ttl: number;
      }
    > = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    for (const [id, esperado] of Object.entries(servidor)) {
      // `__default__` é a arma de serviço: existe no servidor sem
      // template, porque ninguém a equipa.
      const cliente = id === '__default__' ? ARMA_DE_SERVICO : weaponUiInfo(id);
      expect(cliente, `${id} falta no catálogo do cliente`).toBeDefined();
      expect(cliente!.tempoDeCarga, `${id}: tempo de carga`).toBeCloseTo(esperado.chargeTime, 5);
      expect(cliente!.danoMax, `${id}: multiplicador de dano`).toBeCloseTo(
        esperado.chargeDamageMult,
        5,
      );
      expect(cliente!.visual, `${id}: família visual`).toBe(esperado.visual);
      // Velocidade e alcance alimentam a solução de mira: divergindo,
      // o marcador aponta para onde o tiro NÃO vai passar.
      expect(cliente!.velocidade, `${id}: velocidade`).toBeCloseTo(esperado.speed, 5);
      expect(cliente!.alcanceSegundos, `${id}: alcance em segundos`).toBeCloseTo(esperado.ttl, 5);
    }
  });

  it('o cliente não inventa armas que o servidor não tem', () => {
    const servidor = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    for (const id of weaponIds()) {
      expect(Object.keys(servidor), `${id} só existe no cliente`).toContain(id);
    }
  });
});

describe('nave sem canhão equipado', () => {
  // O caso real: um loadout só de lançadores de torpedo. O servidor
  // arma a nave assim mesmo (`DEFAULT_WEAPON`), mas o cliente devolvia
  // `undefined` e a interface ficava MUDA — sem nome de arma, sem barra
  // de carga e sem marcador de mira. Quem montasse essa nave atirava com
  // um canhão que o jogo nunca mencionou e concluía que a arma estava
  // quebrada.
  const SO_TORPEDOS = ['torpedo_heavy', 'engine_void', 'shield_bulwark'];

  it('o HUD tem o que mostrar', () => {
    const w = primaryWeapon(SO_TORPEDOS);
    expect(w.nome).toBe(ARMA_DE_SERVICO.nome);
    expect(w.nome.length).toBeGreaterThan(0);
  });

  it('a solução de mira tem velocidade e alcance', () => {
    // Sem estes dois números o marcador de impacto não é desenhável.
    const w = primaryWeapon(SO_TORPEDOS);
    expect(w.velocidade).toBeGreaterThan(0);
    expect(w.alcanceSegundos).toBeGreaterThan(0);
  });

  it('a arma de serviço não carrega, e a barra diz isso', () => {
    const w = primaryWeapon(SO_TORPEDOS);
    expect(w.tempoDeCarga).toBe(0);
    expect(chargeMultiplier(w, 1)).toBe(1);
  });

  it('o hangar consegue avisar antes do combate', () => {
    expect(semCanhao(SO_TORPEDOS)).toBe(true);
    expect(semCanhao(['railgun_s', ...SO_TORPEDOS])).toBe(false);
  });

  it('um canhão equipado ainda vence a arma de serviço', () => {
    // A rede de segurança não pode virar o caso comum.
    expect(primaryWeapon(['railgun_s', 'engine_void']).nome).toBe('Canhão Linear');
    expect(primaryWeapon([...SO_TORPEDOS, 'plasma_m']).nome).toBe('Canhão de Plasma');
  });
});
