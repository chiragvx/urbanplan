// Pro projects in the signed-in user's account: the same `projects` table, bucket and saved versions as the
// editor's maps (src/app/cloud.ts, supabase/migrations/0002_projects.sql), told apart by `region` 'pro:<city>'.
// The file is the project as JSON (format 'urbanplan/pro'); the browser's own copy stays first, the cloud a few
// seconds behind, and a save from an older revision than the cloud holds is kept as a copy.
import { listProjects, readProject, saveProject, deleteProject, type Project, type Saved } from '../app/cloud';
import type { MapMeta } from '../doc/types';
import { DEFAULT_PROJECT, type ProProject } from './project';

export const FORMAT = 'urbanplan/pro';
export type CloudRef = { id: string; rev: number } | null;

export const listPro = (): Promise<Project[]> => listProjects('pro');
export const deletePro = (id: string) => deleteProject(id);

/** The project's file: everything but where it's saved. */
export const toText = (p: ProProject) => JSON.stringify({ format: FORMAT, ...p });

export async function openPro(id: string): Promise<{ p: ProProject; ref: CloudRef }> {
  const { text, project } = await readProject(id);
  const f = JSON.parse(text);
  if (f.format !== FORMAT) throw new Error('That project isn’t a Pro project.');
  const { format: _, ...rest } = f;
  return { p: { ...DEFAULT_PROJECT, ...rest, v: 1 }, ref: { id: project.id, rev: project.revision } };
}

export function savePro(p: ProProject, ref: CloudRef, version = false): Promise<Saved> {
  const meta = { name: p.name, tile: `pro:${p.city}`, cloud: ref } as unknown as MapMeta;
  return saveProject(meta, toText(p), 1, { version });
}
