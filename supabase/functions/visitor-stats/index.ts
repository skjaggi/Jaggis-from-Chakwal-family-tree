// Admin only: a summary of anonymous public visitors from GoatCounter
// (countries, pages, where visitors came from, devices, visits over time).
// The GoatCounter API token lives only here, as the secret GOATCOUNTER_TOKEN,
// so it never appears in the public site code.
//
// Deployed with verify_jwt off because it checks the caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { FAMILY } from '../_shared/family.ts';

const SITE_CODE = FAMILY.goatcounter;
const API = `https://${SITE_CODE}.goatcounter.com/api/v0`;
const ALLOWED_ORIGINS = FAMILY.origins;

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return reply(401, { error: 'Please sign in first.' });
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle();
  if (me?.role !== 'admin') return reply(403, { error: 'Only the admin can see visitor statistics.' });

  const token = Deno.env.get('GOATCOUNTER_TOKEN');
  if (!token) return reply(503, { error: 'not_configured' });

  let days = 30;
  try { days = Math.min(365, Math.max(1, Number((await req.json()).days) || 30)); } catch { /* default */ }
  const end = new Date();
  end.setUTCMinutes(0, 0, 0);
  end.setUTCHours(end.getUTCHours() + 1);
  const start = new Date(end.getTime() - days * 864e5);
  const range = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;

  const get = async (path: string, withRange = true) => {
    const url = `${API}${path}${withRange ? `${path.includes('?') ? '&' : '?'}${range}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${path.split('?')[0]}: GoatCounter said ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  // Build the same shape as /stats/total from /stats/hits, for when the total
  // endpoint fails: sum each day's visitors over all pages.
  const totalFromHits = (pages: { total?: number; hits?: { stats?: { day: string; daily?: number; hourly?: number[] }[] }[] }) => {
    const byDay = new Map<string, { day: string; daily: number; hourly: number[] }>();
    for (const hit of pages?.hits || []) {
      for (const st of hit.stats || []) {
        const d = byDay.get(st.day) || { day: st.day, daily: 0, hourly: Array(24).fill(0) };
        d.daily += st.daily || 0;
        (st.hourly || []).forEach((n, i) => { d.hourly[i] += n || 0; });
        byDay.set(st.day, d);
      }
    }
    const stats = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    return { total: pages?.total ?? stats.reduce((n, d) => n + d.daily, 0), stats, from_pages: true };
  };

  // Each section is fetched on its own, so one failing GoatCounter call no
  // longer hides all the others. GoatCounter allows 4 requests a second.
  const out: Record<string, unknown> = { days, start: start.toISOString(), end: end.toISOString() };
  const errors: Record<string, string> = {};
  const calls: [string, string][] = [
    ['pages', '/stats/hits?limit=100'],
    ['total', '/stats/total'],
    ['locations', '/stats/locations?limit=25'],
    ['referrers', '/stats/toprefs?limit=15'],
    ['browsers', '/stats/browsers?limit=10'],
    ['systems', '/stats/systems?limit=10'],
    ['sizes', '/stats/sizes?limit=10'],
  ];
  for (const [key, path] of calls) {
    try {
      out[key] = await get(path);
    } catch (e) {
      errors[key] = String((e as Error).message || e);
    }
    await sleep(280);
  }
  if (!out.total && out.pages) out.total = totalFromHits(out.pages as Parameters<typeof totalFromHits>[0]);

  if (Object.keys(errors).length) {
    // Log what the token can see, to tell a token problem from a site problem.
    let me = '';
    try { await get('/me', false); me = 'token works'; } catch (e) { me = String((e as Error).message || e); }
    console.error('visitor-stats', JSON.stringify(errors), 'me:', me);
    out.errors = errors;
  }
  if (Object.keys(errors).length === calls.length) return reply(502, { error: Object.values(errors)[0] });
  return reply(200, out);
});
