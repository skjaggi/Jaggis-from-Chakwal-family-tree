// Reminder emails from the admin to all or some family members, asking them to
// visit and update the family tree. Admin only. Each person gets their own
// copy, starting "Dear <name>,". With preview: true nothing is sent and the
// email is returned as HTML, so the admin sees exactly what goes out.
//
// Secret: GMAIL_APP_PASSWORD (the sender Gmail's app password, also used by
// weekly-summary). Deployed with verify_jwt off because it checks the caller.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import nodemailer from 'npm:nodemailer@6.9.16';
import { FAMILY } from '../_shared/family.ts';

const SENDER = 'helloquantumnexus@gmail.com';
const SITE = FAMILY.site;
const ALLOWED_ORIGINS = FAMILY.origins;
const MAX = 150;

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emailHtml(name: string, message: string, from: string) {
  const paras = message.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e2a24;max-width:560px">
<p style="margin:0 0 14px">Dear ${esc(name)},</p>
${paras}
<p style="margin:20px 0"><a href="${SITE}" style="background:#17706b;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:bold;display:inline-block">Open the family tree</a></p>
<p style="margin:0 0 14px">With love,<br>${esc(from)}</p>
<p style="color:#5b6b61;font-size:12px;margin-top:24px;border-top:1px solid #cdd9cb;padding-top:10px">${FAMILY.footerName} · ${SITE}<br>You are receiving this because you were invited to the family tree.</p>
</div>`;
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
  const { data: me } = await db.from('profiles').select('role, display_name, email').eq('id', who.user.id).maybeSingle();
  if (me?.role !== 'admin') return reply(403, { error: 'Only the admin can send reminder emails.' });

  let body: any;
  try { body = await req.json(); } catch { return reply(400, { error: 'Bad request.' }); }
  const subject = String(body.subject || '').trim().slice(0, 150);
  const message = String(body.message || '').trim().slice(0, 5000);
  const from = (me.display_name || 'The family tree admin').trim();
  if (!subject || !message) return reply(400, { error: 'Please write a subject and a message.' });

  if (body.preview) return reply(200, { html: emailHtml(String(body.previewName || 'Name').slice(0, 60), message, from), subject });

  const wanted = [...new Set((Array.isArray(body.emails) ? body.emails : []).map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return reply(400, { error: 'Please pick at least one person.' });
  if (wanted.length > MAX) return reply(400, { error: `Please send to at most ${MAX} people at a time.` });

  // Only people who were invited, and not removed, can receive a reminder.
  const [{ data: invites }, { data: profiles }, { data: removed }] = await Promise.all([
    db.from('invites').select('email, display_name'),
    db.from('profiles').select('email, display_name'),
    db.from('removed_members').select('email'),
  ]);
  const gone = new Set((removed || []).map((r: any) => r.email.toLowerCase()));
  const names = new Map<string, string>();
  for (const i of invites || []) names.set(i.email.toLowerCase(), i.display_name || '');
  for (const p of profiles || []) if (p.email && (p.display_name || !names.get(p.email.toLowerCase()))) names.set(p.email.toLowerCase(), p.display_name || names.get(p.email.toLowerCase()) || '');
  const skipped = wanted.filter((e) => !names.has(e) || gone.has(e));
  const to = wanted.filter((e) => names.has(e) && !gone.has(e));
  if (!to.length) return reply(400, { error: 'None of those people are on the invite list.' });

  const pass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!pass) return reply(500, { error: 'The email password is not set up (GMAIL_APP_PASSWORD).' });
  const mail = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SENDER, pass } });
  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];
  for (const email of to) {
    const name = (names.get(email) || '').trim().split(/\s+/)[0] || 'family member';
    try {
      await mail.sendMail({ from: `"${FAMILY.senderName}" <${SENDER}>`, replyTo: me.email || undefined, to: email, subject, html: emailHtml(name, message, from), text: `Dear ${name},\n\n${message}\n\nOpen the family tree: ${SITE}\n\nWith love,\n${from}` });
      sent.push(email);
    } catch (e) {
      failed.push({ email, error: (e as Error).message });
    }
    await sleep(300);
  }
  return reply(200, { sent, failed, skipped });
});
