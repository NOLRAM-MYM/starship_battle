/**
 * Cena 3D do hangar — o que aparece atrás da UI nas telas de login,
 * hangar e shipyard.
 *
 * Antes o canvas era simplesmente escondido (`display: none`) fora do
 * jogo, deixando as telas sobre um fundo preto chapado. Aqui reusamos o
 * MESMO `GameRenderer` (nada de segundo contexto WebGPU) com uma cena
 * própria: a nave montada no shipyard flutua numa doca, girando devagar,
 * e reage em tempo real a cada componente encaixado.
 */

import * as THREE from 'three/webgpu';
import { createLightingRig } from './lighting';
import { createSkybox, type SkyboxHandle } from './Starfield';
import { createShipMesh, type ChassisSpec, type ShipMesh } from './ShipMesh';

/** Como a nave é apresentada. */
export type StageMode = 'showcase' | 'blueprint';

/** Peça projetada na tela, para o rótulo HTML. */
export interface ProjectedPart {
  templateId: string;
  /** Coordenadas em pixels dentro do canvas. */
  x: number;
  y: number;
  /** false quando a peça está atrás da câmera. */
  visible: boolean;
}

export interface HangarStageHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * Alterna entre a vitrine (nave montada, iluminada) e o ESQUEMA
   * (vista explodida em wireframe).
   *
   * O esquema existe porque, com as peças ficando visualmente
   * distintas, ainda faltava dizer QUAL é qual: na vitrine elas se
   * fundem no casco.
   */
  setMode(mode: StageMode): void;
  getMode(): StageMode;
  /** Posição de cada peça na tela, para desenhar os rótulos. */
  projectParts(width: number, height: number): ProjectedPart[];
  /** Reconstrói a nave exibida (chamado a cada mudança de loadout). */
  setShip(spec: ChassisSpec): void;
  /** Avança a animação de órbita. */
  update(dt: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * Monta a doca: piso em grade, anéis de atracação e luzes de baliza.
 * Tudo procedural — nenhum asset carregado.
 */
function createDock(): THREE.Group {
  const dock = new THREE.Group();
  dock.name = 'dock';

  // Grade do piso, bem abaixo da nave.
  const grid = new THREE.GridHelper(140, 28, 0x2f6f9e, 0x14283c);
  grid.position.y = -9;
  const gridMat = grid.material as THREE.Material & { transparent: boolean; opacity: number };
  gridMat.transparent = true;
  gridMat.opacity = 0.35;
  dock.add(grid);

  // Dois anéis de atracação inclinados, girando em sentidos opostos.
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x4ec9ff,
    transparent: true,
    opacity: 0.28,
  });
  for (const [radius, tilt] of [
    [11, Math.PI / 2],
    [14, Math.PI / 2.4],
  ] as const) {
    const geo = new THREE.TorusGeometry(radius, 0.08, 6, 64);
    const ring = new THREE.Mesh(geo, ringMat);
    ring.rotation.x = tilt;
    ring.name = 'dock-ring';
    dock.add(ring);
  }

  // Balizas: pontos de luz coloridos em volta da doca.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const beacon = new THREE.PointLight(i % 2 === 0 ? 0x4ec9ff : 0xb06bff, 12, 60);
    beacon.position.set(Math.cos(angle) * 18, -6, Math.sin(angle) * 18);
    dock.add(beacon);
  }

  return dock;
}

export function createHangarStage(): HangarStageHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060d);
  // Névoa fraca: a anterior (0.006) saturava em ~500 unidades e apagava
  // a doca inteira junto com o céu.
  scene.fog = new THREE.FogExp2(0x04060d, 0.0009);

  createLightingRig(scene);

  const skybox: SkyboxHandle = createSkybox('med');
  scene.add(skybox.group);

  const dock = createDock();
  scene.add(dock);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20_000);

  // A nave vive num pivô próprio para girar sem afetar a doca.
  const pivot = new THREE.Group();
  scene.add(pivot);

  let ship: ShipMesh | null = null;
  let orbit = 0;
  let mode: StageMode = 'showcase';
  /** 0 = montada, 1 = totalmente explodida. Animado. */
  let explode = 0;

  // Grade de fundo do modo esquema: dá a leitura de "prancheta".
  const blueprintGrid = new THREE.GridHelper(60, 24, 0x4ec9ff, 0x1b3a52);
  blueprintGrid.rotation.x = Math.PI / 2;
  blueprintGrid.position.z = -18;
  blueprintGrid.visible = false;
  const bgMat = blueprintGrid.material as THREE.Material & { transparent: boolean; opacity: number };
  bgMat.transparent = true;
  bgMat.opacity = 0.18;
  scene.add(blueprintGrid);

  /** Aplica wireframe a tudo que for material padrão da nave. */
  function setWireframe(on: boolean): void {
    if (!ship) return;
    ship.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material;
      const aplicar = (mat: THREE.Material): void => {
        if ('wireframe' in mat) (mat as THREE.MeshStandardMaterial).wireframe = on;
      };
      if (Array.isArray(m)) m.forEach(aplicar);
      else aplicar(m);
    });
  }
  /** Raio da nave atual, usado para reenquadrar a câmera. */
  let shipRadius = 6;
  let viewAspect = 1;

  const boundsBox = new THREE.Box3();
  const boundsSphere = new THREE.Sphere();

  /**
   * Reposiciona a câmera para a nave ficar CENTRADA e inteira no quadro.
   *
   * A versão anterior fixava `camera.position.set(0, 3.5, 22)` e nunca
   * chamava `lookAt`: a câmera olhava reto no -Z, então a nave (na
   * origem) aparecia abaixo do centro da tela e, com a escala de
   * vitrine, ainda estourava a moldura da doca.
   */
  function frameShip(): void {
    // Distância que faz uma esfera de raio `shipRadius` caber no menor
    // dos dois campos de visão (vertical ou horizontal).
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * viewAspect);
    const fov = Math.min(vFov, hFov);
    // 1.9 = folga para a doca e os anéis aparecerem em volta.
    const dist = (shipRadius * 1.9) / Math.sin(fov / 2);

    camera.position.set(0, shipRadius * 0.45, dist);
    // O olhar vai para o centro da nave, não para o horizonte.
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  function setShip(spec: ChassisSpec): void {
    if (ship) {
      pivot.remove(ship.group);
      ship.dispose();
      ship = null;
    }
    // Escala de vitrine: a nave de combate é pequena demais para o painel.
    ship = createShipMesh({ ...spec, scale: (spec.scale ?? 1) * 2.0 });
    pivot.add(ship.group);
    setWireframe(mode === 'blueprint');

    // Mede a nave montada em vez de chutar um número: cascos diferentes
    // (interceptador x cruzador) têm tamanhos bem distintos.
    boundsBox.setFromObject(ship.group);
    boundsBox.getBoundingSphere(boundsSphere);
    shipRadius = Math.max(1, boundsSphere.radius);
    frameShip();
  }

  return {
    scene,
    camera,

    setShip,

    setMode(next: StageMode): void {
      mode = next;
      blueprintGrid.visible = next === 'blueprint';
      setWireframe(next === 'blueprint');
      // A doca some no esquema: ali a nave é um desenho técnico, não
      // um objeto físico numa baia.
      dock.visible = next === 'showcase';
      skybox.group.visible = next === 'showcase';
    },

    getMode(): StageMode {
      return mode;
    },

    projectParts(width: number, height: number): ProjectedPart[] {
      if (!ship) return [];
      camera.updateMatrixWorld(true);
      ship.group.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      return ship.parts.map((p) => {
        p.object.getWorldPosition(v);
        // `project` devolve NDC (-1..1); z > 1 significa atrás da câmera.
        const ndc = v.clone().project(camera);
        return {
          templateId: p.templateId,
          x: (ndc.x * 0.5 + 0.5) * width,
          y: (-ndc.y * 0.5 + 0.5) * height,
          visible: ndc.z < 1,
        };
      });
    },

    update(dt: number): void {
      // No esquema a nave gira mais devagar: dá tempo de ler os rótulos.
      orbit += dt * (mode === 'blueprint' ? 0.11 : 0.28);
      pivot.rotation.y = orbit;
      // Flutuação suave — dá vida sem distrair.
      pivot.position.y = mode === 'blueprint' ? 0 : Math.sin(orbit * 1.6) * 0.4;

      // Anima a separação das peças.
      const alvo = mode === 'blueprint' ? 1 : 0;
      explode += (alvo - explode) * Math.min(1, dt * 3.5);
      if (ship) {
        for (const p of ship.parts) {
          p.object.position
            .copy(p.restPos)
            .addScaledVector(p.explodeDir, explode * 3.2);
        }
      }

      // Anéis contrarrotacionam, reforçando a leitura de "doca ativa".
      let ringIdx = 0;
      for (const child of dock.children) {
        if (child.name !== 'dock-ring') continue;
        child.rotation.z += dt * (ringIdx === 0 ? 0.22 : -0.14);
        ringIdx++;
      }

      skybox.update(dt * 0.4, camera.position);
    },

    resize(width: number, height: number): void {
      viewAspect = width / Math.max(1, height);
      camera.aspect = viewAspect;
      // Reenquadra: numa janela estreita a nave precisa de mais recuo
      // para não ser cortada nas laterais.
      frameShip();
    },

    dispose(): void {
      if (ship) ship.dispose();
      skybox.dispose();
      dock.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m.dispose();
        }
      });
    },
  };
}
