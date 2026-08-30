import * as THREE from 'three/webgpu';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
}

export class GameRenderer {
  readonly three: THREE.WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor(opts: RendererOptions) {
    this.three = new THREE.WebGPURenderer({
      canvas: opts.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1e6);
    this.camera.position.set(0, 0, 50);
  }

  resize(width: number, height: number): void {
    this.three.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async init(): Promise<void> {
    await this.three.init();
  }

  render(): void {
    this.three.render(this.scene, this.camera);
  }
}
