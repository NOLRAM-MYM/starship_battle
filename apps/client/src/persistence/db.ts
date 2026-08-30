const DB_NAME = 'batle';
const DB_VERSION = 1;
export const STORE_LOADOUTS = 'loadouts';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Abre (ou cria) o banco IndexedDB do jogo. Cacheia a promise. */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LOADOUTS)) {
        db.createObjectStore(STORE_LOADOUTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
