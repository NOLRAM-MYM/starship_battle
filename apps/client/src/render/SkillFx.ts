/**
 * Animações das habilidades e dos consumíveis.
 *
 * Antes disto, ativar uma habilidade produzia exatamente ZERO efeito na
 * tela: `SkillActivated` só movia o cooldown do HUD, e nem isso para as
 * naves alheias. Não havia como saber que o inimigo tinha acabado de
 * usar um PEM, nem que o aliado estava se curando — informação que muda
 * a decisão de avançar ou recuar.
 *
 * Cada efeito é **ancorado numa nave** e a acompanha enquanto ela se
 * move. É por isso que o gatilho é `SkillActivated`, que carrega o
 * `entity_id`, e não uma mensagem `Vfx`, que levaria só um ponto fixo do
 * espaço — a nave sairia de dentro do próprio efeito.
 *
 * A regra de desenho é a mesma das peças e dos projéteis: distinguir
 * pela FORMA e pelo MOVIMENTO, não só pela cor, porque a cor sozinha se
 * perde contra o fundo e para quem enxerga cores de forma diferente.
 *
 *   - Dobra   — cone de energia esticando para trás, "puxando" a nave.
 *   - PEM     — anéis achatados expandindo na horizontal, como um pulso.
 *   - Reparo  — cascas pulsando para DENTRO, sentido oposto ao PEM.
 *   - Cargas  — flash curto e único: acabou, não é um estado.
 */

import * as THREE from 'three/webgpu';

/** O que pode ser animado. */
export type SkillFxKind = 'Dash' | 'Emp' | 'Repair' | 'consumable-repair' | 'consumable-shield';

interface Efeito {
  kind: SkillFxKind;
  /** Segundos decorridos. */
  t: number;
  /** Duração total, em segundos. */
  duracao: number;
  group: THREE.Group;
  partes: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
  /** Nave à qual o efeito está preso. */
  alvo: THREE.Object3D;
}

export interface SkillFxHandle {
  /**
   * Inicia um efeito preso a `alvo`.
   *
   * Reativar a mesma habilidade reinicia o efeito em vez de empilhar
   * dois: dois PEMs sobrepostos só produzem brilho ilegível.
   */
  play(kind: SkillFxKind, alvo: THREE.Object3D): void;
  update(dt: number): void;
  clear(): void;
  dispose(): void;
  /** Efeitos ativos — para os testes. */
  activeCount(): number;
}

interface Perfil {
  duracao: number;
  cor: number;
  /** Quantas cascas concêntricas. */
  cascas: number;
  /** Raio final, em unidades. */
  raio: number;
  /** true = expande de dentro para fora; false = contrai. */
  expande: boolean;
  /** Achatamento no eixo Y. 1 = esfera, <1 = disco. */
  achatamento: number;
  /** Deslocamento ao longo do eixo da nave (+Z é a frente). */
  offsetZ: number;
}

/**
 * Perfis por efeito.
 *
 * As durações batem com as do servidor (`ActiveSkill::duration_secs`)
 * para o PEM e o Reparo: o efeito visual termina quando o efeito real
 * termina, senão o jogador confia numa paralisia que já acabou.
 */
const PERFIS: Record<SkillFxKind, Perfil> = {
  // Dobra: puxa para trás, alongado, sem achatamento.
  Dash: {
    duracao: 1.6,
    cor: 0x66d9ff,
    cascas: 3,
    raio: 7,
    expande: true,
    achatamento: 0.45,
    offsetZ: -3,
  },
  // PEM: disco horizontal expandindo — leitura de "onda no plano".
  Emp: {
    duracao: 3.0,
    cor: 0xb06bff,
    cascas: 4,
    raio: 26,
    expande: true,
    achatamento: 0.12,
    offsetZ: 0,
  },
  // Reparo: contrai para dentro. O sentido invertido é o que separa
  // "estou curando" de "acabei de pulsar" sem depender da cor.
  Repair: {
    duracao: 5.0,
    cor: 0x45e5a4,
    cascas: 3,
    raio: 6,
    expande: false,
    achatamento: 0.85,
    offsetZ: 0,
  },
  // Consumíveis: flash curto. São instantâneos, e um efeito longo
  // sugeriria um estado que não existe.
  'consumable-repair': {
    duracao: 0.7,
    cor: 0x8dffc4,
    cascas: 2,
    raio: 5,
    expande: false,
    achatamento: 0.9,
    offsetZ: 0,
  },
  'consumable-shield': {
    duracao: 0.7,
    cor: 0x6fd6ff,
    cascas: 2,
    raio: 5.5,
    expande: true,
    achatamento: 0.95,
    offsetZ: 0,
  },
};

export function skillFxProfile(kind: SkillFxKind): Perfil {
  return PERFIS[kind];
}

/**
 * Não recebe a cena de propósito: cada efeito é anexado à NAVE, para
 * acompanhá-la enquanto ela se move. Um efeito preso à cena ficaria
 * parado no ponto onde a habilidade foi acionada.
 */
export function createSkillFx(): SkillFxHandle {
  const ativos: Efeito[] = [];
  // Geometria compartilhada: uma esfera unitária, escalada por efeito.
  const geo = new THREE.SphereGeometry(1, 16, 10);

  function criar(kind: SkillFxKind, alvo: THREE.Object3D): Efeito {
    const p = PERFIS[kind];
    const group = new THREE.Group();
    // Material próprio por efeito: a opacidade varia com o tempo.
    const mat = new THREE.MeshBasicMaterial({
      color: p.cor,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      wireframe: true,
      fog: false,
    });
    const partes: THREE.Mesh[] = [];
    for (let i = 0; i < p.cascas; i++) {
      const m = new THREE.Mesh(geo, mat);
      group.add(m);
      partes.push(m);
    }
    group.position.z = p.offsetZ;
    return { kind, t: 0, duracao: p.duracao, group, partes, mat, alvo };
  }

  return {
    play(kind, alvo): void {
      // Reativar reinicia em vez de empilhar: dois efeitos iguais
      // sobrepostos viram só brilho ilegível.
      const existente = ativos.find((e) => e.kind === kind && e.alvo === alvo);
      if (existente) {
        existente.t = 0;
        return;
      }
      const e = criar(kind, alvo);
      alvo.add(e.group);
      ativos.push(e);
    },

    update(dt): void {
      for (let i = ativos.length - 1; i >= 0; i--) {
        const e = ativos[i]!;
        e.t += dt;
        const k = Math.min(1, e.t / e.duracao);

        if (k >= 1) {
          e.group.removeFromParent();
          e.mat.dispose();
          ativos.splice(i, 1);
          continue;
        }

        const p = PERFIS[e.kind];
        // Some no fim, com uma entrada rápida para não "piscar" ligado.
        const entrada = Math.min(1, e.t / 0.12);
        e.mat.opacity = entrada * (1 - k) * 0.6;

        e.partes.forEach((m, idx) => {
          // As cascas ficam defasadas: produz a sensação de pulso
          // repetido em vez de uma bolha só inflando.
          const fase = (k + idx / p.cascas) % 1;
          const r = p.expande ? fase : 1 - fase;
          m.scale.set(r * p.raio, r * p.raio * p.achatamento, r * p.raio);
        });
      }
    },

    clear(): void {
      for (const e of ativos) {
        e.group.removeFromParent();
        e.mat.dispose();
      }
      ativos.length = 0;
    },

    dispose(): void {
      this.clear();
      geo.dispose();
    },

    activeCount(): number {
      return ativos.length;
    },
  };
}
