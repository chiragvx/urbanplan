// Your account: who you're signed in as, your profile, your plan, sign out.
import { useEffect, useState } from 'preact/hooks';
import { authReady, explain, loadProfile, ROLES, saveProfile, session, signOut, type Profile, type Role } from '../auth/auth';
import { APP, href, Icon, Page } from './ui';

export function Account() {
  const s = session.value;
  return (
    <Page current="account/">
      <section class="wrap account">
        <div style="display:grid;gap:8px"><span class="eyebrow">Account</span><h1 style="font-size:var(--up-text-3xl)">Your account</h1></div>
        {!authReady ? (
          <div class="notice info"><Icon.info /><div style="display:grid;gap:4px"><b>Accounts aren't switched on yet.</b><p>The editor works without one: your maps are saved in your browser.</p><a href={APP}>Open the editor</a></div></div>
        ) : s === undefined ? <p class="muted">Loading…</p> : s === null ? (
          <div class="card" style="max-width:520px">
            <h2 style="font-size:var(--up-text-xl)">You're not signed in.</h2>
            <p>Sign in to see your account, or create one. It's free.</p>
            <div class="cta-row"><a class="btn btn-primary" href={href('login/')}>Sign in</a><a class="btn" href={href('signup/')}>Create an account</a></div>
          </div>
        ) : <Signed key={s.user.id} />}
      </section>
    </Page>
  );
}

function Signed() {
  const u = session.value!.user;
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [name, setName] = useState((u.user_metadata?.full_name as string) ?? '');
  const [org, setOrg] = useState('');
  const [role, setRole] = useState<Role | ''>((u.user_metadata?.role as Role) ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    void loadProfile(u).then((r) => {
      setP(r);
      if (r) { setName(r.full_name ?? name); setOrg(r.organisation ?? ''); setRole(r.role ?? role); }
    });
  }, [u.id]);
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { await saveProfile(u, { full_name: name.trim(), organisation: org.trim() || null, role: (role || null) as Role | null }); setMsg({ kind: 'ok', text: 'Saved.' }); } catch (x) { setMsg({ kind: 'error', text: explain(x) }); } finally { setBusy(false); }
  };
  const out = async () => { await signOut(); location.assign(href('')); };
  const since = new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div class="account-grid">
      <form class="card form" onSubmit={save}>
        <h2 style="font-size:var(--up-text-xl)">Profile</h2>
        {p === null && <p class="muted small">Your profile is kept with your sign-in until the site's profile table is set up.</p>}
        <div class="field"><label for="name">Name</label><input class="input" id="name" autoComplete="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div class="field"><label for="org">Organisation <span class="muted">(optional)</span></label><input class="input" id="org" autoComplete="organization" value={org} disabled={p === null} onInput={(e) => setOrg((e.target as HTMLInputElement).value)} /></div>
        <div class="field">
          <label for="role">What describes you best?</label>
          <select class="input" id="role" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>
            <option value="">Not set</option>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {msg && <div class={`notice ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.kind === 'ok' ? <Icon.check /> : <Icon.info />}<div>{msg.text}</div></div>}
        <div><button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </form>
      <div style="display:grid;gap:var(--up-space-4)">
        <div class="card">
          <h2 style="font-size:var(--up-text-xl)">Sign-in</h2>
          <dl class="kv">
            <dt>Email</dt><dd>{u.email}</dd>
            <dt>Signed in with</dt><dd>{(u.app_metadata?.provider as string) === 'google' ? 'Google' : 'Email'}</dd>
            <dt>Member since</dt><dd>{since}</dd>
          </dl>
          <div class="cta-row"><a class="btn" href={href('forgot/')}>Change password</a><button class="btn btn-ghost" onClick={() => void out()}>Sign out</button></div>
        </div>
        <div class="card">
          <h2 style="font-size:var(--up-text-xl)">Plan</h2>
          <p><span class="tag tag-now">{p?.plan && p.plan !== 'free' ? p.plan : 'Free'}</span></p>
          <p class="small">Everything in the editor is free during the beta. You'll hear from us when the plot sandbox and exports are ready.</p>
          <div class="cta-row"><a class="btn btn-ink" href={APP}>Open the editor</a><a class="btn" href={href('pricing/')}>See plans</a></div>
        </div>
      </div>
    </div>
  );
}
