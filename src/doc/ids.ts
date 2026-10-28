// Deterministic ids for base objects (same input → same id on every rebake) and random ids for new ones.

/** 53-bit string hash (cyrb53), base-36. */
export function hash(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random id for user-created objects: prefix + 10 chars. */
export function newId(prefix: string): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  let s = prefix + '_';
  for (const v of b) s += ALPHA[v % 36];
  return s;
}

/** Make ids unique within a set by suffixing -2, -3, … in a deterministic order. */
export function uniquify(id: string, taken: Set<string>): string {
  if (!taken.has(id)) { taken.add(id); return id; }
  for (let k = 2; ; k++) { const c = `${id}-${k}`; if (!taken.has(c)) { taken.add(c); return c; } }
}
