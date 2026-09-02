/**
 * Progressão da conta: nível, XP e skills desbloqueadas.
 *
 * Existe porque a árvore de skills era decorativa. Os nós estavam no
 * banco (`account_skills`), a interface mostrava "+5% weapon damage", o
 * jogador gastava pontos — e nada disso saía do cliente. O servidor de
 * jogo nunca via as skills, então o tiro não mudava.
 *
 * O que sai daqui vai no `Join`, junto com o loadout: apenas IDS. Quem
 * converte id em número é o servidor (`sim_core::ship::skills`).
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080';

export interface AccountSkill {
  branch: string;
  node: string;
  level: number;
}

export interface Progression {
  level: number;
  totalXp: number;
  availablePoints: number;
  skills: AccountSkill[];
}

/**
 * Busca a progressão da conta.
 *
 * Devolve `null` em qualquer falha em vez de lançar: entrar na arena não
 * pode depender da API de progressão estar no ar. Sem skills o jogador
 * voa com os números do catálogo, que é exatamente o comportamento
 * anterior — degrada, não quebra.
 */
export async function fetchProgression(): Promise<Progression | null> {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/progression/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    // A API embrulha a resposta em `{ progression: ... }`.
    const body = (await res.json()) as { progression?: Progression };
    const p = body.progression;
    // Sem o array de skills não há o que enviar; devolver o objeto
    // meio-montado faria `skillNodeIds` estourar no meio do lançamento.
    return p && Array.isArray(p.skills) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Ids de nó para mandar ao servidor de jogo.
 *
 * Um nó comprado mais de uma vez (`level > 1`) entra repetido: é assim
 * que o servidor acumula o modificador, e é o mesmo número de vezes que
 * a conta pagou.
 */
export function skillNodeIds(p: Progression | null): string[] {
  if (!p || !Array.isArray(p.skills)) return [];
  const ids: string[] = [];
  for (const s of p.skills) {
    const vezes = Math.max(1, Math.floor(s.level));
    for (let i = 0; i < vezes; i++) ids.push(s.node);
  }
  return ids;
}
