// The account button in the editor's top-right corner and on the start menu: "Sign in", or the signed-in account's
// initial. Nothing when the site has no accounts set up — the editor works the same without them.
import { authReady, session, shortName } from '../auth/auth';
import { Icon } from './components';

const BASE = import.meta.env.BASE_URL;

/** `leave`: how to go to another page (the editor saves the map first); a plain link otherwise. */
export function AccountButton({ leave }: { leave?: (url: string) => void }) {
  if (!authReady) return null;
  const s = session.value;
  if (s === undefined) return null;
  const here = location.pathname + location.search;
  const url = s ? `${BASE}account/` : `${BASE}login/?next=${encodeURIComponent(here)}`;
  const go = (e: MouseEvent) => { if (leave) { e.preventDefault(); leave(url); } };
  if (!s) {
    return <a class="sq account-btn signin" href={url} onClick={go} title="Sign in or create an account"><Icon.user size={16} /><span>Sign in</span></a>;
  }
  const name = shortName(s.user);
  return <a class="sq account-btn" href={url} onClick={go} aria-label={`Your account (${s.user.email})`} title={`${name} · ${s.user.email}`}><span class="account-initial">{name[0]?.toUpperCase()}</span></a>;
}
