// Admin only: remove someone's access, or give it back.
//   { email, action: 'remove' }  bans their login (so they can't sign in or
//     stay signed in), deletes their invite and frees any box they claimed.
//     The login is kept, not deleted, so their earlier changes keep their
//     name and the removal can be undone. A snapshot goes to removed_members.
//   { email, action: 'restore' } undoes that from the snapshot.
// Deployed with verify_jwt off because it checks the caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { FAMILY } from '../_shared/family.ts';

const ALLOWED_ORIGINS = FAMILY.origins;
const FOREVER = '876000h'; // 100 years

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return reply(401, { error: 'Please sign in first.' });
  const { data: me } = await db.from('profiles').select('role').eq('id', who.user.id).maybeSingle();
  if (me?.role !== 'admin') return reply(403, { error: 'Only the admin can remove members.' });

  let email = '', action = '';
  try {
    const b = await req.json();
    email = String(b.email || '').trim().toLowerCase();
    action = String(b.action || '');
  } catch { /* handled below */ }
  if (!email || !['remove', 'restore'].includes(action)) return reply(400, { error: 'Missing email or action.' });

  if (action === 'remove') {
    const [{ data: inv }, { data: prof }] = await Promise.all([
      db.from('invites').select('*').eq('email', email).maybeSingle(),
      db.from('profiles').select('*').eq('email', email).maybeSingle(),
    ]);
    if (!inv && !prof) return reply(404, { error: `${email} isn't invited.` });
    if (prof?.id === who.user.id) return reply(400, { error: "You can't remove yourself." });
    if (prof?.role === 'admin' || inv?.role === 'admin') return reply(400, { error: 'This person is an admin. Make them a member first, then remove them.' });
    const { error: e1 } = await db.from('removed_members').upsert({
      email, user_id: prof?.id ?? null, snapshot: { invite: inv, profile: prof }, removed_by: who.user.id,
    });
    if (e1) return reply(500, { error: e1.message });
    if (prof) {
      const { error: e2 } = await db.auth.admin.updateUserById(prof.id, { ban_duration: FOREVER });
      if (e2) return reply(500, { error: `Couldn't block the login: ${e2.message}` });
      if (prof.claimed_person_id) await db.from('profiles').update({ claimed_person_id: null }).eq('id', prof.id);
    }
    if (inv) await db.from('invites').delete().eq('email', email);
    return reply(200, { removed: true, hadLogin: !!prof });
  }

  // restore
  const { data: gone } = await db.from('removed_members').select('*').eq('email', email).maybeSingle();
  if (!gone) return reply(404, { error: `${email} isn't in the removed list.` });
  const { invite, profile } = gone.snapshot || {};
  if (invite) {
    const { error } = await db.from('invites').upsert(invite);
    if (error) return reply(500, { error: error.message });
  }
  let boxBack = false;
  if (profile) {
    const { error } = await db.auth.admin.updateUserById(profile.id, { ban_duration: 'none' });
    if (error) return reply(500, { error: `Couldn't unblock the login: ${error.message}` });
    if (profile.claimed_person_id) {
      const { data: taken } = await db.from('profiles').select('id').eq('claimed_person_id', profile.claimed_person_id).maybeSingle();
      if (!taken) {
        await db.from('profiles').update({ claimed_person_id: profile.claimed_person_id }).eq('id', profile.id);
        boxBack = true;
      }
    }
  }
  await db.from('removed_members').delete().eq('email', email);
  return reply(200, { restored: true, boxBack });
});
