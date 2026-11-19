// A share link that works without an account: the whole project in the link's #fragment (never sent to a server),
// compressed (JSON → deflate-raw → base64url). A typical project is a few hundred characters, short enough for
// WhatsApp. The link opens /pro/ read-only on that project; the person it's sent to can copy it into their own.
import { DEFAULT_PROJECT, type ProProject } from './project';

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(p: ProProject): Promise<string> {
  // (the fields still at their defaults are left out; they come back from DEFAULT_PROJECT)
  const slim: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (JSON.stringify(v) !== JSON.stringify((DEFAULT_PROJECT as unknown as Record<string, unknown>)[k])) slim[k] = v;
  return b64url(await pipe(new TextEncoder().encode(JSON.stringify(slim)), new CompressionStream('deflate-raw')));
}

export async function decodeShare(s: string): Promise<ProProject> {
  const json = new TextDecoder().decode(await pipe(unb64url(s), new DecompressionStream('deflate-raw')));
  const o = JSON.parse(json) as Partial<ProProject>;
  if (typeof o !== 'object' || !o) throw new Error('Not a project link');
  return { ...DEFAULT_PROJECT, ...o, v: 1 };
}
