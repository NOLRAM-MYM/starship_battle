/**
 * Efeito das skills sobre os números mostrados no hangar.
 *
 * Espelho de `crates/sim-core/src/ship/skills.rs`, e pelo mesmo motivo
 * do espelho de armas: o cliente precisa ANTECIPAR o que o servidor vai
 * calcular, para o painel do estaleiro não mentir.
 *
 * O painel mostrava o DPS do equipamento puro. Com o ramo de combate
 * comprado, o dano real era 20,75% maior que o exibido — o jogador
 * gastava pontos e o número não se mexia, exatamente o sintoma que fazia
 * a árvore parecer decorativa.
 *
 * Quem DECIDE continua sendo o servidor. Isto é previsão, não autoridade:
 * o cliente manda ids e recebe o resultado.
 */

export interface CombatMods {
  damageMult: number;
  fireRateMult: number;
  /** 0..1 — fração do dano que ignora o escudo alvo. */
  shieldPierce: number;
  chargeTimeMult: number;
}

export const NO_MODS: CombatMods = {
  damageMult: 1,
  fireRateMult: 1,
  shieldPierce: 0,
  chargeTimeMult: 1,
};

/**
 * Efeito de um nó. `undefined` para nós que não tocam no combate.
 *
 * Os valores batem com `node_effect` em Rust — há teste de paridade
 * contra uma fixture gerada pelo próprio servidor.
 */
const EFEITOS: Record<string, Partial<CombatMods>> = {
  combat_t1: { damageMult: 1.05 },
  combat_t2: { fireRateMult: 1.1 },
  // "Critical Strike +15% crit chance" vira o valor ESPERADO
  // equivalente: sem sistema de crítico, um acerto aleatório seria dano
  // não determinístico, e o servidor precisa ser replicável.
  combat_t3: { damageMult: 1.15 },
  combat_t4: { shieldPierce: 0.1 },
  combat_t5: { damageMult: 1.12 },
};

/**
 * Acumula os nós desbloqueados.
 *
 * Multiplicadores compõem por MULTIPLICAÇÃO (dois nós de +10% dão +21%,
 * não +20%) e a perfuração soma com teto em 1 — as duas regras iguais às
 * do servidor. Divergir aqui faria o hangar prometer um número e a
 * arena entregar outro.
 */
export function combatMods(nodeIds: readonly string[]): CombatMods {
  const acc: CombatMods = { ...NO_MODS };
  for (const id of nodeIds) {
    const e = EFEITOS[id];
    if (!e) continue;
    acc.damageMult *= e.damageMult ?? 1;
    acc.fireRateMult *= e.fireRateMult ?? 1;
    acc.chargeTimeMult *= e.chargeTimeMult ?? 1;
    acc.shieldPierce = Math.min(1, acc.shieldPierce + (e.shieldPierce ?? 0));
  }
  return acc;
}

/** True se os modificadores mudam alguma coisa de fato. */
export function hasEffect(m: CombatMods): boolean {
  return (
    m.damageMult !== 1 || m.fireRateMult !== 1 || m.shieldPierce > 0 || m.chargeTimeMult !== 1
  );
}

/** Ids de nó com efeito de combate — para os testes de paridade. */
export function combatNodeIds(): string[] {
  return Object.keys(EFEITOS);
}

/** Só a parte de combate de `AggregateStats`, para não acoplar os módulos. */
interface StatsComCombate {
  damage: number;
  fireRate: number;
  dps: number;
}

/**
 * Aplica os modificadores aos números do painel.
 *
 * O `dps` é RECALCULADO de dano × cadência em vez de multiplicado pelo
 * ganho de dano: as duas skills se compõem, e multiplicar só o dano
 * perderia o ganho de cadência.
 */
export function applyModsToStats<T extends StatsComCombate>(stats: T, m: CombatMods): T {
  const damage = stats.damage * m.damageMult;
  const fireRate = stats.fireRate * m.fireRateMult;
  return {
    ...stats,
    damage: Math.round(damage * 10) / 10,
    fireRate: Math.round(fireRate * 100) / 100,
    dps: Math.round(damage * fireRate * 10) / 10,
  };
}
