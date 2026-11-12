# Jaggis of Chakwal: family tree

A family tree website for the descendants of **Bakhshi Bhanna Mal Jaggi** of pre-Partition Chakwal, Punjab.

- Anyone with the link can browse the tree, top-down, starting from any person, and search by name (spelling variants like *Parkash / Prakash* still match).
- Invited family members sign in with their email (no passwords) and can add people, edit details, link relatives, and upload one profile photo per person.
- Every change waits for the admin's approval before it appears.
- Details and photos of living people are visible only to their own branch unless the person adding them chooses *Public*.
- Works on phones. The tree can be exported as a GEDCOM file for other genealogy programs.

**Setup:** see [docs/SETUP.md](docs/SETUP.md). Until Supabase is connected the site runs in a read-only preview of the starting data.

## How it's built

| Part | What | Where |
|---|---|---|
| Website | Plain HTML, CSS and JavaScript modules, no build step. Tree drawing with [d3](https://d3js.org). | `site/` |
| Hosting | GitHub Pages, deployed by `.github/workflows/pages.yml` | |
| Database, logins, photos | [Supabase](https://supabase.com) free tier: Postgres with row level security, email sign-in, storage buckets | `supabase/schema.sql` |
| Starting data | The two family tree PDFs, transcribed | `data/family.source.json` → `scripts/build-seed.mjs` → `supabase/seed.sql`, `site/data/seed.json` |

### Data model

- `people`: name, title (e.g. *Bakhshi*), other names, gender, generation, living or not, photo.
- `person_details`: birth/death dates and places (free text, so *c. 1890* works), profession, notes, sources, what's uncertain, and visibility (*public* or *branch*).
- `parent_child`: biological, adoptive, step or foster; *confirmed* or *uncertain* (for example Ram Lal and Agya Lal, whose father was Gokal Chand **or** Chunni Lal).
- `unions`: any number of marriages per person, with status (married, divorced, widowed, separated).
- `change_requests`: every add, edit, photo or removal, with who asked, and the admin's decision.
- `invites` and `profiles`: who may sign in, their role, and who they are in the tree.

Members never write to the tree tables directly. They file a change request; `approve_change_request()` applies it, and only the admin can call it.

### Tests

```sh
# Database: schema, privacy rules, approval flow (needs a local Postgres 16)
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh

# Browser: preview mode, plus member and admin screens against a fake backend (needs Playwright)
tests/browser/run.sh
```

Both run on every pull request (`.github/workflows/tests.yml`).

## Planned for version 2

Branch admins (approvals delegated from generation 4 down), linking documents such as certificates and letters, GEDCOM import, and letting other families start their own trees.
