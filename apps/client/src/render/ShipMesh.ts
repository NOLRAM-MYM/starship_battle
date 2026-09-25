/**
 * Geometria procedural de nave.
 *
 * Substitui o `BoxGeometry(2,1,4)` que representava toda nave do jogo.
 * A silhueta é montada a partir de um `ChassisSpec` — assim a nave que o
 * jogador constrói no shipyard é a mesma que aparece em combate, e o
 * arquétipo do NPC é legível à distância só pelo contorno.
 *
 * Tudo é gerado com primitivas do three (sem asset externo), então o
 * bundle não cresce e o carregamento continua instantâneo.
 */

import * as THREE from 'three/webgpu';
import { createNavLights, type NavLightsHandle } from './NavLights';
import {
  mountTransform,
  partBaseScale,
  partSizeCap,
  partVisual,
  type MountPoint,
} from './ShipParts';

/** Classe de casco — define proporção e número de asas/nacelas. */
export type ChassisKind = 'interceptor' | 'skirmisher' | 'cruiser' | 'hauler';

export interface ChassisSpec {
  kind: ChassisKind;
  /** Cor primária do casco. */
  hull: number;
  /** Cor de emissão dos motores / faixas. */
  glow: number;
  /** Escala global (1 = nave de jogador padrão). */
  scale?: number;
  /** Nº de nacelas de motor visíveis (0..4), derivado do loadout. */
  engines?: number;
  /** Nº de hardpoints de arma visíveis (0..4), derivado do loadout. */
  weapons?: number;
  /**
   * `templateId`s equipados, em ordem de slot.
   *
   * Cada um vira uma PEÇA VISÍVEL no casco, com forma e cor próprias.
   * Antes a nave só mudava pela contagem de motores e armas: um Canhão
   * Linear e uma Lança Singular produziam o mesmo cilindro.
   */
  loadout?: readonly string[];
  /**
   * Nível de detalhe do casco, 0..4 — cresce com o tier médio dos
   * componentes instalados.
   *
   * Antes toda nave era a mesma silhueta: um jogador de nível 1 e outro
   * com peças lendárias apareciam idênticos. Agora a evolução é visível
   * — placas de blindagem, quilha, aletas, antenas e faixas emissivas
   * vão aparecendo conforme a build melhora.
   */
  detail?: number;
}

/** Proporções por classe: [comprimento, largura, altura]. */
const PROPORTIONS: Record<ChassisKind, [number, number, number]> = {
  interceptor: [6.4, 3.0, 0.85],
  skirmisher: [5.4, 3.8, 1.1],
  cruiser: [7.6, 4.2, 1.7],
  hauler: [6.2, 3.4, 2.2],
};

/** Peça equipada, com o objeto 3D correspondente. */
export interface MountedPart {
  templateId: string;
  object: THREE.Object3D;
  /** Direção para onde a peça se afasta na vista explodida. */
  explodeDir: THREE.Vector3;
  /** Posição de repouso, para voltar da vista explodida. */
  restPos: THREE.Vector3;
}

/**
 * Semente estável para a fase do farol.
 *
 * Duas naves iguais lado a lado piscando em uníssono pareceriam um
 * sistema só; derivar da aparência as separa sem estado extra.
 */
function seedFromSpec(spec: ChassisSpec): number {
  const s = `${spec.kind}${spec.hull}${spec.glow}${(spec.loadout ?? []).join()}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface ShipMesh {
  group: THREE.Group;
  /** Peças do loadout montadas no casco. */
  parts: MountedPart[];
  /** Material emissivo dos motores — modulado pelo acelerador. */
  engineMaterial: THREE.MeshBasicMaterial;
  /** Halo que pulsa quando a nave leva dano. */
  hullMaterial: THREE.MeshStandardMaterial;
  /**
   * Luzes de navegação. Anime com `navLights.update(t)` por quadro.
   *
   * São o que torna a nave visível a distância sem clarear o casco —
   * clarear resolveria a percepção e destruiria a cena.
   */
  navLights: NavLightsHandle;
  /** Malhas dos cones de exaustão dos motores para animação de potência. */
  enginePlumes: THREE.Mesh[];
  /** Bolha de escudo de energia que acende ao receber impactos. */
  shieldMesh?: THREE.Mesh;
  /** Aciona efeito de impacto luminoso no escudo. */
  triggerShieldHit?(severity?: number): void;
  /** Atualiza efeitos visuais internos (ex: dissipação de escudo). */
  update?(dt: number): void;
  dispose(): void;
}

/**
 * Constrói a nave apontando para **+Z**.
 *
 * Essa é a convenção do servidor: `forward()` em `world.rs` devolve
 * `(0,0,1)` para o quaternion identidade, e o teste
 * `input_drives_movement_in_simulation` fixa isso com `p.z > 0`.
 *
 * A primeira versão montou o casco para -Z (com um comentário afirmando,
 * errado, que era o que o servidor usava). O efeito em jogo: a nave voava
 * de ré, os motores ficavam na PONTA e os projéteis — que nascem ao longo
 * do +Z do servidor — saíam de dentro da propulsão.
 *
 * As peças continuam posicionadas no referencial -Z (que é como o
 * desenho foi pensado) e o conjunto inteiro é girado 180° em Y no fim.
 * Uma rotação única não deixa nenhuma peça para trás; reposicionar peça
 * por peça deixaria.
 */
export function createShipMesh(spec: ChassisSpec): ShipMesh {
  const group = new THREE.Group();
  // `frame` guarda o desenho no referencial -Z; `group` é a raiz que o
  // resto do jogo posiciona e escala.
  const frame = new THREE.Group();
  group.add(frame);
  const [len, wid, hei] = PROPORTIONS[spec.kind];
  const s = spec.scale ?? 1;
  const engines = clampInt(spec.engines ?? 2, 0, 4);
  const weapons = clampInt(spec.weapons ?? 2, 0, 4);
  const detail = clampInt(spec.detail ?? 0, 0, 4);
  const disposables: Array<{ dispose(): void }> = [];
  const parts: MountedPart[] = [];

  // Casco metálico com verniz: `metalness` alto e `roughness` baixo
  // fazem o rim light da cena desenhar a silhueta, que é o que dá leitura
  // de nave a distância. A emissão fraca evita que fique um recorte
  // preto quando nenhuma luz a alcança.
  const hullMaterial = new THREE.MeshStandardMaterial({
    color: spec.hull,
    metalness: 0.85,
    roughness: 0.22,
    emissive: new THREE.Color(spec.glow).multiplyScalar(0.12),
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x141b29,
    metalness: 0.95,
    roughness: 0.18,
  });
  const engineMaterial = new THREE.MeshBasicMaterial({
    color: spec.glow,
    transparent: true,
    opacity: 0.95,
  });
  disposables.push(hullMaterial, trimMaterial, engineMaterial);
  const enginePlumes: THREE.Mesh[] = [];

  // --- Fuselagens e Silhueta Personalizadas por ChassisKind ---
  if (spec.kind === 'cruiser') {
    // ==================================================================
    // ESTILO STAR TREK (FEDERATION STARSHIP - ENTERPRISE / GALAXY CLASS)
    // ==================================================================
    // Seção Disco (Saucer / Casco Primário)
    const upperSaucerGeo = new THREE.CylinderGeometry(wid * 0.22, wid * 0.68, hei * 0.16, 24);
    upperSaucerGeo.rotateX(Math.PI / 2);
    disposables.push(upperSaucerGeo);
    const upperSaucer = new THREE.Mesh(upperSaucerGeo, hullMaterial);
    upperSaucer.position.set(0, hei * 0.12, -len * 0.28);
    frame.add(upperSaucer);

    const lowerSaucerGeo = new THREE.CylinderGeometry(wid * 0.68, wid * 0.22, hei * 0.14, 24);
    lowerSaucerGeo.rotateX(Math.PI / 2);
    disposables.push(lowerSaucerGeo);
    const lowerSaucer = new THREE.Mesh(lowerSaucerGeo, hullMaterial);
    lowerSaucer.position.set(0, -hei * 0.03, -len * 0.28);
    frame.add(lowerSaucer);

    const rimSaucerGeo = new THREE.CylinderGeometry(wid * 0.70, wid * 0.70, hei * 0.08, 28);
    rimSaucerGeo.rotateX(Math.PI / 2);
    disposables.push(rimSaucerGeo);
    const rimSaucer = new THREE.Mesh(rimSaucerGeo, trimMaterial);
    rimSaucer.position.set(0, hei * 0.05, -len * 0.28);
    frame.add(rimSaucer);

    // Módulo da Ponte de Comando no topo do disco (Bridge Teardrop)
    const bridgeGeo = new THREE.CylinderGeometry(wid * 0.12, wid * 0.18, hei * 0.12, 14);
    bridgeGeo.rotateX(Math.PI / 2);
    disposables.push(bridgeGeo);
    const bridge = new THREE.Mesh(bridgeGeo, trimMaterial);
    bridge.position.set(0, hei * 0.23, -len * 0.28);
    frame.add(bridge);

    // Cúpula do Sensor Ventral
    const sensorDomeGeo = new THREE.SphereGeometry(wid * 0.11, 10, 8);
    sensorDomeGeo.scale(1, 0.4, 1);
    disposables.push(sensorDomeGeo);
    const sensorDome = new THREE.Mesh(sensorDomeGeo, trimMaterial);
    sensorDome.position.set(0, -hei * 0.12, -len * 0.28);
    frame.add(sensorDome);

    // Bloco dos Motores de Impulso na beirada traseira do disco
    const impulseGeo = new THREE.BoxGeometry(wid * 0.26, hei * 0.1, len * 0.12);
    disposables.push(impulseGeo);
    const impulse = new THREE.Mesh(impulseGeo, trimMaterial);
    impulse.position.set(0, hei * 0.08, -len * 0.02);
    frame.add(impulse);

    const impulseGlowMat = new THREE.MeshBasicMaterial({ color: 0xff3311 });
    disposables.push(impulseGlowMat);
    const impulseGlowGeo = new THREE.BoxGeometry(wid * 0.22, hei * 0.05, len * 0.02);
    disposables.push(impulseGlowGeo);
    const impulseGlow = new THREE.Mesh(impulseGlowGeo, impulseGlowMat);
    impulseGlow.position.set(0, hei * 0.08, 0.04);
    frame.add(impulseGlow);

    // Pescoço / Pilone Conector Aerodinâmico
    const neckGeo = new THREE.BoxGeometry(wid * 0.12, hei * 0.32, len * 0.28);
    disposables.push(neckGeo);
    const neck = new THREE.Mesh(neckGeo, trimMaterial);
    neck.position.set(0, -hei * 0.08, len * 0.02);
    neck.rotation.x = 0.25;
    frame.add(neck);

    // Casco Secundário / Engenharia (Secondary Hull)
    const engHullGeo = new THREE.CylinderGeometry(wid * 0.25, wid * 0.17, len * 0.54, 14);
    engHullGeo.rotateX(Math.PI / 2);
    disposables.push(engHullGeo);
    const engHull = new THREE.Mesh(engHullGeo, hullMaterial);
    engHull.position.set(0, -hei * 0.22, len * 0.08);
    frame.add(engHull);

    // Disco Defletor de Navegação na proa do casco de engenharia (Deflector Dish)
    const deflectorGeo = new THREE.CylinderGeometry(wid * 0.16, wid * 0.14, len * 0.05, 16);
    deflectorGeo.rotateX(Math.PI / 2);
    disposables.push(deflectorGeo);
    const deflectorMat = new THREE.MeshStandardMaterial({
      color: 0x00ccff,
      emissive: new THREE.Color(0x00aaff),
      emissiveIntensity: 0.85,
      metalness: 0.9,
      roughness: 0.1,
    });
    disposables.push(deflectorMat);
    const deflector = new THREE.Mesh(deflectorGeo, deflectorMat);
    deflector.position.set(0, -hei * 0.22, -len * 0.19);
    frame.add(deflector);

    const deflectorConeGeo = new THREE.ConeGeometry(wid * 0.05, len * 0.06, 8);
    deflectorConeGeo.rotateX(-Math.PI / 2);
    disposables.push(deflectorConeGeo);
    const deflectorConeMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    disposables.push(deflectorConeMat);
    const deflectorCone = new THREE.Mesh(deflectorConeGeo, deflectorConeMat);
    deflectorCone.position.set(0, -hei * 0.22, -len * 0.22);
    frame.add(deflectorCone);

    // Pilones das Nacelas Warp e Nacelas de Dobra
    const pylonGeo = new THREE.BoxGeometry(wid * 0.44, hei * 0.08, len * 0.18);
    disposables.push(pylonGeo);
    const nacelleBodyGeo = new THREE.CylinderGeometry(hei * 0.13, hei * 0.11, len * 0.56, 10);
    nacelleBodyGeo.rotateX(Math.PI / 2);
    disposables.push(nacelleBodyGeo);
    const bussardGeo = new THREE.SphereGeometry(hei * 0.13, 10, 8);
    disposables.push(bussardGeo);
    const bussardMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    disposables.push(bussardMat);
    const warpNozzleGeo = new THREE.CircleGeometry(hei * 0.11, 10);
    disposables.push(warpNozzleGeo);
    const warpPlumeGeo = new THREE.ConeGeometry(hei * 0.10, len * 0.42, 8, 1, true);
    warpPlumeGeo.rotateX(Math.PI / 2);
    disposables.push(warpPlumeGeo);

    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeo, trimMaterial);
      pylon.position.set(side * wid * 0.42, hei * 0.18, len * 0.18);
      pylon.rotation.z = side * 0.42;
      frame.add(pylon);

      const warpNacelle = new THREE.Mesh(nacelleBodyGeo, trimMaterial);
      warpNacelle.position.set(side * wid * 0.65, hei * 0.36, len * 0.2);
      frame.add(warpNacelle);

      const bussard = new THREE.Mesh(bussardGeo, bussardMat);
      bussard.position.set(side * wid * 0.65, hei * 0.36, -len * 0.08);
      frame.add(bussard);

      const nozzle = new THREE.Mesh(warpNozzleGeo, engineMaterial);
      nozzle.position.set(side * wid * 0.65, hei * 0.36, len * 0.48);
      nozzle.rotation.y = Math.PI;
      frame.add(nozzle);

      const plume = new THREE.Mesh(warpPlumeGeo, engineMaterial);
      plume.position.set(side * wid * 0.65, hei * 0.36, len * 0.69);
      frame.add(plume);
      enginePlumes.push(plume);
    }
  } else if (spec.kind === 'skirmisher') {
    // ==================================================================
    // ESTILO STAR WARS: STAR DESTROYER / ARROWHEAD WEDGE BATTLECRUISER
    // ==================================================================
    // Casco em Cunha Triangular Dagger com decks escalonados
    const wedgeGeo = new THREE.CylinderGeometry(wid * 0.04, wid * 0.72, len * 0.92, 4);
    wedgeGeo.rotateX(Math.PI / 2);
    wedgeGeo.rotateZ(Math.PI / 4);
    wedgeGeo.scale(1, 0.44, 1);
    disposables.push(wedgeGeo);
    const wedge = new THREE.Mesh(wedgeGeo, hullMaterial);
    wedge.position.set(0, 0, -len * 0.06);
    frame.add(wedge);

    // Trincheira equatorial de maquinário nos flancos
    const trenchGeo = new THREE.BoxGeometry(wid * 0.65, hei * 0.08, len * 0.75);
    disposables.push(trenchGeo);
    const trench = new THREE.Mesh(trenchGeo, trimMaterial);
    trench.position.set(0, 0, -len * 0.02);
    frame.add(trench);

    // Decks escalonados no dorso (Terraced Superstructure)
    const deck1Geo = new THREE.BoxGeometry(wid * 0.46, hei * 0.16, len * 0.44);
    disposables.push(deck1Geo);
    const deck1 = new THREE.Mesh(deck1Geo, hullMaterial);
    deck1.position.set(0, hei * 0.16, len * 0.08);
    frame.add(deck1);

    const deck2Geo = new THREE.BoxGeometry(wid * 0.32, hei * 0.14, len * 0.30);
    disposables.push(deck2Geo);
    const deck2 = new THREE.Mesh(deck2Geo, trimMaterial);
    deck2.position.set(0, hei * 0.28, len * 0.14);
    frame.add(deck2);

    // Torre de comando elevada (Command Bridge Tower)
    const bridgeNeckGeo = new THREE.BoxGeometry(wid * 0.14, hei * 0.22, len * 0.16);
    disposables.push(bridgeNeckGeo);
    const bridgeNeck = new THREE.Mesh(bridgeNeckGeo, trimMaterial);
    bridgeNeck.position.set(0, hei * 0.44, len * 0.2);
    frame.add(bridgeNeck);

    const bridgeWingGeo = new THREE.BoxGeometry(wid * 0.40, hei * 0.08, len * 0.14);
    disposables.push(bridgeWingGeo);
    const bridgeWing = new THREE.Mesh(bridgeWingGeo, trimMaterial);
    bridgeWing.position.set(0, hei * 0.54, len * 0.2);
    frame.add(bridgeWing);

    // Cúpulas de escudo geodésicas (Shield Generator Domes)
    const sensorGeo = new THREE.SphereGeometry(hei * 0.1, 8, 8);
    disposables.push(sensorGeo);
    for (const side of [-1, 1]) {
      const sensor = new THREE.Mesh(sensorGeo, hullMaterial);
      sensor.position.set(side * wid * 0.15, hei * 0.62, len * 0.2);
      frame.add(sensor);
    }

    // Travessa de Popa (Stern Transom) e 3 Motores Iônicos em Triângulo
    const transomGeo = new THREE.BoxGeometry(wid * 0.72, hei * 0.42, len * 0.06);
    disposables.push(transomGeo);
    const transom = new THREE.Mesh(transomGeo, trimMaterial);
    transom.position.set(0, 0, len * 0.38);
    frame.add(transom);

    const bellGeo = new THREE.CylinderGeometry(hei * 0.18, hei * 0.24, len * 0.18, 10);
    bellGeo.rotateX(Math.PI / 2);
    disposables.push(bellGeo);
    const nozGeo = new THREE.CircleGeometry(hei * 0.22, 10);
    disposables.push(nozGeo);
    const plumeConeGeo = new THREE.ConeGeometry(hei * 0.19, len * 0.45, 8, 1, true);
    plumeConeGeo.rotateX(Math.PI / 2);
    disposables.push(plumeConeGeo);

    const enginePositions: [number, number][] = [
      [-wid * 0.22, -hei * 0.06],
      [wid * 0.22, -hei * 0.06],
      [0, hei * 0.12],
    ];

    for (const [ex, ey] of enginePositions) {
      const bell = new THREE.Mesh(bellGeo, trimMaterial);
      bell.position.set(ex, ey, len * 0.44);
      frame.add(bell);

      const nozzle = new THREE.Mesh(nozGeo, engineMaterial);
      nozzle.position.set(ex, ey, len * 0.53);
      nozzle.rotation.y = Math.PI;
      frame.add(nozzle);

      const plume = new THREE.Mesh(plumeConeGeo, engineMaterial);
      plume.position.set(ex, ey, len * 0.74);
      frame.add(plume);
      enginePlumes.push(plume);
    }
  } else if (spec.kind === 'hauler') {
    // ==================================================================
    // ESTILO INDUSTRIAL SCI-FI: CARGUEIRO PESADO / MINERAÇÃO
    // ==================================================================
    // Cabine de Comando Blindada Frontal
    const cabGeo = new THREE.BoxGeometry(wid * 0.44, hei * 0.48, len * 0.3);
    disposables.push(cabGeo);
    const cab = new THREE.Mesh(cabGeo, trimMaterial);
    cab.position.set(0, hei * 0.1, -len * 0.36);
    frame.add(cab);

    // Janelas Panorâmicas de Vidro Refletivo
    const cabWindowGeo = new THREE.BoxGeometry(wid * 0.38, hei * 0.14, len * 0.08);
    disposables.push(cabWindowGeo);
    const cabWindowMat = new THREE.MeshStandardMaterial({
      color: 0x0a1420,
      emissive: new THREE.Color(spec.glow).multiplyScalar(0.4),
      metalness: 0.9,
      roughness: 0.1,
    });
    disposables.push(cabWindowMat);
    const cabWindow = new THREE.Mesh(cabWindowGeo, cabWindowMat);
    cabWindow.position.set(0, hei * 0.18, -len * 0.48);
    frame.add(cabWindow);

    // Espinha Dorsal / Truss Central
    const spineGeo = new THREE.BoxGeometry(wid * 0.24, hei * 0.26, len * 0.82);
    disposables.push(spineGeo);
    const spine = new THREE.Mesh(spineGeo, hullMaterial);
    spine.position.set(0, 0, 0);
    frame.add(spine);

    // Contêineres de Carga Modulares com acabamento bronze/industrial
    const cargoMat = new THREE.MeshStandardMaterial({
      color: 0xb87333,
      metalness: 0.7,
      roughness: 0.35,
    });
    disposables.push(cargoMat);
    const cargoGeo = new THREE.BoxGeometry(wid * 0.34, hei * 0.42, len * 0.32);
    disposables.push(cargoGeo);

    for (const side of [-1, 1]) {
      for (const zOffset of [-len * 0.18, len * 0.14]) {
        const pod = new THREE.Mesh(cargoGeo, cargoMat);
        pod.position.set(side * wid * 0.38, 0, zOffset);
        frame.add(pod);
      }
    }

    // Tanques esféricos de propelente
    const tankGeo = new THREE.SphereGeometry(hei * 0.24, 10, 8);
    disposables.push(tankGeo);
    for (const side of [-1, 1]) {
      const tank = new THREE.Mesh(tankGeo, trimMaterial);
      tank.position.set(side * wid * 0.24, -hei * 0.22, -len * 0.02);
      frame.add(tank);
    }

    // Bloco do Motor Traseiro Industrial com Aletas de Radiador
    const engineBlockGeo = new THREE.BoxGeometry(wid * 0.52, hei * 0.56, len * 0.28);
    disposables.push(engineBlockGeo);
    const engineBlock = new THREE.Mesh(engineBlockGeo, hullMaterial);
    engineBlock.position.set(0, 0, len * 0.34);
    frame.add(engineBlock);

    const radFinGeo = new THREE.BoxGeometry(wid * 0.06, hei * 0.34, len * 0.24);
    disposables.push(radFinGeo);
    const radFinTop = new THREE.Mesh(radFinGeo, trimMaterial);
    radFinTop.position.set(0, hei * 0.44, len * 0.34);
    frame.add(radFinTop);

    // Propulsores Duplos Pesados
    const heavyNozBellGeo = new THREE.CylinderGeometry(hei * 0.2, hei * 0.26, len * 0.2, 10);
    heavyNozBellGeo.rotateX(Math.PI / 2);
    disposables.push(heavyNozBellGeo);
    const heavyNozGeo = new THREE.CircleGeometry(hei * 0.24, 10);
    disposables.push(heavyNozGeo);
    const heavyPlumeGeo = new THREE.ConeGeometry(hei * 0.22, len * 0.48, 8, 1, true);
    heavyPlumeGeo.rotateX(Math.PI / 2);
    disposables.push(heavyPlumeGeo);

    for (const side of [-1, 1]) {
      const bell = new THREE.Mesh(heavyNozBellGeo, trimMaterial);
      bell.position.set(side * wid * 0.18, 0, len * 0.46);
      frame.add(bell);

      const nozzle = new THREE.Mesh(heavyNozGeo, engineMaterial);
      nozzle.position.set(side * wid * 0.18, 0, len * 0.56);
      nozzle.rotation.y = Math.PI;
      frame.add(nozzle);

      const plume = new THREE.Mesh(heavyPlumeGeo, engineMaterial);
      plume.position.set(side * wid * 0.18, 0, len * 0.78);
      frame.add(plume);
      enginePlumes.push(plume);
    }
  } else {
    // ==================================================================
    // ESTILO INTERCEPTOR: STAR WARS X-WING / STRIKE STARFIGHTER
    // ==================================================================
    // Fuselagem cônica afilada em agulha
    const noseGeo = new THREE.CylinderGeometry(wid * 0.04, wid * 0.24, len * 0.65, 8);
    noseGeo.rotateX(Math.PI / 2);
    disposables.push(noseGeo);
    const nose = new THREE.Mesh(noseGeo, hullMaterial);
    nose.position.set(0, 0, -len * 0.16);
    frame.add(nose);

    const aftBodyGeo = new THREE.BoxGeometry(wid * 0.34, hei * 0.32, len * 0.38);
    disposables.push(aftBodyGeo);
    const aftBody = new THREE.Mesh(aftBodyGeo, hullMaterial);
    aftBody.position.set(0, 0, len * 0.2);
    frame.add(aftBody);

    // Canópio / Cabine do Piloto (ponto mais alto à frente do centro)
    const canopyGeo = new THREE.SphereGeometry(wid * 0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    canopyGeo.scale(0.9, 1.25, 1.8);
    disposables.push(canopyGeo);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x081524,
      metalness: 0.2,
      roughness: 0.1,
      emissive: new THREE.Color(spec.glow).multiplyScalar(0.45),
    });
    disposables.push(canopyMat);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, hei * 0.36, -len * 0.14);
    frame.add(canopy);

    // 4 Asas em Configuração X (S-Foils)
    const wingGeo = new THREE.BoxGeometry(wid * 0.52, hei * 0.06, len * 0.34);
    disposables.push(wingGeo);
    const wingGunGeo = new THREE.CylinderGeometry(hei * 0.04, hei * 0.04, len * 0.52, 6);
    wingGunGeo.rotateX(Math.PI / 2);
    disposables.push(wingGunGeo);

    // 4 Motores Turbina nas raízes das asas
    const nacGeo = new THREE.CylinderGeometry(hei * 0.15, hei * 0.18, len * 0.36, 8);
    nacGeo.rotateX(Math.PI / 2);
    disposables.push(nacGeo);
    const nozGeo = new THREE.CircleGeometry(hei * 0.17, 10);
    disposables.push(nozGeo);
    const plumeGeo = new THREE.ConeGeometry(hei * 0.15, len * 0.44, 8, 1, true);
    plumeGeo.rotateX(Math.PI / 2);
    disposables.push(plumeGeo);

    for (const sideX of [-1, 1]) {
      for (const sideY of [-1, 1]) {
        // Asa
        const wing = new THREE.Mesh(wingGeo, hullMaterial);
        wing.position.set(sideX * wid * 0.36, sideY * hei * 0.16, len * 0.08);
        wing.rotation.z = sideX * sideY * -0.26;
        wing.rotation.y = sideX * 0.1;
        frame.add(wing);

        // Canhão de laser na ponta de cada uma das 4 asas
        const cannon = new THREE.Mesh(wingGunGeo, trimMaterial);
        cannon.position.set(sideX * wid * 0.65, sideY * hei * 0.28, -len * 0.14);
        frame.add(cannon);

        // Motor turbina na raiz da asa
        const turbine = new THREE.Mesh(nacGeo, trimMaterial);
        turbine.position.set(sideX * wid * 0.22, sideY * hei * 0.14, len * 0.3);
        frame.add(turbine);

        const nozzle = new THREE.Mesh(nozGeo, engineMaterial);
        nozzle.position.set(sideX * wid * 0.22, sideY * hei * 0.14, len * 0.48);
        nozzle.rotation.y = Math.PI;
        frame.add(nozzle);

        const plume = new THREE.Mesh(plumeGeo, engineMaterial);
        plume.position.set(sideX * wid * 0.22, sideY * hei * 0.14, len * 0.68);
        frame.add(plume);
        enginePlumes.push(plume);
      }
    }
  }

  // ------------------------------------------------------------------
  // Detalhamento progressivo. Cada nível ACRESCENTA sobre o anterior,
  // então a nave "cresce" visualmente conforme o jogador evolui.
  // ------------------------------------------------------------------

  // Nível 1: placas de blindagem sobre o dorso.
  if (detail >= 1) {
    const plateGeo = new THREE.BoxGeometry(wid * 0.22, hei * 0.12, len * 0.3);
    disposables.push(plateGeo);
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(plateGeo, trimMaterial);
      plate.position.set(side * wid * 0.13, hei * 0.2, -len * 0.02);
      plate.rotation.z = side * 0.18;
      frame.add(plate);
    }
  }

  // Nível 2: quilha ventral — muda a silhueta vista de frente.
  if (detail >= 2) {
    const keelGeo = new THREE.BoxGeometry(wid * 0.1, hei * 0.42, len * 0.5);
    disposables.push(keelGeo);
    const keel = new THREE.Mesh(keelGeo, hullMaterial);
    keel.position.set(0, -hei * 0.3, len * 0.05);
    frame.add(keel);
  }

  // Nível 3: aletas verticais e antenas de sensor.
  if (detail >= 3) {
    const finGeo = new THREE.BoxGeometry(hei * 0.1, hei * 0.62, len * 0.24);
    disposables.push(finGeo);
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(finGeo, hullMaterial);
      fin.position.set(side * wid * 0.4, hei * 0.32, len * 0.3);
      fin.rotation.z = side * 0.32;
      frame.add(fin);
    }

    const antennaGeo = new THREE.CylinderGeometry(hei * 0.02, hei * 0.02, len * 0.34, 4);
    antennaGeo.rotateX(Math.PI / 2);
    disposables.push(antennaGeo);
    const antenna = new THREE.Mesh(antennaGeo, trimMaterial);
    antenna.position.set(wid * 0.2, hei * 0.34, -len * 0.34);
    frame.add(antenna);
  }

  // Nível 4: faixas emissivas ao longo do casco — a leitura de "lendária".
  if (detail >= 4) {
    const stripeMat = new THREE.MeshBasicMaterial({
      color: spec.glow,
      transparent: true,
      opacity: 0.8,
    });
    disposables.push(stripeMat);
    const stripeGeo = new THREE.BoxGeometry(wid * 0.04, hei * 0.03, len * 0.62);
    disposables.push(stripeGeo);
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(side * wid * 0.3, hei * 0.05, 0);
      frame.add(stripe);
    }
    // Halo de energia envolvendo os motores.
    const auraGeo = new THREE.TorusGeometry(wid * 0.4, hei * 0.03, 6, 20);
    disposables.push(auraGeo);
    const aura = new THREE.Mesh(auraGeo, stripeMat);
    aura.position.z = len * 0.46;
    frame.add(aura);

    // Feixes de energia nos bordos para visual lendário
    const tipGlowGeo = new THREE.SphereGeometry(hei * 0.06, 8, 6);
    disposables.push(tipGlowGeo);
    for (const side of [-1, 1]) {
      const tipGlow = new THREE.Mesh(tipGlowGeo, stripeMat);
      tipGlow.position.set(side * wid * 0.48, hei * 0.1, -len * 0.1);
      frame.add(tipGlow);
    }
  }

  // ------------------------------------------------------------------
  // Peças do loadout: cada componente equipado vira geometria própria.
  // ------------------------------------------------------------------
  const loadout = spec.loadout ?? [];
  if (loadout.length > 0) {
    // Agrupa por ponto de montagem para distribuir simetricamente.
    const porMontagem = new Map<MountPoint, string[]>();
    for (const id of loadout) {
      const v = partVisual(id);
      if (!v) continue; // id desconhecido: a nave não quebra por isso
      const lista = porMontagem.get(v.mount) ?? [];
      lista.push(id);
      porMontagem.set(v.mount, lista);
    }

    for (const [mount, ids] of porMontagem) {
      ids.forEach((id, i) => {
        const v = partVisual(id);
        if (!v) return;

        const geo = v.build(partBaseScale(len));
        disposables.push(geo);

        // Teto de tamanho: nenhuma peça pode engolir o casco. Mede a
        // geometria de verdade em vez de confiar nos números do
        // catálogo, para valer também para peças novas.
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        let ajuste = 1;
        if (bb) {
          const maior = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
          const teto = partSizeCap(mount, len);
          if (maior > teto) ajuste = teto / maior;
        }

        const mat = new THREE.MeshStandardMaterial({
          color: v.color,
          metalness: v.metalness ?? 0.8,
          roughness: v.roughness ?? 0.3,
          emissive: new THREE.Color(v.emissive ?? 0x000000).multiplyScalar(v.glow ?? 0),
        });
        disposables.push(mat);

        const peca = new THREE.Mesh(geo, mat);
        peca.scale.setScalar(ajuste);
        const t = mountTransform(mount, i, ids.length, { len, wid, hei });
        peca.position.set(t.pos[0], t.pos[1], t.pos[2]);
        peca.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
        frame.add(peca);

        // Direção de afastamento na vista explodida: para fora do eixo
        // do casco, para as peças não se sobreporem ao separar.
        const dir = new THREE.Vector3(t.pos[0], t.pos[1], 0);
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
        parts.push({
          templateId: id,
          object: peca,
          explodeDir: dir.normalize(),
          restPos: peca.position.clone(),
        });
      });
    }
  }

  // Luzes de navegação. Vão no `frame`, junto com o resto do casco, para
  // acompanharem a rotação de orientação abaixo — bombordo precisa ficar
  // à esquerda DA NAVE, não à esquerda do mundo.
  const navLights = createNavLights({ len, wid, hei }, spec.glow, seedFromSpec(spec));
  frame.add(navLights.group);
  disposables.push(navLights);

  // Escudo de energia esférico/elipsoidal envolvendo o casco
  const shieldRadius = Math.max(wid * 0.65, len * 0.52, hei * 0.9) * 1.15;
  const shieldGeo = new THREE.SphereGeometry(shieldRadius, 18, 12);
  shieldGeo.scale(
    wid / (shieldRadius * 0.8),
    Math.max(0.6, hei / (shieldRadius * 0.5)),
    len / (shieldRadius * 0.9),
  );
  disposables.push(shieldGeo);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x4ec9ff,
    transparent: true,
    opacity: 0,
    wireframe: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(shieldMat);
  const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
  shieldMesh.name = 'shield-mesh';
  shieldMesh.position.set(0, 0, 0);
  shieldMesh.visible = false;
  group.add(shieldMesh);

  let shieldOpacity = 0;

  // Vira o conjunto para +Z, a frente que o servidor usa.
  frame.rotation.y = Math.PI;

  group.scale.setScalar(s);

  return {
    group,
    navLights,
    parts,
    engineMaterial,
    hullMaterial,
    enginePlumes,
    shieldMesh,
    triggerShieldHit(severity = 0.5): void {
      shieldOpacity = Math.min(0.85, 0.45 + severity * 0.4);
      shieldMat.opacity = shieldOpacity;
      shieldMesh.visible = true;
    },
    update(dt: number): void {
      if (shieldOpacity > 0) {
        shieldOpacity = Math.max(0, shieldOpacity - dt * 2.8);
        shieldMat.opacity = shieldOpacity;
        if (shieldOpacity <= 0.01) {
          shieldMesh.visible = false;
        }
      }
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Distribui `count` itens simetricamente em torno do eixo central.
 * Contagem ímpar coloca um item exatamente no centro.
 */
export function lateralOffsets(count: number, spread: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const out: number[] = [];
  const step = (spread * 2) / (count - 1);
  for (let i = 0; i < count; i++) out.push(-spread + step * i);
  return out;
}

/** Mapeia o arquétipo de NPC do servidor para uma classe de casco. */
export function chassisForArchetype(archetype: number): ChassisKind {
  switch (archetype) {
    case 1:
      return 'skirmisher'; // Pirate
    case 2:
      return 'cruiser'; // Patrol
    case 3:
      return 'hauler'; // Miner
    default:
      return 'interceptor';
  }
}

/**
 * Nível de detalhe a partir dos tiers instalados.
 *
 * Usa a MÉDIA dos tiers, não a soma: uma nave com oito peças comuns não
 * deve parecer mais avançada que uma com três peças lendárias.
 */
export function detailFromTiers(tiers: readonly number[]): number {
  if (tiers.length === 0) return 0;
  const media = tiers.reduce((a, t) => a + t, 0) / tiers.length;
  // Tier médio 1 -> 0 detalhes; 5 -> 4 detalhes.
  return clampInt(Math.round(media) - 1, 0, 4);
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
