/**
 * Tipos do módulo de missões.
 */

/** Status de uma missão aceita por um jogador. */
export type QuestStatus = 'available' | 'accepted' | 'in_progress' | 'completed' | 'failed' | 'abandoned';

/** Tipos de objetivo (objective). */
export type ObjectiveKind = 'kill' | 'collect' | 'explore' | 'destroy' | 'deliver';

/** Definição de um objetivo dentro de um template. */
export interface ObjectiveTemplate {
  /** Identificador único dentro do template. */
  id: string;
  kind: ObjectiveKind;
  /** Alvo (inimigo tipo, item code, sector id, etc.). */
  target: string;
  /** Quantidade necessária. */
  count: number;
  /** Descrição exibida no UI. */
  description: string;
}

/** Recompensa de um template. */
export interface QuestReward {
  credits?: number;
  gold?: number;
  dark_matter?: number;
  experience?: number;
  items?: { itemCode: string; quantity: number }[];
}

/** Definição estática de uma missão (data-driven). */
export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  /** Nível mínimo recomendado. */
  recommendedLevel: number;
  objectives: ObjectiveTemplate[];
  reward: QuestReward;
  /** Repetível? */
  repeatable: boolean;
  /** Pré-requisitos (outros template ids). */
  prerequisites: string[];
}

/** Progresso de um objetivo específico dentro de uma instância. */
export interface ObjectiveProgress {
  objectiveId: string;
  current: number;
  required: number;
  completed: boolean;
}

/** Instância de missão aceita por um jogador. */
export interface QuestInstance {
  id: number;
  accountId: number;
  templateId: string;
  status: QuestStatus;
  progress: ObjectiveProgress[];
  acceptedAt: Date;
  completedAt: Date | null;
}

/** Evento de progresso enviado pelo cliente/servidor de jogo. */
export interface ProgressEvent {
  accountId: number;
  templateId: string;
  objectiveId: string;
  /** Incremento a aplicar. */
  amount: number;
}

export function isValidObjectiveKind(s: string): s is ObjectiveKind {
  return s === 'kill' || s === 'collect' || s === 'explore' || s === 'destroy' || s === 'deliver';
}
