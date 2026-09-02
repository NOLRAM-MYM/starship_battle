/**
 * Rig de iluminação da cena.
 *
 * Antes desta camada os materiais `MeshStandard*` só reagiam à PointLight
 * que cada entidade carregava consigo — resultado: naves chapadas e mundo
 * preto. Aqui montamos um rig clássico de três pontos + hemisférica para
 * dar volume e leitura de silhueta sem custo de sombra dinâmica.
 */

import * as THREE from 'three/webgpu';
import type { RenderQuality } from './quality';

export interface LightingRig {
  /** Preenchimento ambiental frio (céu) / quente (chão de nebulosa). */
  hemi: THREE.HemisphereLight;
  /** Luz principal — define a forma. */
  key: THREE.DirectionalLight;
  /** Preenchimento oposto, evita sombra 100% preta. */
  fill: THREE.DirectionalLight;
  /** Contraluz que separa a nave do fundo. */
  rim: THREE.DirectionalLight;
  /**
   * Preenchimento preso à CÂMERA.
   *
   * As outras três luzes têm direção fixa no mundo, o que é certo para
   * dar volume — mas deixa a nave quase preta sempre que ela está do
   * lado escuro em relação à key, que é metade do tempo em combate. Esta
   * acompanha o olho: garante um mínimo de leitura em qualquer ângulo,
   * sem achatar a modelagem, porque é fraca e levemente deslocada para
   * cima e para o lado (luz de frente pura mataria o volume).
   */
  cameraFill: THREE.DirectionalLight;
  group: THREE.Group;
}

/**
 * Cria e adiciona o rig à cena. Intensidades calibradas para
 * `toneMapping = ACESFilmic` com `toneMappingExposure = 1.1`.
 */
export function createLightingRig(scene: THREE.Scene): LightingRig {
  const group = new THREE.Group();
  group.name = 'lighting-rig';

  const hemi = new THREE.HemisphereLight(0x5b7fb4, 0x1a1030, 0.55);

  const key = new THREE.DirectionalLight(0xdcecff, 2.2);
  key.position.set(60, 80, 40);

  const fill = new THREE.DirectionalLight(0x4a6ea8, 0.7);
  fill.position.set(-70, -20, 30);

  const rim = new THREE.DirectionalLight(0x9d7bff, 1.4);
  rim.position.set(-30, 20, -80);

  // Só existe depois de `attachCameraFill`; criada aqui para o rig ter
  // um objeto estável desde o começo.
  const cameraFill = new THREE.DirectionalLight(0xbcd4ff, 0.85);
  cameraFill.position.set(0.45, 0.8, 0);
  cameraFill.target.position.set(0, 0, -1);

  group.add(hemi, key, fill, rim);
  scene.add(group);

  return { hemi, key, fill, rim, cameraFill, group };
}

/**
 * Prende o preenchimento à câmera.
 *
 * A luz e o alvo dela viram FILHOS da câmera, então a direção
 * (posição → alvo) acompanha para onde o jogador está olhando sem
 * precisar de nenhuma atualização por quadro. A câmera precisa estar no
 * grafo da cena para os filhos receberem `matrixWorld`.
 */
export function attachCameraFill(rig: LightingRig, camera: THREE.Camera, scene: THREE.Scene): void {
  if (camera.parent !== scene) scene.add(camera);
  camera.add(rig.cameraFill);
  camera.add(rig.cameraFill.target);
}

/**
 * Ajusta o rig para o preset de qualidade gráfica.
 * Em `low` desligamos rim e fill (2 draws de luz a menos por material).
 */
export function applyQualityToRig(rig: LightingRig, quality: RenderQuality): void {
  const on = quality !== 'low';
  rig.rim.visible = on;
  rig.fill.visible = on;
  rig.key.intensity = quality === 'low' ? 2.6 : 2.2;
  // O preenchimento de câmera fica ATIVO até em `low`: sem ele a nave
  // some contra o fundo em metade dos ângulos, e isso é jogabilidade,
  // não enfeite. Em `low` ele até sobe, para compensar rim e fill
  // desligados.
  rig.cameraFill.intensity = quality === 'low' ? 1.15 : 0.85;
}
