import { GameRenderer } from './render/Renderer';
import { createStarfield } from './render/Starfield';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  if (!navigator.gpu) {
    document.body.innerHTML = '<h1>Navegador sem suporte a WebGPU. Use Chrome 113+ ou Firefox 121+.</h1>';
    return;
  }

  const renderer = new GameRenderer({ canvas });
  await renderer.init();
  renderer.resize(window.innerWidth, window.innerHeight);

  const stars = createStarfield();
  renderer.scene.add(stars);

  let t0 = performance.now();
  const tick = (): void => {
    const t = (performance.now() - t0) / 1000;
    stars.rotation.y = t * 0.01;
    renderer.render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
  });

  console.info('[bootstrap] scene running');
}

bootstrap().catch((err) => console.error('[bootstrap] failed', err));
