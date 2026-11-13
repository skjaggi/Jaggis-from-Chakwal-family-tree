// Sends the invitation email for an invite that already exists in
// public.invites. Uses Supabase Auth's "Invite user" email, which goes out
// through the project's own SMTP sender (no extra secrets needed).
//
// Who may call it: the admin, or the member who created that invite.
// Deployed with verify_jwt off because it checks the caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';

const SITE = 'https://skjaggi.github.io/Jaggis-from-Chakwal-family-tree/';
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

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is asking?
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return reply(401, { error: 'Please sign in first.' });
  const { data: caller } = await admin.from('profiles').select('id, role, display_name, email, person_id').eq('id', who.user.id).maybeSingle();
  if (!caller) return reply(403, { error: 'Only family members can send invitations.' });

  let email = '';
  try {
    email = String((await req.json()).email || '').trim().toLowerCase();
  } catch { /* handled below */ }
  if (!email) return reply(400, { error: 'Missing email.' });

  const { data: inv } = await admin.from('invites').select('*').eq('email', email).maybeSingle();
  if (!inv) return reply(404, { error: `${email} hasn't been invited yet.` });
  if (caller.role !== 'admin' && inv.invited_by !== caller.id) {
    return reply(403, { error: 'You can only send invitations for people you invited.' });
  }
  if (inv.accepted_at) return reply(409, { error: `${email} has already signed in.` });

  // Name the inviter as they appear in the tree, e.g. "Sunil Kumar Jaggi".
  let fromName = caller.display_name || 'A family member';
  if (caller.person_id) {
    const { data: me } = await admin.from('people').select('given_name, surname').eq('id', caller.person_id).maybeSingle();
    if (me) fromName = [me.given_name, me.surname].filter(Boolean).join(' ');
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: SITE,
    data: { invited_by: fromName, name: inv.display_name || '' },
  });
  if (error) {
    if (/already been registered|already registered|exists/i.test(error.message)) {
      return reply(200, { sent: false, reason: 'already_has_login',
        message: `${email} already has a login, so no new invitation email was sent. They can sign in on the site with that email.` });
    }
    if (/rate limit/i.test(error.message)) {
      return reply(429, { error: 'Too many emails were sent in the last hour. Please try again later, or use the Email/WhatsApp buttons.' });
    }
    return reply(500, { error: error.message });
  }
  return reply(200, { sent: true });
});
