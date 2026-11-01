// Accounts (Supabase Auth): sign up / sign in with email + password, a one-time email link, or Google; password reset;
// the signed-in session as a signal the website and the editor read. Optional: with no Supabase project configured
// (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, see .env.example) everything here reports "not set up" and the editor
// keeps working without accounts, as before.
import { signal } from '@preact/signals';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

/** Is a Supabase project configured for this build? */
export const authReady = !!(URL_ && KEY);

export const supabase: SupabaseClient | null = authReady ? createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

/** The signed-in session (null when signed out); `undefined` until the first check finishes. */
export const session = signal<Session | null | undefined>(authReady ? undefined : null);
/** The last auth event (PASSWORD_RECOVERY tells the reset page the link was valid). */
export const authEvent = signal<string>('');

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => { session.value = data.session; });
  supabase.auth.onAuthStateChange((event, s) => { session.value = s; authEvent.value = event; });
}

/** Where pages live (the site is served from the build's base URL). */
export const BASE = import.meta.env.BASE_URL;
export const page = (p: string) => `${location.origin}${BASE}${p}`;

const need = (): SupabaseClient => {
  if (!supabase) throw new Error('Accounts aren’t set up on this site yet.');
  return supabase;
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
  const { data, error } = await need().auth.signUp({ email, password, options: { data: data_, emailRedirectTo: page('account/') } });
  if (error) throw error;
  // with email confirmation on (the default), there's a user but no session until they open the link
  return { confirm: !data.session };
}

export async function signIn(email: string, password: string) {
  const { error } = await need().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function emailLink(email: string) {
  const { error } = await need().auth.signInWithOtp({ email, options: { emailRedirectTo: page('account/'), shouldCreateUser: true } });
  if (error) throw error;
}

export async function google() {
  const { error } = await need().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: page('account/') } });
  if (error) throw error;
}

export async function sendReset(email: string) {
  const { error } = await need().auth.resetPasswordForEmail(email, { redirectTo: page('reset/') });
  if (error) throw error;
}

export async function setPassword(password: string) {
  const { error } = await need().auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await need().auth.signOut();
}

export interface Profile { id: string; full_name: string | null; organisation: string | null; role: Role | null; plan: string; created_at: string }

/** The account's profile row (supabase/migrations/0001_profiles.sql); null if the table isn't there yet. */
export async function loadProfile(u: User): Promise<Profile | null> {
  const { data, error } = await need().from('profiles').select('*').eq('id', u.id).maybeSingle();
  if (error) { console.warn('profiles:', error.message); return null; }
  return data as Profile | null;
}

export async function saveProfile(u: User, p: Partial<Pick<Profile, 'full_name' | 'organisation' | 'role'>>) {
  const { error } = await need().from('profiles').upsert({ id: u.id, ...p });
  if (error) throw error;
  await need().auth.updateUser({ data: { full_name: p.full_name, role: p.role } });
}

/** A short name for the account chip: the full name's first word, or the email's local part. */
export function shortName(u: User): string {
  const n = (u.user_metadata?.full_name as string | undefined)?.trim();
  return n ? n.split(/\s+/)[0] : u.email?.split('@')[0] ?? 'Account';
}
