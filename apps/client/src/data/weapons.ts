/**
 * Espelho do catálogo de armas do servidor, só para a INTERFACE.
 *
 * A fonte de verdade é `crates/sim-core/src/ship/weapons.rs`: o dano, a
 * cadência e o efeito da carga são decididos lá, e o cliente nunca
 * envia números — só o id do template equipado. O que existe aqui são
 * os mesmos valores duplicados para desenhar a barra de carga e dizer
 * ao jogador o que ele está prestes a disparar.
 *
 * Estava espalhado como uma tabela solta dentro de `main.ts`, que só
 * conhecia o tempo de carga. Sem o multiplicador de dano e o nome, a
 * barra enchia sem informar nada: o jogador segurava o gatilho sem
 * saber se estava ganhando 2,6× ou nada (o laser não carrega).
 */

/** Família visual, na mesma ordem do `WeaponVisual` do servidor. */
export const WEAPON_VISUAL = {
  Kinetic: 0,
  Laser: 1,
  Plasma: 2,
  Lance: 3,
} as const;

export interface WeaponUiInfo {
  /** Nome curto, para o HUD. */
  nome: string;
  /** Segundos até a carga máxima. 0 = a arma não carrega. */
  tempoDeCarga: number;
  /** Multiplicador de dano com carga cheia. */
  danoMax: number;
  /** Família visual do projétil. */
  visual: number;
  /** Velocidade do projétil (u/s). Alimenta a solução de mira. */
  velocidade: number;
  /** Tempo de vida do projétil (s) — o alcance efetivo. */
  alcanceSegundos: number;
}

const ARMAS: Record<string, WeaponUiInfo> = {
  railgun_s: {
    nome: 'Canhão Linear',
    tempoDeCarga: 0.9,
    danoMax: 2.6,
    visual: WEAPON_VISUAL.Kinetic,
    velocidade: 190,
    alcanceSegundos: 2.6,
  },
  laser_burst: {
    nome: 'Laser em Rajada',
    // Não carrega de propósito: a identidade dela é volume de fogo.
    tempoDeCarga: 0,
    danoMax: 1,
    visual: WEAPON_VISUAL.Laser,
    velocidade: 240,
    alcanceSegundos: 1.8,
  },
  plasma_m: {
    nome: 'Canhão de Plasma',
    tempoDeCarga: 1.6,
    danoMax: 3.0,
    visual: WEAPON_VISUAL.Plasma,
    velocidade: 120,
    alcanceSegundos: 3.4,
  },
  lance_singular: {
    nome: 'Lança Singular',
    tempoDeCarga: 2.5,
    danoMax: 3.4,
    visual: WEAPON_VISUAL.Lance,
    velocidade: 320,
    alcanceSegundos: 4.0,
  },
};

/**
 * Arma de serviço: o que o servidor dá a quem voa sem canhão.
 *
 * Não é um template — ninguém a equipa. É o `DEFAULT_WEAPON` de
 * `resolve_loadout`, e existe para que voar desarmado seja uma
 * desvantagem real sem deixar o jogador sem resposta nenhuma.
 *
 * Faltava aqui, e a consequência era pior que a arma fraca: a interface
 * ficava MUDA. Sem nome no HUD, sem barra de carga e sem marcador de
 * mira, quem montasse uma nave só de torpedos atirava com um canhão que
 * o jogo nunca mencionou e concluía, com razão, que a arma estava
 * quebrada.
 */
export const ARMA_DE_SERVICO: WeaponUiInfo = {
  nome: 'Canhão de Serviço',
  tempoDeCarga: 0,
  danoMax: 1,
  visual: WEAPON_VISUAL.Kinetic,
  velocidade: 100,
  alcanceSegundos: 3,
};

export function weaponUiInfo(templateId: string): WeaponUiInfo | undefined {
  return ARMAS[templateId];
}

/** Ids de arma conhecidos, para os testes de paridade com o servidor. */
export function weaponIds(): string[] {
  return Object.keys(ARMAS);
}

/**
 * Arma primária de um loadout.
 *
 * Mesma regra do servidor (`resolve_loadout`): a PRIMEIRA arma da lista
 * é a primária. Se as duas pontas discordassem sobre qual é, a barra de
 * carga mostraria uma arma e o tiro sairia de outra.
 */
export function primaryWeapon(templateIds: readonly string[]): WeaponUiInfo {
  for (const id of templateIds) {
    const w = ARMAS[id];
    if (w) return w;
  }
  // Nunca `undefined`: o servidor SEMPRE arma a nave, e devolver nada
  // aqui fazia o HUD esconder o que ela de fato dispara.
  return ARMA_DE_SERVICO;
}

/** A nave está com a arma de serviço, isto é, sem canhão equipado? */
export function semCanhao(templateIds: readonly string[]): boolean {
  return !templateIds.some((id) => id in ARMAS);
}

/**
 * Multiplicador de dano da carga atual, para exibição.
 *
 * A escala é QUADRÁTICA, igual à do servidor (`WeaponProfile::charged`):
 * metade do tempo dá bem menos que metade do bônus. Mostrar uma curva
 * linear aqui faria o jogador soltar cedo achando que já valeu.
 */
export function chargeMultiplier(w: WeaponUiInfo, fracao: number): number {
  if (w.tempoDeCarga <= 0) return 1;
  const t = Math.min(1, Math.max(0, fracao));
  return 1 + (w.danoMax - 1) * t * t;
}
