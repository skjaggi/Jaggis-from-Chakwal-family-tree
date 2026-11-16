// Members page: send a reminder email to all or some family members asking
// them to visit and update the tree. The admin sees the exact email (preview)
// before anything is sent.
import { store, functionError } from './data.js';
import { h, clear, toast, field, confirmDialog } from './ui.js';

const DEFAULT_SUBJECT = 'Please help us complete the Jaggi family tree';
const DEFAULT_MESSAGE = `We are building our family tree so the stories of the Jaggis of Chakwal are not lost. Thanksgiving is coming up, and it would mean a lot if you could spend a few minutes on it this week.

Please sign in, find your own box and tap "This is me", then add or correct anything you know: names, birth years, places, photos and stories. Every addition earns you blessings on the family leaderboard.

Details about our earliest generations are the most precious, so if you remember anything about our grandparents and great-grandparents, please add it.`;

async function call(body) {
  const { data, error } = await store.sb.functions.invoke('send-reminder', { body });
  if (error) throw new Error(await functionError(error));
  return data;
}

export function reminderSection(invites, profiles) {
  // Everyone who can receive one: invited people plus anyone signed in.
  const people = new Map();
  for (const i of invites) people.set(i.email.toLowerCase(), { email: i.email.toLowerCase(), name: i.display_name || '', signedIn: !!i.accepted_at, claimed: false });
  for (const p of profiles) {
    if (!p.email) continue;
    const e = p.email.toLowerCase();
    // Sending an invitation already creates the login and its profile, so a
    // profile alone doesn't mean they signed in: the invite's accepted_at
    // (set on their first real sign-in) decides. No invite = signed in.
    const cur = people.get(e) || { email: e, name: '', signedIn: true, claimed: false };
    cur.name = p.display_name || cur.name;
    cur.claimed = !!p.claimed_person_id;
    if (cur.claimed) cur.signedIn = true;
    cur.self = p.id === store.session.user.id;
    people.set(e, cur);
  }
  const list = [...people.values()].filter((p) => !p.self).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const boxes = new Map();
  const count = h('span.muted');
  const update = () => { count.textContent = `${[...boxes.values()].filter((b) => b.checked).length} of ${list.length} selected`; };
  const pick = (test) => { for (const p of list) boxes.get(p.email).checked = test(p); update(); };

  const rows = h('ul.reminder-list', list.map((p) => {
    const box = h('input', { type: 'checkbox', id: `rem-${p.email}`, onchange: update });
    boxes.set(p.email, box);
    return h('li', h('label', { for: `rem-${p.email}` }, box,
      h('span', h('strong', p.name || p.email), p.name ? h('span.muted.small', ` ${p.email}`) : null),
      h('span.rem-tag' + (p.signedIn ? (p.claimed ? '.ok' : '.half') : '.no'),
        p.signedIn ? (p.claimed ? 'Box claimed' : 'Signed in, no box') : 'Not signed in yet')));
  }));
  update();

  const subject = h('input', { id: 'rem-subject', type: 'text', value: DEFAULT_SUBJECT, maxlength: 150 });
  const message = h('textarea', { id: 'rem-message', rows: 9, value: DEFAULT_MESSAGE, maxlength: 5000 });
  const previewBox = h('div.rem-preview', { hidden: true });
  const selected = () => list.filter((p) => boxes.get(p.email).checked);

  const previewBtn = h('button.btn', { type: 'button', onclick: async () => {
    previewBtn.disabled = true;
    try {
      const first = selected()[0];
      const res = await call({ preview: true, subject: subject.value, message: message.value, previewName: (first?.name || 'Name').split(' ')[0] });
      const frame = h('iframe', { title: 'Email preview', sandbox: '' });
      frame.srcdoc = res.html;
      clear(previewBox, h('p.small.muted', h('strong', 'Subject: '), res.subject), frame);
      previewBox.hidden = false;
    } catch (e) { toast(e.message, 'error'); }
    previewBtn.disabled = false;
  } }, 'Preview the email');

  const sendBtn = h('button.btn.primary', { type: 'button', onclick: async () => {
    const to = selected();
    if (!to.length) return toast('Pick at least one person.', 'error');
    if (!subject.value.trim() || !message.value.trim()) return toast('Please write a subject and a message.', 'error');
    if (!(await confirmDialog(`Send "${subject.value.trim()}" to ${to.length} ${to.length === 1 ? 'person' : 'people'}? Each gets their own copy starting "Dear <name>". This can't be undone.`, `Send to ${to.length}`))) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      const res = await call({ subject: subject.value, message: message.value, emails: to.map((p) => p.email) });
      const bad = (res.failed || []).length + (res.skipped || []).length;
      toast(`Sent to ${res.sent.length} ${res.sent.length === 1 ? 'person' : 'people'}.${bad ? ` ${bad} could not be sent: ${[...(res.failed || []).map((f) => f.email), ...(res.skipped || [])].join(', ')}.` : ''}`, bad ? 'error' : 'ok');
      pick(() => false);
    } catch (e) { toast(e.message, 'error'); }
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  } }, 'Send');

  return h('section.reminders',
    h('h2', 'Send a reminder email'),
    h('p.muted', 'Remind family members to visit and update the tree. Pick who gets it, check the preview, then send. Replies go to your own email address.'),
    h('div.row.rem-quick',
      h('span.muted.small', 'Select:'),
      h('button.btn.small', { type: 'button', onclick: () => pick(() => true) }, 'Everyone'),
      h('button.btn.small', { type: 'button', onclick: () => pick((p) => !p.signedIn) }, 'Not signed in yet'),
      h('button.btn.small', { type: 'button', onclick: () => pick((p) => p.signedIn && !p.claimed) }, 'No box claimed'),
      h('button.btn.small.ghost', { type: 'button', onclick: () => pick(() => false) }, 'None'),
      count),
    rows,
    field('Subject', subject),
    field('Message', message, 'Starts with "Dear <first name>," and ends with a button to open the family tree and your name.'),
    h('div.form-actions', previewBtn, sendBtn),
    previewBox);
}
