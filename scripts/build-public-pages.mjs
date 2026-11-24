// Builds plain HTML pages that search engines can read, plus sitemap.xml and
// robots.txt, into site/. Runs in the Pages deploy (see .github/workflows/pages.yml).
//
// Privacy: only people marked deceased get a page. Details appear only when
// their visibility is "public" (exactly what a signed-out visitor sees on the
// site). Living people, and people whose status is unknown, are never named
// on these pages; they are only counted.
//
// Data: read from Supabase with the public (anon) key, or from a JSON file:
//   node scripts/build-public-pages.mjs                     (live database)
//   node scripts/build-public-pages.mjs --from site/data/seed.json
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { buildFamily, fullName, birthYear } from '../site/js/model.js';

const SITE = 'https://familytree.sjaggi.com/';
const OUT = new URL('../site/', import.meta.url);
const TITLE = 'Jaggis of Chakwal';

async function loadLive() {
  const cfg = await readFile(new URL('../site/js/config.js', import.meta.url), 'utf8');
  const url = cfg.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
  const key = cfg.match(/supabaseAnonKey:\s*'([^']+)'/)?.[1];
  if (!url || !key) throw new Error('No Supabase settings in site/js/config.js');
  const get = async ([table, columns]) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const r = await fetch(`${url}/rest/v1/${table}?select=${columns}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
      });
      if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
      const page = await r.json();
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  };
  const [people, details, parentChild, unions] = await Promise.all([
    // Visitors cannot read marriage dates or adoption labels; these pages do not need them.
    ['people', 'id,title,given_name,gender,generation,birth_order,is_living,photo_path,photo_visibility'], ['person_details', '*'],
    ['parent_child', 'id,parent_id,child_id,confidence'], ['unions', 'id,partner_a,partner_b,status,sort_order'],
  ].map(get));
  // Names as visitors see them: married women by their married name, never their maiden name.
  const r = await fetch(`${url}/rest/v1/rpc/public_names`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (r.ok) {
    const names = new Map((await r.json()).map((n) => [n.id, n]));
    for (const p of people) Object.assign(p, { surname: null, other_names: null }, names.get(p.id));
  } else {
    // Database not updated yet (no public_names): names are still fully public there.
    const all = new Map((await get(['people', 'id,surname,other_names'])).map((n) => [n.id, n]));
    for (const p of people) Object.assign(p, all.get(p.id));
  }
  return { people, details, parentChild, unions, photoBase: `${url}/storage/v1/object/public/photos-public/` };
}

async function loadFile(path) {
  const s = JSON.parse(await readFile(path, 'utf8'));
  return { people: s.people, details: s.person_details, parentChild: s.parent_child, unions: s.unions, photoBase: null };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slugify = (s) => s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

const STYLE = `
  :root { --bg:#f6f8f5; --ink:#1d2a22; --muted:#5b6b61; --accent:#17706b; --line:#d9e2db; --card:#fff; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#121815; --ink:#e8efe9; --muted:#a3b2a8; --accent:#5cc0b5; --line:#33423a; --card:#1b231f; } }
  :root[data-theme="dark"] { --bg:#121815; --ink:#e8efe9; --muted:#a3b2a8; --accent:#5cc0b5; --line:#33423a; --card:#1b231f; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; display:block; height:auto; overflow:auto; }
  html { height:auto; }
  .topbar, .toast { font:15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
  main { display:block; flex:none; overflow:visible; max-width:720px; margin:0 auto; padding:24px 16px 48px; }
  a { color:var(--accent); }
  footer.foot { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:24px; padding-top:16px; border-top:1px solid var(--line); }
  footer.foot img { height:36px; width:auto; border-radius:6px; display:block; }
  h1 { margin:8px 0 4px; font-size:1.7rem; }
  .years { color:var(--muted); margin:0 0 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin:16px 0; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:6px 16px; margin:0; }
  dt { color:var(--muted); }
  dd { margin:0; }
  h2 { font-size:1.1rem; margin:20px 0 6px; }
  ul { margin:0; padding-left:20px; }
  main .btn { display:inline-block; background:var(--accent); color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600; }
  img.photo { width:120px; height:120px; object-fit:cover; border-radius:50%; border:3px solid #c49a3a; float:right; margin:0 0 12px 12px; }
  .muted { color:var(--muted); }
  footer { color:var(--muted); font-size:.85rem; margin-top:32px; }
`;

// The same top bar as the family tree, so these pages are never a dead end.
// The HTML holds the visitors' menu (for search engines and browsers without
// JavaScript); js/page-header.js swaps in the full menu, the light/dark
// switch, Sign in / Sign out and the member's chip, exactly as on the tree.
function headerHtml(up) {
  const a = (href, label, extra = '') => `<a href="${up}${href}"${extra}>${label}</a>`;
  return `<header class="topbar">
<div class="brand"><span class="brand-logo" tabindex="0" role="button" aria-label="Show the family logo larger"><img src="${up}img/brand/jaggis-logo3-168.webp" srcset="${up}img/brand/jaggis-logo3-320.webp 2x" width="124" height="88" alt=""><span class="logo-pop" role="img" aria-label="Jaggis of Chakwal logo: Generations today, a brighter tomorrow. Our roots, our strength, our family. Legacy, family, heritage."><img src="${up}img/brand/jaggis-logo3-800.webp" loading="lazy" width="558" height="400" alt=""></span></span><a href="${up}" class="site-title">Jaggis of Chakwal</a></div>
<div class="search-wrap" role="combobox" aria-haspopup="listbox" aria-owns="search-results"><input id="search" type="search" placeholder="Search the family…" autocomplete="off" aria-label="Search for a person" aria-controls="search-results"><ul id="search-results" role="listbox" hidden></ul></div>
<div class="top-right"><nav id="nav" aria-label="Main">${[
    a('#/tree', 'Tree'), a('#/outline', 'List'), a('#/dashboard', 'Dashboard'),
    a('people/', 'Ancestors', ' class="active" aria-current="page" title="Family members who have passed away, one page each"'),
    a('help.html', 'Help'), a('#/export', 'Export', ' title="Download the tree as a PDF or a GEDCOM file"'),
  ].join('')}</nav><div id="who" class="who"></div></div>
</header>`;
}

function page({ title, description, canonical, body, jsonld, depth = 1 }) {
  const up = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script>try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(TITLE)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="stylesheet" href="${up}css/app.css">
<style>${STYLE}</style>
</head>
<body data-page="ancestors">
${headerHtml(up)}
<main>
${body}
<footer>Part of the <a href="${up}">Jaggi family tree of Chakwal</a>, descending from Bakhshi Bhanna Mal Jaggi. Details of living family members are private and are not shown here.</footer>
<footer class="foot"><img src="${up}img/brand/qn-mark-64.webp" srcset="${up}img/brand/qn-mark-64.webp 2x, ${up}img/brand/qn-mark-96.webp 3x" width="52" height="36" alt="Quantum Nexus LLC logo"><span>© 2026 Jaggi Family and Quantum Nexus LLC. All rights reserved.</span></footer>
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script type="module" src="${up}js/page-header.js"></script>
<script type="module">import { countView } from '${up}js/count.js'; countView(location.pathname);</script>
</body>
</html>
`;
}

async function main() {
  const fromIdx = process.argv.indexOf('--from');
  const data = fromIdx > 0 ? await loadFile(process.argv[fromIdx + 1]) : await loadLive();
  // Same rule the site uses for signed-out visitors.
  data.details = data.details.filter((d) => d.visibility === 'public');
  const fam = buildFamily(data);
  const dead = data.people.filter((p) => p.is_living === false);
  const isDead = new Set(dead.map((p) => p.id));
  const slugOf = new Map(dead.map((p) => [p.id, `${slugify(fullName(p, { title: false }))}-${p.id.slice(0, 6)}`]));
  const urlOf = (id) => `${SITE}people/${slugOf.get(id)}.html`;

  const years = (p) => {
    const d = fam.details.get(p.id);
    const b = birthYear(d?.birth_date), x = birthYear(d?.death_date);
    return b || x ? `${b || '?'} – ${x || '?'}` : '';
  };
  // Name and link a relative only if they are deceased; count everyone else.
  const relList = (people, label) => {
    const named = people.filter((q) => isDead.has(q.id));
    const others = people.length - named.length;
    if (!people.length) return '';
    const items = named.map((q) => `<li><a href="${slugOf.get(q.id)}.html">${esc(fullName(q))}</a>${years(q) ? ` <span class="muted">(${esc(years(q))})</span>` : ''}</li>`);
    if (others) items.push(`<li class="muted">${others} living or not yet recorded ${others === 1 ? 'person' : 'people'}, shown only to family on the <a href="../">family tree</a></li>`);
    return `<h2>${label}</h2><ul>${items.join('')}</ul>`;
  };

  await rm(new URL('people/', OUT), { recursive: true, force: true });
  await mkdir(new URL('people/', OUT), { recursive: true });

  for (const p of dead) {
    const d = fam.details.get(p.id);
    const name = fullName(p);
    const y = years(p);
    const parents = fam.parents(p.id).map((x) => x.person);
    const spouses = fam.spouses(p.id).map((x) => x.person);
    const children = fam.children(p.id).map((x) => x.person);
    const rows = [
      ['Born', [birthYear(d?.birth_date), d?.birth_place].filter(Boolean).join(', ')],
      ['Died', [birthYear(d?.death_date), d?.death_place].filter(Boolean).join(', ')],
      ['Work', d?.profession],
      ['Generation', p.generation ? `${p.generation} (from Bakhshi Bhanna Mal Jaggi)` : ''],
      ['Also known as', p.other_names],
    ].filter(([, v]) => v);
    const parentNames = parents.filter((q) => isDead.has(q.id)).map((q) => fullName(q, { title: false }));
    const rel = p.gender === 'female' ? 'daughter' : p.gender === 'male' ? 'son' : 'child';
    const description = `${name}${y ? ` (${y})` : ''}${parentNames.length ? `, ${rel} of ${parentNames.join(' and ')}` : ''}${d?.birth_place ? `, born in ${d.birth_place}` : ''}. Part of the Jaggi family tree of Chakwal.`;
    const photo = p.photo_path && p.photo_visibility === 'public'
      ? (p.photo_path.startsWith('img/') ? `../${p.photo_path}` : data.photoBase ? data.photoBase + p.photo_path : null) : null;
    const jsonld = {
      '@context': 'https://schema.org', '@type': 'Person', name, url: urlOf(p.id),
      familyName: p.surname || undefined, givenName: p.given_name || undefined,
      gender: p.gender === 'male' ? 'Male' : p.gender === 'female' ? 'Female' : undefined,
      birthPlace: d?.birth_place || undefined, deathPlace: d?.death_place || undefined,
      jobTitle: d?.profession || undefined,
      parent: parents.filter((q) => isDead.has(q.id)).map((q) => ({ '@type': 'Person', name: fullName(q), url: urlOf(q.id) })),
      children: children.filter((q) => isDead.has(q.id)).map((q) => ({ '@type': 'Person', name: fullName(q), url: urlOf(q.id) })),
      spouse: spouses.filter((q) => isDead.has(q.id)).map((q) => ({ '@type': 'Person', name: fullName(q), url: urlOf(q.id) })),
    };
    const body = `
<div class="card">
${photo ? `<img class="photo" src="${esc(photo)}" alt="Photo of ${esc(name)}">` : ''}
<h1>${esc(name)}</h1>
<p class="years">${esc(y || 'Deceased')}</p>
${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
${d?.notes ? `<p>${esc(d.notes)}</p>` : ''}
<p style="clear:both;margin-top:16px"><a class="btn" href="../#/tree/${p.id}?p=${p.id}">See ${esc(p.given_name)} in the family tree</a></p>
</div>
${relList(parents, 'Parents')}
${relList(spouses, spouses.length > 1 ? 'Spouses' : 'Spouse')}
${relList(children, `Children (${children.length})`)}
${d?.sources ? `<h2>Sources</h2><p class="muted">${esc(d.sources).replace(/\n/g, '<br>')}</p>` : ''}`;
    await writeFile(new URL(`people/${slugOf.get(p.id)}.html`, OUT),
      page({ title: `${name}${y ? ` (${y})` : ''} | ${TITLE}`, description, canonical: urlOf(p.id), body, jsonld }));
  }

  // An index of every ancestor page, by generation.
  const byGen = new Map();
  for (const p of dead) {
    const g = p.generation || 0;
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(p);
  }
  const gens = [...byGen.keys()].sort((a, b) => (a || 99) - (b || 99));
  const indexBody = `
<h1>Ancestors in the Jaggi family of Chakwal</h1>
<p>The Jaggi family descends from <strong>Bakhshi Bhanna Mal Jaggi</strong> of Chakwal, in the Punjab before Partition. These are the family members who have passed away. To see the whole tree, including living family (for invited relatives), open the <a href="../">interactive family tree</a>.</p>
${gens.map((g) => `<h2>${g ? `Generation ${g}` : 'Generation not recorded'}</h2><ul>${byGen.get(g)
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((p) => `<li><a href="${slugOf.get(p.id)}.html">${esc(fullName(p))}</a>${years(p) ? ` <span class="muted">(${esc(years(p))})</span>` : ''}</li>`).join('')}</ul>`).join('\n')}`;
  await writeFile(new URL('people/index.html', OUT), page({
    title: `Ancestors | ${TITLE}`,
    description: `The ancestors of the Jaggi family of Chakwal, descendants of Bakhshi Bhanna Mal Jaggi: ${dead.length} family members across ${gens.filter(Boolean).length} generations.`,
    canonical: `${SITE}people/`, body: indexBody,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const urls = [SITE, `${SITE}people/`, `${SITE}help.html`, ...dead.map((p) => urlOf(p.id))];
  await writeFile(new URL('sitemap.xml', OUT), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
  await writeFile(new URL('robots.txt', OUT), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
  console.log(`Wrote ${dead.length} ancestor pages, people/index.html, sitemap.xml (${urls.length} URLs), robots.txt`);
}

main().catch((e) => { console.error(e); process.exit(1); });
