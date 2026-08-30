import { addEntity, addComponent } from 'bitecs';
import { world } from './ecs/world';
import { Transform } from './ecs/components/transform';
import { ShipTag } from './ecs/components/ship';
import { ShipStats } from './ecs/components/ship';
import { GameRenderer } from './render/Renderer';
import { createStarfield } from './render/Starfield';
import { spinSystem } from './ecs/systems/spin';

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

  // Cena: starfield + uma nave de teste (ECS)
  const stars = createStarfield();
  renderer.scene.add(stars);

  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  addComponent(world, ShipTag, eid);
  addComponent(world, ShipStats, eid);
  Transform.posX[eid] = 0;
  Transform.posY[eid] = 0;
  Transform.posZ[eid] = 0;
  Transform.scale[eid] = 1;
  ShipStats.mass[eid] = 1000;
  ShipStats.shieldMax[eid] = 500;
  ShipStats.shieldHp[eid] = 500;
  ShipStats.hullMax[eid] = 800;
  ShipStats.hullHp[eid] = 800;
  ShipStats.thrust[eid] = 50;

  let last = performance.now();
  const tick = (): void => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    spinSystem(dt);
    stars.rotation.y += dt * 0.01;
    renderer.render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
  });

  console.info('[bootstrap] scene running, eid=', eid);
}

bootstrap().catch((err) => console.error('[bootstrap] failed', err));
