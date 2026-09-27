/**
 * Stockage des fichiers de modèles importés par l'utilisateur.
 *
 * - En mémoire pendant la session.
 * - Dans IndexedDB pour survivre à un rechargement de page (la sauvegarde automatique
 *   de la scène ne contient que les empreintes, pas les octets).
 * - Intégrés en base64 dans le .squa.json lors d'un « Enregistrer » (scène transportable).
 *
 * Les fichiers sont indexés par l'empreinte SHA-256 de leur contenu : importer deux fois
 * le même fichier ne le stocke qu'une fois.
 */
const DB_NAME = 'squa-world-studio';
const STORE = 'asset-files';

const memory = new Map<string, Blob>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null); // navigation privée, IndexedDB bloqué…
      }
    });
  }
  return dbPromise;
}

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** Empreinte SHA-256 hexadécimale (repli FNV-1a si l'API de chiffrement est indisponible). */
export async function hashBytes(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619);
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 2246822519);
  }
  return `fnv${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}${bytes.length.toString(16)}`;
}

export async function putFile(hash: string, blob: Blob): Promise<void> {
  memory.set(hash, blob);
  await idb('readwrite', (s) => s.put(blob, hash));
}

export async function getFile(hash: string): Promise<Blob | undefined> {
  const m = memory.get(hash);
  if (m) return m;
  const stored = await idb<Blob>('readonly', (s) => s.get(hash));
  if (stored) memory.set(hash, stored);
  return stored;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(data: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
}
