---
name: submit-change-control
description: >
  How changes are classified, gated, and reviewed in the Submit codebase, and
  how the docs of record are maintained. Load when asking "is it safe to
  change X", "do I need owner approval", "can I add a dependency", anything
  involving git/version control/committing, database resets, editing tariff
  or HS rate data, activating production BEAIP, or ending a session (review
  protocol). Also owns README/doc house style.
---

# Change Control for Submit

Solo-owner project (Josiah) worked on by AI sessions. There are no unwritten
house rules beyond what the repo states (owner-confirmed); this skill codifies
what the repo's own artifacts imply. Every rule is labeled **(stated in
<file>)** or **(derived)** — derived rules are authorial inference from code
and structure, not owner law.

## When NOT to use this skill

- HOW to produce evidence (tests, smoke, verification commands) →
  `submit-validation-and-qa`
- Schema-change mechanics (three-place tenant update) →
  `submit-schema-and-migrations`
- BEAIP go-live gating → `submit-beaip-integration-campaign`
- Everything else: `submit-architecture-contract`, `bahamas-customs-reference`,
  `submit-build-and-env`, `submit-calculations-and-money`,
  `submit-auth-and-tenancy`, `submit-api-conventions`

## The dominant governance fact: NO VERSION CONTROL

Verified 2026-07-09: there is no `.git` directory. Consequences:

- No history, no diff-based review, no bisect, no revert. Every edit is
  immediately live and irreversible.
- The skills library itself (`.claude/skills/`) is unversioned.
- A `.gitignore` already exists and covers `node_modules/`, `.next/`, `.env`,
  `.env.local`, `src/generated/`, `prisma/seed.dev.ts`, `*.tsbuildinfo`.

**Recommended remedy (owner decision, Class A):** `git init` + initial commit.
One flag for that decision: `prisma/seed.dev.ts` is in `.gitignore`, so a
plain commit-and-clone would LOSE the dev seed (it contains the demo tenants
the tests and smoke depend on). The owner must decide whether to un-ignore it
or accept that fresh clones need it recreated.

**Until git exists, every session must:** avoid mass deletes/rewrites, prefer
additive edits, and end with a summary of every file touched (see Session
review protocol).

## Change classification

| Class | Gate | What falls in it |
|---|---|---|
| **A — owner approval required** | Ask Josiah first; do not proceed on your own judgment | Money-math semantics in `src/lib/calculations/` (derived: filed declarations are legal documents per README's BEAIP section); schema changes incl. the three-place tenant-scoping update (see `submit-schema-and-migrations`); auth/tenancy semantics (`tenant-client.ts`, `with-auth.ts`, `prisma/sql/rls.sql`); new runtime dependencies; BEAIP production activation or wire-format changes; tariff/HS rate data edits (seed rates or the full-dataset drop-in); `git init` / version-control decisions; deleting or resetting any database; env contract changes in `src/lib/env.ts` |
| **B — proceed with evidence** | Do it, but the evidence listed in `submit-validation-and-qa` must pass, and the change is reported at session end | New endpoints following `submit-api-conventions`; new/changed Zod validations; service logic with test coverage; additive seed data; README updates reflecting shipped reality |
| **C — free** | Just do it | Comments, formatting, `.claude/skills/` content, dev-only scratch files |

When in doubt between classes, treat it as the higher class.

## Non-negotiables

| Rule | Source |
|---|---|
| Never commit or print secrets; `.env` stays out of any future VCS | (stated in `.gitignore`; README env section) |
| Never run `db:seed:dev` or destructive db commands against production | (stated in README "Deploying to Neon + Vercel": "Do **not** run `db:seed:dev` against production") |
| After ANY database reset/recreate, rerun `npm run db:rls` — RLS policies and pg_trgm indexes live outside Prisma migrations and silently vanish otherwise | (derived from `prisma/apply-rls.ts` being out-of-band; mechanics in `submit-schema-and-migrations`) |
| decimal.js only for money — floats never touch money | (stated in README architecture section) |
| Rate freezing is never bypassed; historical shipment amounts are never recomputed | (derived from schema "Rates as applied" fields + `calculations.service.ts`) |
| `organizationId` never comes from request input — only from verified JWT claims via `withAuth` | (derived from `with-auth.ts` design; see `submit-auth-and-tenancy`) |
| No real BEAIP filing outside the campaign's gates | (derived; see `submit-beaip-integration-campaign`) |

## Known debt register (2026-07-09, resolution owner: Josiah)

| # | Debt | Detail / pointer |
|---|---|---|
| 1 | No version control | Section above; blocks safe production-integration work |
| 2 | `.env` is a placeholder copy of `.env.example` | `JWT_SECRET="change-me"` fails env.ts's 16-char minimum → app cannot boot until real values are set (verified without printing secrets) |
| 3 | Neon credential rotation pending | README security note: the dev connection string was shared in a chat session; rotate before real client data (the current `.env` holds placeholders, so the live credential is not in this repo copy) |
| 4 | HS-format validation asymmetry | Zod checks length 4–15 only; mock BEAIP enforces `^\d{4}\.\d{2}(\.\d{2})?$` — bad codes surface at submission, not entry. Detail: `submit-api-conventions` |
| 5 | Production BEAIP creds not cross-validated at boot | `BEAIP_MODE=production` with empty creds boots, throws lazily on first use (`production-client.ts` config getter) |
| 6 | 43-code HS subset insufficient for real filings | Full 1,544-code dataset drop-in path documented in README "HS code data" |
| 7 | `docs/` directory exists but is empty | Purpose unknown; README is the only doc of record |
| 8 | No CI | Nothing forces the 16-test suite to run |
| 9 | `HSCodeRate.processingFeeExempt` unwired | Schema field consumed nowhere; see `submit-calculations-and-money` |
| 10 | No HTTP-layer tests | Route handlers untested end-to-end; see `submit-validation-and-qa` gaps |
| 11 | Submit timeout window can lose the attempt record | `CustomsEntry` created only after the BEAIP call returns; a thrown timeout leaves no record and the shipment DRAFT → double-filing risk on retry. Detail: `submit-beaip-integration-campaign` Gate 1 decision 4 |

Do not "fix" debt items unilaterally — each carries an owner decision.

## Session review protocol (AI sessions)

At the end of every working session:

1. List every file touched, each tagged Class A/B/C.
2. List the evidence produced (test runs, script outputs, verification
   commands) for every Class B change.
3. Flag anything that turned out to be Class A mid-work — stop-and-ask beats
   ask-forgiveness in a repo with no undo.
4. Never mark uncertain work as done; say what remains unverified.
5. If you re-verified a dated fact in any skill, update that skill's
   Provenance date (Class C).

## Docs and writing (house rules)

**README.md is the doc of record.** Update triggers:

| Change | README section to update |
|---|---|
| New/changed endpoint | "API surface (26 routes)" — keep the route count in the heading honest |
| Env var added/changed | Environment variables table (and `.env.example`) |
| New script or verification step | Quick start / "Verifying everything" |
| Deploy-relevant change | "Deploying to Neon + Vercel" |

**House style, mined from the code:** file-top docstring comments explain WHY
and design intent, not just what (see `env.ts`, `rbac.ts`, `errors.ts`,
`mock-client.ts` headers — imitate them); README stays terse: tables, code
blocks, no filler. New services/modules without a WHY-header are
style-incomplete.

**Skills library maintenance:** one home per fact, siblings point rather than
restate; every skill ends with a Provenance section; re-verify dated facts
before trusting them; skill edits are Class C.

## Provenance and maintenance

Verified 2026-07-09 against: absence of `.git` (ls -a), `.gitignore` contents,
README (deploy warnings, security note, architecture), `src/lib/env.ts`,
`.env`/`.env.example` (keys only, values not printed), `docs/` emptiness,
`prisma/apply-rls.ts`, sibling-skill findings for debts 4/5/9/10/11.

Re-verify:
- Still no git? `ls -a /path/to/repo | grep -c "^\.git$"` → 0
- `.env` still placeholder? compare keys/shape to `.env.example` (never print values)
- Debt register: each row lists its source file — grep before trusting
- README route count: `find src/app/api -name route.ts | wc -l` -> 26 files (the handler-export grep returns 35 - several files export multiple methods)
