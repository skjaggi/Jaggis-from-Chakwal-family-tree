// Everything that talks to Supabase (or, in preview mode, reads the seed file).
import { config } from './config.js';
import { buildFamily, fullName } from './model.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm';

export const store = {
  preview: !(config.supabaseUrl && config.supabaseAnonKey),
  sb: null,
  session: null,
  profile: null,
  fam: null,
  photoUrls: new Map(),
  listeners: new Set(),
  onChange(fn) {
    this.listeners.add(fn);
  },
  emit() {
    for (const fn of this.listeners) fn();
  },
  get signedIn() {
    return !!this.session;
  },
  get isAdmin() {
    return this.profile?.role === 'admin';
  },
};

export async function init() {
  if (store.preview) {
    await loadData();
    return;
  }
  const { createClient } = await import(SUPABASE_ESM);
  store.sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
  });
  const { data } = await store.sb.auth.getSession();
  store.session = data.session;
  await loadProfile();
  store.sb.auth.onAuthStateChange((event, session) => {
    const changed = (session?.user?.id || null) !== (store.session?.user?.id || null);
    store.session = session;
    if (!changed) return;
    // Supabase holds its sign-in lock while this callback runs, so database
    // calls made here would wait on it forever. Do the work just afterwards.
    setTimeout(async () => {
      await loadProfile();
      await loadData();
      store.emit();
    }, 0);
  });
  await loadData();
}

async function loadProfile() {
  store.profile = null;
  if (!store.session) return;
  const { data, error } = await store.sb.from('profiles').select('*').eq('id', store.session.user.id).maybeSingle();
  if (error) console.warn('profile', error);
  store.profile = data;
}

async function selectAll(table, columns = '*') {
  // Supabase returns at most 1000 rows per request; page through.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await store.sb.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function loadData() {
  let people, details, parentChild, unions;
  if (store.preview) {
    const seed = await (await fetch('data/seed.json')).json();
    people = seed.people;
    // Preview mode shows only what a signed-out visitor would see.
    details = seed.person_details.filter((d) => d.visibility === 'public');
    parentChild = seed.parent_child;
    unions = seed.unions;
  } else {
    [people, details, parentChild, unions] = await Promise.all([
      selectAll('people'),
      selectAll('person_details'),
      selectAll('parent_child'),
      selectAll('unions'),
    ]);
  }
  for (const p of people) p._order = p.birth_order ?? 1e6;
  store.fam = buildFamily({ people, details, parentChild, unions });
  await loadPhotoUrls(people);
}

async function loadPhotoUrls(people) {
  store.photoUrls = new Map();
  // Historical pictures that ship with the site (e.g. "img/arya-school-plaque-1933.jpg")
  // are public and are served from the site itself rather than from storage.
  for (const p of people) {
    if (p.photo_path?.startsWith('img/')) store.photoUrls.set(p.id, p.photo_path);
  }
  if (store.preview) return;
  const branch = [];
  for (const p of people) {
    if (!p.photo_path || p.photo_path.startsWith('img/')) continue;
    if (p.photo_visibility === 'public') {
      store.photoUrls.set(p.id, store.sb.storage.from('photos-public').getPublicUrl(p.photo_path).data.publicUrl);
    } else if (store.signedIn) {
      branch.push(p);
    }
  }
  if (branch.length) {
    const { data } = await store.sb.storage.from('photos-branch').createSignedUrls(branch.map((p) => p.photo_path), 60 * 60 * 6);
    (data || []).forEach((r, i) => {
      if (r?.signedUrl && !r.error) store.photoUrls.set(branch[i].id, r.signedUrl);
    });
  }
}

// ------------------------------------------------------------------ auth

export async function sendLoginLink(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await store.sb.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: redirect, shouldCreateUser: true },
  });
  if (error) throw friendlyAuthError(error);
}

export async function verifyCode(email, token) {
  const { error } = await store.sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' });
  if (error) throw friendlyAuthError(error);
}

function friendlyAuthError(error) {
  const msg = error.message || String(error);
  if (/database error|not been invited/i.test(msg)) {
    return new Error(`This email hasn't been invited yet. Ask ${config.adminName} to invite you.`);
  }
  if (/rate limit|security purposes/i.test(msg)) {
    return new Error('Too many sign-in emails were sent. Please wait a minute and try again.');
  }
  return new Error(msg);
}

export async function signOut() {
  await store.sb.auth.signOut();
}

// ------------------------------------------------------------------ changes

// Members' changes wait for approval. The admin's own changes apply at once
// (they still go through the same path, so there is a record of them).
export async function submitChange(kind, payload, { target = null, summary = '' } = {}) {
  const { data, error } = await store.sb
    .from('change_requests')
    .insert({ kind, payload, target_person_id: target, summary, submitted_by: store.session.user.id })
    .select()
    .single();
  if (error) throw error;
  if (store.isAdmin) {
    const result = await approveChange(data, 'Made by admin');
    return { applied: true, result };
  }
  return { applied: false, request: data };
}

export async function approveChange(req, note = null) {
  let extra = {};
  // The photo file this change replaces or removes, to tidy up afterwards.
  const old = ['set_photo', 'remove_photo'].includes(req.kind) ? store.fam?.byId.get(req.payload.person_id) : null;
  const oldPath = old?.photo_path;
  const oldBucket = old?.photo_visibility === 'public' ? 'photos-public' : 'photos-branch';
  if (req.kind === 'set_photo') extra = { final_path: await movePendingPhoto(req) };
  const { data, error } = await store.sb.rpc('approve_change_request', { request_id: req.id, note, extra });
  if (error) throw error;
  if (req.kind === 'set_photo') {
    await store.sb.storage.from('photos-pending').remove([req.payload.path]);
  }
  if (oldPath && !oldPath.startsWith('img/') && oldPath !== extra.final_path) {
    await store.sb.storage.from(oldBucket).remove([oldPath]).catch(() => {});
  }
  await loadData();
  store.emit();
  return data;
}

export async function rejectChange(req, note = null) {
  const { error } = await store.sb.rpc('reject_change_request', { request_id: req.id, note });
  if (error) throw error;
  if (req.kind === 'set_photo') await store.sb.storage.from('photos-pending').remove([req.payload.path]);
}

async function movePendingPhoto(req) {
  const { person_id, path, visibility } = req.payload;
  const { data: blob, error } = await store.sb.storage.from('photos-pending').download(path);
  if (error) throw new Error('Could not read the uploaded photo: ' + error.message);
  const bucket = visibility === 'public' ? 'photos-public' : 'photos-branch';
  const finalPath = `${person_id}/${Date.now()}.jpg`;
  const up = await store.sb.storage.from(bucket).upload(finalPath, blob, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw new Error('Could not save the photo: ' + up.error.message);
  return finalPath;
}

export async function uploadPendingPhoto(blob) {
  const path = `${store.session.user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await store.sb.storage.from('photos-pending').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

export async function pendingPhotoUrl(path) {
  const { data } = await store.sb.storage.from('photos-pending').createSignedUrl(path, 3600);
  return data?.signedUrl;
}

export async function listRequests({ status = 'pending', mine = false } = {}) {
  let q = store.sb.from('change_requests').select('*').order('submitted_at', { ascending: status === 'pending' }).limit(200);
  if (status) q = q.eq('status', status);
  else q = q.neq('status', 'pending');
  if (mine) q = q.eq('submitted_by', store.session.user.id);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function withdrawRequest(req) {
  const { error } = await store.sb.from('change_requests').delete().eq('id', req.id);
  if (error) throw error;
  if (req.kind === 'set_photo') await store.sb.storage.from('photos-pending').remove([req.payload.path]);
}

export async function pendingCount() {
  if (!store.isAdmin) return 0;
  const { count } = await store.sb.from('change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  return count || 0;
}

// ------------------------------------------------------------------ admin

export async function listProfiles() {
  const { data, error } = await store.sb.from('profiles').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function updateProfile(id, fields) {
  const { error } = await store.sb.from('profiles').update(fields).eq('id', id);
  if (error) throw error;
}

export async function listInvites() {
  const { data, error } = await store.sb.from('invites').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addInvite({ email, display_name, person_id, role }) {
  const { error } = await store.sb.from('invites').upsert({
    email: email.trim().toLowerCase(),
    display_name: display_name || null,
    person_id: person_id || null,
    role: role || 'member',
    invited_by: store.session.user.id,
  });
  if (error) throw error;
}

// Any signed-in member can invite a relative (as a member). Works at once.
export async function inviteRelative({ email, display_name, person_id }) {
  const { error } = await store.sb.rpc('invite_relative', { email, display_name: display_name || null, person_id: person_id || null });
  if (error) throw error;
}

export async function listMyInvites() {
  const { data, error } = await store.sb.from('invites').select('*').eq('invited_by', store.session.user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function removeInvite(email) {
  const { error } = await store.sb.from('invites').delete().eq('email', email);
  if (error) throw error;
}

export function personLabel(id) {
  const p = store.fam?.byId.get(id);
  return p ? fullName(p) : 'someone no longer in the tree';
}
