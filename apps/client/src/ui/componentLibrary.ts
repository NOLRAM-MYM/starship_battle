export type SlotKindName = 'Engine' | 'Weapon' | 'Shield' | 'Sensor' | 'Cargo' | 'Stealth';

export interface UiComponentTemplate {
  id: string;
  name: string;
  kind: SlotKindName;
  tier: 1 | 2 | 3 | 4 | 5;
  mass: number;
}

export const COMPONENT_LIBRARY: UiComponentTemplate[] = [
  { id: 'engine_mk1', name: 'Motor MK-I', kind: 'Engine', tier: 1, mass: 10 },
  { id: 'engine_mk3', name: 'Motor MK-III', kind: 'Engine', tier: 3, mass: 25 },
  { id: 'railgun_s', name: 'Canhão Linear S', kind: 'Weapon', tier: 1, mass: 20 },
  { id: 'plasma_m', name: 'Canhão Plasma M', kind: 'Weapon', tier: 3, mass: 45 },
  { id: 'shield_bio', name: 'Escudo Biônico', kind: 'Shield', tier: 2, mass: 15 },
  { id: 'sensor_array', name: 'Array Sensores', kind: 'Sensor', tier: 1, mass: 5 },
  { id: 'cargo_x2', name: 'Carga Expansão +2', kind: 'Cargo', tier: 1, mass: 8 },
  { id: 'cloak_lvl1', name: 'Camuflagem I', kind: 'Stealth', tier: 1, mass: 12 },
];
