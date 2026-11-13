// "Invite a relative": any signed-in family member can invite someone. The
// invite works at once (as a member); the inviter then sends a ready-made
// message from their own email, WhatsApp or text. The admin sees every invite
// and who sent it on the Members page.
import { store, inviteRelative, listMyInvites, sendInviteEmail, personLabel } from './data.js';
import { config } from './config.js';
import { fullName } from './model.js';
import { h, clear, toast, field, confirmDialog, formatWhen } from './ui.js';
import { personPicker } from './forms.js';

export function siteUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || '';
}

export function inviteMessage({ email, display_name }, fromName) {
  const site = siteUrl();
  const hello = firstName(display_name) ? `Dear ${firstName(display_name)},` : 'Hello,';
  return [
    hello,
    '',
    `You're invited to the online family tree of the Jaggis of Chakwal, starting from Bakhshi Bhanna Mal Jaggi.`,
    '',
    `Open the tree: ${site}`,
    '',
    `Anyone can look around. To add or correct something, sign in once:`,
    `1. Tap "Sign in" at the top and enter ${email}.`,
    `2. You'll get an email with a 6-digit code (check Spam if it doesn't arrive in a minute).`,
    `3. Type the code on the site. There is no password.`,
    '',
    `You only sign in once on each phone or computer. A short guide: ${site}help.html`,
    '',
    `Please note: changes you make are not visible right away. ${config.adminName}, the administrator, checks each one first, and it appears in the tree once approved. So don't worry about mistakes.`,
    '',
    fromName ? `With love,\n${fromName}` : '',
  ].join('\n').trim();
}

const SUBJECT = "You're invited to the Jaggi family tree";

// Buttons to send the invitation message the inviter's own way.
export function sendButtons(invite) {
  const from = firstName(store.profile?.display_name) || '';
  const text = inviteMessage(invite, from);
  const enc = encodeURIComponent;
  const resend = h('button.btn.small', { type: 'button', onclick: async () => {
    resend.disabled = true;
    try {
      toast(await sendInviteEmail(invite.email), 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    resend.disabled = false;
  } }, 'Resend invitation email');
  const buttons = [
    resend,
    h('a.btn.small', { href: `mailto:${invite.email}?subject=${enc(SUBJECT)}&body=${enc(text)}` }, 'Email it myself'),
    h('a.btn.small', { href: `https://wa.me/?text=${enc(text)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
    h('button.btn.small', { type: 'button', onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Message copied. Paste it into a text, email or WhatsApp.', 'ok');
      } catch {
        toast('Could not copy. Please use Email or WhatsApp.', 'error');
      }
    } }, 'Copy message'),
  ];
  if (navigator.share) {
    buttons.unshift(h('button.btn.small', { type: 'button', onclick: () => navigator.share({ title: SUBJECT, text }).catch(() => {}) }, 'Share…'));
  }
  return h('div.send-invite', buttons);
}

export async function renderInvite(container) {
  let chosen = null;
  const chosenLabel = h('p.form-note', 'Nobody chosen yet.');
  const mine = h('section');
  const form = h('form.form.invite-form',
    h('div.row2',
      field('Their email *', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      field('Their name', h('input', { name: 'display_name', type: 'text' }))),
    field('Who are they in the tree?', personPicker((p) => {
      chosen = p;
      chosenLabel.textContent = `Linked to ${fullName(p)}`;
    }), "This decides which branch's private details and photos they can see. If they aren't in the tree yet, add them first from a relative's card."),
    chosenLabel,
    h('div.form-actions', h('button.btn.primary', { type: 'submit' }, 'Invite')));

  async function showMine(justAdded) {
    let list;
    try {
      list = await listMyInvites();
    } catch (e) {
      return clear(mine, h('p.notice', e.message));
    }
    if (!list.length) return clear(mine);
    clear(mine,
      h('h2', 'People you invited'),
      h('ul.history', list.map((i) => h('li',
        justAdded === i.email ? h('span.tag.ok', 'just added') : null, ' ',
        h('strong', i.display_name || i.email), i.display_name ? h('span.muted', ` ${i.email}`) : null,
        h('span.muted', ` · ${i.person_id ? personLabel(i.person_id) : 'not linked'} · ${i.accepted_at ? 'signed in ' + formatWhen(i.accepted_at) : 'not signed in yet'}`),
        i.accepted_at ? null : sendButtons(i)))));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Please enter a valid email address.', 'error');
    if (!chosen && !(await confirmDialog("You haven't chosen who they are in the tree, so they won't see private details of any branch. Invite anyway?", 'Invite anyway'))) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await inviteRelative({ email, display_name: form.display_name.value.trim(), person_id: chosen?.id });
      form.reset();
      chosen = null;
      chosenLabel.textContent = 'Nobody chosen yet.';
      try {
        toast(`Invited. ${await sendInviteEmail(email)}`, 'ok');
      } catch (mailErr) {
        toast(`${email} can sign in now, but the email didn't go out (${mailErr.message}). Use the Email or WhatsApp button below.`, 'error');
      }
      await showMine(email);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  clear(container,
    h('h1', 'Invite a relative'),
    h('p', 'Know someone in the family who should be able to add photos, dates and stories? Add their email here and the site emails them an invitation with a sign-in link. You can also send it yourself by WhatsApp or text with the buttons that appear.'),
    form, mine);
  showMine();
}
