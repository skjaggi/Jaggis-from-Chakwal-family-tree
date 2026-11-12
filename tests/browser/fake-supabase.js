// In-browser fake of the parts of supabase-js the app uses (test only).
const seed = await (await fetch('/data/seed.json')).json();
const ADMIN = window.__FAKE_ROLE__ !== 'member';
const uid = 'u-1';
const db = {
  people: seed.people, person_details: seed.person_details, parent_child: seed.parent_child, unions: seed.unions,
  profiles: [{ id: uid, email: 'me@example.com', display_name: 'Tester', role: ADMIN ? 'admin' : 'member', person_id: seed.people.find(p => p.given_name === 'Sunil Kumar').id, created_at: new Date().toISOString() }],
  invites: [], change_requests: [],
};
window.__db = db;
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.opts = {}; }
  select(c, o = {}) { if (this.op === 'select') this.op = 'select'; this.opts = o; this.ret = true; return this; }
  eq(k, v) { this.f.push(r => r[k] === v); return this; }
  neq(k, v) { this.f.push(r => r[k] !== v); return this; }
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
    if (this.op === 'insert' || this.op === 'upsert') {
      const r = { id: crypto.randomUUID(), status: 'pending', submitted_at: new Date().toISOString(), created_at: new Date().toISOString(), ...this.row };
      if (this.op === 'upsert') { const i = T.findIndex(x => x.email === r.email); if (i >= 0) T.splice(i, 1); }
      T.push(r); data = [r];
    } else if (this.op === 'update') { data = T.filter(match); data.forEach(r => Object.assign(r, this.row)); }
    else if (this.op === 'delete') { data = T.filter(match); db[this.t] = T.filter(r => !match(r)); }
    else { data = T.filter(match); if (this.rg) data = data.slice(this.rg[0], this.rg[1] + 1); }
    if (this.opts.head) return { data: null, count: data.length, error: null };
    if (this.one) return { data: data[0] ?? null, error: this.one === 'single' && !data[0] ? { message: 'none' } : null };
    return { data, error: null };
  }
  then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }
}
const files = new Map();
export function createClient() {
  const session = { user: { id: uid, email: 'me@example.com' } };
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => {}, signInWithOtp: async () => ({ error: null }), verifyOtp: async () => ({ error: null }), signOut: async () => ({}),
    },
    from: t => new Q(t),
    rpc: async (name, args) => {
      const r = db.change_requests.find(x => x.id === args.request_id);
      if (name === 'approve_change_request') {
        if (r.kind === 'add_person') {
          const id = crypto.randomUUID();
          db.people.push({ id, ...r.payload.person, generation: 7, photo_visibility: 'branch' });
          db.person_details.push({ person_id: id, ...r.payload.details });
          if (r.payload.link.as === 'child') db.parent_child.push({ id: crypto.randomUUID(), parent_id: r.payload.link.of, child_id: id, kind: 'biological', confidence: 'confirmed' });
        }
        if (r.kind === 'set_photo') { const p = db.people.find(p => p.id === r.payload.person_id); p.photo_path = args.extra.final_path; p.photo_visibility = r.payload.visibility; }
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
