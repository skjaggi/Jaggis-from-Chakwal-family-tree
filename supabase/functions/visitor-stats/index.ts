// Admin only: a summary of anonymous public visitors from GoatCounter
// (countries, pages, where visitors came from, devices, visits over time).
// The GoatCounter API token lives only here, as the secret GOATCOUNTER_TOKEN,
// so it never appears in the public site code.
//
// Deployed with verify_jwt off because it checks the caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';

const SITE_CODE = 'jaggis-chakwal';
const API = `https://${SITE_CODE}.goatcounter.com/api/v0`;
const ALLOWED_ORIGINS = ['https://skjaggi.github.io', 'http://localhost:8765'];

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

  const get = async (path: string) => {
    const r = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}${range}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`${path}: GoatCounter said ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  try {
    // GoatCounter allows 4 requests a second, so space them out a little.
    const out: Record<string, unknown> = { days, start: start.toISOString(), end: end.toISOString() };
    const calls: [string, string][] = [
      ['total', '/stats/total'],
      ['pages', '/stats/hits?limit=25'],
      ['locations', '/stats/locations?limit=25'],
      ['referrers', '/stats/toprefs?limit=15'],
      ['browsers', '/stats/browsers?limit=10'],
      ['systems', '/stats/systems?limit=10'],
      ['sizes', '/stats/sizes?limit=10'],
    ];
    for (const [key, path] of calls) {
      out[key] = await get(path);
      await sleep(280);
    }
    return reply(200, out);
  } catch (e) {
    return reply(502, { error: String((e as Error).message || e) });
  }
});
