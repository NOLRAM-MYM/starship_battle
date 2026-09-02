/**
 * Vórtices de dobra: anéis girando que impulsionam quem passa por dentro.
 *
 * Precisam ser lidos **de longe e de relance**, porque a decisão de
 * entrar num vórtice se toma em fração de segundo durante uma
 * perseguição. Por isso são anéis concêntricos brilhantes, orientados na
 * direção do impulso: dá para ver para onde eles empurram sem precisar
 * de rótulo.
 *
 * A intensidade decai com a idade do vórtice, então o brilho e a
 * opacidade acompanham — um rastro velho aparece apagado, sinalizando
 * que vale menos.
 */

import * as THREE from 'three/webgpu';

/** Um vórtice como o servidor o envia no snapshot. */
export interface VortexState {
  serverId: number;
  pos: [number, number, number];
  dir: [number, number, number];
  radius: number;
  /** 0..1 — potência restante. */
  strength: number;
}

interface Entry {
  group: THREE.Group;
  aneis: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
}

export interface VortexFieldHandle {
  group: THREE.Group;
  /** Sincroniza com o conjunto de vórtices do snapshot atual. */
  sync(vortices: readonly VortexState[], dt: number): void;
  clear(): void;
  dispose(): void;
}

/** Quantos anéis por vórtice — o suficiente para dar noção de "túnel". */
const ANEIS = 3;

export function createVortexField(): VortexFieldHandle {
  const group = new THREE.Group();
  group.name = 'vortex-field';
  const entries = new Map<number, Entry>();
  const disposables: Array<{ dispose(): void }> = [];

  // Geometria compartilhada: um anel unitário, escalado por vórtice.
  const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 32);
  disposables.push(ringGeo);

  const alvo = new THREE.Vector3();
  let tempo = 0;

  function criar(v: VortexState): Entry {
    const g = new THREE.Group();
    // Cada vórtice tem material próprio: a opacidade varia com a idade
    // dele, então não dá para compartilhar.
    const mat = new THREE.MeshBasicMaterial({
      color: 0x6fd6ff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const aneis: THREE.Mesh[] = [];
    for (let i = 0; i < ANEIS; i++) {
      const m = new THREE.Mesh(ringGeo, mat);
      // Escalonados ao longo do eixo do impulso: formam um túnel curto.
      m.position.z = (i - (ANEIS - 1) / 2) * 0.55;
      // Anéis internos menores dão a sensação de funil.
      const k = 1 - Math.abs(i - (ANEIS - 1) / 2) * 0.18;
      m.scale.setScalar(k);
      g.add(m);
      aneis.push(m);
    }
    return { group: g, aneis, mat };
  }

  return {
    group,

    sync(vortices, dt): void {
      tempo += dt;
      const vivos = new Set<number>();

      for (const v of vortices) {
        vivos.add(v.serverId);
        let e = entries.get(v.serverId);
        if (!e) {
          e = criar(v);
          group.add(e.group);
          entries.set(v.serverId, e);
        }

        e.group.position.set(v.pos[0], v.pos[1], v.pos[2]);
        // Orienta o túnel ao longo da direção do impulso: o eixo local
        // dos anéis é +Z, então basta olhar para o ponto à frente.
        alvo.set(v.pos[0] + v.dir[0], v.pos[1] + v.dir[1], v.pos[2] + v.dir[2]);
        e.group.lookAt(alvo);
        e.group.scale.setScalar(v.radius);

        // Brilho e opacidade caem com a potência restante.
        e.mat.opacity = 0.15 + 0.55 * v.strength;
        e.mat.color.setHSL(0.55, 1, 0.35 + 0.3 * v.strength);

        // Anéis giram em sentidos alternados: leitura de "turbilhão".
        e.aneis.forEach((m, i) => {
          m.rotation.z = tempo * (i % 2 === 0 ? 1.8 : -1.3) + i;
        });
      }

      for (const [id, e] of entries) {
        if (vivos.has(id)) continue;
        group.remove(e.group);
        e.mat.dispose();
        entries.delete(id);
      }
    },

    clear(): void {
      for (const e of entries.values()) {
        group.remove(e.group);
        e.mat.dispose();
      }
      entries.clear();
    },

    dispose(): void {
      this.clear();
      for (const d of disposables) d.dispose();
    },
  };
}
