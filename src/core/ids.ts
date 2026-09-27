const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Identifiant unique court et lisible, ex. "obj_k3x9f0q2m7ab".
 * Utilise crypto.getRandomValues (disponible dans tous les navigateurs modernes,
 * y compris hors HTTPS, contrairement à crypto.randomUUID).
 */
export function createId(prefix = 'obj'): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
