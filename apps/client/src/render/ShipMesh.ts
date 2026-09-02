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

export interface ShipMesh {
  group: THREE.Group;
  /** Peças do loadout montadas no casco. */
  parts: MountedPart[];
  /** Material emissivo dos motores — modulado pelo acelerador. */
  engineMaterial: THREE.MeshBasicMaterial;
  /** Halo que pulsa quando a nave leva dano. */
  hullMaterial: THREE.MeshStandardMaterial;
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

  // --- Fuselagem: cone alongado dá bico afiado sem custo de modelo. ---
  const bodyGeo = new THREE.ConeGeometry(wid * 0.28, len, 6);
  bodyGeo.rotateX(-Math.PI / 2); // bico ao longo de -Z no referencial de desenho
  const body = new THREE.Mesh(bodyGeo, hullMaterial);
  disposables.push(bodyGeo);
  group.add(body);

  // --- Cockpit: meia-esfera emissiva, ponto de leitura da "frente". ---
  const canopyGeo = new THREE.SphereGeometry(wid * 0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  // Cabine: vidro escuro muito polido, com emissão forte. É o ponto
  // mais brilhante da nave e serve de marcador de "frente".
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x081524,
    metalness: 0.05,
    roughness: 0.02,
    emissive: new THREE.Color(spec.glow).multiplyScalar(0.55),
  });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, hei * 0.32, -len * 0.12);
  disposables.push(canopyGeo, canopyMat);
  frame.add(canopy);

  // --- Asas: dois trapézios espelhados (BoxGeometry escalado enviesado). ---
  const wingGeo = new THREE.BoxGeometry(wid * 0.62, hei * 0.18, len * 0.42);
  disposables.push(wingGeo);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, hullMaterial);
    wing.position.set(side * wid * 0.42, 0, len * 0.06);
    wing.rotation.z = side * -0.22;
    wing.rotation.y = side * 0.12;
    frame.add(wing);
  }

  // --- Nacelas de motor + bocal emissivo, uma por motor instalado. ---
  const nacelleGeo = new THREE.CylinderGeometry(hei * 0.2, hei * 0.24, len * 0.34, 8);
  nacelleGeo.rotateX(Math.PI / 2);
  const nozzleGeo = new THREE.CircleGeometry(hei * 0.22, 10);
  disposables.push(nacelleGeo, nozzleGeo);
  for (const offset of lateralOffsets(engines, wid * 0.5)) {
    const nacelle = new THREE.Mesh(nacelleGeo, trimMaterial);
    nacelle.position.set(offset, -hei * 0.06, len * 0.34);
    frame.add(nacelle);

    const nozzle = new THREE.Mesh(nozzleGeo, engineMaterial);
    // Ligeiramente atrás do bocal, virado para trás (+Z).
    nozzle.position.set(offset, -hei * 0.06, len * 0.51);
    nozzle.rotation.y = Math.PI;
    frame.add(nozzle);

    // Pluma: cone de escape que sai do bocal. Deixa a traseira
    // inconfundível mesmo com a nave parada.
    const plumeGeo = new THREE.ConeGeometry(hei * 0.19, len * 0.42, 8, 1, true);
    plumeGeo.rotateX(Math.PI / 2);
    disposables.push(plumeGeo);
    const plume = new THREE.Mesh(plumeGeo, engineMaterial);
    plume.position.set(offset, -hei * 0.06, len * 0.72);
    frame.add(plume);
  }

  // --- Hardpoints de arma: cilindros finos sob as asas. ---
  if (weapons > 0) {
    const gunGeo = new THREE.CylinderGeometry(hei * 0.08, hei * 0.05, len * 0.52, 6);
    gunGeo.rotateX(Math.PI / 2);
    disposables.push(gunGeo);
    for (const offset of lateralOffsets(weapons, wid * 0.66)) {
      const gun = new THREE.Mesh(gunGeo, trimMaterial);
      // Bem à frente: os canos ultrapassam as asas, então fica óbvio de
      // que lado a nave atira.
      gun.position.set(offset, -hei * 0.16, -len * 0.34);
      frame.add(gun);
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

  // Vira o conjunto para +Z, a frente que o servidor usa.
  frame.rotation.y = Math.PI;

  group.scale.setScalar(s);

  return {
    group,
    parts,
    engineMaterial,
    hullMaterial,
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
