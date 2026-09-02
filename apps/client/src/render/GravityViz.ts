/**
 * Visualização da gravidade: linha de força e trajetória prevista.
 *
 * Sem isso a gravidade era invisível: a nave desviava e o jogador não
 * tinha como saber de onde vinha o puxão nem para onde estava sendo
 * levado — só percebia ao colidir.
 *
 * Duas leituras complementares:
 *   - **linha de força**: direção e intensidade do puxão AGORA;
 *   - **curva prevista**: onde a nave vai parar se não fizer nada,
 *     vermelha quando termina em impacto.
 *
 * Tudo é geometria de linha reaproveitada entre frames: os buffers são
 * alocados uma vez e só têm os valores reescritos, para não gerar lixo
 * a 60fps.
 */

import * as THREE from 'three/webgpu';
import {
  captureRadius,
  dominantBody,
  gravityTotal,
  magnitude,
  predictTrajectory,
  type GravityBody,
  type Vec3,
} from '../game/gravity';

/** Pontos da curva prevista. Mais que isso não acrescenta leitura. */
const TRAJ_POINTS = 160;

export interface GravityVizHandle {
  group: THREE.Group;
  /**
   * Atualiza as linhas para o estado atual.
   * Some sozinho quando não há corpo influenciando.
   */
  update(pos: Vec3, vel: Vec3, bodies: readonly GravityBody[]): void;
  /** Liga/desliga as linhas. O alerta do HUD não é afetado. */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  dispose(): void;
}

export interface GravityVizOptions {
  gravityConstant: number;
  shipDrag: number;
}

export function createGravityViz(opts: GravityVizOptions): GravityVizHandle {
  const group = new THREE.Group();
  group.name = 'gravity-viz';
  // Linhas de HUD: sempre visíveis, mesmo através de um planeta.
  group.renderOrder = 10;

  // ---------------- Trajetória prevista ----------------
  const trajPos = new Float32Array(TRAJ_POINTS * 3);
  const trajCol = new Float32Array(TRAJ_POINTS * 3);
  const trajGeo = new THREE.BufferGeometry();
  trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPos, 3));
  trajGeo.setAttribute('color', new THREE.BufferAttribute(trajCol, 3));
  const trajMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    fog: false,
  });
  const traj = new THREE.Line(trajGeo, trajMat);
  traj.frustumCulled = false;
  group.add(traj);

  // ---------------- Linha de força ----------------
  // Aponta do nariz da nave na direção do puxão; o comprimento cresce
  // com a intensidade, então dá para sentir "quão preso" se está.
  const forceGeo = new THREE.BufferGeometry();
  forceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const forceMat = new THREE.LineBasicMaterial({
    color: 0xffc34e,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    fog: false,
  });
  const force = new THREE.Line(forceGeo, forceMat);
  force.frustumCulled = false;
  group.add(force);

  // ---------------- Anel do raio de captura ----------------
  // Mostra a fronteira que separa "dá para sair" de "vai precisar de
  // empuxo". Fica no plano da eclíptica, encarando a câmera.
  const ringGeo = new THREE.RingGeometry(0.98, 1.0, 96);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc34e,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthTest: false,
    fog: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.frustumCulled = false;
  group.add(ring);

  /**
   * Só desenha quando o puxão é forte o bastante para importar.
   *
   * O limiar anterior (0.35 m/s²) acendia as linhas em quase todo o
   * setor — elas ficavam permanentemente na tela e atrapalhavam a
   * leitura do combate. 6 m/s² corresponde grosso modo à metade do raio
   * de captura: perto o suficiente para a informação ser útil.
   */
  const LIMIAR = 6;
  let habilitado = true;

  const corSegura = new THREE.Color(0x4ec9ff);
  const corAlerta = new THREE.Color(0xffc34e);
  const corImpacto = new THREE.Color(0xff5f6d);

  function esconder(): void {
    traj.visible = false;
    force.visible = false;
    ring.visible = false;
  }

  return {
    group,

    setEnabled(on: boolean): void {
      habilitado = on;
      if (!on) esconder();
    },

    isEnabled(): boolean {
      return habilitado;
    },

    update(pos, vel, bodies): void {
      if (!habilitado || bodies.length === 0) {
        esconder();
        return;
      }

      const g = gravityTotal(bodies, pos, opts.gravityConstant);
      const intensidade = magnitude(g);

      // Abaixo disso as linhas só poluem a tela.
      if (intensidade < LIMIAR) {
        esconder();
        return;
      }

      // ---- Trajetória ----
      const prev = predictTrajectory(bodies, pos, vel, opts.gravityConstant, {
        step: 0.3,
        steps: TRAJ_POINTS - 1,
        drag: opts.shipDrag,
      });

      const base = prev.impact ? corImpacto : corAlerta;
      const n = Math.min(prev.points.length, TRAJ_POINTS);
      for (let i = 0; i < TRAJ_POINTS; i++) {
        // Depois do fim da curva, repete o último ponto: a linha some
        // em vez de voltar para a origem.
        const p = prev.points[Math.min(i, n - 1)] ?? pos;
        trajPos[i * 3] = p.x;
        trajPos[i * 3 + 1] = p.y;
        trajPos[i * 3 + 2] = p.z;

        // Esmaece com a distância no tempo: o começo (mais confiável)
        // é forte, o fim (mais especulativo) é fraco.
        const t = i / (TRAJ_POINTS - 1);
        const fade = 1 - t * 0.85;
        const c = i >= n ? corSegura : base;
        trajCol[i * 3] = c.r * fade;
        trajCol[i * 3 + 1] = c.g * fade;
        trajCol[i * 3 + 2] = c.b * fade;
      }
      trajGeo.getAttribute('position').needsUpdate = true;
      trajGeo.getAttribute('color').needsUpdate = true;
      trajGeo.setDrawRange(0, n);
      traj.visible = true;

      // ---- Linha de força ----
      // Escala logarítmica: a força varia por ordens de grandeza entre a
      // borda da influência e a superfície; linear estouraria a tela.
      const comprimento = Math.min(220, 18 * Math.log2(1 + intensidade) + 12);
      const dir = { x: g.x / intensidade, y: g.y / intensidade, z: g.z / intensidade };
      const fp = forceGeo.getAttribute('position') as THREE.BufferAttribute;
      fp.setXYZ(0, pos.x, pos.y, pos.z);
      fp.setXYZ(
        1,
        pos.x + dir.x * comprimento,
        pos.y + dir.y * comprimento,
        pos.z + dir.z * comprimento,
      );
      fp.needsUpdate = true;
      forceMat.color.copy(prev.impact ? corImpacto : corAlerta);
      force.visible = true;

      // ---- Anel de captura do corpo dominante ----
      const dom = dominantBody(bodies, pos);
      if (dom) {
        const r = captureRadius(dom.body);
        ring.position.set(dom.body.pos[0], dom.body.pos[1], dom.body.pos[2]);
        ring.scale.setScalar(r);
        // Encara a nave, para o anel nunca aparecer de perfil (invisível).
        ring.lookAt(pos.x, pos.y, pos.z);
        ring.visible = true;
      } else {
        ring.visible = false;
      }
    },

    dispose(): void {
      trajGeo.dispose();
      trajMat.dispose();
      forceGeo.dispose();
      forceMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}
