// IndexedDB key-value store. public/sw.js opens the same database (name, version, store)
// read-only, so keep DB_NAME / STORE / VERSION in sync with it.

const DB_NAME = 'invenstory';
const STORE = 'kv';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kv = {
  get: <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run('readwrite', (s) => s.put(structuredClone(value), key)).then(() => {}),
  del: (key: string) => run('readwrite', (s) => s.delete(key)).then(() => {}),
  clear: () => run('readwrite', (s) => s.clear()).then(() => {}),
};

/** Keys used across the app (and by sw.js for `api`). */
export const K = {
  n8nConn: 'n8n.conn',
  n8nClient: 'n8n.client',
  n8nTokens: 'n8n.tokens',
  n8nPending: 'n8n.pending',
  llm: 'llm',
  install: 'install',
  api: 'api',
  push: 'push',
} as const;
