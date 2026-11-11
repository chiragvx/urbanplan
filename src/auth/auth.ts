// Accounts (Supabase Auth): sign up / sign in with email + password or a one-time email link; password reset;
// the signed-in session as a signal the website and the editor read. Optional: with no Supabase project configured
// (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, see .env.example) everything here reports "not set up" and the editor
// keeps working without accounts, as before.
import { signal } from '@preact/signals';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

/** Is a Supabase project configured for this build? */
export const authReady = !!(URL_ && KEY);

/**
 * The client, once loaded: the Supabase library (~64 kB gzipped) loads only where it's needed — the editor, the
 * account pages, or a page opened by someone with a stored session (on idle, to keep it fresh). `startAuth()` loads it.
 * (None while the build prerenders the pages: there's no browser, and nobody is signed in.)
 */
export let supabase: SupabaseClient | null = null;

/** The signed-in session (null when signed out); `undefined` until the first check finishes. */
export const session = signal<Session | null | undefined>(authReady ? undefined : null);
/** The last auth event (PASSWORD_RECOVERY tells the reset page the link was valid). */
export const authEvent = signal<string>('');

let starting: Promise<SupabaseClient | null> | null = null;
/** Load the client and follow the session (once; later calls get the same promise). */
export function startAuth(): Promise<SupabaseClient | null> {
  if (!authReady || typeof window === 'undefined') return Promise.resolve(null);
  return (starting ??= import('@supabase/supabase-js').then(({ createClient }) => {
    const c = createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    supabase = c;
    void c.auth.getSession().then(({ data }) => { session.value = data.session; });
    c.auth.onAuthStateChange((event, s) => { session.value = s; authEvent.value = event; });
    return c;
  }));
}

/**
 * The session as Supabase last stored it in this browser, without loading Supabase: enough for the header to show
 * who's signed in. Sets `session` (if nothing has yet) and, when there is one, loads the client on idle to refresh it.
 */
export function peekSession() {
  if (!authReady || typeof window === 'undefined' || session.value !== undefined || starting) return;
  let s: Session | null = null;
  try {
    const raw = localStorage.getItem(`sb-${new URL(URL_!).hostname.split('.')[0]}-auth-token`);
    const v = raw ? JSON.parse(raw) : null;
    if (v?.user && v.access_token) s = v as Session;
  } catch { /* storage off, or not JSON */ }
  session.value = s;
  if (s) (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500)))(() => void startAuth());
}

/** Where pages live (the site is served from the build's base URL). */
export const BASE = import.meta.env.BASE_URL;
export const page = (p: string) => `${location.origin}${BASE}${p}`;

const need = async (): Promise<SupabaseClient> => {
  const c = await startAuth();
  if (!c) throw new Error('Accounts aren’t set up on this site yet.');
  return c;
};

/** Supabase's messages, said the way a person would want to read them. */
export function explain(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match an account. Check them, or reset your password.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you, then sign in.';
  if (/already registered|already been registered/i.test(m)) return 'There’s already an account with this email. Sign in instead, or reset your password.';
  if (/password should be at least/i.test(m)) return 'Use a password of at least 8 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return 'Couldn’t reach the account service. Check your connection and try again.';
  return m;
}

export type Role = 'developer' | 'architect' | 'consultant' | 'broker' | 'buyer' | 'civic' | 'other';
export const ROLES: [Role, string][] = [
  ['developer', 'Developer or land team'],
  ['architect', 'Architect or planner'],
  ['consultant', 'Engineer or consultant'],
  ['broker', 'Broker or valuer'],
  ['buyer', 'Home buyer or owner'],
  ['civic', 'Civic group, journalist or researcher'],
  ['other', 'Something else'],
];

/** `interest`: the plan they asked about on the pricing page (pro / firm), if any. */
export async function signUp(email: string, password: string, fullName: string, role: Role, interest?: string) {
  const data_ = { full_name: fullName, role, ...(interest ? { interest } : {}) };
  const { data, error } = await (await need()).auth.signUp({ email, password, options: { data: data_, emailRedirectTo: page('account/') } });
  if (error) throw error;
  // with email confirmation on (the default), there's a user but no session until they open the link
  return { confirm: !data.session };
}

export async function signIn(email: string, password: string) {
  const { error } = await (await need()).auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** `back`: where the link should land (a full URL on this site); the account page by default. */
export async function emailLink(email: string, back?: string) {
  const { error } = await (await need()).auth.signInWithOtp({ email, options: { emailRedirectTo: back ?? page('account/'), shouldCreateUser: true } });
  if (error) throw error;
}

/**
 * Note a downloaded DP report against the account (supabase/migrations/0002_dp_reports.sql). Best effort: a missing
 * table or a network error never stops the download.
 */
export async function logReport(r: { lat: number; lon: number; area?: string; cls?: string | null }) {
  try {
    const c = await startAuth(), u = session.value?.user;
    if (!c || !u) return;
    const { error } = await c.from('dp_reports').insert({ user_id: u.id, email: u.email, lat: r.lat, lon: r.lon, area: r.area ?? null, cls: r.cls ?? null });
    if (error) console.warn('dp_reports:', error.message);
  } catch (e) { console.warn('dp_reports:', e); }
}

export async function sendReset(email: string) {
  const { error } = await (await need()).auth.resetPasswordForEmail(email, { redirectTo: page('reset/') });
  if (error) throw error;
}

export async function setPassword(password: string) {
  const { error } = await (await need()).auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await (await need()).auth.signOut();
}

export interface Profile { id: string; full_name: string | null; organisation: string | null; role: Role | null; plan: string; created_at: string }

/** The account's profile row (supabase/migrations/0001_profiles.sql); null if the table isn't there yet. */
export async function loadProfile(u: User): Promise<Profile | null> {
  const { data, error } = await (await need()).from('profiles').select('*').eq('id', u.id).maybeSingle();
  if (error) { console.warn('profiles:', error.message); return null; }
  return data as Profile | null;
}

export async function saveProfile(u: User, p: Partial<Pick<Profile, 'full_name' | 'organisation' | 'role'>>) {
  const { error } = await (await need()).from('profiles').upsert({ id: u.id, ...p });
  if (error) throw error;
  await (await need()).auth.updateUser({ data: { full_name: p.full_name, role: p.role } });
}

/** A short name for the account chip: the full name's first word, or the email's local part. */
export function shortName(u: User): string {
  const n = (u.user_metadata?.full_name as string | undefined)?.trim();
  return n ? n.split(/\s+/)[0] : u.email?.split('@')[0] ?? 'Account';
}
