import { defineQuery } from 'bitecs';
import { world } from '../world';
import { Transform } from '../components/transform';
import { ShipTag } from '../components/ship';

const ships = defineQuery([ShipTag, Transform]);

/** Rotaciona a nave em torno do eixo Y a 0.1 rad/s. */
export function spinSystem(dt: number): void {
  const entities = ships(world) as readonly number[];
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    if (eid === undefined) continue;
    // noUncheckedIndexedAccess faz TypedArray[idx] ser number|undefined;
    // sabemos que o eid está dentro do storage.
    const current = Transform.rotY[eid] ?? 0;
    Transform.rotY[eid] = current + dt * 0.1;
  }
}
