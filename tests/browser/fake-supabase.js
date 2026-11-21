// In-browser fake of the parts of supabase-js the app uses (test only).
const seed = await (await fetch('/data/seed.json')).json();
const ADMIN = !['member', 'owner'].includes(window.__FAKE_ROLE__);
const SUNIL = seed.people.find(p => p.given_name === 'Sunil Kumar').id;
const uid = 'u-1';
// The one-time Blessings welcome would cover the page in every test; skip it unless a test asks for it.
if (!window.__FAKE_INTRO__) try { localStorage.setItem('blessings-intro-seen:' + uid, '1'); } catch {}
const db = {
  people: seed.people, person_details: seed.person_details, parent_child: seed.parent_child, unions: seed.unions,
  profiles: [{ id: uid, email: 'me@example.com', display_name: window.__FAKE_NAME__ || 'Tester', role: ADMIN ? 'admin' : 'member', person_id: window.__FAKE_UNLINKED__ ? null : SUNIL, claimed_person_id: window.__FAKE_ROLE__ === 'owner' || window.__FAKE_CLAIMED__ ? SUNIL : null, created_at: new Date().toISOString() }],
  invites: [], change_requests: [], research_questions: [], not_duplicates: [], page_views: [], removed_members: [], library_links: [], book_drafts: [], book_shares: window.__FAKE_SHARES__ || [],
  ai_settings: [{ id: 1, daily_cap_usd: 2, model: 'claude-haiku-5-5', research_model: 'claude-haiku-5-5' }], ai_usage: [], ai_findings: [],
};
// Sample Library links (window.__FAKE_LIBRARY__): approved ones, plus one suggestion waiting.
if (window.__FAKE_LIBRARY__) {
  const pid = (n) => seed.people.find((p) => p.given_name === n)?.id;
  const at = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const L = (o) => ({ id: crypto.randomUUID(), status: 'approved', visibility: 'public', person_ids: [], submitted_by: uid, source: null, note: null, image_url: null, ...o });
  db.library_links.push(
    L({ url: 'https://www.youtube.com/watch?v=SAMPLEvid01', title: 'A walk through Chakwal bazaar today (sample video)', source: 'YouTube', topic: 'Places today', note: 'The old bazaar and the streets near the family haveli, filmed recently.', submitted_at: at(1) }),
    L({ url: 'https://www.dawn.com/news/1353858', title: "'They set them all on fire': Chakwal recalls horrors of Partition", source: 'Dawn newspaper', topic: 'Partition 1947', note: 'What happened in Chakwal in March 1947, from people who lived through it.', submitted_at: at(2) }),
    L({ url: 'https://dawn.com/news/1200706/chakwals-oldest-village-losing-its-historic-sites', title: "Chakwal's oldest village losing its historic sites", source: 'Dawn newspaper', topic: 'Chakwal history', submitted_at: at(3) }),
    L({ url: 'https://example.com/arya-high-school-chakwal', title: 'Arya High School, Chakwal: the 1933 plaque', source: 'Family photo', topic: 'Arya High School', image_url: 'img/arya-school-plaque-1933.jpg', visibility: 'family', note: 'The foundation plaque with the family name on it.', person_ids: [pid('Bhanna Mal')].filter(Boolean), submitted_at: at(4) }),
    L({ url: 'https://dawn.com/news/1176843/vahali-state-a-gem-in-the-salt-range', title: 'Vahali State: a gem in the Salt Range', source: 'Dawn newspaper', topic: 'Places today', submitted_at: at(5) }),
    L({ url: 'https://www.youtube.com/watch?v=SAMPLEvid02', title: 'Memories of Chakwal: an interview (sample video)', source: 'YouTube', topic: 'Family members', person_ids: [pid('Sunil Kumar')].filter(Boolean), submitted_at: at(6) }),
  );
  db.library_links.push(L({ url: 'https://www.youtube.com/watch?v=SAMPLEvid03', title: 'Chakwal in the 1940s, old photographs (sample video)', source: 'YouTube', topic: 'Chakwal history', status: 'pending', submitted_by: ADMIN ? 'u-2' : uid, note: 'Old photos of the town. Grandfather mentioned some of these places.', submitted_at: at(0) }));
}
// A second member with some visits, for the admin's Visits report.
if (ADMIN) {
  db.profiles.push({ id: 'u-2', email: 'cousin@example.com', display_name: 'Cousin', role: 'member', person_id: null, claimed_person_id: null, created_at: new Date().toISOString() });
  db.invites.push({ email: 'pending@example.com', display_name: 'Not Yet', role: 'member', created_at: new Date().toISOString(), accepted_at: null });
  // Sending an invitation creates the login (and profile) before they ever sign in.
  db.profiles.push({ id: 'u-3', email: 'invited@example.com', display_name: 'Invited Only', role: 'member', person_id: null, claimed_person_id: null, created_at: new Date().toISOString() });
  db.invites.push({ email: 'invited@example.com', display_name: 'Invited Only', role: 'member', created_at: new Date().toISOString(), accepted_at: null });
  db.profiles.push({ id: 'u-4', email: 'came@example.com', display_name: 'Came Once', role: 'member', person_id: null, claimed_person_id: null, created_at: new Date().toISOString() });
  db.invites.push({ email: 'came@example.com', display_name: 'Came Once', role: 'member', created_at: new Date().toISOString(), accepted_at: new Date().toISOString() });
  const someone = seed.people.find((p) => p.given_name === 'Tapashi Ram').id;
  for (let i = 0; i < 6; i++) db.page_views.push({ id: i, user_id: 'u-2', viewed_at: new Date(Date.now() - i * 3 * 864e5).toISOString(), view: 'tree', person_id: someone });
}
// AI helper (window.__FAKE_AI__ adds a sample finding waiting for review).
const pidOf = (n) => seed.people.find((p) => p.given_name === n)?.id;
const sampleFinding = (personId, status = 'pending') => ({
  id: crypto.randomUUID(), person_id: personId, status, created_at: new Date(Date.now() - 36e5).toISOString(), created_by: uid, cost_usd: 0.31,
  request: { names: ['Bakhshi Kesar Mal Jaggi'], gender: 'male', generation_from_bhanna_mal: 2, born: 'not recorded', died: 'not recorded', work: 'not recorded', relatives_who_have_passed_away: [{ relation: 'parent', name: 'Bakhshi Bhanna Mal Jaggi' }, { relation: 'child', name: 'Bakhshi Prabh Dyal Jaggi' }] },
  result: {
    summary: 'SAMPLE TEXT FOR THE PREVIEW (not a real search). A 1933 notice about the opening of Arya High School in **Chakwal** names Bakhshi Kesar Mal Jaggi as the grandfather in whose memory a school building was given by his grandsons Bir Chand and Gyan Prakash, timber merchants of Chakwal. A district gazetteer lists the Bakhshi family among the town\'s Khatri merchant families before 1947.',
    confidence: 'medium', confidence_reason: 'The name, town and grandsons match the tree, but no source gives his own years.',
    sources: [
      { title: 'Sample: Arya High School, Chakwal, opening notice (1933)', url: 'https://example.com/sample-arya-school-1933', what_it_says: 'Names the building given in memory of Bakhshi Kesar Mal Jaggi.', match: 'strong' },
      { title: 'Sample: Jhelum District Gazetteer, Chakwal tahsil', url: 'https://example.com/sample-gazetteer', what_it_says: 'Lists Bakhshi Khatri families of Chakwal.', match: 'possible' },
    ],
    suggested_details: [{ field: 'profession', value: 'Merchant', source_url: 'https://example.com/sample-gazetteer', why: 'The gazetteer lists the family as merchants.' }],
    other_people: [{ name: 'Bir Chand', relation: 'grandson', source_url: 'https://example.com/sample-arya-school-1933' }],
    next_steps: ['Ask the oldest relatives in the Prabh Dyal branch whether a family photo of him survives.', 'Look for Arya Samaj Chakwal records from the 1920s and 1930s.'],
    model: 'claude-opus-5-5', searches: 5,
  },
});
if (window.__FAKE_AI__) {
  db.ai_findings.push(sampleFinding(pidOf('Kesar Mal')));
  db.ai_usage.push({ kind: 'ask', cost_usd: 0.03, created_at: new Date().toISOString() }, { kind: 'research', cost_usd: 0.31, created_at: new Date().toISOString() }, { kind: 'ask', cost_usd: 0.01, created_at: new Date(Date.now() - 5 * 864e5).toISOString() });
}
function fakeAsk(question) {
  const code = new Map(); let n = 0;
  const ref = (id) => { if (!code.has(id)) code.set(id, `P${++n}`); return code.get(id); };
  const name = (id) => { const p = db.people.find((x) => x.id === id); return [p.title, p.given_name, p.surname].filter(Boolean).join(' '); };
  const kids = (id) => db.parent_child.filter((l) => l.parent_id === id).map((l) => l.child_id);
  const km = pidOf('Kesar Mal');
  let answer;
  if (/grandchild/i.test(question)) {
    const sons = kids(km);
    answer = `[${name(km)}](#${ref(km)}) had ${sons.length} sons, and the tree records these grandchildren:\n` +
      sons.map((s) => `**Through [${name(s)}](#${ref(s)}):**\n- ${kids(s).map((g) => `[${name(g)}](#${ref(g)})`).join(', ') || 'none recorded yet'}`).join('\n') +
      '\n\nThe 1933 plaque at Arya High School was placed by two of them, **Bir Chand** and **Gyan Prakash**, in his memory.';
  } else {
    answer = `The tree doesn't record that yet. [${name(km)}](#${ref(km)})'s line is the best place to start; an older relative may know.`;
  }
  return { answer, people: Object.fromEntries([...code].map(([id, c]) => [c, id])), cost: 0.021, today: 0.36, cap: 2, model: 'claude-opus-5-5' };
}
window.__db = db;
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.opts = {}; }
  select(c, o = {}) { if (this.op === 'select') { this.op = 'select'; this.cols = c; } this.opts = o; this.ret = true; return this; }
  eq(k, v) { this.f.push(r => r[k] === v); return this; }
  neq(k, v) { this.f.push(r => r[k] !== v); return this; }
  gte(k, v) { this.f.push(r => r[k] >= v); return this; }
  order() { return this; } limit() { return this; } range(a, b) { this.rg = [a, b]; return this; }
  insert(row) { this.op = 'insert'; this.row = row; return this; }
  upsert(row) { this.op = 'upsert'; this.row = row; return this; }
  update(row) { this.op = 'update'; this.row = row; return this; }
  delete() { this.op = 'delete'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'single'; return this; }
  run() {
    const T = db[this.t];
    const match = r => this.f.every(f => f(r));
    let data = null;
    if (this.op === 'insert' && this.t === 'library_links' && T.some((l) => l.status !== 'declined' && l.url.toLowerCase() === String(this.row.url).toLowerCase())) {
      return { data: null, error: { message: 'duplicate key value violates unique constraint "library_links_url_once"' } };
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      const r = { id: crypto.randomUUID(), status: this.t === 'research_questions' ? 'open' : 'pending', submitted_at: new Date().toISOString(), created_at: new Date().toISOString(), ...this.row };
      if (this.op === 'upsert') { const k = r.token ? 'token' : 'email'; const i = T.findIndex(x => x[k] === r[k]); if (i >= 0) T.splice(i, 1); }
      T.push(r); data = [r];
    } else if (this.op === 'update') { data = T.filter(match); data.forEach(r => Object.assign(r, this.row)); }
    else if (this.op === 'delete') { data = T.filter(match); db[this.t] = T.filter(r => !match(r)); }
    else {
      data = T.filter(match); if (this.rg) data = data.slice(this.rg[0], this.rg[1] + 1);
      // Column lists (no joins) return only those columns, like PostgREST.
      if (this.cols && /^[a-z_,]+$/.test(this.cols)) { const cs = this.cols.split(','); data = data.map((r) => Object.fromEntries(cs.map((c) => [c, r[c]]))); }
    }
    if (this.opts.head) return { data: null, count: data.length, error: null };
    if (this.one) return { data: data[0] ?? null, error: this.one === 'single' && !data[0] ? { message: 'none' } : null };
    return { data, error: null };
  }
  then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }
}
const files = new Map();
export function createClient() {
  const session = window.__FAKE_ROLE__ === 'anon' ? null : { user: { id: uid, email: 'me@example.com' } };
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => {}, signInWithOtp: async () => ({ error: null }), verifyOtp: async () => ({ error: null }), signOut: async () => ({}),
    },
    from: t => new Q(t),
    functions: { invoke: async (name, { body }) => {
      (window.__invoked ||= []).push([name, body.email]);
      if (name === 'visitor-stats') {
        const days = Array.from({ length: body.days }, (_, i) => ({ day: new Date(Date.now() - (body.days - 1 - i) * 864e5).toISOString().slice(0, 10), daily: (i * 7) % 11, hourly: Array.from({ length: 24 }, (_, h) => (h > 14 && h < 22 ? 2 : 0)) }));
        return { data: { days: body.days, total: { total: 142, stats: days },
          pages: { hits: [{ path: '/Jaggis-from-Chakwal-family-tree/#/tree', title: 'Jaggis of Chakwal: tree', count: 90 }, { path: '/Jaggis-from-Chakwal-family-tree/people/', title: 'Ancestors | Jaggi family of Chakwal', count: 30 }] },
          locations: { stats: [{ id: 'IN', name: 'India', count: 70 }, { id: 'US', name: 'United States', count: 50 }, { id: 'CA', name: 'Canada', count: 12 }] },
          referrers: { stats: [{ name: 'Google', count: 40 }, { name: '', count: 80 }, { name: 'WhatsApp', count: 22 }] },
          browsers: { stats: [{ name: 'Chrome', count: 90 }, { name: 'Safari', count: 52 }] },
          systems: { stats: [{ name: 'Android', count: 70 }, { name: 'iOS', count: 40 }, { name: 'Windows', count: 32 }] },
          sizes: { stats: [{ name: 'Phones', count: 100 }, { name: 'Computer monitors', count: 42 }] } }, error: null };
      }
      if (name === 'remove-member') {
        if (body.action === 'remove') { const i = db.invites.findIndex((x) => x.email === body.email); const inv = db.invites.splice(i, 1)[0]; (db.removed_members ||= []).push({ email: body.email, snapshot: { invite: inv, profile: null }, removed_at: new Date().toISOString() }); return { data: { removed: true }, error: null }; }
        const j = db.removed_members.findIndex((x) => x.email === body.email); const r = db.removed_members.splice(j, 1)[0]; db.invites.push(r.snapshot.invite); return { data: { restored: true }, error: null };
      }
      if (name === 'send-reminder') {
        if (body.preview) return { data: { html: `<p>Dear ${body.previewName},</p><p>${body.message}</p>`, subject: body.subject }, error: null };
        window.__reminder = body; return { data: { sent: body.emails, failed: [], skipped: [] }, error: null };
      }
      if (name === 'ask-tree') { await new Promise((r) => setTimeout(r, 400)); return { data: fakeAsk(body.question), error: null }; }
      if (name === 'research-person') {
        const f = sampleFinding(body.person_id, 'running'); f.created_at = new Date().toISOString(); db.ai_findings.push(f);
        setTimeout(() => { f.status = 'pending'; }, window.__FAKE_AI_WAIT__ ?? 3000);
        return { data: { id: f.id, today: 0.36, cap: 2 }, error: null };
      }
      if (name === 'weekly-summary') return { data: { sent: true, to: ['me@example.com'] }, error: null };
      return { data: { sent: true }, error: null };
    } },
    rpc: async (name, args) => {
      // Marriage dates and adoption labels: visitors only get them for people who have passed away.
      const dead = (id) => db.people.find((p) => p.id === id)?.is_living === false;
      const anon = window.__FAKE_ROLE__ === 'anon';
      if (name === 'public_names') return { data: db.people.map((p) => {
        const married = p.gender !== 'male' && db.unions.some((u) => u.partner_a === p.id || u.partner_b === p.id);
        if (!married) return { id: p.id, surname: p.surname, other_names: p.other_names };
        const c = (p.other_names || '').replace(/\([^)]*\)/g, '').trim(); const w = (c.match(/([^\s?]+)$/) || [])[1];
        const ok = w && !/\?$/.test(c) && w.toLowerCase() !== (p.surname || '').toLowerCase() && !(p.given_name || '').toLowerCase().split(' ').includes(w.toLowerCase());
        return { id: p.id, surname: ok ? w : null, other_names: null };
      }), error: null };
      if (name === 'union_details') return { data: db.unions.filter((u) => !anon || (dead(u.partner_a) && dead(u.partner_b))).map(({ id, start_date, end_date, note }) => ({ id, start_date, end_date, note })), error: null };
      if (name === 'parent_link_details') return { data: db.parent_child.filter((l) => !anon || dead(l.child_id)).map(({ id, kind, note }) => ({ id, kind, note })), error: null };
      if (name === 'my_managed_people') {
        const c = db.profiles[0].claimed_person_id; if (!c) return { data: [], error: null };
        const ids = new Set([c]); let grew = true;
        while (grew) { grew = false; for (const l of db.parent_child) if (ids.has(l.parent_id) && !ids.has(l.child_id)) { ids.add(l.child_id); grew = true; } }
        for (const u of db.unions) { if (ids.has(u.partner_a)) ids.add(u.partner_b); if (ids.has(u.partner_b)) ids.add(u.partner_a); }
        return { data: [...ids].map(id => ({ person_id: id, edit_only: false })), error: null };
      }
      if (name === 'person_claimed_by') return { data: db.profiles.find(x => x.claimed_person_id === args.p)?.display_name ?? null, error: null };
      if (name === 'revoke_claim') { db.profiles.find(x => x.id === args.u).claimed_person_id = null; return { data: null, error: null }; }
      if (name === 'blessings_ledger') {
        const me = db.profiles[0];
        const rows = db.change_requests.filter((r) => r.status === 'approved' && ['add_person', 'edit_person', 'set_photo', 'add_link'].includes(r.kind))
          .map((r) => ({ user_id: r.submitted_by, name: me.display_name, person_id: me.claimed_person_id, role: me.role, at: new Date().toISOString(), points: r.kind === 'add_person' ? 5 : 2, kind: r.kind, story: false, reason: r.summary }));
        if (me.claimed_person_id) rows.push({ user_id: me.id, name: me.display_name, person_id: me.claimed_person_id, role: me.role, at: new Date().toISOString(), points: 5, kind: 'claim', story: false, reason: 'Claimed their own box' });
        if (window.__FAKE_BONUS__) rows.push({ user_id: me.id, name: me.display_name, person_id: me.claimed_person_id, role: me.role, at: new Date().toISOString(), points: window.__FAKE_BONUS__, kind: 'edit_person', story: true, reason: 'Added a story' });
        if (window.__FAKE_BADGES__) for (const [kind, story, n] of [['add_person', false, 10], ['edit_person', true, 5], ['set_photo', false, 10]]) for (let i = 0; i < n; i++) rows.push({ user_id: me.id, name: me.display_name, person_id: me.claimed_person_id, role: me.role, at: new Date().toISOString(), points: 1, kind, story, reason: 'Badge test' });
        rows.push({ user_id: 'u-9', name: 'Cousin Neha', person_id: null, role: 'member', at: new Date().toISOString(), points: 12, kind: 'add_person', story: true, reason: 'Add someone' });
        return { data: rows, error: null };
      }
      // A shared book opens by its token, for anyone (no listing).
      if (name === 'shared_book') { const r = db.book_shares.find((x) => x.token === args.t); return { data: r ? [{ title: r.title, snapshot: r.snapshot, updated_at: r.updated_at }] : [], error: null }; }
      if (name === 'member_name') return { data: 'Cousin Neha', error: null };
      if (name === 'undo_change_request') { const r = db.change_requests.find(x => x.id === args.request_id); r.status = 'undone'; return { data: null, error: null }; }
      if (name === 'person_history') {
        return { data: db.change_requests.filter(r => r.status === 'approved' && (r.payload.person_id === args.p || r.result_person_id === args.p))
          .map(r => ({ kind: r.kind, summary: r.summary, by_name: 'Tester', at: new Date().toISOString() })), error: null };
      }
      if (name === 'invite_relative') {
        if (db.invites.some(i => i.email === args.email)) return { data: null, error: { message: `${args.email} has already been invited` } };
        db.invites.push({ email: args.email, display_name: args.display_name, person_id: args.person_id, role: 'member', invited_by: uid, created_at: new Date().toISOString() });
        return { data: null, error: null };
      }
      const r = db.change_requests.find(x => x.id === args.request_id);
      if (name === 'approve_change_request') {
        if (r.kind === 'add_person') {
          const id = crypto.randomUUID();
          db.people.push({ id, ...r.payload.person, generation: 7, photo_visibility: 'branch' });
          db.person_details.push({ person_id: id, ...r.payload.details });
          if (r.payload.link.as === 'child') db.parent_child.push({ id: crypto.randomUUID(), parent_id: r.payload.link.of, child_id: id, kind: 'biological', confidence: 'confirmed' });
        }
        if (r.kind === 'claim_person') db.profiles.find(x => x.id === r.submitted_by).claimed_person_id = r.target_person_id;
        if (r.kind === 'set_photo') { const p = db.people.find(p => p.id === r.payload.person_id); p.photo_path = args.extra.final_path; p.photo_visibility = r.payload.visibility; }
        if (r.kind === 'remove_photo') { const p = db.people.find(p => p.id === r.payload.person_id); p.photo_path = null; }
        if (r.kind === 'edit_person') { const d = db.person_details.find(d => d.person_id === r.payload.person_id); Object.assign(d, r.payload.details); }
        r.status = 'approved'; window.__approved = (window.__approved || []).concat(r);
      } else { r.status = 'rejected'; }
      return { data: null, error: null };
    },
    storage: { from: b => ({
      upload: async (p, blob) => { files.set(b + '/' + p, blob); return { error: null }; },
      download: async p => ({ data: files.get(b + '/' + p), error: null }),
      remove: async () => ({ error: null }),
      getPublicUrl: p => ({ data: { publicUrl: URL.createObjectURL(files.get(b + '/' + p) || new Blob()) } }),
      createSignedUrl: async p => ({ data: { signedUrl: URL.createObjectURL(files.get(b + '/' + p) || new Blob()) } }),
      createSignedUrls: async ps => ({ data: ps.map(p => ({ signedUrl: URL.createObjectURL(files.get(b + '/' + p) || new Blob()) })) }),
    }) },
  };
}
