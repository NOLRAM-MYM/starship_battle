import { Types, defineComponent } from 'bitecs';

/**
 * Tags marcador para entidades vivas do mundo (Fase 4).
 * Cada um identifica a categoria de payload lido do servidor.
 */
export const NpcTag = defineComponent();
export const AsteroidTag = defineComponent();
export const AnomalyTag = defineComponent();
export const WreckTag = defineComponent();

/**
 * Dados numéricos compartilhados pelas 4 categorias.
 * `kind` mapeia a categoria interna (0=Npc, 1=Asteroid, 2=Anomaly, 3=Wreck)
 * para que o renderer consiga distinguir sem precisar de múltiplos componentes
 * via query, e `subKind` carrega o archetype (npc) ou kind (asteroid/anomaly).
 */
export const WorldEntityKind = defineComponent({
  kind: Types.ui8,
  subKind: Types.ui8,
  radius: Types.f32,
});
