// Sharing a project, one way everywhere: Pro's Share (a dialog on a computer, the Share sheet on a phone) and a card's
// Share on the dashboard (docs/plans/mobile-view-only.md §4):
// - which link: "anyone with the link" (the whole project in the #s= fragment, opens read-only, nothing uploaded) or
//   "people on the project" (its ?p= address; they sign in with the email it was shared to);
// - the device's own share sheet first (WhatsApp, Mail, Messages…), else Copy link and WhatsApp;
// - an image of the view, shared as a file where the device can, else saved;
// - more below it (the drawing set) as children.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ProProject } from './project';
import { encodeShare } from './share';
import { projectLink } from './team';
import { Btn, Seg } from './ui';

const BASE = import.meta.env.BASE_URL;
const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export function ShareBody({ name, load, id, team, image, phone, toast, done, children }: {
  name: string;
  /** the project, for the anyone-with-the-link address (loaded only when that's asked for) */
  load: () => Promise<ProProject>;
  /** its cloud id, when it's in an account: the people-on-the-project link */
  id?: string | null;
  /** whether this person may hand out the project's own link (an owner or editor) */
  team?: boolean;
  /** an image of the view, when there's a view to render */
  image?: () => Promise<Blob>;
  phone?: boolean;
  toast: (s: string) => void;
  /** after a link went out (a dialog closes) */
  done?: () => void;
  children?: ComponentChildren;
}) {
  const teamOk = !!id && !!team;
  const [who, setWho] = useState<'anyone' | 'team'>(teamOk ? 'team' : 'anyone');
  const [anyone, setAnyone] = useState(''), [err, setErr] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  useEffect(() => {
    if (who !== 'anyone' || anyone) return;
    load().then(encodeShare).then((s) => setAnyone(`${location.origin}${BASE}pro/#s=${s}`), () => setErr('Couldn’t make the link: the project didn’t open.'));
  }, [who]);
  const url = who === 'team' && id ? projectLink(id) : anyone;
  const text = who === 'team' ? `${name} on UrbanPlan (sign in with the email it was shared to)` : `${name} on UrbanPlan`;

  const native = async () => {
    try { await navigator.share({ title: name, text, url }); done?.(); }
    catch (x) { if ((x as Error).name !== 'AbortError') toast('Couldn’t open sharing here. Copy the link instead.'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); done?.(); } catch { toast('Select the link and copy it.'); } };
  const shareImage = async () => {
    if (!image || imgBusy) return;
    setImgBusy(true);
    try {
      const blob = await image(), file = new File([blob], `${name.replace(/[^\w -]+/g, '') || 'urbanplan'}.png`, { type: 'image/png' });
      if (canShare() && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); } catch (x) { if ((x as Error).name !== 'AbortError') throw x; } }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('Image saved.'); }
    } catch (x) { toast(`Couldn’t make the image: ${(x as Error).message}`); }
    finally { setImgBusy(false); }
  };

  return (
    <div class="sharebody">
      {teamOk && <Seg<'anyone' | 'team'> value={who} set={setWho} label="Who it's for" options={[{ value: 'team', label: 'People on the project' }, { value: 'anyone', label: 'Anyone with the link' }]} />}
      <p class="note">{who === 'team'
        ? <>Opens for the people on the project once they sign in with the email it was shared to.{phone ? ' Invite people from a computer.' : ''}</>
        : 'Anyone with the link sees the scheme, its 3D and its figures, read-only. The whole project is in the link: nothing is uploaded.'}</p>
      {err ? <p class="note bad">{err}</p> : <input class="share-url" readOnly value={url || 'Making the link…'} aria-label="The link" onFocus={(ev) => (ev.target as HTMLInputElement).select()} />}
      <div class="row r2">
        {canShare() && <Btn kind="primary" icon="share" onClick={() => void native()} disabled={!url}>Share…</Btn>}
        <Btn kind={canShare() ? undefined : 'primary'} icon="link" onClick={() => void copy()} disabled={!url}>Copy link</Btn>
        {!canShare() && <Btn href={url ? `https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}` : undefined} icon="share" disabled={!url}>WhatsApp</Btn>}
      </div>
      {image && <Btn icon="camera" onClick={() => void shareImage()} disabled={imgBusy}>{imgBusy ? 'Making the image…' : 'Share an image of the view'}</Btn>}
      {children}
    </div>
  );
}
