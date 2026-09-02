/**
 * Trava a CONVENÇÃO DE FRENTE da nave.
 *
 * O servidor define frente = +Z: `forward()` em `world.rs` devolve
 * (0,0,1) para o quaternion identidade, e o teste
 * `input_drives_movement_in_simulation` fixa isso com `p.z > 0`.
 *
 * O cliente montava o casco para -Z. O resultado em jogo era a nave
 * voando de ré, com os motores na ponta e os projéteis saindo de dentro
 * da propulsão. Nada disso quebrava teste nenhum — era só geometria
 * errada, silenciosa.
 *
 * Estes testes leem a posição real das peças no espaço do mundo depois
 * de montada, então uma regressão volta a falhar aqui.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createShipMesh } from '../src/render/ShipMesh.js';

/** Posição no espaço do grupo raiz de todos os meshes com este material. */
function posicoesComMaterial(root: THREE.Object3D, material: THREE.Material): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material === material) {
      out.push(o.getWorldPosition(new THREE.Vector3()));
    }
  });
  return out;
}

describe('orientação da nave (convenção +Z do servidor)', () => {
  const spec = {
    kind: 'interceptor' as const,
    hull: 0x28405e,
    glow: 0x4ec9ff,
    engines: 2,
    weapons: 2,
  };

  it('os bocais de motor ficam ATRÁS (z negativo)', () => {
    const ship = createShipMesh(spec);
    const bocais = posicoesComMaterial(ship.group, ship.engineMaterial);

    expect(bocais.length, 'deveria haver bocal de motor').toBeGreaterThan(0);
    for (const p of bocais) {
      expect(
        p.z,
        `bocal em z=${p.z.toFixed(2)} — motor na ponta faz o tiro sair da propulsão`,
      ).toBeLessThan(0);
    }
    ship.dispose();
  });

  it('o nariz do casco aponta para +Z', () => {
    const ship = createShipMesh(spec);
    ship.group.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(ship.group);
    // A ponta afiada avança mais em +Z do que a traseira recua em -Z?
    // Não necessariamente; o critério robusto é o centro de massa da
    // fuselagem estar à frente dos motores.
    const bocais = posicoesComMaterial(ship.group, ship.engineMaterial);
    const zMotor = bocais.reduce((a, p) => a + p.z, 0) / bocais.length;

    expect(caixa.max.z, 'o casco precisa se estender para +Z').toBeGreaterThan(0);
    expect(caixa.max.z, 'a ponta precisa estar à frente dos motores').toBeGreaterThan(zMotor);
    ship.dispose();
  });

  it('a frente local (+Z) coincide com o forward do servidor', () => {
    const ship = createShipMesh(spec);
    // Com quaternion identidade, o forward do servidor é (0,0,1).
    const frenteServidor = new THREE.Vector3(0, 0, 1);
    const frenteNave = new THREE.Vector3(0, 0, 1).applyQuaternion(ship.group.quaternion);
    expect(frenteNave.dot(frenteServidor)).toBeCloseTo(1, 5);
    ship.dispose();
  });

  it('vale para todos os cascos, não só o interceptador', () => {
    for (const kind of ['interceptor', 'skirmisher', 'cruiser', 'hauler'] as const) {
      const ship = createShipMesh({ ...spec, kind });
      const bocais = posicoesComMaterial(ship.group, ship.engineMaterial);
      for (const p of bocais) {
        expect(p.z, `${kind}: bocal em z=${p.z.toFixed(2)}`).toBeLessThan(0);
      }
      ship.dispose();
    }
  });

  it('vale com o detalhamento máximo instalado', () => {
    const ship = createShipMesh({ ...spec, detail: 4 });
    const bocais = posicoesComMaterial(ship.group, ship.engineMaterial);
    expect(bocais.length).toBeGreaterThan(0);
    for (const p of bocais) expect(p.z).toBeLessThan(0);
    ship.dispose();
  });
});
