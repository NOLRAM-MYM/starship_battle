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

import { mensagemDeErro } from '../net/apiErrors';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080';

/**
 * Transforma a resposta de erro em algo que o jogador possa ler.
 *
 * As mensagens aqui eram o `statusText` cru em inglês — com o banco fora
 * do ar, a tela da frota dizia "Failed to list loadouts: Internal Server
 * Error", que não informa nem de quem é o problema.
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
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Sessão expirada. Entre novamente.');
  return `Bearer ${token}`;
}

export async function saveLoadout(loadout: Omit<SavedLoadout, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedLoadout> {
  const res = await fetch(`${API_URL}/loadouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuthHeader(),
    },
    body: JSON.stringify({
      name: loadout.name,
      data: { slots: loadout.slots },
    }),
  });
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
  const res = await fetch(`${API_URL}/loadouts`, {
    headers: {
      'Authorization': getAuthHeader(),
    },
  });
  if (!res.ok) throw await falha(res, 'carregar a frota');
  const data = await res.json();
  return data.loadouts.map((saved: any) => ({
    id: saved.id,
    name: saved.name,
    slots: saved.data?.slots || [],
    createdAt: new Date(saved.createdAt).getTime(),
    updatedAt: new Date(saved.updatedAt).getTime(),
  }));
}

export async function deleteLoadout(id: number | string): Promise<void> {
  const res = await fetch(`${API_URL}/loadouts/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': getAuthHeader(),
    },
  });
  if (!res.ok) throw await falha(res, 'apagar a nave');
}
