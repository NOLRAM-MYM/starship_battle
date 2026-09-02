/**
 * Pontos de referência do setor: sol, planetas, gigante gasoso com anéis,
 * cinturão de asteroides e chuvas de meteoros.
 *
 * Antes o espaço era literalmente vazio — só o campo de estrelas, que
 * gira junto com a câmera e por isso **não serve de referência**. Sem
 * nada fixo no mundo, o jogador não tinha como saber para onde estava
 * indo a não ser pelo radar.
 *
 * Estes marcos são grandes, ficam longe e são estáticos: servem de
 * bússola natural.
 *
 * Os CORPOS (estrela, planetas, luas) vêm do servidor pela mensagem
 * `Sector`. Antes eram gerados aqui a partir da seed, o que bastava
 * enquanto eram só cenário; agora eles têm MASSA e exercem gravidade na
 * simulação, então os dois lados precisam concordar sobre a posição de
 * cada um — e a fonte de verdade é o servidor.
 *
 * O cinturão de asteroides e os meteoros continuam decorativos e
 * gerados localmente a partir da mesma seed.
 */

import * as THREE from 'three/webgpu';

/** LCG determinístico — mesma família usada no worldgen do servidor. */
function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffff_ffff;
  };
}

/** Corpo celeste como o servidor o envia. */
export interface ServerBody {
  id: number;
  kind: 'Star' | 'Planet' | 'GasGiant' | 'Moon' | 'NeutronStar' | 'BlackHole';
  name: string;
  pos: [number, number, number];
  radius: number;
  /** Massa: usada pela previsão de trajetória, não pelo desenho. */
  mass: number;
  color: number;
  hasRings: boolean;
}

export interface Landmark {
  /** Id estável para o HUD referenciar. */
  id: string;
  /** Nome exibido na bússola / lista de navegação. */
  name: string;
  kind: 'star' | 'planet' | 'giant' | 'belt' | 'station' | 'exotic';
  /** Posição no mundo. */
  position: THREE.Vector3;
  /** Raio aproximado, para o HUD estimar distância útil. */
  radius: number;
  /** Cor do marcador no HUD. */
  color: number;
}

export interface LandmarksHandle {
  group: THREE.Group;
  /** Marcos para o HUD desenhar bússola e marcadores. */
  list: readonly Landmark[];
  /** Anima meteoros e rotação dos corpos. */
  update(dt: number, cameraPos: THREE.Vector3): void;
  dispose(): void;
}

/** Paleta de planetas — variada mas sempre legível contra o preto. */
const PLANET_COLORS = [0x8c5a3c, 0x3f6fa8, 0x6f8c5a, 0xa87f3f, 0x7a5aa8, 0x4f8c8c];

const PLANET_NAMES = [
  'Kepler', 'Vega', 'Ares', 'Thule', 'Nyx', 'Orpheus', 'Íris', 'Aurora',
  'Tellus', 'Perseu', 'Lyra', 'Cygnus',
];

/**
 * Planeta procedural: esfera com faixas horizontais de cor, geradas por
 * vértice. Sem textura, sem shader custom — a variação de matiz por
 * latitude já dá leitura de "corpo celeste" a longa distância.
 */
function createPlanet(radius: number, baseColor: number, rand: () => number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 24);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);

  const base = new THREE.Color(baseColor);
  const bandCount = 3 + Math.floor(rand() * 5);
  const bandStrength = 0.12 + rand() * 0.2;

  for (let i = 0; i < pos.count; i++) {
    const lat = pos.getY(i) / radius; // -1..1
    // Faixas: seno da latitude cria bandas horizontais como num gigante.
    const band = Math.sin(lat * Math.PI * bandCount) * bandStrength;
    // Polos levemente mais claros, como calotas.
    const polar = Math.abs(lat) ** 3 * 0.25;
    const c = base.clone().offsetHSL(0, -Math.abs(band) * 0.3, band + polar);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.02,
    // Marcos ficam a dezenas de milhares de unidades: a névoa da cena
    // os apagaria por completo.
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1; // desenha atrás de tudo que é jogável

  // Halo de atmosfera: casca levemente maior, vista de dentro, aditiva.
  // Dá a borda azulada que separa o planeta do preto do espaço — sem
  // ela o disco fica com recorte duro e "colado" no fundo.
  const atmGeo = new THREE.SphereGeometry(radius * 1.045, 32, 24);
  const atmMat = new THREE.MeshBasicMaterial({
    color: base.clone().offsetHSL(0, 0.15, 0.25),
    transparent: true,
    opacity: 0.16,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  mesh.add(new THREE.Mesh(atmGeo, atmMat));
  return mesh;
}

/** Anel de gigante gasoso: disco fino com opacidade radial. */
function createRing(inner: number, outer: number, color: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(inner, outer, 64, 1);
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    fog: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI / 2.3;
  return ring;
}

/**
 * Textura de brilho: gradiente radial desenhado num canvas.
 *
 * A primeira versão empilhava esferas translúcidas concêntricas para
 * simular o halo. Esferas têm cor CHAPADA, então o resultado eram discos
 * duros e sobrepostos — na tela parecia um anel marrom com recortes, não
 * um sol. Um gradiente real resolve com uma textura só.
 */
function glowTexture(): THREE.Texture {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Queda suave: branco no núcleo, transparente na borda.
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.05)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

/** Sol distante: esfera emissiva + halo em sprite (sempre de frente). */
function createStar(radius: number, color: number): THREE.Group {
  const g = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshBasicMaterial({ color, fog: false }),
  );
  g.add(core);

  // Sprite: sempre encara a câmera, então o brilho nunca mostra silhueta
  // de esfera nem se auto-intersecta.
  const tex = glowTexture();
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  halo.scale.setScalar(radius * 7);
  g.add(halo);

  // Luz real: o sol ilumina as naves de verdade.
  const light = new THREE.PointLight(color, 3.2, 0, 0);
  g.add(light);
  return g;
}

/** Cinturão de asteroides: anel de pontos, marco visual de longa distância. */
function createBelt(radius: number, count: number, rand: () => number): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = radius * (0.9 + rand() * 0.2);
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = (rand() - 0.5) * radius * 0.05;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x9a8f7d,
    size: 3,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    fog: false,
  });
  return new THREE.Points(geo, mat);
}

/**
 * Chuva de meteoros: riscos que cruzam o campo de visão perto do
 * jogador. É o único marco que se MOVE — dá sensação de mundo vivo sem
 * atrapalhar a navegação.
 */
interface MeteorField {
  points: THREE.Points;
  positions: Float32Array;
  velocities: Float32Array;
  count: number;
}

function createMeteors(count: number, spread: number, rand: () => number): MeteorField {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rand() - 0.5) * spread;
    positions[i * 3 + 1] = (rand() - 0.5) * spread * 0.4;
    positions[i * 3 + 2] = (rand() - 0.5) * spread;
    // Todos na mesma direção geral, como um enxame.
    const speed = 40 + rand() * 90;
    velocities[i * 3] = -speed * (0.6 + rand() * 0.4);
    velocities[i * 3 + 1] = (rand() - 0.5) * speed * 0.15;
    velocities[i * 3 + 2] = -speed * (0.2 + rand() * 0.3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffd9a8,
    size: 2.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, positions, velocities, count };
}

/**
 * Monta o setor. `seed` vem do `world_seed` do servidor — mesmo seed,
 * mesmo céu, em todos os clientes.
 */
export function createLandmarks(
  seed: number,
  quality: 'low' | 'med' | 'high' | 'ultra' = 'high',
  serverBodies: readonly ServerBody[] = [],
): LandmarksHandle {
  const rand = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'landmarks';
  const list: Landmark[] = [];
  const disposables: Array<{ dispose(): void }> = [];

  const track = (obj: THREE.Object3D): void => {
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        disposables.push(o.geometry);
      }
      // Sprites não têm geometria própria, mas têm material + textura.
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) {
        const m = o.material;
        const mats = Array.isArray(m) ? m : [m];
        for (const mm of mats) {
          disposables.push(mm);
          const map = (mm as THREE.SpriteMaterial).map;
          if (map) disposables.push(map);
        }
      }
    });
  };

  // ------------- Corpos vindos do servidor -------------
  // Se a lista chegar vazia (servidor antigo), o setor fica sem corpos
  // em vez de inventar posições que a simulação não conheceria.
  const planetMeshes: THREE.Object3D[] = [];
  for (const b of serverBodies) {
    const pos = new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]);

    if (b.kind === 'Star' || b.kind === 'NeutronStar') {
      // Estrela de nêutrons: núcleo pequeno e branco-azulado com halo
      // muito mais compacto — a leitura de "pequeno mas perigoso".
      const sun = createStar(b.radius, b.color);
      sun.position.copy(pos);
      group.add(sun);
      track(sun);
    } else if (b.kind === 'BlackHole') {
      // Disco de acreção brilhante em volta de um núcleo TOTALMENTE
      // preto: o buraco negro não emite luz, então a única forma de
      // enxergá-lo é pelo que ele deforma em volta.
      const nucleo = new THREE.Mesh(
        new THREE.SphereGeometry(b.radius, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }),
      );
      nucleo.position.copy(pos);
      group.add(nucleo);
      track(nucleo);

      const disco = createRing(b.radius * 2.2, b.radius * 5.5, 0xffa347);
      disco.position.copy(pos);
      group.add(disco);
      track(disco);
      planetMeshes.push(disco);
    } else {
      const planeta = createPlanet(b.radius, b.color, rand);
      planeta.position.copy(pos);
      group.add(planeta);
      track(planeta);
      planetMeshes.push(planeta);

      if (b.hasRings) {
        const ring = createRing(b.radius * 1.5, b.radius * 2.4, 0xd8c9a8);
        ring.position.copy(pos);
        group.add(ring);
        track(ring);
      }
    }

    list.push({
      id: `body_${b.id}`,
      name: b.hasRings ? `${b.name} (anelado)` : b.name,
      kind:
        b.kind === 'Star'
          ? 'star'
          : b.kind === 'GasGiant'
            ? 'giant'
            : b.kind === 'NeutronStar' || b.kind === 'BlackHole'
              ? 'exotic'
              : 'planet',
      position: pos,
      radius: b.radius,
      color: b.color,
    });
  }

  // ---------------- Cinturão de asteroides ----------------
  const beltRadius = 4200 + rand() * 1200;
  const belt = createBelt(beltRadius, quality === 'low' ? 800 : 2400, rand);
  belt.rotation.x = (rand() - 0.5) * 0.4;
  group.add(belt);
  track(belt);
  list.push({
    id: 'belt',
    name: 'Cinturão de Vesta',
    kind: 'belt',
    // O marcador aponta para a borda mais próxima, não para o centro
    // vazio do anel.
    position: new THREE.Vector3(beltRadius, 0, 0),
    radius: beltRadius,
    color: 0x9a8f7d,
  });

  // ---------------- Meteoros ----------------
  const meteors = quality === 'low' ? null : createMeteors(quality === 'ultra' ? 700 : 380, 3000, rand);
  if (meteors) {
    group.add(meteors.points);
    track(meteors.points);
  }

  // Rotações próprias, para os corpos não parecerem estáticos.
  // Guardamos as referências direto, em vez de indexar `group.children`
  // por posição — qualquer objeto novo antes deles quebraria o índice.
  const spins = planetMeshes.map((obj) => ({ obj, speed: 0.01 + rand() * 0.02 }));

  const meteorOrigin = new THREE.Vector3();

  return {
    group,
    list,

    update(dt: number, cameraPos: THREE.Vector3): void {
      for (const s of spins) {
        if (s.obj) s.obj.rotation.y += dt * s.speed;
      }

      if (!meteors) return;
      // Meteoros vivem NUM VOLUME AO REDOR DA CÂMERA: recicla quem sai
      // da caixa, para a chuva acompanhar o jogador sem precisar de
      // milhares de partículas cobrindo o setor inteiro.
      meteorOrigin.copy(cameraPos);
      const half = 1500;
      const p = meteors.positions;
      const v = meteors.velocities;
      for (let i = 0; i < meteors.count; i++) {
        const k = i * 3;
        p[k] = (p[k] ?? 0) + (v[k] ?? 0) * dt;
        p[k + 1] = (p[k + 1] ?? 0) + (v[k + 1] ?? 0) * dt;
        p[k + 2] = (p[k + 2] ?? 0) + (v[k + 2] ?? 0) * dt;

        // Reposiciona relativo à câmera quando escapa da caixa.
        if (Math.abs((p[k] ?? 0) - meteorOrigin.x) > half) {
          p[k] = meteorOrigin.x + half;
        }
        if (Math.abs((p[k + 2] ?? 0) - meteorOrigin.z) > half) {
          p[k + 2] = meteorOrigin.z + half;
        }
        if (Math.abs((p[k + 1] ?? 0) - meteorOrigin.y) > half * 0.4) {
          p[k + 1] = meteorOrigin.y + (Math.random() - 0.5) * half * 0.4;
        }
      }
      meteors.points.geometry.getAttribute('position').needsUpdate = true;
    },

    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}
