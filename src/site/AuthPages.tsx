// Sign in, create an account, forgotten password, set a new password.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { authEvent, authReady, startAuth, emailLink, explain, ROLES, sendReset, session, setPassword, shortName, signIn, signUp, type Role } from '../auth/auth';

// (these pages need the account service: load it as soon as the page's code does)
if (typeof window !== 'undefined') void startAuth();
import { APP, Header, href, Icon, nextUrl, useSearch } from './ui';

/** The two-column frame: the city in 3D (left), the form (right). */
function AuthFrame({ children }: { children: ComponentChildren }) {
  return (
    <>
      <a class="skip" href="#main">Skip to content</a>
      <Header />
      <main id="main" class="auth">
        <aside class="auth-side">
          <img width={1220} height={740} src={href('site/city-clean.webp')} alt="" />
          <h2>Your city, edited.</h2>
          <p>Free in beta, with or without an account.</p>
        </aside>
        <div class="auth-main"><div class="auth-card">{children}</div></div>
      </main>
    </>
  );
}

const NotSetUp = () => (
  <div class="notice info" role="status">
    <Icon.info />
    <div style="display:grid;gap:4px"><b>Accounts aren't switched on yet.</b><p>You can still use the whole editor without one: your maps are saved in your browser.</p><a href={APP}>Open the editor</a></div>
  </div>
);

const Alert = ({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ComponentChildren }) => (
  <div class={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{kind === 'ok' ? <Icon.check /> : <Icon.info />}<div>{children}</div></div>
);

function Password({ id, value, onInput, auto, invalid }: { id: string; value: string; onInput: (v: string) => void; auto: string; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div class="pw">
      <input class="input" id={id} type={show ? 'text' : 'password'} autoComplete={auto} required minLength={8} value={value} aria-invalid={invalid || undefined} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide the password' : 'Show the password'}>{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}

/** Already signed in: say so instead of showing the form again. */
function SignedIn() {
  const u = session.value!.user;
  return (
    <Alert kind="ok">
      <div style="display:grid;gap:8px"><span>You're signed in as <b>{shortName(u)}</b> ({u.email}).</span><span style="display:flex;gap:12px;flex-wrap:wrap"><a href={nextUrl()}>Continue</a><a href={APP}>Open the editor</a></span></div>
    </Alert>
  );
}

export function Login() {
  const search = useSearch();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [link, setLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { if (session.value && new URLSearchParams(location.search).has('next')) location.replace(nextUrl()); }, [session.value]);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (link) { await emailLink(email); setSent(true); } else { await signIn(email, pw); location.assign(nextUrl()); }
    } catch (x) { setErr(explain(x)); } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <div style="display:grid;gap:8px"><h1>Sign in</h1><p class="muted">New here? <a href={href(`signup/${search}`)}>Create an account</a></p></div>
      {!authReady ? <NotSetUp /> : session.value ? <SignedIn /> : sent ? (
        <Alert kind="ok"><b>Check your email.</b> We sent a sign-in link to {email}. Open it on this device to continue.</Alert>
      ) : (
        <>
          <form class="form" onSubmit={submit} noValidate={false}>
            <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></div>
            {!link && <div class="field"><label for="password">Password</label><Password id="password" value={pw} onInput={setPw} auto="current-password" /></div>}
            {err && <Alert kind="error">{err}</Alert>}
            <button class="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>{busy ? 'Signing in…' : link ? 'Email me a sign-in link' : 'Sign in'}</button>
          </form>
          <div class="links">
            <button type="button" class="linkish" onClick={() => { setLink(!link); setErr(''); }}>{link ? 'Use a password instead' : 'Email me a link instead'}</button>
            <a href={href('forgot/')}>Forgot your password?</a>
          </div>
        </>
      )}
    </AuthFrame>
  );
}

export function Signup() {
  const search = useSearch();
  const plan = new URLSearchParams(search).get('plan') ?? undefined;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<'confirm' | 'in' | ''>('');
  const submit = async (e: Event) => {
    e.preventDefault();
    if (pw.length < 8) { setErr('Use a password of at least 8 characters.'); return; }
    if (!agree) { setErr('Please accept the terms to create an account.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await signUp(email.trim(), pw, name.trim(), (role || 'other') as Role, plan === 'pro' || plan === 'firm' ? plan : undefined);
      if (r.confirm) setDone('confirm'); else location.assign(nextUrl());
    } catch (x) { setErr(explain(x)); } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <div style="display:grid;gap:8px">
        <h1>Create your account</h1>
        <p class="muted">{plan === 'pro' || plan === 'firm' ? `We'll let you know when ${plan === 'pro' ? 'Pro' : 'Firm'} is ready. ` : ''}Already have one? <a href={href(`login/${search}`)}>Sign in</a></p>
      </div>
      {!authReady ? <NotSetUp /> : session.value && !done ? <SignedIn /> : done === 'confirm' ? (
        <Alert kind="ok"><b>Check your email to finish.</b> We sent a confirmation link to {email}. Open it and you'll land on your account page.</Alert>
      ) : (
        <>
          <form class="form" onSubmit={submit}>
            <div class="field"><label for="name">Your name</label><input class="input" id="name" autoComplete="name" required value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
            <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></div>
            <div class="field"><label for="password">Password</label><Password id="password" value={pw} onInput={setPw} auto="new-password" invalid={!!err && pw.length > 0 && pw.length < 8} /><span class="hint">At least 8 characters.</span></div>
            <div class="field">
              <label for="role">What describes you best?</label>
              <select class="input" id="role" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}>
                <option value="">Choose one (optional)</option>
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <label class="check" for="agree"><input id="agree" type="checkbox" checked={agree} onChange={(e) => setAgree((e.target as HTMLInputElement).checked)} /><span>I agree to the <a href={href('terms/')}>terms</a> and have read the <a href={href('privacy/')}>privacy notice</a>.</span></label>
            {err && <Alert kind="error">{err}</Alert>}
            <button class="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>{busy ? 'Creating your account…' : 'Create account'}</button>
          </form>
        </>
      )}
    </AuthFrame>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await sendReset(email.trim()); setSent(true); } catch (x) { setErr(explain(x)); } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <div style="display:grid;gap:8px"><h1>Reset your password</h1><p class="muted">We'll email you a link to set a new one.</p></div>
      {!authReady ? <NotSetUp /> : sent ? (
        <Alert kind="ok"><b>Check your email.</b> If there's an account for {email}, a reset link is on its way. It works once, for a limited time.</Alert>
      ) : (
        <form class="form" onSubmit={submit}>
          <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autoComplete="email" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></div>
          {err && <Alert kind="error">{err}</Alert>}
          <button class="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send the reset link'}</button>
        </form>
      )}
      <div class="links"><a href={href('login/')}>Back to sign in</a></div>
    </AuthFrame>
  );
}

/** Opened from the reset email: the link signs the browser in for recovery, then a new password is set. */
export function Reset() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const ready = authEvent.value === 'PASSWORD_RECOVERY' || !!session.value;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (pw.length < 8) { setErr('Use a password of at least 8 characters.'); return; }
    if (pw !== pw2) { setErr('The two passwords don’t match.'); return; }
    setBusy(true); setErr('');
    try { await setPassword(pw); setDone(true); setTimeout(() => location.assign(href('account/')), 1200); } catch (x) { setErr(explain(x)); } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      <div style="display:grid;gap:8px"><h1>Choose a new password</h1></div>
      {!authReady ? <NotSetUp /> : done ? <Alert kind="ok">Your password is changed. Taking you to your account…</Alert> : session.value === undefined ? <p class="muted">Checking your link…</p> : !ready ? (
        <Alert kind="error">This reset link has expired or was already used. <a href={href('forgot/')}>Send a new one</a>.</Alert>
      ) : (
        <form class="form" onSubmit={submit}>
          <div class="field"><label for="password">New password</label><Password id="password" value={pw} onInput={setPw} auto="new-password" /><span class="hint">At least 8 characters.</span></div>
          <div class="field"><label for="password2">Type it again</label><Password id="password2" value={pw2} onInput={setPw2} auto="new-password" invalid={!!pw2 && pw2 !== pw} /></div>
          {err && <Alert kind="error">{err}</Alert>}
          <button class="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save the new password'}</button>
        </form>
      )}
    </AuthFrame>
  );
}
