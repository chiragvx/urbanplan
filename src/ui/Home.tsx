// The start menu: pick a city, carry on with a map saved in this browser or in the account, open a file or a
// published map. Shown when the page opens without a city or map in its address; each choice opens the editor on that
// city (?region=…).
import { useEffect, useState } from 'preact/hooks';
import { gallery, local, pickFile, type LocalMap, type Published } from '../app/storage';
import { parse } from '../doc/format';
import { saveSettings, settings } from '../editor/state';
import { Icon } from './components';
import { STANDARDS, standardFor, type StandardId } from '../assets/roadmodel';
import { AccountButton } from './account';
import { session } from '../auth/auth';
import './hovercard';
import { deleteProject, listProjects, saveProject, type Project } from '../app/cloud';

export interface CityEntry {
  id: string; name: string; city: string; state: string; about: string; legacy: string[];
  counts: { sections: number; roads: number; buildings: number }; km2: number; baked: string;
}

const BASE = import.meta.env.BASE_URL;

/** The cities baked into this site (public/regions/index.json). */
export async function cities(): Promise<CityEntry[]> {
  try { const r = await fetch(`${BASE}regions/index.json`, { cache: 'no-cache' }); return r.ok ? (await r.json()).regions ?? [] : []; } catch { return []; }
}

/** The city a map was made on: its own id, or the city that took over the tile it was made on. */
export const cityOf = (list: CityEntry[], tile: string) => list.find((c) => c.id === tile || c.legacy.includes(tile));

const go = (q: Record<string, string>) => { location.href = `${BASE}app/?${new URLSearchParams(q)}`; };

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!(s >= 0)) return '';
  if (s < 60) return 'just now';
  const u: [number, string][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2629800, 'month'], [31557600, 'year']];
  let k = 0;
  while (k + 1 < u.length && s >= u[k + 1][0]) k++;
  const n = Math.floor(s / u[k][0]);
  return `${n} ${u[k][1]}${n === 1 ? '' : 's'} ago`;
}
const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : n.toLocaleString());

function isDark() { return document.documentElement.dataset.theme === 'dark'; }

export function Home() {
  const [list, setList] = useState<CityEntry[] | null>(null);
  const [maps, setMaps] = useState<LocalMap[]>([]);
  const [pub, setPub] = useState<Published[]>([]);
  const [dark, setDark] = useState(isDark());
  const [err, setErr] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [moving, setMoving] = useState('');
  /** the street standard a new map of each city starts with (its own by default) */
  const [std, setStd] = useState<Record<string, StandardId>>({});
  const user = session.value?.user;
  useEffect(() => {
    void cities().then(setList);
    void local.list().then(setMaps);
    void gallery().then(setPub);
  }, []);
  useEffect(() => { if (user) listProjects().then(setProjects, (e) => setErr(`Couldn't load your projects: ${(e as Error).message}`)); else setProjects(null); }, [user?.id]);
  const flipTheme = () => {
    const d = !isDark();
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
    saveSettings({ theme: d ? 'dark' : 'light' });
    setDark(d);
  };
  const C = list ?? [];
  const mine = maps.filter((m) => cityOf(C, m.meta.tile));
  const last = mine[0];
  const lastCity = last && cityOf(C, last.meta.tile);
  const openMap = (m: LocalMap) => { const c = cityOf(C, m.meta.tile); if (c) go({ region: c.id, local: m.meta.id }); };
  const remove = async (m: LocalMap) => {
    if (!confirm(`Delete “${m.meta.name}” from this browser? This can't be undone (files you saved stay).`)) return;
    await local.remove(m.meta.id);
    setMaps(await local.list());
  };
  const openProject = (p: Project) => { const c = cityOf(C, p.region); if (c) go({ region: c.id, project: p.id }); };
  const removeProject = async (p: Project) => {
    if (!confirm(`Delete “${p.name}” from your account, with its versions? This can't be undone.`)) return;
    try { await deleteProject(p.id); setProjects(await listProjects()); } catch (e) { setErr(`Couldn't delete: ${(e as Error).message}`); }
  };
  // this browser's maps that aren't in the account yet
  const toMove = user ? mine.filter((m) => !m.meta.cloud && m.edits > 0) : [];
  const moveAll = async () => {
    for (const [i, m] of toMove.entries()) {
      setMoving(`Saving ${i + 1} of ${toMove.length}…`);
      try {
        const r = await saveProject(m.meta, m.text, m.edits, { version: true });
        await local.put({ ...m, meta: { ...m.meta, cloud: { id: r.id, rev: r.revision } } });
      } catch (e) { setErr(`Couldn't save “${m.meta.name}”: ${(e as Error).message}`); break; }
    }
    setMoving('');
    setMaps(await local.list());
    setProjects(await listProjects());
  };
  const openFile = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const text = await f.text();
      const c = cityOf(C, parse(text).meta.tile);
      if (!c) throw new Error('it was made on a city this site doesn’t have');
      sessionStorage.setItem('urbanplan:open', text);
      go({ region: c.id, open: 'file' });
    } catch (e) { setErr(`Couldn't open ${f.name}: ${(e as Error).message}`); }
  };
  const author = settings.value.author;
  return (
    <div class="home">
      <header class="home-top">
        <a class="logo" href={BASE} title="UrbanPlan website">Urban<span>Plan</span></a>
        <span class="spacer" />
        <AccountButton />
        <button class="sq" aria-label={dark ? 'Light theme' : 'Dark theme'} title={dark ? 'Light theme' : 'Dark theme'} onClick={flipTheme}>{dark ? <Icon.sun size={16} /> : <Icon.moon size={16} />}</button>
      </header>
      <main class="home-main">
        <section class="home-hero">
          <h1>Pick a city.<br />Make it better.</h1>
          <p>Edit in 2D. See it in 3D.</p>
          <div class="home-actions">
            {last && lastCity && (
              <button class="primary big" onClick={() => openMap(last)}>
                <span>Continue “{last.meta.name}”</span>
                <small>{lastCity.city} · {last.edits} edit{last.edits === 1 ? '' : 's'} · {ago(last.savedAt)}</small>
              </button>
            )}
            <button class="big" onClick={openFile}><span>Open a file…</span><small>a map saved as .json</small></button>
          </div>
          {err && <p class="home-err" role="alert">{err}</p>}
        </section>

        <section>
          <h2>Cities</h2>
          {list === null ? <p class="muted">Loading…</p> : !C.length ? <p class="muted">No cities baked yet — run <code>npm run bake:region</code>.</p> : (
            <div class="city-grid">
              {C.map((c) => {
                const n = maps.filter((m) => cityOf(C, m.meta.tile)?.id === c.id).length;
                return (
                  <article key={c.id} class="city-card">
                    <button class="city-thumb" aria-label={`Open ${c.name}`} onClick={() => go({ region: c.id })}>
                      <img src={`${BASE}regions/${c.id}/landuse.png`} alt="" loading="lazy" />
                      <span class="city-chip">{c.km2.toLocaleString()} km²</span>
                    </button>
                    <div class="city-body">
                      <h3>{c.name}</h3>
                      <p class="muted small">{c.state}{n ? ` · ${n} map${n === 1 ? '' : 's'} of yours` : ''}</p>
                                            <dl class="city-stats">
                        <div><dt>Road sections</dt><dd>{big(c.counts.sections)}</dd></div>
                        <div><dt>Buildings</dt><dd>{big(c.counts.buildings)}</dd></div>
                      </dl>
                      <div class="city-btns">
                        <button class="primary" title={n ? `Open: carry on with your last map of ${c.name}` : `Open: ${c.name} as it is today, ready to edit`} onClick={() => go({ region: c.id })}>Open</button>
                        <button title={`New map: a clean copy of ${c.name}, with none of your edits${n ? ' (your other maps stay saved)' : ''}`} onClick={() => go({ region: c.id, new: '1', ...(std[c.id] ? { std: std[c.id] } : {}) })}>New map</button>
                        <select class="city-std" aria-label="Street standard for a new map" title="Street standard a new map starts with: how a road's width and features become its cross-section (change it later in Settings)"
                          value={std[c.id] ?? standardFor(c.city)} onChange={(e) => setStd({ ...std, [c.id]: (e.currentTarget as HTMLSelectElement).value as StandardId })}>
                          {STANDARDS.map((x) => <option key={x.id} value={x.id}>{x.short}</option>)}
                        </select>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {user && (
          <section>
            <h2>Your projects <span class="muted small">saved in your account</span></h2>
            {toMove.length > 0 && (
              <p class="home-move">
                <span>{toMove.length} map{toMove.length === 1 ? '' : 's'} in this browser {toMove.length === 1 ? 'isn’t' : 'aren’t'} in your account yet.</span>
                <button class="primary" disabled={!!moving} onClick={() => void moveAll()}>{moving || 'Save to my account'}</button>
              </p>
            )}
            {projects === null ? <p class="muted">Loading…</p> : !projects.length ? <p class="muted small">None yet: maps you edit while signed in are saved here, with their versions.</p> : (
              <ul class="home-list">
                {projects.map((p) => (
                  <li key={p.id}>
                    <button class="home-row" onClick={() => openProject(p)}>
                      <b>{p.name}</b>
                      {cityOf(C, p.region) && <span class="tag">{cityOf(C, p.region)!.city}</span>}
                      <span class="muted small">{p.edits} edit{p.edits === 1 ? '' : 's'} · {ago(p.updated_at)}</span>
                    </button>
                    <button class="icon-btn" aria-label={`Delete ${p.name}`} title="Delete from your account" onClick={() => void removeProject(p)}><Icon.trash size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {mine.length > 0 && (
          <section>
            <h2>Your maps <span class="muted small">saved in this browser</span></h2>
            <ul class="home-list">
              {mine.map((m) => (
                <li key={m.meta.id}>
                  <button class="home-row" onClick={() => openMap(m)}>
                    <b>{m.meta.name}</b>
                    <span class="tag">{cityOf(C, m.meta.tile)!.city}</span>
                    {m.meta.cloud && user && <span class="tag">In your account</span>}
                    <span class="muted small">{m.edits} edit{m.edits === 1 ? '' : 's'} · {ago(m.savedAt)}</span>
                  </button>
                  <button class="icon-btn" aria-label={`Delete ${m.meta.name}`} title="Delete from this browser" onClick={() => void remove(m)}><Icon.trash size={15} /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pub.length > 0 && (
          <section>
            <h2>Published maps</h2>
            <ul class="home-list">
              {pub.map((p) => (
                <li key={p.file}>
                  <button class="home-row" onClick={() => go({ map: `${BASE}maps/${p.file}` })}>
                    <b>{p.name}</b>
                    <span class="muted small">{p.author || 'anonymous'} · {p.edits} edits · {ago(p.updated)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <footer class="home-foot muted small">
        {author ? <>Signed as {author} · </> : null}{user ? 'Maps are saved in this browser and your account as you work.' : 'Maps are saved in this browser as you work; sign in to keep them in your account.'} Data © OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30 © DLR/Airbus.
      </footer>
    </div>
  );
}
