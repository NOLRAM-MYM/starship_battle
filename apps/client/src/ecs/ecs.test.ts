import { describe, it, expect } from 'vitest';
import { addEntity, addComponent, createWorld, defineQuery } from 'bitecs';
import { Transform } from './components/transform';
import { ShipTag, ShipStats } from './components/ship';

describe('ECS smoke', () => {
  it('cria entidade com componentes e query retorna ela', () => {
    const w = createWorld();
    const eid = addEntity(w);
    addComponent(w, Transform, eid);
    addComponent(w, ShipTag, eid);
    addComponent(w, ShipStats, eid);
    Transform.posX[eid] = 1;
    ShipStats.mass[eid] = 100;

    const q = defineQuery([ShipTag, Transform, ShipStats]);
    const entities = q(w);
    expect(entities).toContain(eid);
    expect(Transform.posX[eid]).toBe(1);
    expect(ShipStats.mass[eid]).toBe(100);
  });
});
