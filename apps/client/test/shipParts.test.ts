/**
 * Testes das peças visuais por equipamento.
 *
 * O ponto: cada componente do catálogo tem que produzir geometria
 * PRÓPRIA na nave. Antes um Canhão Linear e uma Lança Singular geravam
 * exatamente o mesmo cilindro.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createShipMesh } from '../src/render/ShipMesh.js';
import {
  defaultMountFor,
  mountTransform,
  partBaseScale,
  partSizeCap,
  partVisual,
  visualIds,
} from '../src/render/ShipParts.js';
import { COMPONENT_LIBRARY } from '../src/ui/componentLibrary.js';

const BASE = {
  kind: 'interceptor' as const,
  hull: 0x28405e,
  glow: 0x4ec9ff,
  engines: 2,
  weapons: 2,
};

describe('catálogo visual', () => {
  it('TODO componente da loja tem peça visual', () => {
    // Se um item novo entrar na loja sem visual, ele seria invisível na
    // nave — o jogador compraria algo que não aparece.
    const semVisual = COMPONENT_LIBRARY.filter((c) => !partVisual(c.id)).map((c) => c.id);
    expect(semVisual, `sem peça visual: ${semVisual.join(', ')}`).toEqual([]);
  });

  it('não há peça visual órfã (id que não existe na loja)', () => {
    const idsLoja = new Set(COMPONENT_LIBRARY.map((c) => c.id));
    const orfas = visualIds().filter((id) => !idsLoja.has(id));
    expect(orfas, `visual sem componente: ${orfas.join(', ')}`).toEqual([]);
  });

  it('cada arma gera uma geometria diferente', () => {
    const armas = ['railgun_s', 'laser_burst', 'plasma_m', 'lance_singular'];
    const assinaturas = armas.map((id) => {
      const v = partVisual(id)!;
      const g = v.build(1);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      const chave = `${g.type}:${(b.max.x - b.min.x).toFixed(2)}:${(b.max.z - b.min.z).toFixed(2)}`;
      g.dispose();
      return chave;
    });
    expect(new Set(assinaturas).size, `assinaturas: ${assinaturas.join(' | ')}`).toBe(armas.length);
  });

  it('a arma lendária é visivelmente maior que a comum', () => {
    const medir = (id: string): number => {
      const g = partVisual(id)!.build(1);
      g.computeBoundingBox();
      const c = g.boundingBox!.max.z - g.boundingBox!.min.z;
      g.dispose();
      return c;
    };
    expect(medir('lance_singular')).toBeGreaterThan(medir('railgun_s'));
  });

  it('pontos de montagem separam as famílias', () => {
    expect(partVisual('railgun_s')!.mount).toBe('weapon');
    expect(partVisual('engine_mk1')!.mount).toBe('engine');
    expect(partVisual('shield_bio')!.mount).toBe('dorsal');
    expect(partVisual('cargo_x2')!.mount).toBe('ventral');
    expect(partVisual('cloak_lvl1')!.mount).toBe('wingtip');
  });

  it('defaultMountFor cobre todas as famílias de slot', () => {
    for (const k of ['Weapon', 'Engine', 'Shield', 'Sensor', 'Cargo', 'Stealth'] as const) {
      expect(defaultMountFor(k)).toBeTruthy();
    }
  });
});

describe('posicionamento', () => {
  const dims = { len: 6, wid: 3, hei: 1 };

  it('duas peças do mesmo tipo ficam simétricas', () => {
    const a = mountTransform('weapon', 0, 2, dims);
    const b = mountTransform('weapon', 1, 2, dims);
    expect(a.pos[0]).toBeCloseTo(-b.pos[0], 5);
  });

  it('uma peça sozinha fica centrada', () => {
    expect(mountTransform('weapon', 0, 1, dims).pos[0]).toBe(0);
  });

  it('armas ficam à frente e motores atrás (referencial de desenho)', () => {
    // No referencial de desenho o nariz é -Z; `ShipMesh` gira no fim.
    expect(mountTransform('weapon', 0, 1, dims).pos[2]).toBeLessThan(0);
    expect(mountTransform('engine', 0, 1, dims).pos[2]).toBeGreaterThan(0);
  });

  it('dorsal fica acima e ventral abaixo', () => {
    expect(mountTransform('dorsal', 0, 1, dims).pos[1]).toBeGreaterThan(0);
    expect(mountTransform('ventral', 0, 1, dims).pos[1]).toBeLessThan(0);
  });
});

describe('montagem na nave', () => {
  it('cada item do loadout vira uma peça', () => {
    const ship = createShipMesh({
      ...BASE,
      loadout: ['railgun_s', 'engine_mk3', 'shield_bio'],
    });
    expect(ship.parts.map((p) => p.templateId).sort()).toEqual(
      ['engine_mk3', 'railgun_s', 'shield_bio'].sort(),
    );
    ship.dispose();
  });

  it('id desconhecido é ignorado sem quebrar a nave', () => {
    const ship = createShipMesh({ ...BASE, loadout: ['nao_existe', 'railgun_s'] });
    expect(ship.parts).toHaveLength(1);
    expect(ship.parts[0]!.templateId).toBe('railgun_s');
    ship.dispose();
  });

  it('loadout vazio produz nave sem peças, mas montável', () => {
    const ship = createShipMesh({ ...BASE, loadout: [] });
    expect(ship.parts).toHaveLength(0);
    expect(ship.group.children.length).toBeGreaterThan(0);
    ship.dispose();
  });

  it('duas armas diferentes produzem peças de tamanhos diferentes', () => {
    // Mede a PEÇA, não a nave inteira.
    //
    // A versão anterior media a caixa envolvente da nave toda, e só
    // passava porque as peças eram grandes demais e vazavam para fora
    // do casco — o mesmo defeito que deixava o cruzador parecendo uma
    // caixa marrom com um toro rosa. Agora que as peças cabem dentro da
    // silhueta, o casco domina a caixa e a medida antiga daria igual
    // para qualquer arma. O que interessa de verdade é que a Lança
    // Singular seja visivelmente maior que o Canhão Linear.
    const medir = (id: string): number => {
      const ship = createShipMesh({ ...BASE, loadout: [id] });
      ship.group.updateMatrixWorld(true);
      const peca = ship.parts[0]!.object;
      const b = new THREE.Box3().setFromObject(peca);
      const t = new THREE.Vector3();
      b.getSize(t);
      const vol = t.x * t.y * t.z;
      ship.dispose();
      return vol;
    };
    const lanca = medir('lance_singular');
    const canhao = medir('railgun_s');
    expect(lanca).toBeGreaterThan(canhao * 1.5);
  });

  it('peças têm direção de explosão unitária', () => {
    const ship = createShipMesh({ ...BASE, loadout: ['railgun_s', 'shield_bio', 'cargo_x2'] });
    for (const p of ship.parts) {
      expect(p.explodeDir.length()).toBeCloseTo(1, 5);
    }
    ship.dispose();
  });

  it('os bocais continuam atrás com o loadout montado', () => {
    // Regressão da orientação: acrescentar peças não pode inverter a nave.
    const ship = createShipMesh({
      ...BASE,
      loadout: ['engine_void', 'lance_singular', 'shield_bulwark'],
    });
    ship.group.updateMatrixWorld(true);
    const bocais: number[] = [];
    ship.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === ship.engineMaterial) {
        bocais.push(o.getWorldPosition(new THREE.Vector3()).z);
      }
    });
    expect(bocais.length).toBeGreaterThan(0);
    for (const z of bocais) expect(z).toBeLessThan(0);
    ship.dispose();
  });
});

describe('proporção entre peças e casco', () => {
  // O bug: a escala das peças vinha da ALTURA do casco (`hei * 2.2`).
  // Num cruzador (casco baixo e comprido) o porão de carga saía maior
  // que o próprio casco, e a nave virava uma caixa marrom com um toro
  // rosa em volta — sem fuselagem visível. Estes testes fixam o teto.

  /** Maior dimensão do objeto no mundo, já com a escala aplicada. */
  function maiorDimensao(obj: THREE.Object3D): number {
    const bb = new THREE.Box3().setFromObject(obj);
    const t = new THREE.Vector3();
    bb.getSize(t);
    return Math.max(t.x, t.y, t.z);
  }

  const CHASSIS = ['interceptor', 'skirmisher', 'cruiser', 'hauler'] as const;

  it.each(CHASSIS)('em %s nenhuma peça ultrapassa o teto do seu ponto', (kind) => {
    // Um loadout deliberadamente pesado: as peças mais volumosas do
    // catálogo, todas de uma vez.
    const mesh = createShipMesh({
      kind,
      hull: 0x8899aa,
      glow: 0x4ec9ff,
      loadout: [
        'lance_singular',
        'engine_void',
        'shield_bulwark',
        'cargo_hauler',
        'cloak_umbra',
        'sensor_deep',
      ],
    });

    expect(mesh.parts.length, 'as peças precisam existir').toBeGreaterThan(0);

    const casco = maiorDimensao(mesh.group);
    for (const p of mesh.parts) {
      const v = partVisual(p.templateId);
      if (!v) continue;
      const teto = partSizeCap(v.mount, casco);
      // Folga de 1% para arredondamento de ponto flutuante.
      expect(maiorDimensao(p.object), `${p.templateId} (${v.mount})`).toBeLessThanOrEqual(
        teto * 1.01,
      );
    }
  });

  it('o porão industrial não é maior que o casco do cruzador', () => {
    // O caso concreto que apareceu na tela.
    const mesh = createShipMesh({
      kind: 'cruiser',
      hull: 0x8899aa,
      glow: 0x4ec9ff,
      loadout: ['cargo_hauler'],
    });
    const porao = mesh.parts.find((p) => p.templateId === 'cargo_hauler');
    expect(porao).toBeDefined();
    const casco = maiorDimensao(mesh.group);
    expect(maiorDimensao(porao!.object)).toBeLessThan(casco * 0.35);
  });

  it('a escala base não dispara com a altura do casco', () => {
    // Cargueiro é o casco mais alto (2.2) e o cruzador o mais comprido.
    // Ancorada no comprimento, a escala fica parecida entre os dois; se
    // alguém voltar a ancorar na altura, a razão estoura.
    const razao = partBaseScale(6.2) / partBaseScale(7.6);
    expect(razao).toBeGreaterThan(0.75);
    expect(razao).toBeLessThan(1.25);
  });
});
