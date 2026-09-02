import * as THREE from 'three/webgpu';
import { densityFor, type RenderQuality } from './quality';

/**
 * Fundo espacial em camadas.
 *
 * Antes era um único `Points` de 8000 estrelas a 5000 unidades — sem
 * profundidade e sem cor. Agora são três camadas com paralaxe própria
 * mais um domo de nebulosa com gradiente vertical, tudo procedural.
 *
 * `createStarfield()` continua exportado com a mesma assinatura para
 * não quebrar chamadores existentes.
 */

/** Gerador determinístico (LCG) — mesmo céu em todas as sessões. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffff_ffff;
  };
}

function createStarLayer(count: number, radius: number, size: number, seed: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = makeRng(seed);

  for (let i = 0; i < count; i++) {
    const theta = 2 * Math.PI * rand();
    const phi = Math.acos(2 * rand() - 1);
    const r = radius * (0.7 + 0.3 * rand());

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    // Achata levemente no eixo Y para sugerir um disco galáctico.
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.42;
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Classe espectral: azul quente -> branco -> âmbar frio.
    const t = rand();
    const warm = t * t; // enviesa para estrelas brancas/azuis
    colors[i * 3] = 0.62 + warm * 0.38;
    colors[i * 3 + 1] = 0.7 + (1 - Math.abs(t - 0.5)) * 0.3;
    colors[i * 3 + 2] = 1 - warm * 0.35;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size,
    vertexColors: true,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // Céu NÃO recebe névoa. `PointsMaterial` tem `fog: true` por padrão
    // e a névoa exponencial da cena apagava 100% das estrelas: a
    // densidade 0.0016 a 5.000 unidades dá exp(-64), ou seja, preto.
    fog: false,
  });

  return new THREE.Points(geo, mat);
}

/**
 * Domo de nebulosa: esfera invertida com gradiente vertical por
 * cor de vértice. Dá cor ao "vazio" sem textura nem shader custom.
 */
function createNebulaDome(radius: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);

  const top = new THREE.Color(0x120a2e); // roxo profundo
  const mid = new THREE.Color(0x061020); // azul quase preto
  const bottom = new THREE.Color(0x1a0a1e); // magenta abafado

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius; // -1..1
    const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(bottom, -y);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  return new THREE.Mesh(geo, mat);
}

export interface SkyboxHandle {
  /** Raiz para adicionar à cena. */
  group: THREE.Group;
  /**
   * Avança a paralaxe e, se `cameraPos` for informado, reancora o céu
   * na câmera.
   *
   * Sem isso o céu ficava fixo na origem do mundo: voando alguns
   * milhares de unidades, o jogador saía "de dentro" da esfera de
   * estrelas e via todas amontoadas de um lado só.
   */
  update(dt: number, cameraPos?: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Céu completo: nebulosa + 3 camadas de estrelas com paralaxe.
 * `quality` controla a densidade (vide `densityFor`).
 */
export function createSkybox(quality: RenderQuality = 'high'): SkyboxHandle {
  const density = densityFor(quality);
  const group = new THREE.Group();
  group.name = 'skybox';

  const dome = createNebulaDome(9_000);
  group.add(dome);

  const far = createStarLayer(Math.round(5000 * density), 7_000, 1.1, 0x1234_5678);
  const mid = createStarLayer(Math.round(2500 * density), 4_500, 1.8, 0x9abc_def0);
  const near = createStarLayer(Math.round(900 * density), 2_600, 2.6, 0x0fed_cba9);
  group.add(far, mid, near);

  return {
    group,
    update(dt: number, cameraPos?: THREE.Vector3): void {
      // Camadas próximas giram mais rápido -> sensação de profundidade.
      far.rotation.y += dt * 0.004;
      mid.rotation.y += dt * 0.011;
      near.rotation.y += dt * 0.024;
      near.rotation.x += dt * 0.006;
      // O céu acompanha a câmera: ele é infinitamente distante, então
      // translação não deve produzir paralaxe (só a rotação produz).
      if (cameraPos) group.position.copy(cameraPos);
    },
    dispose(): void {
      for (const obj of [dome, far, mid, near]) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
    },
  };
}

/**
 * Compatibilidade: campo de estrelas único.
 * Prefira `createSkybox()` para a cena de jogo.
 */
export function createStarfield(count = 8000, radius = 5_000): THREE.Points {
  return createStarLayer(count, radius, 1.5, 0x1234_5678);
}
