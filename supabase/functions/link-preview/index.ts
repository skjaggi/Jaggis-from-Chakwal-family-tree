// Finds the preview picture (and title) of a web page, the same picture
// WhatsApp shows when a link is shared, so the Library form can fill in a
// picture for articles and other non-YouTube links (Sunil, 25 Nov 2026).
// Browsers can't read other sites' pages themselves, so this does it for them.
//
// Who may call it: a signed-in member of the family. It only reads public
// pages and saves nothing; the picture's address goes back to the form.
// Deployed with verify_jwt off because it checks the caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { FAMILY } from '../_shared/family.ts';

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': FAMILY.origins.includes(origin) ? origin : FAMILY.origins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const MAX_BYTES = 600_000; // the <head> is near the top; no need for the whole page
const TIMEOUT_MS = 7000;

// Only ordinary public web addresses: no local or private network addresses.
function publicUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /\.(local|internal|localhost|lan|home|corp)$/.test(host)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  if (host.includes(':')) return null; // IPv6 literals: not needed for news sites
  return u;
}

// Fetch a page, following up to 4 redirects, each checked again.
async function getPage(start: URL): Promise<{ url: URL; html: string } | null> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Many sites only give their preview tags to link-preview robots.
        'User-Agent': 'Mozilla/5.0 (compatible; FamilyTreeLinkPreview/1.0; +https://familytree.sjaggi.com/)',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en',
      },
    });
    if (r.status >= 300 && r.status < 400) {
      const next = publicUrl(new URL(r.headers.get('location') || '', url).href);
      await r.body?.cancel();
      if (!next) return null;
      url = next;
      continue;
    }
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) { await r.body?.cancel(); return null; }
    const reader = r.body!.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
      // Stop once the <head> is done.
      if (new TextDecoder().decode(value).includes('</head>')) break;
    }
    reader.cancel().catch(() => {});
    const all = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    return { url, html: new TextDecoder().decode(all) };
  }
  return null;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();

// <meta property="og:image" content="…"> in any attribute order.
function metaTags(html: string) {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const val = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const content = val ? decode(val[1] ?? val[2] ?? '') : '';
    if (key && content && !(key in out)) out[key] = content;
  }
  return out;
}

function pictureOf(html: string, base: URL): string | null {
  const m = metaTags(html);
  const linkImg = /<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/i.exec(html)?.[0];
  const candidates = [
    m['og:image:secure_url'], m['og:image'], m['og:image:url'], m['twitter:image'], m['twitter:image:src'], m['image'],
    linkImg ? decode(/\bhref\s*=\s*["']([^"']+)["']/i.exec(linkImg)?.[1] || '') : '',
  ];
  for (const c of candidates) {
    if (!c) continue;
    let u: URL;
    try { u = new URL(c, base); } catch { continue; }
    if (u.protocol === 'http:') u.protocol = 'https:'; // the Library only shows https pictures
    if (u.protocol !== 'https:' || u.href.length > 2000 || /\s/.test(u.href)) continue;
    return u.href;
  }
  return null;
}

function titleOf(html: string): string | null {
  const m = metaTags(html);
  const t = m['og:title'] || m['twitter:title'] || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '');
  return t ? t.replace(/\s+/g, ' ').slice(0, 200) : null;
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(token);
  if (!who?.user) return reply(401, { error: 'Please sign in first.' });
  const { data: profile } = await db.from('profiles').select('id').eq('id', who.user.id).maybeSingle();
  if (!profile) return reply(403, { error: 'Only family members can add Library links.' });

  let raw = '';
  try { raw = String((await req.json()).url || '').trim(); } catch { /* handled below */ }
  const start = publicUrl(raw);
  if (!start || raw.length > 2000) return reply(400, { error: 'That is not a public web link.' });

  try {
    const page = await getPage(start);
    if (!page) return reply(200, { image: null, title: null });
    return reply(200, { image: pictureOf(page.html, page.url), title: titleOf(page.html) });
  } catch {
    // The other site was slow or refused: the form just goes without a picture.
    return reply(200, { image: null, title: null });
  }
});
