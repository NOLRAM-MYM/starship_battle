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

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080';

function getAuthHeader(): string {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Not authenticated');
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
  if (!res.ok) throw new Error(`Failed to save loadout: ${res.statusText}`);
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
  if (!res.ok) throw new Error(`Failed to list loadouts: ${res.statusText}`);
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
  if (!res.ok) throw new Error(`Failed to delete loadout: ${res.statusText}`);
}
