/**
 * Tipos do módulo de loadouts.
 */

export interface Loadout {
  id: number;
  accountId: number;
  name: string;
  data: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
