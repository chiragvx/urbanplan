// Emails someone the invite to a project they've been added to (Team → Add). The owner's browser calls this with
// their session; it checks the caller owns the project and the person is on it, makes a one-time sign-in link for
// that email (creating the account if there isn't one) that opens the project, and sends it through Resend.
//
//   POST /api/invite  { project: <uuid>, email }   Authorization: Bearer <the owner's access token>
//
// Needs, in Vercel's environment: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, INVITE_FROM ("UrbanPlan <invites@your
// domain>"), and SITE_URL (the site's own address; the link is never built from the request). Without them it
// answers 501 and the app falls back to the copy-link. Add SITE_URL/pro/** to Supabase → Auth → Redirect URLs.
// Limits: one email per person per project every 10 minutes, 30 an hour per owner.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const SB = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY, RESEND = process.env.RESEND_API_KEY, FROM = process.env.INVITE_FROM;
  const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (!SB || !ANON || !SERVICE || !RESEND || !FROM || !SITE) return res.status(501).json({ error: 'not-configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const project = String(body?.project ?? ''), email = String(body?.email ?? '').trim().toLowerCase();
  if (!UUID.test(project) || !EMAIL.test(email) || email.length > 254) return res.status(400).json({ error: 'bad project or email' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first.' });

  const asCaller = { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const asService = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' };
  try {
    // who's asking, and do they own the project
    const u = await fetch(`${SB}/auth/v1/user`, { headers: asCaller });
    if (!u.ok) return res.status(401).json({ error: 'Sign in first.' });
    const me = await u.json();
    const role = await (await fetch(`${SB}/rest/v1/rpc/project_role`, { method: 'POST', headers: asCaller, body: JSON.stringify({ pid: project }) })).json();
    if (role !== 'owner') return res.status(403).json({ error: 'Only the project’s owner sends invites.' });

    // the person is on it and wasn't just emailed; the owner isn't sending too many
    const q = (path) => fetch(`${SB}/rest/v1/${path}`, { headers: asService }).then((r) => r.json());
    const [m] = await q(`project_members?project=eq.${project}&email=eq.${encodeURIComponent(email)}&select=invited_at`);
    if (!m) return res.status(404).json({ error: 'Add them to the project first.' });
    if (m.invited_at && Date.now() - Date.parse(m.invited_at) < 10 * 60_000) return res.status(429).json({ error: 'Invite already sent. Try again in a few minutes.' });
    const hour = new Date(Date.now() - 3600_000).toISOString();
    const recent = await q(`project_members?added_by=eq.${me.id}&invited_at=gt.${encodeURIComponent(hour)}&select=email`);
    if (Array.isArray(recent) && recent.length >= 30) return res.status(429).json({ error: 'Too many invites this hour.' });
    const [p] = await q(`projects?id=eq.${project}&select=name`);
    const name = String(p?.name || 'a project').slice(0, 120);

    // a one-time link that signs them in (or makes the account) and lands on the project
    const redirect_to = `${SITE}/pro/?p=${project}`;
    const gen = (type) => fetch(`${SB}/auth/v1/admin/generate_link`, { method: 'POST', headers: asService, body: JSON.stringify({ type, email, redirect_to }) });
    let g = await gen('invite');
    if (!g.ok) g = await gen('magiclink'); // they already have an account
    if (!g.ok) return res.status(502).json({ error: 'Couldn’t make the sign-in link.' });
    const gj = await g.json();
    const link = gj.action_link || gj.properties?.action_link;
    if (!link) return res.status(502).json({ error: 'Couldn’t make the sign-in link.' });

    const who = String(me.user_metadata?.name || me.user_metadata?.full_name || me.email || 'Someone').slice(0, 80);
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:480px">
<p><b>${esc(who)}</b> shared <b>${esc(name)}</b> with you on UrbanPlan Pro.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open the project</a></p>
<p style="color:#666;font-size:13px">The button signs you in as ${esc(email)} and works once. After that, sign in at ${esc(SITE)}/login/ and find it under Projects, shared with you.</p></div>`;
    const s = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${RESEND}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [email], subject: `${who} shared “${name}” with you`, html, text: `${who} shared "${name}" with you on UrbanPlan Pro.\n\nOpen it: ${link}\n\nThe link signs you in as ${email} and works once.` }),
    });
    if (!s.ok) return res.status(502).json({ error: 'The email didn’t send.' });
    await fetch(`${SB}/rest/v1/project_members?project=eq.${project}&email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', headers: asService, body: JSON.stringify({ invited_at: new Date().toISOString() }) }).catch(() => {}); // the email went: noting it is best effort
    return res.status(200).json({ sent: true });
  } catch {
    return res.status(502).json({ error: 'Something went wrong sending the invite.' });
  }
}
