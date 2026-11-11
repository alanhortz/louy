/**
 * Accès à IndexedDB, réduit à ce dont l'application a besoin : deux magasins,
 * des promesses, aucune dépendance.
 *
 *  - `cache`     : réponses réutilisables (noms de lieux OSM), par clef ;
 *  - `telemetry` : lots d'événements compressés, indexés par date de fin.
 */

const NAME = 'louy';
const VERSION = 1;

export const STORES = { cache: 'cache', telemetry: 'telemetry' } as const;
export type StoreName = (typeof STORES)[keyof typeof STORES];

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(STORES.cache, { keyPath: 'key' });
      db.createObjectStore(STORES.telemetry, { autoIncrement: true }).createIndex('endedAt', 'endedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Exécute `work` dans une transaction et attend sa validation. */
export async function transact<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  const transaction = db.transaction(store, mode);
  const result = settled(work(transaction.objectStore(store)));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
  return result;
}
