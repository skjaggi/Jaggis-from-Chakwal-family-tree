// The AI helper (#/ai), admins only while it is being tested.
//  • Ask the family tree: questions answered from the tree's own records
//    (people, notes and stories, the Library, open questions). No web search.
//  • Find more about this person: a web search about one family member who
//    has passed away, written up as a short summary with source links and a
//    confidence level. It never changes the tree: the admin picks what to use
//    (it then goes in through the usual edit, with its history) or declines it.
// The AI runs in the edge functions ask-tree and research-person, which hold
// the Claude API key. Every call's cost is logged and a daily limit is kept.
import { store, submitChange, functionError } from './data.js';
import { openLibraryForm } from './library.js';
import { personPicker } from './forms.js';
import { fullName, shortName, birthYear } from './model.js';
import { h, clear, toast, modal, field, formatWhen, confirmDialog } from './ui.js';

export const MODEL_CHOICES = [
  ['claude-opus-5-5', 'Claude Opus 5.5', 'Best answers. About 1–4¢ a question and 20–50¢ a web search.'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Very good, about half the cost of Opus.'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5', 'Cheapest (a fraction of a cent a question), simpler answers.'],
];
const modelName = (m) => MODEL_CHOICES.find(([k]) => k === m)?.[1] || m || 'Claude';
const FIELD_LABEL = { birth_date: 'Year of birth', birth_place: 'Birthplace', death_date: 'Year of passing', death_place: 'Place of passing', profession: 'Profession' };
const CONFIDENCE = { high: ['High confidence', 'ok'], medium: ['Medium confidence', 'warn'], low: ['Low confidence', 'low'] };

export const money = (usd) => {
  const n = Number(usd) || 0;
  return n < 1 ? `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}¢` : `$${n.toFixed(2)}`;
};

// ---------------------------------------------------------------- database

async function settings() {
  const { data, error } = await store.sb.from('ai_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data || { daily_cap_usd: 2, model: 'claude-opus-5-5' };
}

// The family's day runs on Arizona time (UTC-7, no daylight saving).
function dayStart() {
  const az = new Date(Date.now() - 7 * 3600e3);
  return new Date(Date.UTC(az.getUTCFullYear(), az.getUTCMonth(), az.getUTCDate(), 7)).toISOString();
}

async function spending() {
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data, error } = await store.sb.from('ai_usage').select('kind,cost_usd,created_at').gte('created_at', since30);
  if (error) throw error;
  const start = dayStart();
  const sum = (rows) => rows.reduce((n, r) => n + Number(r.cost_usd || 0), 0);
  const today = (data || []).filter((r) => r.created_at >= start);
  return { today: sum(today), month: sum(data || []), asks: (data || []).filter((r) => r.kind === 'ask').length, searches: (data || []).filter((r) => r.kind === 'research').length };
}

async function listFindings(personId = null) {
  let q = store.sb.from('ai_findings').select('*').order('created_at', { ascending: false }).limit(100);
  if (personId) q = q.eq('person_id', personId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function getFinding(id) {
  const { data, error } = await store.sb.from('ai_findings').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function setFinding(id, fields) {
  const { error } = await store.sb.from('ai_findings').update(fields).eq('id', id);
  if (error) throw error;
}

async function callFunction(name, body) {
  const { data, error } = await store.sb.functions.invoke(name, { body });
  if (error) {
    const msg = await functionError(error);
    throw new Error(msg === 'not_configured'
      ? 'The AI helper is not switched on yet: the Claude API key (ANTHROPIC_API_KEY) still needs to be saved in Supabase → Edge Functions → Secrets.'
      : msg);
  }
  return data;
}

// ---------------------------------------------------------------- answers

const personHref = (uuid) => `#/tree/${store.fam.defaultRootId}?p=${uuid}`;

// A little Markdown (bold, lists, paragraphs) and person links "[Name](#P12)",
// built as elements so nothing in an answer can run as code.
export function renderAnswer(text, ids = {}) {
  const inline = (s) => {
    const out = [];
    const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(#(P\d+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let last = 0;
    for (const m of s.matchAll(re)) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1]) out.push(h('strong', m[1]));
      else if (m[2]) out.push(ids[m[3]] && store.fam.byId.has(ids[m[3]]) ? h('a.ai-person', { href: personHref(ids[m[3]]), title: 'Show in the tree' }, m[2]) : m[2]);
      else out.push(h('a', { href: m[5], target: '_blank', rel: 'noopener' }, m[4]));
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const blocks = [];
  let list = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) blocks.push((list = h(/^\d/.test(line) ? 'ol' : 'ul')));
      list.append(h('li', inline(item[1])));
      continue;
    }
    list = null;
    if (!line) continue;
    const head = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(head ? h('p', h('strong', inline(head[1]))) : h('p', inline(line)));
  }
  return h('div.ai-answer-text', blocks);
}

// ---------------------------------------------------------------- the page

export async function renderAi(page, query) {
  if (!store.isAdmin) {
    clear(page, h('h1', 'AI helper'), h('p', 'The AI helper is being tested by the admins. It will open to family members later.'));
    return;
  }
  const personFilter = query?.get('person');
  const spendLine = h('p.ai-spend.muted', 'Loading today\'s spending…');
  const settingsBox = h('section.dash-card.ai-settings', h('h2', 'Cost and settings'), h('p.loading', 'Loading…'));
  const findingsBox = h('div.ai-findings', h('p.loading', 'Loading findings…'));

  const refreshSpend = async () => {
    try {
      const [s, sp] = await Promise.all([settings(), spending()]);
      clear(spendLine, `Today: ${money(sp.today)} of the ${money(s.daily_cap_usd)} daily limit · Model: ${modelName(s.model)}`);
      drawSettings(s, sp);
    } catch (e) {
      clear(spendLine, h('span.form-error', `Could not load the AI settings: ${e.message}. The AI tables may not be set up yet.`));
      clear(settingsBox, h('h2', 'Cost and settings'), h('p.form-error', 'Not set up yet.'));
    }
  };

  function drawSettings(s, sp) {
    const cap = h('input', { type: 'number', name: 'cap', min: 0, max: 100, step: 0.5, value: Number(s.daily_cap_usd).toFixed(2) });
    const model = h('div.ai-models', MODEL_CHOICES.map(([k, label, note]) =>
      h('label.check', h('input', { type: 'radio', name: 'model', value: k, checked: s.model === k }), ' ', h('b', label), h('span.muted', ` ${note}`))));
    const form = h('form.ai-settings-form',
      h('div.ai-stats',
        h('div', h('b', money(sp.today)), h('small', 'today')),
        h('div', h('b', money(sp.month)), h('small', 'last 30 days')),
        h('div', h('b', String(sp.asks)), h('small', 'questions (30 days)')),
        h('div', h('b', String(sp.searches)), h('small', 'web searches (30 days)'))),
      field('Daily spending limit (US dollars)', cap, 'The AI stops for the day when this is reached and starts again at midnight Arizona time. Questions cost about 1–4¢ and web searches about 20–50¢ with Opus.'),
      h('fieldset.ai-fs', h('legend', 'Claude model'), model),
      h('div.form-actions.left', h('button.btn.primary', { type: 'submit' }, 'Save settings')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        const { error } = await store.sb.from('ai_settings').update({ daily_cap_usd: Number(f.get('cap')), model: f.get('model') }).eq('id', 1);
        if (error) throw error;
        toast('Saved.', 'ok');
        refreshSpend();
      } catch (err) { toast(err.message, 'error'); }
    });
    clear(settingsBox, h('h2', 'Cost and settings'), form);
  }

  const drawFindings = async () => {
    let rows = [];
    try { rows = await listFindings(personFilter); } catch (e) {
      clear(findingsBox, h('p.form-error', `Could not load findings: ${e.message}`));
      return;
    }
    const waiting = rows.filter((r) => ['pending', 'running'].includes(r.status));
    const done = rows.filter((r) => !['pending', 'running'].includes(r.status));
    const who = personFilter && store.fam.byId.get(personFilter);
    clear(findingsBox,
      who ? h('p', `Showing findings about ${fullName(who)}. `, h('a', { href: '#/ai' }, 'Show everyone')) : null,
      rows.length ? null : h('p.muted', 'No findings yet. Search for someone above, or use "Find more with AI" on the card of a family member who has passed away.'),
      waiting.length ? [h('h3', `Waiting for you (${waiting.length})`), waiting.map((r) => findingCard(r, { onChange: drawFindings }))] : null,
      done.length ? h('details.ai-done', h('summary', `Used, declined or failed (${done.length})`), done.map((r) => findingCard(r, { onChange: drawFindings }))) : null);
    // Keep checking while a search is still running.
    if (rows.some((r) => r.status === 'running')) setTimeout(() => { if (findingsBox.isConnected) drawFindings(); }, 5000);
  };

  const picker = personPicker((p) => openResearch(p, { onDone: drawFindings }), { placeholder: 'Type the name of someone who has passed away' });

  clear(page,
    h('div.ai-page',
      h('h1', 'AI helper ', h('span.tag.warn', 'Pilot: admins only')),
      spendLine,
      h('section.dash-card.ai-ask', h('h2', 'Ask the family tree'), askPanel(refreshSpend)),
      h('section.dash-card.ai-research',
        h('h2', 'Find more about a person (web search)'),
        h('p.muted.small', 'Claude searches newspapers, Partition and school records, books and obituaries, then writes a short summary with links and how sure it is. Only for family members who have passed away: details of living people are never sent out. Nothing is added to the tree until you choose to use it.'),
        picker,
        findingsBox),
      settingsBox));
  refreshSpend();
  drawFindings();
}

// ---------------------------------------------------------------- ask

const CHAT_KEY = 'ai-chat';
const EXAMPLES = [
  'Who were Kesar Mal Jaggi\'s grandchildren?',
  'Who in the family was born in Chakwal?',
  'Which ancestors still have no year of birth?',
  'Tell me the story of the Arya High School plaque.',
];

function askPanel(onSpent) {
  let chat = [];
  try { chat = JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]'); } catch { chat = []; }
  const save = () => { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-20))); } catch { /* storage blocked */ } };
  const log = h('div.ai-chat', { 'aria-live': 'polite' });
  const input = h('textarea', { name: 'q', rows: 2, maxlength: 2000, placeholder: 'Ask anything about the family, e.g. "Who were Hari Singh\'s children?"' });
  const btn = h('button.btn.primary', { type: 'submit' }, 'Ask');
  const reset = h('button.btn.small.ghost', { type: 'button', onclick: () => { chat = []; save(); draw(); input.focus(); } }, 'New conversation');

  const bubble = (t) => t.role === 'user'
    ? h('div.ai-msg.me', h('p', t.content))
    : h('div.ai-msg.ai', t.error ? h('p.form-error', t.content) : renderAnswer(t.content, t.ids),
      t.cost != null ? h('p.ai-cost', `${modelName(t.model)} · cost ${money(t.cost)}${t.truncated ? ' · the answer was cut short' : ''}`) : null);
  function draw() {
    clear(log, chat.length
      ? chat.map(bubble)
      : h('div.ai-examples', h('p.muted.small', 'Try one of these:'),
        EXAMPLES.map((q) => h('button.chip', { type: 'button', onclick: () => { input.value = q; form.requestSubmit(); } }, q))));
    reset.hidden = !chat.length;
    log.scrollTop = log.scrollHeight;
  }

  const form = h('form.ai-ask-form', input, h('div.form-actions.left', btn, reset,
    h('span.muted.small', 'Answers come only from the tree, its notes and stories, the Library and open questions.')));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question || btn.disabled) return;
    const history = chat.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    chat.push({ role: 'user', content: question });
    input.value = '';
    btn.disabled = true;
    draw();
    const thinking = h('div.ai-msg.ai.thinking', h('p', h('span.ai-dots', 'Looking through the family tree')));
    log.append(thinking);
    log.scrollTop = log.scrollHeight;
    try {
      const res = await callFunction('ask-tree', { question, history });
      chat.push({ role: 'assistant', content: res.answer, ids: res.people || {}, cost: res.cost, model: res.model, truncated: res.truncated });
      onSpent?.();
    } catch (err) {
      chat.push({ role: 'assistant', content: err.message, error: true });
    }
    btn.disabled = false;
    save();
    draw();
    input.focus();
  });
  draw();
  return [log, form];
}

// ---------------------------------------------------------------- research

// What will be sent for the search: the same rules as the edge function
// (only people who have passed away; maiden name only when ticked).
function searchProfile(p, includeMaiden) {
  const fam = store.fam;
  const d = fam.details.get(p.id);
  const dead = (q) => q?.is_living === false;
  const married = p.gender !== 'male' && fam.spouses(p.id).length > 0;
  let name = fullName(p);
  if (married && !includeMaiden) name = [p.title, p.given_name, (p.other_names || '').replace(/\([^)]*\)/g, '').trim().split(/\s+/).pop()].filter(Boolean).join(' ');
  const parents = fam.parents(p.id).map((x) => x.person);
  const rel = [
    ...parents.filter(dead).map((q) => `parent ${fullName(q)}`),
    ...parents.flatMap((q) => fam.parents(q.id).map((x) => x.person)).filter(dead).map((q) => `grandparent ${fullName(q)}`),
    ...fam.spouses(p.id).map((x) => x.person).filter(dead).map((q) => `spouse ${fullName(q)}`),
    ...fam.children(p.id).map((x) => x.person).filter(dead).map((q) => `child ${fullName(q)}`),
  ];
  return [
    ['Name', [name, !married || includeMaiden ? p.other_names : null].filter(Boolean).join(' / ')],
    ['Born', [birthYear(d?.birth_date), d?.birth_place].filter(Boolean).join(', ') || 'not recorded'],
    ['Died', [birthYear(d?.death_date), d?.death_place].filter(Boolean).join(', ') || 'not recorded'],
    ['Work', d?.profession || 'not recorded'],
    ['Relatives who have passed away', rel.join('; ') || 'none recorded'],
  ];
}

export function openResearch(p, { onDone } = {}) {
  if (p.is_living !== false) {
    toast(`Web research is only for family members who have passed away. ${shortName(p)} is not marked as passed away.`, 'error');
    return;
  }
  const married = p.gender !== 'male' && store.fam.spouses(p.id).length > 0;
  const maiden = h('input', { type: 'checkbox', name: 'maiden' });
  const hint = h('textarea', { name: 'hint', rows: 2, maxlength: 500, placeholder: 'e.g. He was a timber merchant and may have moved to Delhi in 1947.' });
  const sent = h('dl.ai-sent');
  const drawSent = () => clear(sent, searchProfile(p, maiden.checked).map(([k, v]) => h('div.dl-row', h('dt', k), h('dd', v))));
  maiden.addEventListener('change', drawSent);
  drawSent();
  const body = h('div.ai-run');
  const form = h('form',
    h('p', 'Claude will search the web for records about ', h('strong', fullName(p)), ' and write a short summary with links and how sure it is. It usually takes about a minute and costs about 20–50¢.'),
    h('details.ai-sent-box', { open: true }, h('summary', 'What will be sent for the search'), sent,
      h('p.muted.small', 'Living relatives are never included.')),
    married ? h('label.check', maiden, ' Also search her name before marriage (not shown to visitors)') : null,
    field('Anything that might help (optional)', hint, 'Please don\'t type details of anyone who is living.'),
    h('div.form-actions', h('button.btn.primary', { type: 'submit' }, 'Start the search')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await callFunction('research-person', { person_id: p.id, include_maiden: maiden.checked, hint: hint.value.trim() });
      waitFor(res.id, body, { onDone });
      form.replaceWith(body);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
  clear(body);
  modal(`Find more about ${shortName(p)}`, form, { wide: true });
}

// Shows "searching…" until the finding is ready, then the finding itself.
function waitFor(id, box, { onDone } = {}) {
  const started = Date.now();
  const tick = async () => {
    if (!box.isConnected && Date.now() - started > 2000) { onDone?.(); return; }
    let row = null;
    try { row = await getFinding(id); } catch { /* try again */ }
    if (row && row.status !== 'running') {
      clear(box, findingCard(row, { onChange: onDone }));
      onDone?.();
      return;
    }
    const secs = Math.round((Date.now() - started) / 1000);
    if (secs > 300) {
      clear(box, h('p.form-error', 'The search is taking much longer than usual. Close this and check the AI page later.'));
      return;
    }
    clear(box, h('div.ai-searching', h('span.spinner'), h('div',
      h('p', h('strong', 'Searching the web…'), ` ${secs}s`),
      h('p.muted.small', 'This usually takes about a minute. You can close this: the result will be waiting on the AI page.'))));
    setTimeout(tick, 4000);
  };
  tick();
}

// One finding: summary, confidence, sources, suggested details, and what to do with it.
export function findingCard(row, { onChange } = {}) {
  const p = store.fam.byId.get(row.person_id);
  const r = row.result || {};
  const head = h('div.ai-f-head',
    p ? h('a.ai-person', { href: personHref(p.id) }, fullName(p)) : h('span', 'Someone no longer in the tree'),
    h('span.muted.small', ` · ${formatWhen(row.created_at)}`),
    row.status === 'pending' && r.confidence ? h('span.tag.' + CONFIDENCE[r.confidence][1], CONFIDENCE[r.confidence][0]) : null,
    row.status === 'used' ? h('span.tag.ok', 'Used') : null,
    row.status === 'declined' ? h('span.tag', 'Declined') : null,
    row.status === 'failed' ? h('span.tag.warn', 'Did not finish') : null,
    row.status === 'running' ? h('span.tag', 'Searching…') : null);

  if (row.status === 'running') return h('article.ai-finding', head, h('p.muted', 'Still searching. This page checks again every few seconds.'));
  if (row.status === 'failed') {
    return h('article.ai-finding', head, h('p.form-error', row.error || 'The search did not finish.'),
      h('div.form-actions.left', p ? h('button.btn.small', { type: 'button', onclick: () => openResearch(p, { onDone: onChange }) }, 'Try again') : null,
        h('button.btn.small.ghost', { type: 'button', onclick: async () => { await setFinding(row.id, { status: 'declined' }).catch(() => {}); onChange?.(); } }, 'Dismiss')));
  }

  const d = p ? store.fam.details.get(p.id) : null;
  const ticks = [];
  const tick = (label, value, apply, checked = true, note = null) => {
    const box = h('input', { type: 'checkbox', checked });
    ticks.push({ box, apply, label });
    return h('label.check.ai-tick', box, ' ', h('span', label, value ? [': ', h('strong', value)] : null, note ? h('span.muted.small', ` ${note}`) : null));
  };
  const details = (r.suggested_details || []).map((s) => {
    const now = d?.[s.field];
    const value = ['birth_date', 'death_date'].includes(s.field) ? birthYear(s.value) || s.value : s.value;
    return tick(FIELD_LABEL[s.field] || s.field, value, (ch) => { ch.details[s.field] = value; },
      row.status === 'pending' && r.confidence !== 'low',
      [now ? `(the tree has ${['birth_date', 'death_date'].includes(s.field) ? birthYear(now) || now : now})` : '(not in the tree yet)', s.why].filter(Boolean).join(' '));
  });
  const strong = (r.sources || []).filter((s) => s.match === 'strong');
  const stamp = new Date(row.created_at).toISOString().slice(0, 10);
  const extras = row.status === 'pending' ? [
    r.summary ? tick('Add the summary to Notes / Story', null, (ch) => { ch.notes.push(`From AI research (${stamp}, ${CONFIDENCE[r.confidence]?.[0].toLowerCase() || 'unchecked'}): ${r.summary}`); }, false) : null,
    (r.sources || []).length ? tick('Add the source links to Sources', null, (ch) => { ch.sources.push(...(strong.length ? strong : r.sources).map((s) => `${s.title}: ${s.url}`)); }, strong.length > 0, strong.length ? '(the strong matches)' : '(possible matches only)') : null,
  ] : [];

  const use = async () => {
    if (!p) return;
    const ch = { details: {}, notes: [], sources: [] };
    const chosen = ticks.filter((t) => t.box.checked);
    if (!chosen.length) return toast('Tick what you want to use first.', 'error');
    chosen.forEach((t) => t.apply(ch));
    const join = (old, add) => [old, ...add].filter(Boolean).join('\n\n');
    if (ch.notes.length) ch.details.notes = join(d?.notes, ch.notes);
    if (ch.sources.length) ch.details.sources = join(d?.sources, ch.sources);
    if (Object.keys(ch.details).length) ch.details.visibility = d?.visibility || 'branch';
    const what = chosen.map((t) => t.label.toLowerCase());
    if (!(await confirmDialog(`Add this to ${fullName(p)}'s details? ${chosen.map((t) => t.label).join(', ')}. It is saved like any edit, with "Added and updated by" history.`, 'Use these'))) return;
    try {
      await submitChange('edit_person', { person_id: p.id, person: {}, details: ch.details }, { target: p.id, summary: `Edit ${shortName(p)} from AI research: ${what.join(', ')}` });
      await setFinding(row.id, { status: 'used', review_note: `Used: ${what.join(', ')}` });
      toast('Added to the tree.', 'ok');
      onChange?.();
    } catch (e) { toast(e.message, 'error'); }
  };
  const decline = async () => {
    try { await setFinding(row.id, { status: 'declined' }); toast('Declined. Nothing was added.'); onChange?.(); } catch (e) { toast(e.message, 'error'); }
  };

  return h('article.ai-finding',
    head,
    r.summary ? renderAnswer(r.summary) : null,
    r.confidence_reason ? h('p.muted.small', h('b', 'How sure: '), r.confidence_reason) : null,
    (r.sources || []).length ? h('div.ai-sources', h('h4', 'Sources'), h('ul', r.sources.map((s) => h('li',
      h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title), s.match === 'strong' ? h('span.tag.ok', 'strong match') : h('span.tag', 'possible'),
      s.what_it_says ? h('div.muted.small', s.what_it_says) : null,
      row.status !== 'declined' ? h('button.link.small', { type: 'button', onclick: () => openLibraryForm({ prefill: { url: s.url, title: s.title, person_ids: p ? [p.id] : [], topic: 'Family members', note: s.what_it_says || '' }, onDone: () => toast('Added to the Library.', 'ok') }) }, '+ Add to Library') : null)))) : h('p.muted.small', 'No sources matched this person.'),
    details.length || extras.some(Boolean) ? h('div.ai-use', h('h4', row.status === 'pending' ? 'Choose what to add to the tree' : 'Suggested details'), details, extras) : null,
    (r.other_people || []).length ? h('div.ai-other', h('h4', 'Other people mentioned'), h('ul', r.other_people.map((o) => h('li', o.name, o.relation ? h('span.muted', ` (${o.relation})`) : null,
      o.source_url ? [' ', h('a.small', { href: o.source_url, target: '_blank', rel: 'noopener' }, 'source')] : null)))) : null,
    (r.next_steps || []).length ? h('div.ai-next', h('h4', 'Ideas for what to try next'), h('ul', r.next_steps.map((s) => h('li', s)))) : null,
    h('details.ai-sent-box', h('summary', 'What was sent for the search'),
      h('dl.ai-sent', Object.entries(row.request || {}).map(([k, v]) => h('div.dl-row', h('dt', k.replace(/_/g, ' ')),
        h('dd', Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? `${x.relation} ${x.name}` : x)).join('; ') || 'none' : String(v)))))),
    h('p.ai-cost', `${modelName(r.model)} · ${r.searches ?? 0} searches · cost ${money(row.cost_usd)}${row.review_note ? ` · ${row.review_note}` : ''}`),
    row.status === 'pending' ? h('div.form-actions.left',
      details.length || extras.some(Boolean) ? h('button.btn.primary', { type: 'button', onclick: use }, 'Use the ticked items') : null,
      h('button.btn', { type: 'button', onclick: decline }, 'Decline (add nothing)')) : null);
}

// On a person's card (admins): a button to search, and earlier findings.
export function personAi(p) {
  if (!store.isAdmin || store.preview || store.viewAs) return null;
  const box = h('section.ai-card-box',
    h('h3', 'AI research ', h('span.tag.warn', 'Pilot')),
    p.is_living === false
      ? h('button.btn.small', { type: 'button', onclick: () => openResearch(p, { onDone: load }) }, '🔎 Find more with AI')
      : h('p.muted.small', 'Web research is only for family members who have passed away, to protect the privacy of the living.'),
    h('span.ai-card-found'));
  async function load() {
    try {
      const rows = await listFindings(p.id);
      const pending = rows.filter((r) => r.status === 'pending').length;
      const slot = box.querySelector('.ai-card-found');
      if (slot) clear(slot, rows.length ? h('a.small', { href: `#/ai?person=${p.id}` }, ` ${rows.length} finding${rows.length > 1 ? 's' : ''}${pending ? ` (${pending} waiting)` : ''}`) : null);
    } catch { /* the AI tables are not set up yet */ }
  }
  load();
  return box;
}
