/**
 * Mede ONDE está cada parte da nave no espaço, depois de montada.
 *
 * O relato foi "o que atira e o que propulsiona está revertido". Este
 * teste não confia em raciocínio sobre rotações: ele lê a posição real
 * de cada peça e compara com a convenção do servidor (frente = +Z, que
 * é a direção em que o projétil nasce).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createShipMesh } from '../src/render/ShipMesh.js';

/** Todas as malhas com a posição no espaço da raiz e o raio aproximado. */
function pecas(root: THREE.Object3D): Array<{ z: number; y: number; mat: THREE.Material }> {
  root.updateMatrixWorld(true);
  const out: Array<{ z: number; y: number; mat: THREE.Material }> = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const p = o.getWorldPosition(new THREE.Vector3());
      const m = Array.isArray(o.material) ? o.material[0]! : o.material;
      out.push({ z: p.z, y: p.y, mat: m });
    }
  });
  return out;
}

describe('geometria da nave x convenção do servidor', () => {
  const spec = {
    kind: 'interceptor' as const,
    hull: 0x28405e,
    glow: 0x4ec9ff,
    engines: 2,
    weapons: 2,
  };

  it('os bocais de motor ficam ATRÁS do centro (z negativo)', () => {
    const ship = createShipMesh(spec);
    const bocais = pecas(ship.group).filter((p) => p.mat === ship.engineMaterial);
    expect(bocais.length).toBeGreaterThan(0);
    for (const b of bocais) {
      expect(b.z, 'motor à frente faria o tiro sair pela propulsão').toBeLessThan(0);
    }
    ship.dispose();
  });

  it('o casco avança mais para a FRENTE (+Z) do que os motores recuam', () => {
    const ship = createShipMesh(spec);
    ship.group.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(ship.group);
    const bocais = pecas(ship.group).filter((p) => p.mat === ship.engineMaterial);
    const zMotor = bocais.reduce((a, b) => a + b.z, 0) / bocais.length;

    expect(caixa.max.z).toBeGreaterThan(0);
    expect(caixa.max.z).toBeGreaterThan(zMotor);
    ship.dispose();
  });

  it('a cabine fica na metade da FRENTE', () => {
    // A cabine é o marcador visual de "onde é a frente". Se ela caísse
    // atrás, o jogador leria a nave ao contrário mesmo com a física certa.
    const ship = createShipMesh(spec);
    const todas = pecas(ship.group);
    // A cabine é a peça mais alta (fica sobre o dorso).
    const cabine = todas.reduce((a, b) => (b.y > a.y ? b : a));
    expect(cabine.z, 'cabine deveria estar à frente do centro').toBeGreaterThan(0);
    ship.dispose();
  });

  it('o projétil nasce à frente de todas as peças de motor', () => {
    // O servidor cria o projétil em `pos + forward * 3`, com forward=+Z.
    const ship = createShipMesh(spec);
    const muzzleZ = 3;
    const bocais = pecas(ship.group).filter((p) => p.mat === ship.engineMaterial);
    for (const b of bocais) {
      expect(muzzleZ).toBeGreaterThan(b.z);
    }
    ship.dispose();
  });
});
