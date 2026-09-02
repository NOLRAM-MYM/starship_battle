/**
 * Painéis HUD em world-space para uso dentro da sessão XR.
 *
 * Cada painel é um `THREE.Group` com:
 *   - um mesh de fundo (`BoxGeometry(1, 0.3, 0.05)`, preto 60% alpha)
 *   - um mesh filho com `CanvasTexture` exibindo o texto
 *
 * Implementação intencionalmente simples: sem raycasting, sem
 * billboard, sem animação. É um ponto de extensão para a Fase 6.
 */

import * as THREE from 'three/webgpu';

const PANEL_WIDTH = 1;
const PANEL_HEIGHT = 0.3;
const PANEL_DEPTH = 0.05;
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 128;

interface HudUserData {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  texture: THREE.CanvasTexture | null;
}

function getUserData(group: THREE.Group): HudUserData {
  const ud = group.userData as Partial<HudUserData> | undefined;
  return {
    canvas: (ud?.canvas ?? null) as HTMLCanvasElement | OffscreenCanvas | null,
    ctx: (ud?.ctx ?? null) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
    texture: (ud?.texture ?? null) as THREE.CanvasTexture | null,
  };
}

function createCanvas(): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null } {
  // Preferência: OffscreenCanvas (mais performático em workers)
  // Fallback: HTMLCanvasElement regular
  // Fallback final (testes sem `document`): canvas "vazio" — devolvemos
  // um stub que será descartado por `createHudPanel`.
  if (typeof document === 'undefined') {
    return { canvas: null as unknown as HTMLCanvasElement, ctx: null };
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const oc = new OffscreenCanvas(TEXTURE_WIDTH, TEXTURE_HEIGHT);
    const ctx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    return { canvas: oc, ctx };
  }
  const c = document.createElement('canvas');
  c.width = TEXTURE_WIDTH;
  c.height = TEXTURE_HEIGHT;
  const ctx = c.getContext('2d');
  return { canvas: c, ctx };
}

function drawText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  canvas: HTMLCanvasElement | OffscreenCanvas | null,
  text: string,
): void {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2);
}

export function createHudPanel(text: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'XrHudPanel';

  // Mesh de fundo (painel preto translúcido).
  const bgGeo = new THREE.BoxGeometry(PANEL_WIDTH, PANEL_HEIGHT, PANEL_DEPTH);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.6,
  });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  group.add(bg);

  // Canvas com texto.
  const { canvas, ctx } = createCanvas();

  let texture: THREE.CanvasTexture | null = null;
  if (canvas && typeof THREE.CanvasTexture === 'function') {
    texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    drawText(ctx, canvas, text);
    texture.needsUpdate = true;

    const textGeo = new THREE.PlaneGeometry(PANEL_WIDTH * 0.95, PANEL_HEIGHT * 0.9);
    const textMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const textMesh = new THREE.Mesh(textGeo, textMat);
    // Ligeiramente à frente do painel preto, para evitar z-fighting.
    textMesh.position.z = PANEL_DEPTH / 2 + 0.001;
    group.add(textMesh);
  }

  group.userData = {
    canvas,
    ctx,
    texture,
  } as HudUserData;

  return group;
}

export function updateHudText(panel: THREE.Group, text: string): void {
  const ud = getUserData(panel);
  if (!ud.ctx || !ud.canvas) return;
  drawText(ud.ctx, ud.canvas, text);
  if (ud.texture) {
    ud.texture.needsUpdate = true;
  }
}
