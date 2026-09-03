/**
 * Espelho do catálogo de torpedos, para a INTERFACE.
 *
 * Existe por um motivo específico: quando um lançamento não sai, o
 * servidor simplesmente ignora o pedido. Do lado do jogador, isso é
 * indistinguível de um bug — a tecla não faz nada e não há como saber
 * se falta lançador, se o alvo está longe demais, ou se ainda está em
 * espera. Com os números aqui, a interface consegue DIZER o motivo.
 *
 * A fonte de verdade continua sendo `crates/sim-core/src/ship/torpedo.rs`.
 * O servidor confere tudo de novo antes de criar qualquer coisa: isto é
 * previsão para explicar, não autoridade.
 */

export interface TorpedoUiInfo {
  nome: string;
  /** Distância máxima para adquirir a trava, em unidades. */
  lockRange: number;
  damage: number;
  speed: number;
  /** Casco do torpedo — quanto dano é preciso para abatê-lo. */
  hp: number;
}

const TORPEDOS: Record<string, TorpedoUiInfo> = {
  torpedo_seeker: {
    nome: 'Torpedo Perseguidor',
    lockRange: 900,
    damage: 140,
    speed: 105,
    hp: 40,
  },
  torpedo_heavy: {
    nome: 'Torpedo Pesado',
    lockRange: 1200,
    damage: 380,
    speed: 85,
    hp: 120,
  },
};

export function torpedoUiInfo(templateId: string): TorpedoUiInfo | undefined {
  return TORPEDOS[templateId];
}

/** Ids conhecidos, para o teste de paridade com o servidor. */
export function torpedoIds(): string[] {
  return Object.keys(TORPEDOS);
}

/**
 * Lançador equipado no loadout, se houver.
 *
 * Mesma regra do servidor (`apply_loadout_and_skills`): o PRIMEIRO
 * lançador da lista é o que vale. Se as duas pontas discordassem sobre
 * qual, a interface anunciaria um alcance e o servidor usaria outro.
 */
export function equippedTorpedo(templateIds: readonly string[]): TorpedoUiInfo | undefined {
  for (const id of templateIds) {
    const t = TORPEDOS[id];
    if (t) return t;
  }
  return undefined;
}

/** Por que um lançamento não pode acontecer agora. */
export type TorpedoBlock = 'sem-lancador' | 'sem-alvo' | 'fora-de-alcance' | null;

/**
 * Decide se dá para lançar, e por que não.
 *
 * Devolver o MOTIVO, e não só um booleano, é o ponto: "não dá" repetido
 * na tela não ensina nada, enquanto "fora de alcance" diz ao jogador que
 * ele precisa se aproximar.
 */
export function torpedoBlock(
  lancador: TorpedoUiInfo | undefined,
  alvoDistancia: number | null,
): TorpedoBlock {
  if (!lancador) return 'sem-lancador';
  if (alvoDistancia === null) return 'sem-alvo';
  if (alvoDistancia > lancador.lockRange) return 'fora-de-alcance';
  return null;
}

/** Mensagem para o jogador. */
export function torpedoBlockMessage(motivo: TorpedoBlock, lancador?: TorpedoUiInfo): string {
  switch (motivo) {
    case 'sem-lancador':
      return 'Sem lançador de torpedos — equipe um no estaleiro';
    case 'sem-alvo':
      return 'Sem alvo: use Tab para travar alguém';
    case 'fora-de-alcance':
      return lancador
        ? `Alvo fora do alcance de travamento (${lancador.lockRange} u)`
        : 'Alvo fora do alcance de travamento';
    case null:
      return '';
  }
}
