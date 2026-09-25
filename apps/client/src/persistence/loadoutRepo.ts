export interface LoadoutSlotEntry {
  slotId: number;
  templateId: string;
  tier: number;
}

export interface SavedLoadout {
  id: number | string;
  name: string;
  slots: LoadoutSlotEntry[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Frotas-padrão para quem ainda não montou nenhuma nave.
 *
 * Os ids precisam existir no catálogo (`componentLibrary.ts`) e no
 * servidor. Estes usavam `laser_mk1`, `shield_mk1`, `plasma_cannon` e
 * `shield_heavy`, que não existem em lugar nenhum: o servidor ignorava
 * as peças e as três naves decolavam só com o motor — sem arma, sem
 * escudo. Todo jogador novo começava desarmado. O teste
 * `frotas-padrao.test.ts` confere os ids.
 *
 * E são um KIT INICIAL: só peças de nível 1 e 2. Uma conta nova começa com
 * zero créditos, então tudo aqui é de graça — o modelo "Destróier" vinha
 * com o melhor escudo do jogo (nível 4, 3.900 créditos), o que tornava a
 * loja dispensável. Cada um tem uma identidade diferente; subir de nível é
 * o que a loja passa a oferecer.
 */
export const DEFAULT_PRESET_LOADOUTS: SavedLoadout[] = [
  {
    id: 'preset_explorer',
    name: 'Cruzador Explorer Alpha',
    slots: [
      { slotId: 1, templateId: 'engine_mk1', tier: 1 },
      { slotId: 2, templateId: 'railgun_s', tier: 1 },
      { slotId: 3, templateId: 'sensor_array', tier: 1 },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_interceptor',
    name: 'Caça Interceptador Strike',
    slots: [
      { slotId: 1, templateId: 'engine_mk1', tier: 1 },
      { slotId: 2, templateId: 'laser_burst', tier: 2 },
      { slotId: 3, templateId: 'cloak_lvl1', tier: 1 },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'preset_heavy',
    name: 'Destróier de Batalha',
    slots: [
      { slotId: 1, templateId: 'engine_mk1', tier: 1 },
      { slotId: 2, templateId: 'railgun_s', tier: 1 },
      { slotId: 3, templateId: 'shield_bio', tier: 2 },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

import { mensagemDeErro } from '../net/apiErrors';

/**
 * Chave das naves salvas sem conta.
 *
 * Quem joga como visitante salvava a nave e a perdia: o salvamento
 * devolvia um id inventado e não gravava nada em lugar nenhum. Agora fica
 * no navegador, e some junto com os dados do site — não em silêncio no
 * instante seguinte.
 */
const CHAVE_LOCAL = 'batle.frotasLocais';

/**
 * Token da sessão, ou `null`.
 *
 * Em `try`/`catch` porque nem todo contexto tem `localStorage`: num
 * ambiente sem ele (teste, renderização fora do navegador) a leitura
 * direta lança e derruba o hangar inteiro.
 */
function tokenDaSessao(): string | null {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

function esquecerToken(): void {
  try {
    localStorage.removeItem('token');
  } catch {
    // Sem armazenamento não há token para esquecer.
  }
}

function lerLocais(): SavedLoadout[] {
  try {
    const cru = localStorage.getItem(CHAVE_LOCAL);
    if (!cru) return [];
    const v: unknown = JSON.parse(cru);
    return Array.isArray(v) ? (v as SavedLoadout[]) : [];
  } catch {
    // Armazenamento indisponível (modo privado) ou conteúdo corrompido:
    // o jogador volta a ver só os modelos padrão.
    return [];
  }
}

function gravarLocais(lista: SavedLoadout[]): void {
  try {
    localStorage.setItem(CHAVE_LOCAL, JSON.stringify(lista));
  } catch {
    // Sem armazenamento a nave vale para esta sessão. Melhor que perder
    // a sessão inteira por causa de uma gravação.
  }
}

/** Id de uma nave que só existe neste navegador. */
export function ehLoadoutLocal(id: number | string): boolean {
  return typeof id === 'string' && id.startsWith('local_');
}

/** Id de um dos modelos oferecidos a quem ainda não montou nave. */
export function ehPreset(id: number | string): boolean {
  return typeof id === 'string' && id.startsWith('preset_');
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080';

/**
 * Transforma a resposta de erro em algo que o jogador possa ler.
 */
async function falha(res: Response, acao: string): Promise<Error> {
  let corpo = null;
  try {
    corpo = await res.json();
  } catch {
    // Resposta sem JSON: o status já basta para classificar.
  }
  return new Error(mensagemDeErro(res.status, corpo, acao));
}

function getAuthHeader(): string {
  const token = tokenDaSessao();
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  return `Bearer ${token}`;
}

export async function saveLoadout(loadout: Omit<SavedLoadout, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedLoadout> {
  const token = tokenDaSessao();
  if (!token) {
    // Sem conta, a nave fica no navegador — de verdade.
    const agora = Date.now();
    const local: SavedLoadout = {
      id: `local_${agora}`,
      name: loadout.name,
      slots: loadout.slots,
      createdAt: agora,
      updatedAt: agora,
    };
    gravarLocais([...lerLocais(), local]);
    return local;
  }

  const res = await fetch(`${API_URL}/loadouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: loadout.name,
      data: { slots: loadout.slots },
    }),
  });

  if (res.status === 401 || res.status === 403) {
    esquecerToken();
    throw new Error('Sessão expirada. Entre novamente para salvar na nuvem.');
  }

  if (!res.ok) throw await falha(res, 'salvar a nave');
  const data = await res.json();
  const saved = data.loadout;
  return {
    id: saved.id,
    name: saved.name,
    slots: saved.data.slots,
    createdAt: new Date(saved.createdAt).getTime(),
    updatedAt: new Date(saved.updatedAt).getTime(),
  };
}

export async function listLoadouts(): Promise<SavedLoadout[]> {
  const token = tokenDaSessao();
  // Sem conta: os modelos padrão mais o que este navegador guardou.
  if (!token) {
    const locais = lerLocais();
    return locais.length > 0 ? [...locais, ...DEFAULT_PRESET_LOADOUTS] : DEFAULT_PRESET_LOADOUTS;
  }

  const res = await fetch(`${API_URL}/loadouts`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    esquecerToken();
    throw new Error('Sessão expirada. Entre novamente.');
  }

  // Falha de verdade CHEGA à tela.
  //
  // Antes, qualquer erro devolvia os modelos padrão em silêncio: com o
  // banco fora do ar o jogador via "Cruzador Explorer Alpha" no lugar da
  // própria frota e concluía que as naves tinham sumido. O hangar já tem
  // tela de erro com "tentar novamente" — ela só não era alcançada.
  if (!res.ok) throw await falha(res, 'carregar a frota');

  const data = await res.json();
  const loaded: SavedLoadout[] = (data.loadouts || []).map((saved: any) => ({
    id: saved.id,
    name: saved.name,
    slots: saved.data?.slots || [],
    createdAt: new Date(saved.createdAt).getTime(),
    updatedAt: new Date(saved.updatedAt).getTime(),
  }));

  // Frota vazia (conta nova): os modelos servem de ponto de partida.
  return loaded.length > 0 ? loaded : DEFAULT_PRESET_LOADOUTS;
}

export async function deleteLoadout(id: number | string): Promise<void> {
  if (ehPreset(id)) {
    return; // Modelos padrão não existem no servidor.
  }

  if (ehLoadoutLocal(id)) {
    gravarLocais(lerLocais().filter((l) => l.id !== id));
    return;
  }

  const token = tokenDaSessao();
  if (!token) return;

  const res = await fetch(`${API_URL}/loadouts/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    esquecerToken();
    return;
  }

  if (!res.ok) throw await falha(res, 'apagar a nave');
}
