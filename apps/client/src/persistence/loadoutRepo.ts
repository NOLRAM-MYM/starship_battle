import { openDb, STORE_LOADOUTS } from './db';

export interface LoadoutSlotEntry {
  slotId: number;
  templateId: string;
  tier: number;
}

export interface SavedLoadout {
  id: string;
  name: string;
  slots: LoadoutSlotEntry[];
  createdAt: number;
  updatedAt: number;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE_LOADOUTS, mode);
        const req = fn(t.objectStore(STORE_LOADOUTS));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveLoadout(loadout: SavedLoadout): Promise<void> {
  await tx('readwrite', (store) => store.put(loadout));
}

export async function listLoadouts(): Promise<SavedLoadout[]> {
  return tx<SavedLoadout[]>('readonly', (store) => store.getAll() as IDBRequest<SavedLoadout[]>);
}

export async function deleteLoadout(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}
