/**
 * Aparência de um projétil: família da arma × carga acumulada.
 *
 * Antes todo tiro era a mesma esfera amarela de raio 0.42. Duas coisas
 * ficavam invisíveis por causa disso:
 *
 * 1. **A arma equipada.** Um laser em rajada e uma Lança Singular — que
 *    custa 9.800 — saíam idênticos do cano.
 * 2. **A carga.** Segurar o gatilho 2,5 segundos triplica o dano, mas o
 *    projétil resultante era pixel por pixel igual a um toque. O jogador
 *    não tinha como saber se tinha valido a pena.
 *
 * A regra aqui é a mesma das peças da nave: a diferença tem que ser
 * legível **pela silhueta e pela cor**, à velocidade de combate, sem
 * precisar ler número nenhum.
 */

import * as THREE from 'three/webgpu';

/** Famílias, na ordem do `WeaponVisual` do servidor. */
export type WeaponVisualIdx = 0 | 1 | 2 | 3;

export interface ShotLook {
  visual: number;
  charge: number;
  radius: number;
}

interface FamilySpec {
  nome: string;
  /** Cor do núcleo sem carga. */
  frio: number;
  /** Cor do núcleo com carga cheia — o "esquenta" visual. */
  quente: number;
  /** Cor da cauda. */
  cauda: number;
  /** Alongamento do núcleo no eixo de voo (1 = esfera). */
  alongamento: number;
  /** Comprimento da cauda, em múltiplos do raio. */
  caudaLonga: number;
  /** Intensidade da luz que o projétil emite. */
  luz: number;
}

/**
 * Uma família por tipo de arma.
 *
 * Os contrastes são deliberados: o cinético é curto e seco, o laser é
 * uma agulha, o plasma é uma bola gorda e a lança é um dardo com cauda
 * enorme. Mesmo de relance, dá para saber o que vem vindo — o que
 * importa para decidir se dá para tanque ou se tem que desviar.
 */
const FAMILIAS: Record<number, FamilySpec> = {
  // Cinético: sólido, rápido, sem drama.
  0: {
    nome: 'cinético',
    frio: 0xffd166,
    quente: 0xfff3c4,
    cauda: 0xff8a3c,
    alongamento: 1.6,
    caudaLonga: 5,
    luz: 3,
  },
  // Laser: agulha finíssima, quase só brilho.
  1: {
    nome: 'laser',
    frio: 0x45e5a4,
    quente: 0xc9fff0,
    cauda: 0x1f8f6b,
    alongamento: 5.5,
    caudaLonga: 9,
    luz: 2.2,
  },
  // Plasma: bola gorda com halo — lenta e claramente pesada.
  2: {
    nome: 'plasma',
    frio: 0xb06bff,
    quente: 0xf0d5ff,
    cauda: 0x6a2fb0,
    alongamento: 1.1,
    caudaLonga: 3.4,
    luz: 6,
  },
  // Lança: dardo longo com cauda enorme. Impossível de confundir.
  3: {
    nome: 'lança',
    frio: 0xffb347,
    quente: 0xffffff,
    cauda: 0xff5f2e,
    alongamento: 3.2,
    caudaLonga: 12,
    luz: 9,
  },
};

const PADRAO = FAMILIAS[0] as FamilySpec;

export function familyOf(visual: number): FamilySpec {
  return FAMILIAS[visual] ?? PADRAO;
}

/** Nome da família, para HUD e testes. */
export function familyName(visual: number): string {
  return familyOf(visual).nome;
}

export interface ProjectileVisual {
  group: THREE.Group;
  dispose(): void;
}

/**
 * Fator de escala aplicado pela carga.
 *
 * Cresce mais devagar que o dano (que é quadrático até 3,4×): um tiro
 * cheio fica ~2,1× maior em vez de 3,4×, senão a Lança carregada vira
 * uma bola do tamanho de uma nave e atrapalha a leitura do combate.
 */
export function chargeScale(charge: number): number {
  const c = Math.min(1, Math.max(0, charge));
  return 1 + 1.1 * c;
}

/**
 * Monta o objeto 3D de um projétil.
 *
 * O `radius` do servidor já inclui o bônus de carga, então ele dimensiona
 * o núcleo; `charge` é usado para o que é puramente visual — cor, halo
 * e comprimento da cauda.
 */
export function createProjectileVisual(shot: ShotLook | null): ProjectileVisual {
  const fam = familyOf(shot?.visual ?? 0);
  const carga = Math.min(1, Math.max(0, shot?.charge ?? 0));
  // Sem payload (servidor antigo, ou entidade sem dados) cai no raio
  // histórico: a nave nunca fica sem tiro visível por falta de dado.
  const raio = (shot?.radius ?? 0.42) * chargeScale(carga);

  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // Núcleo: uma esfera esticada no eixo de voo (+Z no referencial do
  // servidor). O alongamento é o que separa a agulha do laser da bola
  // de plasma antes mesmo de a cor ser percebida.
  const coreGeo = new THREE.SphereGeometry(raio, 10, 8);
  coreGeo.scale(1, 1, fam.alongamento);
  disposables.push(coreGeo);

  const cor = new THREE.Color(fam.frio).lerp(new THREE.Color(fam.quente), carga);
  const coreMat = new THREE.MeshBasicMaterial({ color: cor, fog: false });
  disposables.push(coreMat);
  group.add(new THREE.Mesh(coreGeo, coreMat));

  // Halo: só aparece com carga. É o sinal mais direto de "este tiro
  // está carregado" — cresce junto com o perigo.
  if (carga > 0.05) {
    const haloGeo = new THREE.SphereGeometry(raio * (1.5 + 0.9 * carga), 10, 8);
    haloGeo.scale(1, 1, fam.alongamento * 0.8);
    disposables.push(haloGeo);
    const haloMat = new THREE.MeshBasicMaterial({
      color: fam.quente,
      transparent: true,
      opacity: 0.12 + 0.3 * carga,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    disposables.push(haloMat);
    group.add(new THREE.Mesh(haloGeo, haloMat));
  }

  // Cauda: atrás do projétil, que viaja para +Z.
  const compr = raio * fam.caudaLonga * (1 + 0.6 * carga);
  const trailGeo = new THREE.CylinderGeometry(raio * 0.42, raio * 0.04, compr, 6);
  trailGeo.rotateX(Math.PI / 2);
  disposables.push(trailGeo);
  const trailMat = new THREE.MeshBasicMaterial({
    color: fam.cauda,
    transparent: true,
    opacity: 0.4 + 0.35 * carga,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  disposables.push(trailMat);
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.position.z = -compr / 2;
  group.add(trail);

  const light = new THREE.PointLight(cor, fam.luz * (1 + carga), 18 + 30 * carga);
  group.add(light);

  return {
    group,
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}
