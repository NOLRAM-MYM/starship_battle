/**
 * VFX pooled — rastro de motor, disparo, impacto e explosão.
 *
 * Tudo vive num único `Points` com buffer pré-alocado: partículas são
 * recicladas em vez de alocadas por evento, então uma troca de tiros
 * intensa não gera pressão de GC no meio do frame.
 */

import * as THREE from 'three/webgpu';

export type VfxKind = 'thruster' | 'muzzle' | 'impact' | 'explosion';

interface Particle {
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

/** Perfil de cada tipo de efeito: contagem, velocidade, vida e cor. */
const PROFILE: Record<VfxKind, { count: number; speed: number; life: number; size: number; color: number }> = {
  thruster: { count: 2, speed: 6, life: 0.35, size: 1.6, color: 0x66d9ff },
  muzzle: { count: 8, speed: 26, life: 0.18, size: 2.2, color: 0xffd166 },
  impact: { count: 20, speed: 22, life: 0.5, size: 2.4, color: 0xff8a5c },
  // Explosão: muitas partículas, rápidas e grandes. É o evento mais
  // importante do combate — precisa dominar o quadro por um instante.
  explosion: { count: 90, speed: 46, life: 1.6, size: 5.0, color: 0xffb05f },
};

export interface VfxSystem {
  points: THREE.Points;
  /** Emite um efeito na posição dada; `dir` orienta thruster/muzzle. */
  emit(kind: VfxKind, at: THREE.Vector3, dir?: THREE.Vector3): void;
  update(dt: number): void;
  /** Partículas vivas — usado nos testes e no HUD de performance. */
  activeCount(): number;
  dispose(): void;
}

/**
 * Cria o sistema. `capacity` limita o total simultâneo; ao estourar,
 * as partículas mais antigas são recicladas (sem alocar).
 */
export function createVfxSystem(capacity = 1200): VfxSystem {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const particles: Particle[] = new Array(capacity);
  for (let i = 0; i < capacity; i++) {
    particles[i] = { life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 1 };
    sizes[i] = 0;
  }
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({
    size: 2.4,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'vfx';

  const tint = new THREE.Color();

  function spawn(
    kind: VfxKind,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
  ): void {
    const p = PROFILE[kind];
    const i = cursor;
    cursor = (cursor + 1) % capacity;

    const part = particles[i];
    if (!part) return;

    // Dispersão aleatória em torno da direção base.
    const jitter = kind === 'thruster' ? 0.25 : 1;
    const sx = dx + (Math.random() - 0.5) * jitter;
    const sy = dy + (Math.random() - 0.5) * jitter;
    const sz = dz + (Math.random() - 0.5) * jitter;
    const mag = Math.hypot(sx, sy, sz) || 1;
    const speed = p.speed * (0.6 + Math.random() * 0.6);

    part.vx = (sx / mag) * speed;
    part.vy = (sy / mag) * speed;
    part.vz = (sz / mag) * speed;
    part.maxLife = p.life * (0.7 + Math.random() * 0.6);
    part.life = part.maxLife;
    part.size = p.size;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    tint.setHex(p.color);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
    sizes[i] = p.size;
  }

  return {
    points,

    emit(kind, at, dir): void {
      const p = PROFILE[kind];
      const dx = dir?.x ?? 0;
      const dy = dir?.y ?? 0;
      const dz = dir?.z ?? 0;
      const omni = dx === 0 && dy === 0 && dz === 0;
      for (let n = 0; n < p.count; n++) {
        if (omni) {
          spawn(kind, at.x, at.y, at.z, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        } else {
          spawn(kind, at.x, at.y, at.z, dx, dy, dz);
        }
      }
    },

    update(dt): void {
      for (let i = 0; i < capacity; i++) {
        const part = particles[i];
        if (!part || part.life <= 0) continue;
        part.life -= dt;
        if (part.life <= 0) {
          sizes[i] = 0;
          continue;
        }
        const px = i * 3;
        positions[px] = (positions[px] ?? 0) + part.vx * dt;
        positions[px + 1] = (positions[px + 1] ?? 0) + part.vy * dt;
        positions[px + 2] = (positions[px + 2] ?? 0) + part.vz * dt;
        // Arrasto + encolhimento conforme a partícula morre.
        const k = part.life / part.maxLife;
        part.vx *= 0.94;
        part.vy *= 0.94;
        part.vz *= 0.94;
        sizes[i] = part.size * k;
        // Esfria para vermelho conforme a partícula apaga.
        colors[px + 1] = (colors[px + 1] ?? 0) * 0.985;
        colors[px + 2] = (colors[px + 2] ?? 0) * 0.97;
      }
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('color').needsUpdate = true;
      geo.getAttribute('size').needsUpdate = true;
    },

    activeCount(): number {
      let n = 0;
      for (let i = 0; i < capacity; i++) if ((particles[i]?.life ?? 0) > 0) n++;
      return n;
    },

    dispose(): void {
      geo.dispose();
      mat.dispose();
    },
  };
}
