import { Types, defineComponent } from 'bitecs';

export const Transform = defineComponent({
  posX: Types.f32,
  posY: Types.f32,
  posZ: Types.f32,
  rotX: Types.f32,
  rotY: Types.f32,
  rotZ: Types.f32,
  scale: Types.f32,
});
