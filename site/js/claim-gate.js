// "Claim your box first": before a signed-in member adds, edits or removes
// anything, they claim their own box with "This is me". Members whose box is
// not in the tree yet can say so and carry on, so they can add themselves.
// Admins, members who already claimed a box, and members whose claim is
// waiting for confirmation are never asked.
import { store, listRequests, claimPerson, personClaimedBy, refreshProfile } from './data.js';
import { fullName, relationHint } from './model.js';
import { h, clear, modal, toast } from './ui.js';
import { personPicker } from './forms.js';

const NOT_IN_TREE = 'claim-not-in-tree';

function saidNotInTree() {
  try { return sessionStorage.getItem(NOT_IN_TREE) === '1'; } catch { return false; }
}

// Resolves true when the change may go ahead, false when they closed the box.
export async function claimGate() {
  if (!store.signedIn || store.preview || store.isAdmin || store.claimedId || saidNotInTree()) return true;
  const mine = await listRequests({ status: 'pending', mine: true }).catch(() => []);
  if (mine.some((r) => r.kind === 'claim_person')) return true;
  const linkedId = store.profile?.person_id;
  const linked = linkedId && store.fam.byId.get(linkedId);
  const linkedOwner = linked ? await personClaimedBy(linked.id).catch(() => null) : null;
  return askToClaim(linked && !linkedOwner ? linked : null);
}

// Right after signing in: most invitations name the invitee's box, so take
// them straight to it and ask "Is this you?". Once per visit.
export async function welcomeToLinkedBox(goTo) {
  if (!store.signedIn || store.preview || store.isAdmin || store.claimedId) return;
  try { if (sessionStorage.getItem('claim-welcome') === '1') return; sessionStorage.setItem('claim-welcome', '1'); } catch { /* ignore */ }
  const linked = store.profile?.person_id && store.fam.byId.get(store.profile.person_id);
  if (!linked) return;
  const mine = await listRequests({ status: 'pending', mine: true }).catch(() => []);
  if (mine.some((r) => r.kind === 'claim_person')) return;
  if (await personClaimedBy(linked.id).catch(() => null)) return;
  goTo(linked.id);
  await new Promise((r) => setTimeout(r, 400)); // let the tree move to the box first
  await askToClaim(linked, { welcome: true });
}

function askToClaim(linked, { welcome = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const done = (ok) => { result = ok; m.close(); };

    const claim = async (p, btn) => {
      const owner = await personClaimedBy(p.id).catch(() => null);
      if (owner) return toast(`${fullName(p)} has already been claimed by ${owner}. If that is wrong, please tell the admin.`, 'error');
      btn.disabled = true;
      try {
        const res = await claimPerson(p, `${store.profile?.display_name || 'A member'} says this is them: ${fullName(p)}`);
        toast(res.applied
          ? 'Done. This is now your box. Your changes to your own family will appear right away.'
          : 'Sent. The person who invited you, or the admin, will confirm it. You can carry on meanwhile.', 'ok');
        await refreshProfile();
        done(true);
      } catch (e) {
        toast(e.message.includes('duplicate') ? 'You already have a claim waiting.' : e.message, 'error');
        btn.disabled = false;
      }
    };

    // The box picked from the search, with a button to claim it.
    const picked = h('div.claim-pick', { hidden: true });
    const showPick = (p) => {
      const btn = h('button.btn.primary', { type: 'button', onclick: () => claim(p, btn) }, 'Yes, this is me');
      clear(picked, h('p', h('strong', fullName(p)), h('span.muted', ' ' + relationHint(store.fam, p.id))), btn);
      picked.hidden = false;
    };

    const linkedBtn = linked ? h('button.btn.primary', { type: 'button', onclick: () => claim(linked, linkedBtn) }, `Yes, I am ${fullName(linked)}`) : null;
    const notInTree = h('div.claim-gate-none', { hidden: true },
      h('p', h('strong', 'No problem. '), 'Add yourself under your father or mother (open their box and tap ', h('strong', 'Child'), '). Once your box is in the tree, open it and tap ', h('strong', 'This is me'), '.'),
      h('div.form-actions', h('button.btn.primary', { type: 'button', onclick: () => {
        try { sessionStorage.setItem(NOT_IN_TREE, '1'); } catch { /* ignore */ }
        done(true);
      } }, 'Continue')));

    const content = h('div.claim-gate',
      welcome
        ? h('p', h('strong', 'Welcome dear member of Jaggi Family!'), ' Here is your box in the family tree. Please confirm it is you, so your changes to your own family appear right away and the tree shows how everyone is related to you.')
        : h('p', 'Before you make changes, please claim your own box in the tree. It takes a moment, and then your changes to your own family appear right away and the tree shows how everyone is related to you.'),
      linked ? h('div.claim-linked',
        h('p', 'Your invitation is linked to ', h('strong', fullName(linked)), h('span.muted', ' ' + relationHint(store.fam, linked.id)), '.'),
        linkedBtn) : null,
      h('p.form-note', linked ? 'Not you? Search for your name:' : 'Search for your name:'),
      personPicker(showPick, { placeholder: 'Type your name' }),
      picked,
      h('div.claim-gate-foot',
        h('button.linkish', { type: 'button', onclick: (e) => { e.target.hidden = true; notInTree.hidden = false; } }, "My box isn't in the tree yet")),
      notInTree);
    const m = modal(welcome ? 'Is this you?' : 'First, claim your own box', content, { onClose: () => resolve(result) });
  });
}
