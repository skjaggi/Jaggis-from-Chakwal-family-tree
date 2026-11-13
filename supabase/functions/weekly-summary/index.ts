// Weekly summary email for the admin: who visited, what changed, and public
// visitor numbers for the last 7 days.
//
// Two ways in:
//  - the weekly schedule (pg_cron), which sends the header x-cron-key with a
//    key kept in the database (public.app_secrets, readable by no one else);
//  - the admin, signed in, pressing "Email me this week's summary now" on the
//    Dashboard. That copy goes only to the admin who asked.
//
// Secrets (Supabase → Edge Functions → Secrets): GMAIL_APP_PASSWORD (the
// sender Gmail's app password), GOATCOUNTER_TOKEN (optional, for public visitors).
// Deployed with verify_jwt off because it checks the caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import nodemailer from 'npm:nodemailer@6.9.16';

const SENDER = 'helloquantumnexus@gmail.com';
const SITE = 'https://skjaggi.github.io/Jaggis-from-Chakwal-family-tree/';
const GOAT = 'https://jaggis-chakwal.goatcounter.com/api/v0';
const ALLOWED_ORIGINS = ['https://skjaggi.github.io', 'http://localhost:8765'];
const GAP = 30 * 60 * 1000; // a visit = views with no gap over 30 minutes

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fullName = (p: any) => [p?.title, p?.given_name, p?.surname].filter(Boolean).join(' ');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sessions(times: number[]) {
  let n = 0, prev: number | null = null;
  for (const t of times.sort((a, b) => a - b)) { if (prev === null || t - prev > GAP) n++; prev = t; }
  return n;
}

async function goat(path: string, start: Date, end: Date) {
  const token = Deno.env.get('GOATCOUNTER_TOKEN');
  if (!token) return null;
  const r = await fetch(`${GOAT}${path}${path.includes('?') ? '&' : '?'}start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!r.ok) return null;
  return r.json();
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is asking: the schedule, or a signed-in admin?
  let recipients: string[] = [];
  const cronKey = req.headers.get('x-cron-key');
  if (cronKey) {
    const { data: ok } = await db.rpc('check_app_secret', { n: 'weekly_summary_key', v: cronKey });
    if (!ok) return reply(403, { error: 'Wrong key.' });
    const { data: admins } = await db.from('profiles').select('email').eq('role', 'admin');
    recipients = (admins || []).map((a: any) => a.email).filter(Boolean);
  } else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = await db.auth.getUser(jwt);
    if (!who?.user) return reply(401, { error: 'Please sign in first.' });
    const { data: me } = await db.from('profiles').select('role, email').eq('id', who.user.id).maybeSingle();
    if (me?.role !== 'admin') return reply(403, { error: 'Only the admin can send the summary.' });
    recipients = [me.email || who.user.email!].filter(Boolean);
  }
  if (!recipients.length) return reply(400, { error: 'No admin email address found.' });
  const pass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!pass) return reply(503, { error: 'not_configured' });

  const end = new Date();
  const start = new Date(end.getTime() - 7 * 864e5);
  const since = start.toISOString();

  const [{ data: profiles }, { data: views }, { data: people }, { data: approved }, { count: pending }, { data: invites }] = await Promise.all([
    db.from('profiles').select('id, email, display_name, role, person_id, created_at'),
    db.from('page_views').select('user_id, viewed_at, person_id').gte('viewed_at', since).limit(20000),
    db.from('people').select('id, title, given_name, surname'),
    db.from('change_requests').select('summary, kind, reviewed_at, submitted_by').eq('status', 'approved').gte('reviewed_at', since).order('reviewed_at', { ascending: false }).limit(50),
    db.from('change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('invites').select('email, display_name, accepted_at, created_at'),
  ]);
  const byPerson = new Map((people || []).map((p: any) => [p.id, p]));
  const prof = new Map((profiles || []).map((p: any) => [p.id, p]));
  const nameOf = (u: string) => {
    const p: any = prof.get(u);
    if (!p) return 'Someone';
    return (p.person_id && byPerson.get(p.person_id)) ? fullName(byPerson.get(p.person_id)) : (p.display_name || p.email);
  };
  const adminIds = new Set((profiles || []).filter((p: any) => p.role === 'admin').map((p: any) => p.id));
  const memberViews = (views || []).filter((v: any) => !adminIds.has(v.user_id));
  const perUser = new Map<string, any[]>();
  for (const v of memberViews) (perUser.get(v.user_id) || perUser.set(v.user_id, []).get(v.user_id)!).push(v);
  const memberRows = [...perUser].map(([u, list]) => ({ name: nameOf(u), visits: sessions(list.map((v) => new Date(v.viewed_at).getTime())), views: list.length }))
    .sort((a, b) => b.visits - a.visits || b.views - a.views);
  const personCounts = new Map<string, number>();
  for (const v of memberViews) if (v.person_id) personCounts.set(v.person_id, (personCounts.get(v.person_id) || 0) + 1);
  const topPeople = [...personCounts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${fullName(byPerson.get(id))} (${n})`);
  const newMembers = (profiles || []).filter((p: any) => p.created_at >= since && !adminIds.has(p.id)).map((p: any) => nameOf(p.id));
  const notYet = (invites || []).filter((i: any) => !i.accepted_at).map((i: any) => i.display_name || i.email);

  // Public visitors (GoatCounter), if the token is set.
  let pub: { total: number; places: string[]; refs: string[] } | null = null;
  try {
    const total = await goat('/stats/total', start, end); await sleep(300);
    const locs = await goat('/stats/locations?limit=5', start, end); await sleep(300);
    const refs = await goat('/stats/toprefs?limit=5', start, end);
    if (total) {
      pub = {
        total: total.total ?? 0,
        places: (locs?.stats || []).filter((s: any) => s.count).map((s: any) => `${s.name || s.id} (${s.count})`),
        refs: (refs?.stats || []).filter((s: any) => s.count).map((s: any) => `${s.name || 'Typed in or bookmark'} (${s.count})`),
      };
    }
  } catch { /* leave out */ }

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'America/Phoenix' });
  const li = (items: string[], empty: string) => items.length ? `<ul style="margin:4px 0 12px;padding-left:20px">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p style="color:#5b6b61;margin:4px 0 12px">${esc(empty)}</p>`;
  const h2 = (t: string) => `<h2 style="font-size:16px;margin:20px 0 6px;color:#17706b">${esc(t)}</h2>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1d2a22;max-width:600px">
<h1 style="font-size:20px;margin:0 0 4px">Jaggi family tree: your week</h1>
<p style="color:#5b6b61;margin:0 0 16px">${fmt(start)} to ${fmt(end)}</p>
<p><strong>${memberRows.length}</strong> family ${memberRows.length === 1 ? 'member' : 'members'} visited${pub ? `, and <strong>${pub.total}</strong> public ${pub.total === 1 ? 'visitor' : 'visitors'} (not signed in)` : ''}. <strong>${(approved || []).length}</strong> ${(approved || []).length === 1 ? 'change was' : 'changes were'} added to the tree, and <strong>${pending ?? 0}</strong> ${pending === 1 ? 'is' : 'are'} waiting for approval.</p>
${h2('Family members who visited')}
${li(memberRows.map((m) => `${m.name}: ${m.visits} ${m.visits === 1 ? 'visit' : 'visits'}, ${m.views} ${m.views === 1 ? 'page' : 'pages'}`), 'No family members visited this week.')}
${topPeople.length ? h2('Most looked-at people') + li(topPeople, '') : ''}
${newMembers.length ? h2('New members who signed in') + li(newMembers, '') : ''}
${h2('Changes added to the tree')}
${li((approved || []).slice(0, 10).map((r: any) => `${r.summary || r.kind} (by ${nameOf(r.submitted_by)})`).concat((approved || []).length > 10 ? [`and ${(approved || []).length - 10} more`] : []), 'No changes this week.')}
${pending ? `<p><a href="${SITE}#/review" style="color:#17706b">Review the ${pending} waiting ${pending === 1 ? 'change' : 'changes'}</a></p>` : ''}
${pub ? h2('Public visitors') + li([...(pub.places.length ? [`Where: ${pub.places.join(', ')}`] : []), ...(pub.refs.length ? [`Came from: ${pub.refs.join(', ')}`] : [])], pub.total ? '' : 'No public visitors this week.') : ''}
${notYet.length ? h2('Invited but not signed in yet') + li(notYet.slice(0, 15), '') : ''}
<p style="margin-top:24px"><a href="${SITE}#/dashboard" style="background:#17706b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the Dashboard</a></p>
<p style="color:#5b6b61;font-size:13px;margin-top:24px">Sent every Monday to the family tree's admin. Only the admin receives this.</p>
</div>`;

  try {
    const mail = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SENDER, pass } });
    await mail.sendMail({
      from: `"Jaggi family tree" <${SENDER}>`,
      to: recipients.join(', '),
      subject: `Jaggi family tree: your week (${fmt(start)} to ${fmt(end)})`,
      html,
    });
  } catch (e) {
    console.error('weekly-summary send', String((e as Error).message || e));
    return reply(502, { error: `The email could not be sent: ${(e as Error).message}` });
  }
  return reply(200, { sent: true, to: recipients });
});
