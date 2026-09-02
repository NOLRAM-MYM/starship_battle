import * as THREE from 'three/webgpu';
import { CameraRig, fovForAspect } from './CameraRig';
import { attachCameraFill, createLightingRig, type LightingRig } from './lighting';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
}

/**
 * Subset do `WebXRManager` do three.js que usamos. Os tipos
 * `@types/three@0.170.0` declaram `WebGPURenderer.xr` como apenas
 * `{ enabled: boolean }` (XR WebGPU ainda não está totalmente
 * tipado), mas em runtime o objeto expõe `setSession`/`getSession`
 * (a implementação do three reusa o `WebXRManager` do WebGL).
 * Mantemos o tipo local para não `any`-castar no call-site.
 */
export interface XrManagerLike {
  enabled: boolean;
  setSession: (session: XRSession | null) => Promise<void>;
  getSession: () => XRSession | null;
}

/**
 * Renderer do jogo.
 *
 * Além do que já fazia, agora: aplica tone mapping ACES (sem ele o
 * emissivo dos motores estoura em branco puro), monta o rig de luzes da
 * cena de combate, expõe um `CameraRig` amortecido e permite renderizar
 * uma cena alternativa — é assim que o hangar 3D aparece atrás da UI sem
 * criar um segundo contexto WebGPU.
 */
export class GameRenderer {
  readonly three: THREE.WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig;
  readonly lights: LightingRig;
  /** Habilita o pipeline XR (stereo rendering, controllers, ...). */
  xrEnabled: boolean = false;

  constructor(opts: RendererOptions) {
    this.three = new THREE.WebGPURenderer({
      canvas: opts.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // ACES + exposure ligeiramente acima de 1: preserva o brilho dos
    // motores e do plasma sem lavar o preto do espaço.
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060d);
    // Névoa exponencial fraca: dá profundidade a asteroides distantes.
    this.scene.fog = new THREE.FogExp2(0x060a14, 0.0016);

    this.lights = createLightingRig(this.scene);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1e6);
    this.camera.position.set(0, 12, 42);

    this.rig = new CameraRig(this.camera, { distance: 34, height: 11, stiffness: 6 });

    // Preenchimento preso ao olho: as luzes direcionais fixas deixavam
    // a nave quase preta sempre que ela voava para o lado escuro em
    // relação à key — metade do tempo, na prática.
    attachCameraFill(this.lights, this.camera, this.scene);
  }

  /**
   * Ajusta buffer e projeção ao tamanho de EXIBIÇÃO do canvas.
   *
   * O `false` em `setSize` significa "não escreva `canvas.style`" — quem
   * dimensiona a exibição é o CSS (`canvas#game-canvas` fixo no
   * viewport). Sem essa regra de CSS o canvas assumia o tamanho do
   * buffer (janela x devicePixelRatio) e a cena saía da tela.
   *
   * `setPixelRatio` é reaplicado aqui porque o DPR muda quando a janela
   * vai para um monitor de densidade diferente.
   */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.three.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Sem isto, uma janela alta e fina corta a cena nas laterais.
    this.camera.fov = fovForAspect(70, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Mede o canvas e devolve o tamanho de exibição em pixels CSS.
   * Usa o retângulo real do elemento, não `window.inner*`: barra de
   * ferramentas móvel e zoom da página deslocam um do outro.
   */
  displaySize(): { width: number; height: number } {
    const el = this.three.domElement as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(r.width || window.innerWidth)),
      height: Math.max(1, Math.round(r.height || window.innerHeight)),
    };
  }

  async init(): Promise<void> {
    await this.three.init();
  }

  /**
   * Habilita o XR no WebGPURenderer. Deve ser chamado ANTES de
   * `requestVrSession()` no cliente. Idempotente.
   */
  enableXr(): void {
    this.three.xr.enabled = true;
    this.xrEnabled = true;
  }

  /**
   * Retorna o `WebXRManager` do three para gerenciar a sessão
   * (`setSession` / `getSession`). O tipo declarado em
   * `@types/three@0.170.0` para `WebGPURenderer.xr` é parcial —
   * fazemos um cast estrutural para o subset que efetivamente
   * usamos (vide `XrManagerLike`).
   */
  getXrManager(): XrManagerLike {
    return this.three.xr as unknown as XrManagerLike;
  }

  /**
   * Desenha a cena de combate, ou a cena passada por argumento
   * (usado pelo hangar/estaleiro).
   */
  render(scene?: THREE.Scene, camera?: THREE.PerspectiveCamera): void {
    // A presença de uma sessão XR ativa altera o pipeline interno
    // (stereo + reference space) automaticamente.
    this.three.render(scene ?? this.scene, camera ?? this.camera);
  }
}
