// Where maps live: autosave in this browser (IndexedDB), files in the repo (dev server), files on disk
// (File System Access / download), and published maps on any static host (maps/index.json gallery).
import type { MapMeta } from '../doc/types';

const DB = 'pune-remix', STORE = 'maps';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = f(t.objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export interface LocalMap { meta: MapMeta; text: string; savedAt: string; edits: number }

export const local = {
  async put(m: LocalMap) { try { await tx(STORE, 'readwrite', (s) => s.put(m, m.meta.id)); await tx('kv', 'readwrite', (s) => s.put(m.meta.id, 'last')); } catch (e) { console.warn('autosave failed', e); } },
  async get(id: string): Promise<LocalMap | undefined> { try { return await tx(STORE, 'readonly', (s) => s.get(id)); } catch { return undefined; } },
  async last(): Promise<LocalMap | undefined> { try { const id = await tx<string>('kv', 'readonly', (s) => s.get('last')); return id ? await local.get(id) : undefined; } catch { return undefined; } },
  async list(): Promise<LocalMap[]> {
    try { const all = await tx<LocalMap[]>(STORE, 'readonly', (s) => s.getAll()); return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt)); } catch { return []; }
  },
  async remove(id: string) { try { await tx(STORE, 'readwrite', (s) => s.delete(id)); } catch { /* ignore */ } },
};

// ---------------- repo files (dev server only) ----------------

export interface RepoMap { file: string; name: string; author: string; updated: string; edits: number }

export const repo = {
  available: false,
  async probe() {
    try { const r = await fetch('/__maps/list'); repo.available = r.ok && (r.headers.get('content-type') ?? '').includes('json'); } catch { repo.available = false; }
    return repo.available;
  },
  async list(): Promise<RepoMap[]> { const r = await fetch('/__maps/list'); return r.ok ? r.json() : []; },
  async read(file: string): Promise<string> { const r = await fetch(`/__maps/file?name=${encodeURIComponent(file)}`); if (!r.ok) throw new Error(await r.text()); return r.text(); },
  async save(file: string, text: string) {
    const r = await fetch(`/__maps/save?name=${encodeURIComponent(file)}`, { method: 'POST', body: text });
    if (!r.ok) throw new Error(await r.text());
  },
  async publish(file: string, text: string): Promise<string> {
    const r = await fetch(`/__maps/publish?name=${encodeURIComponent(file)}`, { method: 'POST', body: text });
    if (!r.ok) throw new Error(await r.text());
    return r.text();
  },
};

// ---------------- published gallery ----------------

export interface Published { file: string; name: string; author: string; description: string; updated: string; edits: number }

export async function gallery(): Promise<Published[]> {
  try { const r = await fetch(`${import.meta.env.BASE_URL}maps/index.json`, { cache: 'no-cache' }); return r.ok ? (await r.json()).maps ?? [] : []; } catch { return []; }
}

// ---------------- disk ----------------

export const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map').slice(0, 60);

export function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

type FileHandle = { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>; name: string };
let handle: FileHandle | null = null;

/** Save to a file the user picks (Chrome / Edge); falls back to a download. */
export async function saveToDisk(name: string, text: string, again = false): Promise<string> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileHandle> };
  if (w.showSaveFilePicker) {
    try {
      if (!handle || again) handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Pune Remix map', accept: { 'application/json': ['.json'] } }] });
      const s = await handle.createWritable();
      await s.write(text); await s.close();
      return handle.name;
    } catch (e) { if ((e as Error).name === 'AbortError') throw e; }
  }
  download(name, text);
  return name;
}

export function pickFile(accept = '.json'): Promise<File | null> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => res(i.files?.[0] ?? null);
    i.click();
  });
}
