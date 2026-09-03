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

/**
 * Catálogo visual. As chaves batem com `componentLibrary.ts` e com o
 * catálogo de armas do servidor — se um id sumir de um lado, a peça
 * simplesmente não aparece, sem quebrar a nave.
 */
const VISUALS: Record<string, PartVisual> = {
  // ---------------------------------------------------------- Armas
  // Canhão cinético: cano longo e fino, com freio de boca.
  railgun_s: {
    mount: 'weapon',
    color: 0x8a929e,
    metalness: 0.95,
    roughness: 0.25,
    build: (s) => {
      const cano = new THREE.CylinderGeometry(0.07 * s, 0.06 * s, 1.5 * s, 8);
      cano.rotateX(Math.PI / 2);
      return cano;
    },
  },

  // Laser: emissor curto e prismático, quase todo brilho.
  laser_burst: {
    mount: 'weapon',
    color: 0x2a3f5c,
    emissive: 0x45e5a4,
    glow: 0.85,
    metalness: 0.3,
    roughness: 0.1,
    build: (s) => {
      const emissor = new THREE.CylinderGeometry(0.13 * s, 0.05 * s, 0.75 * s, 6);
      emissor.rotateX(Math.PI / 2);
      return emissor;
    },
  },

  // Plasma: câmara bojuda com bocal largo — pesado e evidente.
  plasma_m: {
    mount: 'weapon',
    color: 0x3a2a52,
    emissive: 0xb06bff,
    glow: 0.7,
    metalness: 0.6,
    roughness: 0.3,
    build: (s) => {
      const camara = new THREE.CapsuleGeometry(0.2 * s, 0.7 * s, 6, 10);
      camara.rotateX(Math.PI / 2);
      return camara;
    },
  },

  // Lança singular: cano enorme com acelerador anelado. Domina a asa.
  lance_singular: {
    mount: 'weapon',
    color: 0x4a3410,
    emissive: 0xffb347,
    glow: 1,
    metalness: 0.9,
    roughness: 0.15,
    build: (s) => {
      const cano = new THREE.CylinderGeometry(0.1 * s, 0.22 * s, 2.6 * s, 10);
      cano.rotateX(Math.PI / 2);
      return cano;
    },
  },

  // ------------------------------------------------------- Torpedos
  // Tubos de lançamento sob a asa: silhueta grossa e curta, bem
  // diferente do cano fino de um canhão.
  torpedo_seeker: {
    mount: 'weapon',
    color: 0x6b6f78,
    emissive: 0xff5f6d,
    glow: 0.45,
    metalness: 0.8,
    roughness: 0.4,
    build: (s) => {
      const tubo = new THREE.CylinderGeometry(0.22 * s, 0.22 * s, 1.1 * s, 8);
      tubo.rotateX(Math.PI / 2);
      return tubo;
    },
  },
  torpedo_heavy: {
    mount: 'weapon',
    color: 0x55585f,
    emissive: 0xff8a3c,
    glow: 0.6,
    metalness: 0.85,
    roughness: 0.35,
    build: (s) => {
      const tubo = new THREE.CylinderGeometry(0.34 * s, 0.34 * s, 1.7 * s, 10);
      tubo.rotateX(Math.PI / 2);
      return tubo;
    },
  },

  // -------------------------------------------------------- Motores
  engine_mk1: {
    mount: 'engine',
    color: 0x2b3444,
    emissive: 0x4ec9ff,
    glow: 0.5,
    build: (s) => {
      const g = new THREE.CylinderGeometry(0.2 * s, 0.24 * s, 0.7 * s, 8);
      g.rotateX(Math.PI / 2);
      return g;
    },
  },

  // MK-III: nacela maior com anel de resfriamento.
  engine_mk3: {
    mount: 'engine',
    color: 0x2b3444,
    emissive: 0x66d9ff,
    glow: 0.75,
    build: (s) => {
      const g = new THREE.CylinderGeometry(0.3 * s, 0.36 * s, 1.0 * s, 10);
      g.rotateX(Math.PI / 2);
      return g;
    },
  },

  // Iônico: bocal cônico aberto, fino e alongado.
  engine_ion: {
    mount: 'engine',
    color: 0x1e2c3a,
    emissive: 0x9d7bff,
    glow: 0.9,
    build: (s) => {
      const g = new THREE.ConeGeometry(0.28 * s, 1.2 * s, 10, 1, true);
      g.rotateX(Math.PI / 2);
      return g;
    },
  },

  // Núcleo do Vazio: toro pulsante — não parece um motor comum.
  engine_void: {
    mount: 'engine',
    color: 0x14101e,
    emissive: 0xff5f6d,
    glow: 1,
    build: (s) => new THREE.TorusGeometry(0.34 * s, 0.12 * s, 8, 16),
  },

  // ---------------------------------------------------------- Dobra
  // Bobina: anel duplo pulsante na traseira.
  warp_coil: {
    mount: 'engine',
    color: 0x1a2a3e,
    emissive: 0x66d9ff,
    glow: 1,
    build: (s) => new THREE.TorusGeometry(0.42 * s, 0.08 * s, 8, 20),
  },

  // Captador: antena em espiral no dorso — o "farejador" de rastro.
  vortex_tap: {
    mount: 'dorsal',
    color: 0xb8c4d4,
    emissive: 0xb06bff,
    glow: 0.7,
    build: (s) => new THREE.TorusKnotGeometry(0.24 * s, 0.05 * s, 48, 6),
  },

  // Estabilizador: aletas de esteira sob a barriga.
  wake_stabilizer: {
    mount: 'ventral',
    color: 0x2e3a4c,
    emissive: 0x45e5a4,
    glow: 0.5,
    build: (s) => new THREE.ConeGeometry(0.2 * s, 0.9 * s, 6, 1, true),
  },

  // -------------------------------------------------------- Escudos
  // Emissor dorsal: cúpula achatada sobre o casco.
  shield_bio: {
    mount: 'dorsal',
    color: 0x1c3a34,
    emissive: 0x45e5a4,
    glow: 0.55,
    build: (s) => new THREE.SphereGeometry(0.34 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  },

  // Defletor de fase: anel girando na horizontal.
  shield_phase: {
    mount: 'dorsal',
    color: 0x16304a,
    emissive: 0x4ec9ff,
    glow: 0.9,
    build: (s) => {
      const g = new THREE.TorusGeometry(0.42 * s, 0.05 * s, 6, 20);
      g.rotateX(Math.PI / 2);
      return g;
    },
  },

  // Baluarte: blocos de blindagem grossos, sem brilho.
  shield_bulwark: {
    mount: 'dorsal',
    color: 0x4a4438,
    metalness: 0.85,
    roughness: 0.6,
    build: (s) => new THREE.BoxGeometry(0.8 * s, 0.26 * s, 1.1 * s),
  },

  // ------------------------------------------------------- Sensores
  sensor_array: {
    mount: 'dorsal',
    color: 0x9aa4b2,
    emissive: 0x4ec9ff,
    glow: 0.3,
    build: (s) => {
      const g = new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.9 * s, 4);
      return g;
    },
  },

  // Varredura profunda: prato parabólico — inconfundível.
  sensor_deep: {
    mount: 'dorsal',
    color: 0xc8d2e0,
    emissive: 0x4ec9ff,
    glow: 0.2,
    metalness: 0.4,
    roughness: 0.5,
    build: (s) => {
      const g = new THREE.SphereGeometry(0.42 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6);
      g.rotateX(-Math.PI / 2.2);
      return g;
    },
  },

  // ---------------------------------------------------------- Carga
  cargo_x2: {
    mount: 'ventral',
    color: 0x5c5142,
    metalness: 0.5,
    roughness: 0.75,
    build: (s) => new THREE.BoxGeometry(0.5 * s, 0.34 * s, 0.9 * s),
  },

  // Porão industrial: contêiner enorme sob a barriga.
  cargo_hauler: {
    mount: 'ventral',
    color: 0x6b5a3c,
    metalness: 0.45,
    roughness: 0.8,
    build: (s) => new THREE.BoxGeometry(0.95 * s, 0.6 * s, 1.9 * s),
  },

  // ----------------------------------------------------- Furtividade
  // Camuflagem: painéis facetados nas pontas das asas.
  cloak_lvl1: {
    mount: 'wingtip',
    color: 0x2a2438,
    metalness: 0.2,
    roughness: 0.95,
    build: (s) => new THREE.OctahedronGeometry(0.24 * s, 0),
  },

  // Manto Umbra: painéis maiores e quase pretos, que "engolem" a luz.
  cloak_umbra: {
    mount: 'wingtip',
    color: 0x0b0a12,
    emissive: 0x7a4eff,
    glow: 0.25,
    metalness: 0.05,
    roughness: 1,
    build: (s) => new THREE.OctahedronGeometry(0.4 * s, 1),
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
