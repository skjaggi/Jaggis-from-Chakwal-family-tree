// "View as" (admin only): see the site the way one family member sees it,
// without signing in as them. The admin picks a member; the site then uses
// that member's profile (their claimed box, their role), works out which
// people they look after and which branch-only details and photos they may
// see, and draws everything as for them. It is a preview only: every save,
// upload, email and approval is refused while viewing, so nothing changes.
//
// The rules below copy the database's own (supabase/schema.sql):
//   my_visible_people()  -> visibleFor()
//   _branch_of(), _ancestors_of(), _can_manage_person() -> managedFor()
//   union_details()      -> marriage dates in memberFamily()
//   change_requests read policy -> canReview()
import { store, predictManage, restoreRealViewer, listProfiles, listInvites, listRemoved } from './data.js';
import { buildFamily, fullName } from './model.js';
import { branchOf } from './completeness.js';
import { h, clear, modal, toast } from './ui.js';

const KEY = 'view-as';
const BRANCH_LEVEL = 4;

// Database functions that only read. Everything else is refused.
const READ_RPCS = new Set(['blessings_ledger', 'member_name', 'person_claimed_by', 'person_history', 'public_names', 'union_details', 'parent_link_details']);

function whoName(p) {
  return p?.display_name || p?.email || 'this member';
}

// A stand-in for a Supabase call that is not allowed while viewing: it can be
// chained (.select().single()) and awaited, and gives back { error } the way a
// refused Supabase call does, so every page shows its usual error message.
function refusal() {
  const error = new Error(`You are viewing the site as ${whoName(store.viewAs?.profile)}. This is only a preview, so nothing is saved or sent. Tap "Back to my view" to make changes.`);
  const result = { data: null, error, count: null };
  const done = Promise.resolve(result);
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then') return done.then.bind(done);
      if (k === 'catch') return done.catch.bind(done);
      if (k === 'finally') return done.finally.bind(done);
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

const pass = (target, k) => {
  const v = target[k];
  return typeof v === 'function' ? v.bind(target) : v;
};

// The Supabase client, with every way of changing something switched off.
function readOnly(sb) {
  const TABLE_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
  const FILE_WRITES = new Set(['upload', 'update', 'remove', 'move', 'copy', 'uploadToSignedUrl', 'createSignedUploadUrl']);
  const guard = (obj, blocked) => new Proxy(obj, { get: (t, k) => (blocked.has(k) ? () => refusal() : pass(t, k)) });
  const storage = new Proxy(sb.storage, { get: (t, k) => (k === 'from' ? (bucket) => guard(t.from(bucket), FILE_WRITES) : pass(t, k)) });
  return new Proxy(sb, {
    get(t, k) {
      if (k === 'from') return (table) => guard(t.from(table), TABLE_WRITES);
      if (k === 'rpc') return (fn, ...args) => (READ_RPCS.has(fn) ? t.rpc(fn, ...args) : refusal());
      if (k === 'storage') return storage;
      if (k === 'functions') return { invoke: () => refusal() }; // emails, invites, removals
      return pass(t, k);
    },
  });
}

// ---------------------------------------------------------------- rules

const spousesOf = (fam, id) => fam.spouses(id).map((s) => s.person?.id).filter(Boolean);

function ancestorsOf(fam, id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    for (const l of fam.parentLinks(stack.pop())) if (!out.has(l.parent_id)) { out.add(l.parent_id); stack.push(l.parent_id); }
  }
  return out;
}

function descendantsOf(fam, ids) {
  const out = new Set(ids);
  const stack = [...ids];
  while (stack.length) {
    for (const l of fam.childLinks(stack.pop())) if (!out.has(l.child_id)) { out.add(l.child_id); stack.push(l.child_id); }
  }
  return out;
}

// Whose branch-only details this member can read (my_visible_people): their
// own box and spouses, all their ancestors, everyone descended from their
// generation-4 ancestor (their family branch), and all those people's spouses.
export function visibleFor(fam, personId) {
  if (!personId || !fam.byId.has(personId)) return new Set();
  const meAndSpouses = new Set([personId, ...spousesOf(fam, personId)]);
  const anc = new Set(meAndSpouses);
  for (const id of meAndSpouses) for (const a of ancestorsOf(fam, id)) anc.add(a);
  const roots = new Set(meAndSpouses);
  for (const id of anc) if (fam.byId.get(id)?.generation === BRANCH_LEVEL) roots.add(id);
  const line = new Set([...descendantsOf(fam, roots), ...anc]);
  const out = new Set(line);
  for (const id of line) for (const s of spousesOf(fam, id)) out.add(s);
  return out;
}

// Who this member looks after: id -> true when only details and photo can be
// changed. Leaves out people another branch admin from a different line also
// covers, because those changes wait for the admin.
export function managedFor(fam, member, profiles) {
  const out = new Map();
  const c = member.claimed_person_id;
  if (!c || !fam.byId.has(c)) return out;
  const deadAncestors = (id) => new Set([...ancestorsOf(fam, id)].filter((a) => fam.byId.get(a)?.is_living === false));
  const mine = new Set(branchOf(fam, c));
  const others = profiles
    .filter((o) => o.id !== member.id && o.claimed_person_id && fam.byId.has(o.claimed_person_id))
    .map((o) => ({ c: o.claimed_person_id, branch: new Set(branchOf(fam, o.claimed_person_id)), anc: deadAncestors(o.claimed_person_id) }))
    .filter((o) => !mine.has(o.c) && !o.branch.has(c));
  const shared = (p, scope) => others.some((o) => o.branch.has(p) || (scope === 'person' && o.anc.has(p)));
  for (const p of mine) {
    if (shared(p, 'person')) continue;
    out.set(p, shared(p, 'branch'));
  }
  for (const p of deadAncestors(c)) if (!mine.has(p) && !shared(p, 'person')) out.set(p, true);
  return out;
}

// The family as this member would load it: branch-only details, photos and
// marriage dates only for the people they may see.
function memberFamily(raw, visible) {
  const living = new Map(raw.people.map((p) => [p.id, p.is_living]));
  const details = raw.details.filter((d) => d.visibility === 'public' || visible.has(d.person_id));
  const unions = raw.unions.map((u) => {
    const ok = (living.get(u.partner_a) === false && living.get(u.partner_b) === false) || visible.has(u.partner_a) || visible.has(u.partner_b);
    return ok ? u : { ...u, start_date: null, end_date: null, note: null };
  });
  return buildFamily({ people: raw.people, details, parentChild: raw.parentChild, unions });
}

function memberPhotos(urls, fam, visible) {
  const out = new Map();
  for (const [id, url] of urls) {
    const p = fam.byId.get(id);
    if (!p || p.photo_visibility === 'public' || p.photo_path?.startsWith('img/') || visible.has(id)) out.set(id, url);
  }
  return out;
}

// ---------------------------------------------------------------- switching

function apply(member, profiles, invites) {
  const real = store.real;
  const admin = member.role === 'admin';
  const visible = admin ? null : visibleFor(real.fam, member.person_id);
  store.fam = admin ? real.fam : memberFamily(store.raw, visible);
  store.photoUrls = admin ? real.photoUrls : memberPhotos(real.photoUrls, real.fam, visible);
  store.managed = admin ? new Map() : managedFor(store.fam, member, profiles);
  const inviter = new Map(invites.map((i) => [i.email.toLowerCase(), i.invited_by]));
  const emailOf = new Map(profiles.map((u) => [u.id, (u.email || '').toLowerCase()]));
  store.viewAs = {
    profile: member,
    // Pending suggestions this member would be asked to review.
    canReview: (r) => (r.kind === 'claim_person' ? inviter.get(emailOf.get(r.submitted_by)) === member.id : predictManage(r.kind, r.payload)),
    // The data was reloaded (rare while viewing): filter the new copy again.
    reapply: () => {
      store.real.fam = store.fam;
      store.real.photoUrls = store.photoUrls;
      apply(member, profiles, invites);
    },
  };
}

export async function enterViewAs(member, { profiles, invites } = {}) {
  if (!store.isRealAdmin) return;
  profiles ||= await listProfiles();
  invites ||= await listInvites().catch(() => []);
  if (!store.viewAs) {
    store.real = { profile: store.profile, session: store.session, sb: store.sb, fam: store.fam, photoUrls: store.photoUrls, managed: store.managed };
  }
  store.profile = { ...member };
  store.session = { user: { id: member.id, email: member.email } };
  store.sb = readOnly(store.real.sb);
  apply(member, profiles, invites);
  try { sessionStorage.setItem(KEY, member.id); } catch { /* ignore */ }
  try { sessionStorage.removeItem('claim-later'); } catch { /* show their claim reminder as they would */ }
  store.emit();
}

export function exitViewAs() {
  if (!store.viewAs) return;
  restoreRealViewer();
  store.emit();
}

// After a reload in the same tab, carry on viewing as the same member.
export async function resumeViewAs() {
  let id = null;
  try { id = sessionStorage.getItem(KEY); } catch { /* ignore */ }
  if (!id || !store.isRealAdmin || store.viewAs) return false;
  const profiles = await listProfiles().catch(() => []);
  const member = profiles.find((u) => u.id === id);
  if (!member) {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    return false;
  }
  await enterViewAs(member, { profiles });
  return true;
}

// What the member is, in a few words, for the picker and the banner.
export function describeMember(u, fam, invite) {
  const box = u.claimed_person_id && fam.byId.get(u.claimed_person_id);
  if (u.role === 'admin') return box ? `Admin · ${fullName(box)}` : 'Admin';
  if (box) return `Branch admin of ${fullName(box)}`;
  if (invite && !invite.accepted_at) return 'Invited, not signed in yet';
  return 'Signed in, no box claimed yet';
}

// ---------------------------------------------------------------- picker

export async function openViewAsPicker(onPicked) {
  if (!store.isRealAdmin) return;
  const list = h('ul.viewas-list', h('li.muted', 'Loading members…'));
  const search = h('input', { type: 'search', placeholder: 'Type a name or email', autocomplete: 'off', 'aria-label': 'Find a member' });
  const m = modal('View the site as…', h('div.viewas-pick',
    h('p.form-note', 'See the tree, the menu and the buttons exactly as this member sees them. It is only a preview: nothing you do is saved, sent or approved until you tap "Back to my view".'),
    search, list));
  let profiles, invites, removed;
  try {
    [profiles, invites, removed] = await Promise.all([listProfiles(), listInvites().catch(() => []), listRemoved().catch(() => [])]);
  } catch (e) {
    clear(list, h('li.muted', e.message));
    return;
  }
  const me = (store.real?.profile || store.profile)?.id;
  const gone = new Set(removed.map((r) => (r.email || '').toLowerCase()));
  const inviteOf = new Map(invites.map((i) => [i.email.toLowerCase(), i]));
  const fam = store.real?.fam || store.fam;
  const members = profiles
    .filter((u) => u.id !== me && !gone.has((u.email || '').toLowerCase()))
    .map((u) => ({ u, label: describeMember(u, fam, inviteOf.get((u.email || '').toLowerCase())) }))
    .sort((a, b) => whoName(a.u).localeCompare(whoName(b.u)));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = members.filter(({ u }) => !q || `${u.display_name || ''} ${u.email || ''}`.toLowerCase().includes(q));
    clear(list, shown.length ? shown.map(({ u, label }) =>
      h('li', h('button.viewas-row', { type: 'button', onclick: async () => {
        m.close();
        try {
          await enterViewAs(u, { profiles, invites });
          onPicked?.(u);
        } catch (e) {
          toast(e.message, 'error');
        }
      } },
      h('strong', whoName(u)),
      h('span.muted.small', `${u.email || ''}`),
      h('span.viewas-tag' + (u.claimed_person_id ? '.ok' : ''), label)))) : h('li.muted', 'Nobody matches.'));
  };
  search.addEventListener('input', draw);
  draw();
  setTimeout(() => search.focus(), 50);
}

// The strip across the top while viewing as someone.
export function renderViewAsBanner(el, { onSwitch, onExit }) {
  if (!store.viewAs) { el.hidden = true; clear(el); return; }
  const u = store.viewAs.profile;
  const fam = store.real.fam;
  clear(el,
    h('span', '👁 ', h('strong', `Viewing as ${whoName(u)}`), h('span.viewas-what', ` (${describeMember(u, fam).replace(/^Signed in, /, '')})`),
      h('span.viewas-note', '. Only a preview: nothing is saved or sent.')),
    h('span.claim-actions',
      h('button.btn.small', { type: 'button', onclick: onSwitch }, 'Someone else'),
      h('button.btn.small.primary', { type: 'button', onclick: onExit }, 'Back to my view')));
  el.hidden = false;
}
