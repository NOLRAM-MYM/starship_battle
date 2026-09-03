/**
 * Luzes de navegação.
 *
 * O que se protege: uma nave é um objeto pequeno e escuro contra um
 * fundo preto, e some justamente na distância em que se decide engajar
 * ou fugir. Clarear o casco resolveria a percepção e destruiria a cena.
 * As luzes resolvem porque EMITEM.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createNavLights,
  COR_BOMBORDO,
  COR_ESTIBORDO,
  COR_POPA,
} from '../src/render/NavLights.js';
import { createShipMesh } from '../src/render/ShipMesh.js';

const DIMS = { len: 6.4, wid: 3.0, hei: 0.85 };
const FACCAO = 0x4ec9ff;

function porCor(h: ReturnType<typeof createNavLights>, cor: number) {
  return h.lights.filter((l) => l.material.color.getHex() === cor);
}

describe('disposição das luzes', () => {
  it('tem bombordo, estibordo, popa e farol', () => {
    const h = createNavLights(DIMS, FACCAO);
    expect(h.lights).toHaveLength(4);
    expect(porCor(h, COR_BOMBORDO)).toHaveLength(1);
    expect(porCor(h, COR_ESTIBORDO)).toHaveLength(1);
    expect(porCor(h, COR_POPA)).toHaveLength(1);
    expect(porCor(h, FACCAO)).toHaveLength(1);
    h.dispose();
  });

  it('vermelho a bombordo e verde a estibordo, na convenção náutica', () => {
    // Não é enfeite: é o que diz se a nave vem na sua direção ou se
    // afasta. Vermelho à esquerda e verde à direita = vindo para cima
    // de você.
    const h = createNavLights(DIMS, FACCAO);
    const bombordo = porCor(h, COR_BOMBORDO)[0]!;
    const estibordo = porCor(h, COR_ESTIBORDO)[0]!;
    expect(bombordo.mesh.position.x).toBeLessThan(0);
    expect(estibordo.mesh.position.x).toBeGreaterThan(0);
    h.dispose();
  });

  it('a luz de popa fica ATRÁS no referencial de desenho', () => {
    // O nariz é -Z antes de `ShipMesh` girar o conjunto. Escrever as
    // posições como se a frente já fosse +Z põe a luz de popa no nariz
    // e o farol atrás — foi o primeiro erro cometido aqui.
    const h = createNavLights(DIMS, FACCAO);
    const popa = porCor(h, COR_POPA)[0]!;
    expect(popa.mesh.position.z).toBeGreaterThan(0);
    h.dispose();
  });

  it('o farol fica no ponto mais alto, para ser visto de cima', () => {
    const h = createNavLights(DIMS, FACCAO);
    const farol = porCor(h, FACCAO)[0]!;
    for (const l of h.lights) {
      if (l === farol) continue;
      expect(farol.mesh.position.y).toBeGreaterThan(l.mesh.position.y);
    }
    h.dispose();
  });

  it('as luzes acompanham o tamanho do casco', () => {
    // Posições absolutas cairiam dentro do casco de uma nave e fora da
    // outra: um cargueiro tem três vezes a largura de um interceptador.
    const pequena = createNavLights({ len: 5, wid: 2, hei: 0.8 }, FACCAO);
    const grande = createNavLights({ len: 9, wid: 6, hei: 2.4 }, FACCAO);
    const xp = Math.abs(porCor(pequena, COR_BOMBORDO)[0]!.mesh.position.x);
    const xg = Math.abs(porCor(grande, COR_BOMBORDO)[0]!.mesh.position.x);
    expect(xg).toBeGreaterThan(xp * 2);
    pequena.dispose();
    grande.dispose();
  });

  it('numa nave pequena a luz ainda tem tamanho visível', () => {
    // Escalar sem piso faria a luz virar subpixel e sumir de novo — o
    // problema que ela existe para resolver.
    const h = createNavLights({ len: 3, wid: 0.8, hei: 0.4 }, FACCAO);
    for (const l of h.lights) {
      expect(l.mesh.scale.x).toBeGreaterThanOrEqual(0.16);
    }
    h.dispose();
  });
});

describe('brilho e pulsação', () => {
  it('as luzes ignoram a névoa', () => {
    // Uma luz de navegação que some com a distância é o oposto do que
    // ela existe para fazer. Foi assim que as estrelas sumiram uma vez.
    const h = createNavLights(DIMS, FACCAO);
    for (const l of h.lights) {
      expect(l.material.fog).toBe(false);
    }
    h.dispose();
  });

  it('usam mistura aditiva, para continuarem legíveis contra o preto', () => {
    const h = createNavLights(DIMS, FACCAO);
    for (const l of h.lights) {
      expect(l.material.blending).toBe(THREE.AdditiveBlending);
    }
    h.dispose();
  });

  it('só o farol pulsa', () => {
    // Se tudo piscasse, a leitura de orientação se perderia: as luzes
    // de lado precisam ficar acesas para dizer de que ângulo a nave
    // está sendo vista.
    const h = createNavLights(DIMS, FACCAO);
    const pulsando = h.lights.filter((l) => l.strobePeriod !== null);
    expect(pulsando).toHaveLength(1);
    expect(pulsando[0]!.material.color.getHex()).toBe(FACCAO);
    h.dispose();
  });

  it('o farol de fato acende e apaga ao longo do tempo', () => {
    const h = createNavLights(DIMS, FACCAO);
    const farol = porCor(h, FACCAO)[0]!;
    const vistos = new Set<number>();
    for (let i = 0; i < 60; i++) {
      h.update(i * 0.05);
      vistos.add(Math.round(farol.material.opacity * 100));
    }
    expect(vistos.size).toBeGreaterThan(1);
    h.dispose();
  });

  it('as luzes fixas não mudam de brilho', () => {
    const h = createNavLights(DIMS, FACCAO);
    const bombordo = porCor(h, COR_BOMBORDO)[0]!;
    const antes = bombordo.material.opacity;
    for (let i = 0; i < 40; i++) h.update(i * 0.1);
    expect(bombordo.material.opacity).toBe(antes);
    h.dispose();
  });

  it('naves diferentes piscam fora de fase', () => {
    // Em uníssono, um grupo de naves pareceria um sistema só.
    const a = createNavLights(DIMS, FACCAO, 7);
    const b = createNavLights(DIMS, FACCAO, 53);
    expect(porCor(a, FACCAO)[0]!.strobeOffset).not.toBe(
      porCor(b, FACCAO)[0]!.strobeOffset,
    );
    a.dispose();
    b.dispose();
  });
});

describe('integração com a nave', () => {
  it('a nave montada expõe as luzes e as posiciona no casco', () => {
    const ship = createShipMesh({ kind: 'interceptor', hull: 0x28405e, glow: FACCAO });
    expect(ship.navLights.lights).toHaveLength(4);
    // Estão dentro do grupo da nave, e não soltas na cena: precisam
    // acompanhar a nave enquanto ela manobra.
    ship.group.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    ship.navLights.lights[0]!.mesh.getWorldPosition(p);
    expect(Number.isFinite(p.x)).toBe(true);
    ship.dispose();
  });

  it('o farol usa a cor da facção da nave', () => {
    // É o que responde "amigo ou inimigo" antes de qualquer texto.
    const aliado = createShipMesh({ kind: 'interceptor', hull: 0x2c5c46, glow: 0x45e5a4 });
    const inimigo = createShipMesh({ kind: 'interceptor', hull: 0x5a2b38, glow: 0xff5f6d });
    const corDe = (s: ReturnType<typeof createShipMesh>) =>
      s.navLights.lights.find((l) => l.strobePeriod !== null)!.material.color.getHex();
    expect(corDe(aliado)).toBe(0x45e5a4);
    expect(corDe(inimigo)).toBe(0xff5f6d);
    aliado.dispose();
    inimigo.dispose();
  });
});
