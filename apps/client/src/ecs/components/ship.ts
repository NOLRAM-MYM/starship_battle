import { Types, defineComponent } from 'bitecs';

/** Tag marker: entidade é uma nave. */
export const ShipTag = defineComponent();

/** Stats agregados da nave (resultado de sim-core::ship::build_ship). */
export const ShipStats = defineComponent({
  mass: Types.f32,
  thrust: Types.f32,
  shieldHp: Types.f32,
  shieldMax: Types.f32,
  hullHp: Types.f32,
  hullMax: Types.f32,
  cargoCap: Types.f32,
  sensorRange: Types.f32,
  stealthRating: Types.f32,
});
