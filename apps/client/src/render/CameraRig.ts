/**
 * Rig de câmera com amortecimento — o coração da "sensação" de pilotar.
 *
 * O loop antigo escrevia `camera.position = shipPos + 50` a cada frame:
 * a câmera colava na nave e qualquer correção de snapshot virava um
 * tranco. Aqui a câmera persegue um alvo com mola crítica, olha à frente
 * na direção do movimento, abre o FOV com a velocidade e treme quando
 * a nave leva dano.
 *
 * A matemática de suavização é pura (`damp`) e testada isoladamente.
 */

import * as THREE from 'three/webgpu';

/**
 * Interpolação exponencial independente de framerate.
 * `lambda` maior = mais rígido. Equivale a lerp(a,b,1-e^(-λ·dt)).
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * FOV em função da velocidade: acelerar "abre" a lente e amplifica a
 * sensação de rapidez. Saturação em `maxSpeed` evita enjoo.
 */
export function fovForSpeed(speed: number, base = 70, boost = 14, maxSpeed = 120): number {
  if (!Number.isFinite(speed) || speed <= 0) return base;
  const t = Math.min(1, speed / maxSpeed);
  // easeOut: ganho grande já nas primeiras velocidades.
  return base + boost * (1 - (1 - t) * (1 - t));
}

/**
 * Corrige o FOV vertical para telas estreitas.
 *
 * `PerspectiveCamera.fov` é VERTICAL: numa janela alta e fina, o campo
 * horizontal encolhe junto com a largura e a cena parece "fechar" nas
 * laterais. Aqui garantimos um campo horizontal mínimo, abrindo o
 * vertical quando necessário — a mesma ideia do "Hor+" dos consoles.
 *
 * Em telas largas devolve `baseFov` sem mexer.
 */
export function fovForAspect(baseFov: number, aspect: number, minHorizontalFov = 75): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return baseFov;
  const vRad = (baseFov * Math.PI) / 180;
  const hRad = 2 * Math.atan(Math.tan(vRad / 2) * aspect);
  const minHRad = (minHorizontalFov * Math.PI) / 180;
  if (hRad >= minHRad) return baseFov;
  // Recalcula o vertical que produz exatamente o horizontal mínimo.
  const correctedV = 2 * Math.atan(Math.tan(minHRad / 2) / aspect);
  // Teto de 100° para não distorcer demais em telas muito estreitas.
  return Math.min(100, (correctedV * 180) / Math.PI);
}

export interface CameraRigOptions {
  /** Distância atrás do alvo. */
  distance?: number;
  /** Altura acima do alvo. */
  height?: number;
  /** Rigidez do acompanhamento de posição. */
  stiffness?: number;
}

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly distance: number;
  private readonly height: number;
  private readonly stiffness: number;

  /** Posição suavizada do alvo (não a da câmera). */
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();

  private shake = 0;
  private currentFov: number;
  private initialized = false;

  constructor(camera: THREE.PerspectiveCamera, opts: CameraRigOptions = {}) {
    this.camera = camera;
    this.distance = opts.distance ?? 34;
    this.height = opts.height ?? 11;
    this.stiffness = opts.stiffness ?? 6;
    this.currentFov = camera.fov;
  }

  /** Adiciona trepidação (0..1). Chamado ao levar dano ou explodir perto. */
  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + Math.max(0, amount));
  }

  /**
   * Atualiza a câmera para seguir `targetPos`, orientada por `targetQuat`
   * e com antecipação na direção de `velocity`.
   */
  update(
    dt: number,
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion,
    velocity: THREE.Vector3,
  ): void {
    // Primeiro frame: encaixa sem animar, senão a câmera "voa" da origem.
    if (!this.initialized) {
      this.focus.copy(targetPos);
      this.initialized = true;
    }

    this.focus.x = damp(this.focus.x, targetPos.x, this.stiffness, dt);
    this.focus.y = damp(this.focus.y, targetPos.y, this.stiffness, dt);
    this.focus.z = damp(this.focus.z, targetPos.z, this.stiffness, dt);

    // Posição desejada: ATRÁS e acima da nave.
    //
    // A frente do servidor é +Z (`forward()` devolve (0,0,1) na
    // identidade), então "atrás" é -Z local. A versão anterior usava
    // +Z e colocava a câmera na FRENTE da nave — de onde o voo parecia
    // ser de ré.
    this.desired.set(0, this.height, -this.distance).applyQuaternion(targetQuat).add(this.focus);

    // A câmera é mais frouxa que o foco -> leve atraso ao acelerar.
    const camLambda = this.stiffness * 0.75;
    this.camera.position.x = damp(this.camera.position.x, this.desired.x, camLambda, dt);
    this.camera.position.y = damp(this.camera.position.y, this.desired.y, camLambda, dt);
    this.camera.position.z = damp(this.camera.position.z, this.desired.z, camLambda, dt);

    // Olha um pouco à frente do movimento, não para a nave em si.
    const speed = velocity.length();
    this.lookAt.copy(this.focus).addScaledVector(velocity, 0.22);
    this.camera.lookAt(this.lookAt);

    // FOV dinâmico, também amortecido para não pulsar com jitter de rede,
    // e corrigido para a proporção da janela (telas estreitas).
    const targetFov = fovForAspect(fovForSpeed(speed), this.camera.aspect);
    this.currentFov = damp(this.currentFov, targetFov, 3.5, dt);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    // Trepidação: ruído decrescente aplicado depois do lookAt.
    if (this.shake > 0.001) {
      const mag = this.shake * this.shake * 1.6;
      this.shakeOffset.set(
        (Math.random() - 0.5) * mag,
        (Math.random() - 0.5) * mag,
        (Math.random() - 0.5) * mag,
      );
      this.camera.position.add(this.shakeOffset);
      this.shake = damp(this.shake, 0, 4.5, dt);
    } else {
      this.shake = 0;
    }
  }
}
