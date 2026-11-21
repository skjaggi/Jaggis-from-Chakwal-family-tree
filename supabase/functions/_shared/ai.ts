// Shared by the AI helper's edge functions (ask-tree, research-person).
// Admins only while the helper is being tested. The Claude API key lives only
// here, as the secret ANTHROPIC_API_KEY, so it never reaches the browser.
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0';

const ALLOWED_ORIGINS = ['https://familytree.sjaggi.com', 'https://skjaggi.github.io', 'http://localhost:8765'];

export function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

// Dollars per million tokens (input, output, cache write, cache read), and
// dollars per web search. Used to show what each answer cost and to keep the
// daily limit. A model that stepped in after a refusal is priced as itself.
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 5, 0.2],
  'claude-sonnet-5-5': [2, 10, 2.5, 0.1],
  'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.01],
  'claude-opus-5': [5, 25, 6.25, 0.5],
  'claude-opus-4-8': [5, 25, 6.25, 0.5],
  'claude-sonnet-5': [2, 10, 2.5, 0.2],
};
const PER_SEARCH = 0.01;

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; searches: number; cost: number };
export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, cost: 0 });

// Adds one response's usage (and its cost) to a running total.
export function addUsage(total: Usage, model: string, u: Anthropic.Beta.Messages.BetaUsage) {
  const [pin, pout, pw, pr] = PRICES[model] || PRICES['claude-opus-5-5'];
  const input = u.input_tokens || 0;
  const output = u.output_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  const searches = u.server_tool_use?.web_search_requests || 0;
  total.input += input;
  total.output += output;
  total.cacheRead += cacheRead;
  total.cacheWrite += cacheWrite;
  total.searches += searches;
  total.cost += (input * pin + output * pout + cacheWrite * pw + cacheRead * pr) / 1e6 + searches * PER_SEARCH;
  return total;
}

export function claude() {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  return apiKey ? new Anthropic({ apiKey }) : null;
}

// Claude Haiku has no stand-in model when it declines; the others do.
export const fallbackFor = (model: string) =>
  model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

export const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// A client that reads the database as the signed-in person, so the AI only
// ever sees what that person may see (Family branch only, maiden names...).
export const userClient = (jwt: string) =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

export type Caller = { userId: string; jwt: string; admin: SupabaseClient; db: SupabaseClient };

// Signed in and an admin, or an error message and status for the browser.
export async function adminCaller(req: Request): Promise<Caller | { status: number; error: string }> {
  const admin = serviceClient();
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return { status: 401, error: 'Please sign in first.' };
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle();
  if (me?.role !== 'admin') return { status: 403, error: 'The AI helper is only for admins while it is being tested.' };
  return { userId: who.user.id, jwt, admin, db: userClient(jwt) };
}

// The family's day runs on Arizona time (no daylight saving: UTC-7).
export function dayStartUtc(now = new Date()) {
  const az = new Date(now.getTime() - 7 * 3600e3);
  return new Date(Date.UTC(az.getUTCFullYear(), az.getUTCMonth(), az.getUTCDate(), 7));
}

export async function budget(admin: SupabaseClient) {
  const [{ data: s }, { data: rows }] = await Promise.all([
    admin.from('ai_settings').select('daily_cap_usd, model').eq('id', 1).maybeSingle(),
    admin.from('ai_usage').select('cost_usd').gte('created_at', dayStartUtc().toISOString()),
  ]);
  const cap = Number(s?.daily_cap_usd ?? 2);
  const model = MODELS.includes(s?.model) ? s!.model : 'claude-opus-5-5';
  const today = (rows || []).reduce((n: number, r: { cost_usd: number }) => n + Number(r.cost_usd || 0), 0);
  return { cap, model, today, left: Math.max(0, cap - today) };
}

export async function logUsage(admin: SupabaseClient, row: { user_id: string; kind: 'ask' | 'research'; person_id?: string | null; model: string }, u: Usage) {
  const { error } = await admin.from('ai_usage').insert({
    ...row,
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_tokens: u.cacheRead,
    cache_write_tokens: u.cacheWrite,
    web_searches: u.searches,
    cost_usd: Math.round(u.cost * 10000) / 10000,
  });
  if (error) console.error('ai_usage', error.message);
}

// ---------------------------------------------------------------- family data

export type Person = {
  id: string; title: string | null; given_name: string; surname: string | null; other_names: string | null;
  gender: string; generation: number | null; birth_order: number | null; is_living: boolean | null;
};
export type Details = {
  person_id: string; birth_date: string | null; birth_place: string | null; death_date: string | null;
  death_place: string | null; profession: string | null; notes: string | null; sources: string | null; uncertainty: string | null;
};
export type ParentLink = { id: string; parent_id: string; child_id: string; confidence: string; kind?: string };
export type Union = { id: string; partner_a: string; partner_b: string; status: string; sort_order: number; start_date?: string | null; end_date?: string | null };

async function all<T>(db: SupabaseClient, table: string, columns = '*'): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data as T[]));
    if (data.length < 1000) return rows;
  }
}

// Marriage dates and adoption labels come from the same functions the site
// uses, so they follow the same privacy rules.
async function withPrivate<T extends { id: string }>(db: SupabaseClient, table: string, columns: string, fn: string, defaults: Partial<T> = {}) {
  const [rows, extra] = await Promise.all([all<T>(db, table, columns), db.rpc(fn)]);
  const byId = new Map(((extra.data || []) as T[]).map((r) => [r.id, r]));
  return rows.map((r) => ({ ...r, ...defaults, ...byId.get(r.id) }));
}

export async function loadFamily(db: SupabaseClient) {
  const [people, details, links, unions] = await Promise.all([
    all<Person>(db, 'people'),
    all<Details>(db, 'person_details'),
    withPrivate<ParentLink>(db, 'parent_child', 'id,parent_id,child_id,confidence', 'parent_link_details', { kind: 'biological' }),
    withPrivate<Union>(db, 'unions', 'id,partner_a,partner_b,status,sort_order', 'union_details'),
  ]);
  return { people, details: new Map(details.map((d) => [d.person_id, d])), links, unions };
}

export const fullName = (p: Person) => [p.title, p.given_name, p.surname].filter(Boolean).join(' ');

// "1952-03-04" -> "1952", "about 1890" -> "c. 1890" (the site shows years only).
export function year(v: string | null | undefined) {
  if (!v) return '';
  const m = String(v).match(/(c\.|ca\.?|circa|about|abt\.?|approx\.?|~)?\s*(\d{4}s?)/i);
  return m ? (m[1] ? 'c. ' : '') + m[2] : '';
}

export function errorText(e: unknown) {
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Please try again in a minute.';
  if (e instanceof Anthropic.APIError) {
    if (e.status === 401) return 'The Claude API key was not accepted. Please check the ANTHROPIC_API_KEY secret in Supabase.';
    if (e.status === 429) return 'Claude is busy right now (rate limit). Please try again in a minute.';
    if (e.status === 400 && /credit|billing/i.test(e.message)) return 'The Claude account has run out of credit. Please add credit in the Claude Console (Billing).';
    if ((e.status ?? 0) >= 500) return 'Claude had a problem on its side. Please try again in a minute.';
    return `Claude said: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
