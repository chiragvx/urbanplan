// Shared handles for the UI components (set once at boot).
import type { Editor } from '../editor/editor';
import type { CityDoc } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { IssueIndex } from '../doc/issues';
import type { App } from '../app/app';

export interface UI { E: Editor; doc: CityDoc; C: Compiler; issues: IssueIndex; app: App }

export let ui: UI;
export function setUI(u: UI) { ui = u; }
