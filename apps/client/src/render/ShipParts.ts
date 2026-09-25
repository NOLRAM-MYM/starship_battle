/**
 * Peças visuais por equipamento.
 *
 * Até aqui a nave só mudava de silhueta pela CONTAGEM de motores e armas
 * e pelo tier médio: um Canhão Linear e uma Lança Singular produziam
 * exatamente o mesmo cilindro. Quem gastava 9.800 numa arma lendária não
 * via diferença nenhuma na própria nave.
 *
 * Aqui cada `templateId` do catálogo vira uma peça com forma, tamanho e
 * cor próprios. A regra é que a peça seja reconhecível **de longe, pela
 * silhueta** — não por um detalhe que só aparece com zoom.
 *
 * As peças são montadas no referencial de desenho da nave (nariz em -Z);
 * `ShipMesh` gira o conjunto para +Z no final.
 */

import * as THREE from 'three/webgpu';
import type { SlotKindName } from '../ui/componentLibrary';

/** Onde a peça é montada no casco. */
export type MountPoint = 'weapon' | 'engine' | 'dorsal' | 'ventral' | 'wingtip';

export interface PartVisual {
  /** Ponto de montagem — decide a posição no casco. */
  mount: MountPoint;
  /** Constrói a geometria da peça, centrada na origem. */
  build(scale: number): THREE.BufferGeometry;
  /** Cor da peça. */
  color: number;
  /** Cor emissiva (0 = sem brilho). */
  emissive?: number;
  /** Intensidade do brilho, 0..1. */
  glow?: number;
  /** Metalicidade do material. */
  metalness?: number;
  /** Rugosidade do material. */
  roughness?: number;
}

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mergeCompound(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geometries.map((g) => {
    const ni = g.index ? g.toNonIndexed() : g;
    if (!ni.getAttribute('normal')) ni.computeVertexNormals();
    return ni;
  });
  const merged = mergeGeometries(nonIndexed, false);
  return merged ?? geometries[0] ?? new THREE.BufferGeometry();
}

/**
 * Catálogo visual. As chaves batem com `componentLibrary.ts` e com o
 * catálogo de armas do servidor — se um id sumir de um lado, a peça
 * simplesmente não aparece, sem quebrar a nave.
 */
const VISUALS: Record<string, PartVisual> = {
  // ---------------------------------------------------------- Armas
  // Canhão linear: trilhos magnéticos paralelos com receptor e freio de boca.
  railgun_s: {
    mount: 'weapon',
    color: 0x9aa0a6,
    metalness: 0.95,
    roughness: 0.2,
    build: (s) => {
      const breech = new THREE.BoxGeometry(0.16 * s, 0.16 * s, 0.45 * s);
      breech.translate(0, 0, 0.35 * s);
      const railUpper = new THREE.BoxGeometry(0.04 * s, 0.03 * s, 1.25 * s);
      railUpper.translate(0, 0.05 * s, -0.25 * s);
      const railLower = new THREE.BoxGeometry(0.04 * s, 0.03 * s, 1.25 * s);
      railLower.translate(0, -0.05 * s, -0.25 * s);
      const shroud = new THREE.BoxGeometry(0.12 * s, 0.12 * s, 0.3 * s);
      shroud.translate(0, 0, 0.05 * s);
      return mergeCompound([breech, railUpper, railLower, shroud]);
    },
  },

  // Laser em rajada: conjunto rotativo de 3 canos emissores com dissipadores.
  laser_burst: {
    mount: 'weapon',
    color: 0x2a3f5c,
    emissive: 0x45e5a4,
    glow: 0.85,
    metalness: 0.3,
    roughness: 0.1,
    build: (s) => {
      const housing = new THREE.CylinderGeometry(0.12 * s, 0.14 * s, 0.35 * s, 6);
      housing.rotateX(Math.PI / 2);
      housing.translate(0, 0, 0.15 * s);
      const barrel1 = new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.65 * s, 6);
      barrel1.rotateX(Math.PI / 2);
      barrel1.translate(0, 0.06 * s, -0.15 * s);
      const barrel2 = new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.65 * s, 6);
      barrel2.rotateX(Math.PI / 2);
      barrel2.translate(-0.05 * s, -0.04 * s, -0.15 * s);
      const barrel3 = new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.65 * s, 6);
      barrel3.rotateX(Math.PI / 2);
      barrel3.translate(0.05 * s, -0.04 * s, -0.15 * s);
      return mergeCompound([housing, barrel1, barrel2, barrel3]);
    },
  },

  // Plasma: câmara de contenção toroidal com bocal magnético dilatado.
  plasma_m: {
    mount: 'weapon',
    color: 0x3a2a52,
    emissive: 0xb06bff,
    glow: 0.7,
    metalness: 0.6,
    roughness: 0.3,
    build: (s) => {
      const camara = new THREE.CapsuleGeometry(0.18 * s, 0.5 * s, 6, 8);
      camara.rotateX(Math.PI / 2);
      const ring = new THREE.TorusGeometry(0.24 * s, 0.04 * s, 6, 12);
      ring.translate(0, 0, 0);
      const muzzle = new THREE.CylinderGeometry(0.14 * s, 0.09 * s, 0.25 * s, 8);
      muzzle.rotateX(Math.PI / 2);
      muzzle.translate(0, 0, -0.4 * s);
      return mergeCompound([camara, ring, muzzle]);
    },
  },

  // Lança singular: canhão espinhal pesado com colares aceleradores.
  lance_singular: {
    mount: 'weapon',
    color: 0x4a3410,
    emissive: 0xffb347,
    glow: 1,
    metalness: 0.9,
    roughness: 0.15,
    build: (s) => {
      const barrel = new THREE.CylinderGeometry(0.11 * s, 0.19 * s, 2.7 * s, 8);
      barrel.rotateX(Math.PI / 2);
      const breech = new THREE.BoxGeometry(0.38 * s, 0.34 * s, 0.7 * s);
      breech.translate(0, 0, 0.85 * s);
      const ring1 = new THREE.TorusGeometry(0.22 * s, 0.035 * s, 6, 12);
      ring1.translate(0, 0, -0.6 * s);
      const ring2 = new THREE.TorusGeometry(0.24 * s, 0.035 * s, 6, 12);
      ring2.translate(0, 0, 0.1 * s);
      return mergeCompound([barrel, breech, ring1, ring2]);
    },
  },

  // ------------------------------------------------------- Torpedos
  // Tubos duplos de lançamento em casulo aerodinâmico.
  torpedo_seeker: {
    mount: 'weapon',
    color: 0x6b6f78,
    emissive: 0xff5f6d,
    glow: 0.45,
    metalness: 0.8,
    roughness: 0.4,
    build: (s) => {
      const pod = new THREE.BoxGeometry(0.38 * s, 0.22 * s, 1.05 * s);
      const nose = new THREE.ConeGeometry(0.18 * s, 0.25 * s, 4);
      nose.rotateX(-Math.PI / 2);
      nose.rotateZ(Math.PI / 4);
      nose.translate(0, 0, -0.65 * s);
      const tubeL = new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.2 * s, 6);
      tubeL.rotateX(Math.PI / 2);
      tubeL.translate(-0.1 * s, 0, -0.55 * s);
      const tubeR = new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.2 * s, 6);
      tubeR.rotateX(Math.PI / 2);
      tubeR.translate(0.1 * s, 0, -0.55 * s);
      return mergeCompound([pod, nose, tubeL, tubeR]);
    },
  },

  // Casulo quádruplo blindado de torpedos pesados.
  torpedo_heavy: {
    mount: 'weapon',
    color: 0x55585f,
    emissive: 0xff8a3c,
    glow: 0.6,
    metalness: 0.85,
    roughness: 0.35,
    build: (s) => {
      const pod = new THREE.BoxGeometry(0.48 * s, 0.38 * s, 1.55 * s);
      const rack = new THREE.BoxGeometry(0.54 * s, 0.12 * s, 0.6 * s);
      rack.translate(0, 0.15 * s, 0);
      return mergeCompound([pod, rack]);
    },
  },

  // -------------------------------------------------------- Motores
  engine_mk1: {
    mount: 'engine',
    color: 0x2b3444,
    emissive: 0x4ec9ff,
    glow: 0.5,
    build: (s) => {
      const body = new THREE.CylinderGeometry(0.18 * s, 0.23 * s, 0.65 * s, 8);
      body.rotateX(Math.PI / 2);
      const nozzle = new THREE.CylinderGeometry(0.24 * s, 0.21 * s, 0.2 * s, 8);
      nozzle.rotateX(Math.PI / 2);
      nozzle.translate(0, 0, 0.4 * s);
      return mergeCompound([body, nozzle]);
    },
  },

  // MK-III: nacela de dois estágios com anel de resfriamento.
  engine_mk3: {
    mount: 'engine',
    color: 0x2b3444,
    emissive: 0x66d9ff,
    glow: 0.75,
    build: (s) => {
      const body = new THREE.CylinderGeometry(0.28 * s, 0.35 * s, 0.95 * s, 8);
      body.rotateX(Math.PI / 2);
      const ring = new THREE.TorusGeometry(0.36 * s, 0.04 * s, 6, 12);
      ring.translate(0, 0, 0.1 * s);
      return mergeCompound([body, ring]);
    },
  },

  // Iônico: coluna aceleradora linear com cone magnético aberto.
  engine_ion: {
    mount: 'engine',
    color: 0x1e2c3a,
    emissive: 0x9d7bff,
    glow: 0.9,
    build: (s) => {
      const column = new THREE.CylinderGeometry(0.18 * s, 0.22 * s, 0.8 * s, 8);
      column.rotateX(Math.PI / 2);
      const cone = new THREE.ConeGeometry(0.28 * s, 0.45 * s, 8, 1, true);
      cone.rotateX(Math.PI / 2);
      cone.translate(0, 0, 0.55 * s);
      return mergeCompound([column, cone]);
    },
  },

  // Núcleo do Vazio: toro gravitacional com núcleo de singularidade.
  engine_void: {
    mount: 'engine',
    color: 0x14101e,
    emissive: 0xff5f6d,
    glow: 1,
    build: (s) => {
      const ring1 = new THREE.TorusGeometry(0.32 * s, 0.06 * s, 6, 16);
      const ring2 = new THREE.TorusGeometry(0.22 * s, 0.05 * s, 6, 12);
      ring2.rotateY(Math.PI / 2);
      const core = new THREE.SphereGeometry(0.12 * s, 8, 8);
      return mergeCompound([ring1, ring2, core]);
    },
  },

  // ---------------------------------------------------------- Dobra
  // Bobina de dobra: anéis de indução de campo subespacial.
  warp_coil: {
    mount: 'engine',
    color: 0x1a2a3e,
    emissive: 0x66d9ff,
    glow: 1,
    build: (s) => {
      const ringF = new THREE.TorusGeometry(0.36 * s, 0.06 * s, 6, 16);
      ringF.translate(0, 0, -0.15 * s);
      const ringB = new THREE.TorusGeometry(0.36 * s, 0.06 * s, 6, 16);
      ringB.translate(0, 0, 0.15 * s);
      const bar = new THREE.BoxGeometry(0.1 * s, 0.1 * s, 0.4 * s);
      return mergeCompound([ringF, ringB, bar]);
    },
  },

  // Captador: antena em espiral quântica.
  vortex_tap: {
    mount: 'dorsal',
    color: 0xb8c4d4,
    emissive: 0xb06bff,
    glow: 0.7,
    build: (s) => {
      const base = new THREE.CylinderGeometry(0.15 * s, 0.2 * s, 0.1 * s, 6);
      const knot = new THREE.TorusKnotGeometry(0.2 * s, 0.04 * s, 36, 6);
      knot.translate(0, 0.15 * s, 0);
      return mergeCompound([base, knot]);
    },
  },

  // Estabilizador: aletas de esteira sob a barriga.
  wake_stabilizer: {
    mount: 'ventral',
    color: 0x2e3a4c,
    emissive: 0x45e5a4,
    glow: 0.5,
    build: (s) => {
      const fin = new THREE.BoxGeometry(0.08 * s, 0.6 * s, 0.8 * s);
      fin.translate(0, -0.25 * s, 0);
      const bulb = new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.85 * s, 6);
      bulb.rotateX(Math.PI / 2);
      bulb.translate(0, -0.55 * s, 0);
      return mergeCompound([fin, bulb]);
    },
  },

  // -------------------------------------------------------- Escudos
  // Emissor dorsal bio-plásmico com anel de contenção.
  shield_bio: {
    mount: 'dorsal',
    color: 0x1c3a34,
    emissive: 0x45e5a4,
    glow: 0.55,
    build: (s) => {
      const dome = new THREE.SphereGeometry(0.3 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const baseRing = new THREE.TorusGeometry(0.32 * s, 0.04 * s, 6, 12);
      baseRing.rotateX(Math.PI / 2);
      return mergeCompound([dome, baseRing]);
    },
  },

  // Defletor de fase: anel de deflexão com raios de sustentação.
  shield_phase: {
    mount: 'dorsal',
    color: 0x16304a,
    emissive: 0x4ec9ff,
    glow: 0.9,
    build: (s) => {
      const ring = new THREE.TorusGeometry(0.38 * s, 0.04 * s, 6, 16);
      ring.rotateX(Math.PI / 2);
      const spoke1 = new THREE.BoxGeometry(0.72 * s, 0.04 * s, 0.04 * s);
      const spoke2 = new THREE.BoxGeometry(0.04 * s, 0.04 * s, 0.72 * s);
      return mergeCompound([ring, spoke1, spoke2]);
    },
  },

  // Baluarte: blocos escalonados de blindagem reativa pesada.
  shield_bulwark: {
    mount: 'dorsal',
    color: 0x4a4438,
    metalness: 0.85,
    roughness: 0.6,
    build: (s) => {
      const lowerPlate = new THREE.BoxGeometry(0.75 * s, 0.15 * s, 1.0 * s);
      const upperPlate = new THREE.BoxGeometry(0.55 * s, 0.12 * s, 0.75 * s);
      upperPlate.translate(0, 0.12 * s, 0);
      return mergeCompound([lowerPlate, upperPlate]);
    },
  },

  // ------------------------------------------------------- Sensores
  // Array de sensores: mastro telescópico com barras dipolo cruzadas.
  sensor_array: {
    mount: 'dorsal',
    color: 0x9aa4b2,
    emissive: 0x4ec9ff,
    glow: 0.3,
    build: (s) => {
      const mast = new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 0.85 * s, 6);
      const bar1 = new THREE.BoxGeometry(0.35 * s, 0.02 * s, 0.04 * s);
      bar1.translate(0, 0.25 * s, 0);
      const bar2 = new THREE.BoxGeometry(0.22 * s, 0.02 * s, 0.04 * s);
      bar2.translate(0, 0.38 * s, 0);
      return mergeCompound([mast, bar1, bar2]);
    },
  },

  // Varredura profunda: prato parabólico orientável com haste receptora.
  sensor_deep: {
    mount: 'dorsal',
    color: 0xc8d2e0,
    emissive: 0x4ec9ff,
    glow: 0.2,
    metalness: 0.4,
    roughness: 0.5,
    build: (s) => {
      const dish = new THREE.SphereGeometry(0.38 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
      dish.rotateX(-Math.PI / 2.2);
      const pivot = new THREE.CylinderGeometry(0.08 * s, 0.12 * s, 0.15 * s, 6);
      pivot.translate(0, -0.15 * s, 0);
      const feed = new THREE.CylinderGeometry(0.02 * s, 0.03 * s, 0.25 * s, 4);
      feed.translate(0, 0.1 * s, -0.2 * s);
      return mergeCompound([dish, pivot, feed]);
    },
  },

  // ---------------------------------------------------------- Carga
  // Módulo de carga estanque com nervuras de reforço.
  cargo_x2: {
    mount: 'ventral',
    color: 0x5c5142,
    metalness: 0.5,
    roughness: 0.75,
    build: (s) => {
      const pod = new THREE.BoxGeometry(0.48 * s, 0.32 * s, 0.85 * s);
      const ribs = new THREE.BoxGeometry(0.52 * s, 0.34 * s, 0.25 * s);
      return mergeCompound([pod, ribs]);
    },
  },

  // Porão industrial: duplo contêiner reforçado para frete pesado.
  cargo_hauler: {
    mount: 'ventral',
    color: 0x6b5a3c,
    metalness: 0.45,
    roughness: 0.8,
    build: (s) => {
      const podL = new THREE.BoxGeometry(0.35 * s, 0.35 * s, 1.4 * s);
      podL.translate(-0.2 * s, 0, 0);
      const podR = new THREE.BoxGeometry(0.35 * s, 0.35 * s, 1.4 * s);
      podR.translate(0.2 * s, 0, 0);
      const spine = new THREE.BoxGeometry(0.2 * s, 0.15 * s, 1.5 * s);
      spine.translate(0, 0.18 * s, 0);
      return mergeCompound([podL, podR, spine]);
    },
  },

  // ----------------------------------------------------- Furtividade
  // Painel facetado defletor de radar.
  cloak_lvl1: {
    mount: 'wingtip',
    color: 0x2a2438,
    metalness: 0.2,
    roughness: 0.95,
    build: (s) => {
      const baffle = new THREE.ConeGeometry(0.2 * s, 0.4 * s, 4);
      baffle.rotateX(Math.PI / 2);
      return baffle;
    },
  },

  // Manto Umbra: defletores escalonados de absorção quântica.
  cloak_umbra: {
    mount: 'wingtip',
    color: 0x0b0a12,
    emissive: 0x7a4eff,
    glow: 0.25,
    metalness: 0.05,
    roughness: 1,
    build: (s) => {
      const outer = new THREE.OctahedronGeometry(0.32 * s, 0);
      const inner = new THREE.BoxGeometry(0.15 * s, 0.15 * s, 0.45 * s);
      return mergeCompound([outer, inner]);
    },
  },
};

export function partVisual(templateId: string): PartVisual | undefined {
  return VISUALS[templateId];
}

/** Todos os ids com peça visual — usado pelos testes de cobertura. */
export function visualIds(): string[] {
  return Object.keys(VISUALS);
}

/**
 * Posições de montagem no referencial de desenho (nariz em -Z).
 *
 * `index` distribui várias peças do mesmo tipo simetricamente.
 */
export function mountTransform(
  mount: MountPoint,
  index: number,
  total: number,
  dims: { len: number; wid: number; hei: number },
): { pos: [number, number, number]; rot: [number, number, number] } {
  const { len, wid, hei } = dims;
  // Espalha simetricamente: -1, +1 para dois; 0 para um só.
  const spread = total <= 1 ? 0 : (index / (total - 1)) * 2 - 1;

  switch (mount) {
    case 'weapon':
      // Sob as asas, projetadas à frente.
      return { pos: [spread * wid * 0.6, -hei * 0.18, -len * 0.3], rot: [0, 0, 0] };
    case 'engine':
      // Atrás, na linha das nacelas.
      return { pos: [spread * wid * 0.45, -hei * 0.06, len * 0.42], rot: [0, 0, 0] };
    case 'dorsal':
      // Sobre o dorso, escalonadas ao longo do casco.
      return { pos: [0, hei * 0.42, -len * 0.05 + index * len * 0.16], rot: [0, 0, 0] };
    case 'ventral':
      // Sob a barriga.
      return { pos: [0, -hei * 0.42, index * len * 0.12], rot: [0, 0, 0] };
    case 'wingtip':
      // Nas pontas das asas.
      return { pos: [spread * wid * 0.85, 0, len * 0.06], rot: [0, 0, spread * 0.3] };
  }
}

/**
 * Tamanho máximo de uma peça, como fração do comprimento do casco.
 *
 * Sem este teto a nave deixava de ser uma nave: as peças eram escaladas
 * pela ALTURA do casco (`hei * 2.2`), e num cruzador — casco baixo e
 * comprido — o contêiner de carga saía com 7.1 de comprimento contra um
 * casco de 7.6. O que aparecia na tela era uma caixa marrom com um toro
 * rosa em volta, sem fuselagem visível.
 *
 * O teto é por ponto de montagem porque a tolerância é diferente: um
 * canhão pode e deve avançar além do nariz, uma nacela não.
 */
const CAP_POR_MONTAGEM: Record<MountPoint, number> = {
  weapon: 0.42,
  engine: 0.22,
  dorsal: 0.3,
  ventral: 0.28,
  wingtip: 0.16,
};

/**
 * Escala base das peças, a partir do comprimento do casco.
 *
 * Ancorada no COMPRIMENTO, não na altura: o comprimento é o que varia
 * pouco entre os chassis (6.2 a 7.6), então as peças ficam com o mesmo
 * tamanho aparente em qualquer nave, em vez de dobrarem de tamanho num
 * cargueiro só porque ele é mais alto.
 */
export function partBaseScale(len: number): number {
  return len * 0.16;
}

/** Maior dimensão permitida para uma peça neste ponto de montagem. */
export function partSizeCap(mount: MountPoint, len: number): number {
  return len * CAP_POR_MONTAGEM[mount];
}

/** Ponto de montagem padrão de uma família de slot, para peças sem visual. */
export function defaultMountFor(kind: SlotKindName): MountPoint {
  switch (kind) {
    case 'Weapon': return 'weapon';
    case 'Engine': return 'engine';
    case 'Shield': return 'dorsal';
    case 'Sensor': return 'dorsal';
    case 'Cargo': return 'ventral';
    case 'Stealth': return 'wingtip';
  }
}
