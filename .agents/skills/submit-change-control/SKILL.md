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

## Version control status (RESOLVED 2026-07-29, verified 2026-07-31)

The repo is now under git: initial commit `b72bc45` (2026-07-29), remote
`origin = github.com:josiahuriah/submit.git`, branch `main`. Commits are
made when the owner asks (session 2026-07-31 pushed `462d3c4` on request).

Still-live consequence: `prisma/seed.dev.ts` remains in `.gitignore`, so a
fresh clone LACKS the dev seed (demo tenants that tests and smoke depend on).
Un-ignoring it is an owner decision (Class A). `.gitignore` also covers
`node_modules/`, `.next/`, `.env`, `.env.local`, `src/generated/`,
`*.tsbuildinfo`, `.DS_Store`.

The session review protocol below still applies in full — git gives undo,
not permission to skip the ledger.

## Change classification

| Class | Gate | What falls in it |
|---|---|---|
| **A — owner approval required** | Ask Josiah first; do not proceed on your own judgment | Money-math semantics in `src/lib/calculations/` (derived: filed declarations are legal documents per README's BEAIP section); schema changes incl. the three-place tenant-scoping update (see `submit-schema-and-migrations`); auth/tenancy semantics (`tenant-client.ts`, `with-auth.ts`, `prisma/sql/rls.sql`); new runtime dependencies; BEAIP production activation or wire-format changes; tariff/HS rate data edits (seed rates or the full-dataset drop-in); `git init` / version-control decisions; deleting or resetting any database; env contract changes in `src/lib/env.ts` |
| **B — proceed with evidence** | Do it, but the evidence listed in `submit-validation-and-qa` must pass, and the change is reported at session end | New endpoints following `submit-api-conventions`; new/changed Zod validations; service logic with test coverage; additive seed data; README updates reflecting shipped reality |
| **C — free** | Just do it | Comments, formatting, `.Codex/skills/` content, dev-only scratch files |

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
| 1 | Version control | Resolved 2026-07-29; commits and pushes remain owner-directed |
| 2 | Fresh environment configuration | `.env.example` contains placeholders; every new environment needs a real database URL and a JWT secret of at least 16 characters |
| 3 | Neon credential rotation pending | README security note: the dev connection string was shared in a chat session; rotate before real client data (the current `.env` holds placeholders, so the live credential is not in this repo copy) |
| 4 | Withheld TFP code masters | Regime/office/CPC/UOM/HS wire-format and common-type enumerations remain provisional; formal register in `docs/tfp/field-mapping-matrix.md` |
| 5 | No verified endpoint contract | Hypothetical SOAP/mock infrastructure was removed; do not add transport or credentials before government step-4 docs |
| 6 | Duty-only tariff extraction | Full 1,544 codes exist, but excisable lines require separate verified legal-source rows; calculation now fails safe |
| 7 | Vehicle product characteristics not modeled | TFP supports chassis/engine/make qualifiers; declaration UI does not yet capture them |
| 8 | No CI | Nothing forces the 45-test suite to run |
| 9 | `HSCodeRate.processingFeeExempt` unwired | Schema field consumed nowhere; see `submit-calculations-and-money` |
| 10 | Limited HTTP-layer tests | Fresh-account happy path is covered through XML download; error and branch coverage remains incomplete |
| 11 | Official common types/business rules unavailable | Builder tests use the supplied XSD plus permissive common-types stub; per-artifact validation must not be described as Customs acceptance |

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
| New/changed endpoint | "API surface" — keep the route count in the heading honest (29 as of 2026-08-08) |
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

Verified 2026-08-08 against: git status/remote, `.gitignore` contents,
README (deploy warnings, security note, architecture), `src/lib/env.ts`,
`.env`/`.env.example` (keys only, values not printed), `docs/` emptiness,
`prisma/apply-rls.ts`, sibling-skill findings for debts 4/5/9/10/11.

Re-verify:
- Git/branch status: `git status --short --branch`
- `.env` still placeholder? compare keys/shape to `.env.example` (never print values)
- Debt register: each row lists its source file — grep before trusting
- README route count: `find src/app/api -name route.ts | wc -l` -> 26 files (the handler-export grep returns 35 - several files export multiple methods)
