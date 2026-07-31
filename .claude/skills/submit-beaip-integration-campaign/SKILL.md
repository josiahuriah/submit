---
name: submit-beaip-integration-campaign
description: >
  Executable, decision-gated campaign to take Submit's BEAIP integration from
  mock mode to verified production filing with the real Bahamas Customs Single
  Window (operated by CrimsonLogic). Load when working on anything in
  src/lib/beaip/, flipping BEAIP_MODE, adjusting buildEnvelope()/parseResponse(),
  onboarding with CrimsonLogic, testing declaration submission or rejection
  paths, reconciling BEAIP-assessed amounts against our calculations, or
  planning "go live with real customs filing".
---

# BEAIP Integration Campaign: Mock → Verified Production Filing

The hardest live problem in this project (named by the owner). This skill is a
campaign runbook: numbered gates, exact commands, expected observations, and
STOP conditions. Work the gates in order. Do not skip.

## When NOT to use this skill

- Building or reviewing ordinary API endpoints → `submit-api-conventions`
- Duty/VAT math questions → `submit-calculations-and-money` (code) or
  `bahamas-customs-reference` (domain theory)
- What needs owner approval → `submit-change-control`
- Env/setup problems → `submit-build-and-env`
- Tenancy/auth → `submit-auth-and-tenancy`

## Campaign status ledger

Update this table as gates pass (editing this file is Class C — free — but a
gate only PASSES with the evidence listed in its section).

| Gate | Item | Status (2026-07-09) |
|---|---|---|
| 0 | WSDL + schema docs obtained from CrimsonLogic | 🟡 2026-07-31: DEC message spec v1.4.4 + `TFB_WCO_DEC_v1.4.4.xsd` + sample XML received. Still withheld until we pass the sample-file gate: `TFB_Common_Types.xsd`, code-master worksheets, endpoint/transport docs. See `docs/tfp-single-window-gap-analysis.md` — it also answers Gate 0 item 7 (C13/C14 are NOT wire fields; the message uses Regime + CPC) and shows DutyTaxFee is left blank on submission (we don't transmit our amounts; reconciliation is against the response). |
| 0 | Sandbox/test environment + credentials obtained | ⬜ |
| 0 | Broker code + onboarding requirements confirmed | ⬜ |
| 0 | Sync/async assessment + duplicate-submission semantics documented | ⬜ |
| 1 | Full test suite green + mock smoke incl. REJECT path | ⬜ |
| 1 | Owner decisions resolved (HS validation, env cross-validation, git, timeout gap) | ⬜ |
| 2 | buildEnvelope()/parseResponse() reconciled against real WSDL | ⬜ |
| 2 | DeclarationType codes + refresh flow confirmed against spec | ⬜ |
| 3 | N consecutive clean sandbox filings (N = owner decision) | ⬜ |
| 3 | Duplicate-submission experiment run; idempotency documented | ⬜ |
| 3 | To-the-cent reconciliation passing; full tariff dataset loaded | ⬜ |
| 4 | Production promotion approved by owner | ⬜ |

## Objective and why it is hard

**Objective:** file real customs declarations through BEAIP with amounts that
match the government's assessment to the cent, with a verbatim audit trail.

**Why hard:** the counterparty is external and undocumented-to-us (README:
"When CrimsonLogic's WSDL documentation arrives, only the namespace/action/
element names in buildEnvelope()/parseResponse() should need adjusting");
filed declarations are legal documents; duplicate filings have real-world
consequences; and the repo is not under version control, so there is no
rollback safety net for a production integration.

**What already exists (verified 2026-07-09):**

| Piece | File | State |
|---|---|---|
| Client interface + payload contract | `src/lib/beaip/types.ts` (`BeaipClient`, `BeaipDeclaration`, `BeaipSubmissionResult`) | Done |
| Factory switched by `BEAIP_MODE` | `src/lib/beaip/index.ts` (`getBeaipClient()`, cached singleton) | Done |
| Mock client (full workflow sim) | `src/lib/beaip/mock-client.ts` | Done, exercised by smoke |
| Production SOAP client skeleton | `src/lib/beaip/production-client.ts` | Written, NEVER exercised |
| Submission orchestration | `src/server/services/declarations.service.ts` (`submit`, `refreshStatus`) | Done in mock mode |
| Routes | `POST /api/shipments/:id/submit` (permission `shipments:submit`), `POST /api/customs-entries/:id/refresh` (`shipments:read`) | Done |
| Payload persistence | `CustomsEntry.requestPayload` / `responsePayload` (Json), rejections included | Done |

Everything about the REAL service — endpoint, WSDL, auth scheme, element
names, status vocabulary, assessment flow — is **unverified-external**. The
production client's `BEAIP_NS` is a placeholder (`urn:bs:gov:customs:beaip:
declaration:v1`, marked as such in the source) and WS-Security UsernameToken
is a convention guess per its header comment.

---

## Gate 0 — External onboarding (NO code)

Obtain from CrimsonLogic / Bahamas Customs, in writing:

1. WSDL + XML schema for declaration submission and status query.
2. Sandbox/test environment URL and credentials.
3. Broker code issuance and any onboarding/certification requirements.
4. The error taxonomy (fault codes, rejection reasons).
5. **Duplicate-submission semantics** — what happens if the same declaration
   arrives twice? Is there an idempotency key? (Drives Gate 3's experiment.)
6. Assessment flow: synchronous accept/reject only, or asynchronous assessment
   requiring polling? (The `refresh` endpoint exists because polling is
   suspected; confirm.)
7. Whether DeclarationType codes C13/C14/C17/C18 (our enum) match the official
   form codes — **unverified-external**.

**STOP condition:** if the WSDL/sandbox cannot be obtained → STOP. Escalate to
the owner. Do NOT proceed by guessing at the wire format; the placeholder
namespace exists precisely so nobody mistakes it for the real one.

**Result when:** a written spec summary exists answering 1–7, checked against
this campaign's assumptions, stored where the owner keeps project notes.

## Gate 1 — Internal readiness (mock-mode proof + owner decisions)

Run from the repo root:

```bash
npm test                    # expect 16 passing (11 calc + 5 isolation; needs seeded DB)
npx tsx scripts/smoke.ts    # e2e in mock mode: calculate → verify → submit → reset
```

**REJECT-path recipe** (mock client rejects any brokerReference containing
"REJECT"): create a shipment whose `shipmentNumber` contains `REJECT` (the
service maps `shipmentNumber` → `brokerReference`), calculate, submit. Expect:
`CustomsEntry.status = REJECTED`, `rejectionReason` set, shipment stays DRAFT,
request/response payloads persisted. If instead the shipment advances to
SUBMITTED → STOP, the rejection path regressed.

**Owner decisions to resolve BEFORE Gate 2 (all Class A, see
`submit-change-control`):**

| # | Decision | Evidence for the recommendation |
|---|---|---|
| 1 | Tighten Zod HS validation to the dotted format the mock enforces (`^\d{4}\.\d{2}(\.\d{2})?$`)? Today Zod checks only length 4–15, so bad codes surface at submission, not entry. | `src/lib/validation/schemas.ts` vs `mock-client.ts` `validate()` |
| 2 | Cross-validate production creds at boot? Today `BEAIP_MODE=production` with empty creds boots fine and throws lazily on first submit (`production-client.ts` `config` getter). | `src/lib/env.ts` has no cross-field rule |
| 3 | `git init` before any production work — no version control means no rollback for integration changes. | no `.git` (verified 2026-07-09) |
| 4 | **Timeout-window double-filing gap:** if the SOAP fetch throws (e.g. 60s `AbortSignal.timeout`), the exception propagates BEFORE `CustomsEntry` is created — no record of the attempt exists, the shipment stays DRAFT, and a retry could double-file a declaration BEAIP actually accepted. Fix direction (owner to approve): create the entry in a PENDING state before the network call, or record attempts separately. | `declarations.service.ts` `submit()` — entry creation happens after `beaip.submitDeclaration()` returns |
| 5 | `refreshStatus` persists the remote payload and audits, but never updates `CustomsEntry.status` from the remote status — status mapping deferred until the real vocabulary is known. Confirm this is intentional and design the mapping at Gate 2. | `declarations.service.ts` `refreshStatus()` updates only `responsePayload` |

**Result when:** suite + smoke + REJECT path pass, and the five decisions have
owner rulings recorded in the ledger.

## Gate 2 — Spec reconciliation (WSDL in hand)

Adjustment points in `src/lib/beaip/production-client.ts`, in order:

1. `BEAIP_NS` constant — replace placeholder with the WSDL's namespace.
2. `SOAPAction` header values for `SubmitDeclaration` / `GetDeclarationStatus`.
3. Element names inside `buildEnvelope()` (`bea:BrokerCode`, `bea:Payload` —
   the real schema will almost certainly name the declaration fields
   individually rather than accept our object shape wholesale).
4. `parseResponse()` picks (`Reference`/`ReferenceNumber`, `EntryNumber`,
   `Status`, `Message`) — replace regex-over-flattened-JSON heuristics with
   paths from the real response schema.
5. WS-Security scheme — confirm UsernameToken or swap per the documentation.
6. Map `BeaipDeclaration` field-by-field against the WSDL's required elements;
   anything the WSDL requires that we don't carry (e.g. exemption references,
   regime codes) becomes a schema/service change → `submit-schema-and-migrations`
   + owner approval.
7. Define the real status vocabulary → design the `refreshStatus` → 
   `CustomsEntryStatus` mapping (decision 5 from Gate 1).

**Result when:** a field-mapping document exists (WSDL element ↔ our field ↔
gap), and the production client compiles against the real names with every
change traceable to a WSDL citation.

## Gate 3 — Sandbox validation

Sandbox-first rule: no production filing until **N consecutive clean sandbox
filings** (N = owner decision; record it in the ledger).

1. **Clean filings:** real sandbox submission → ACCEPTED, reference and entry
   number captured, payloads persisted verbatim.
2. **Forced rejection:** submit an intentionally invalid declaration; verify
   REJECTED handling end-to-end matches the mock-path behavior.
3. **The discriminating experiment — duplicates:** submit the same declaration
   twice in the sandbox BEFORE writing any retry logic. Record what BEAIP does
   (rejects? creates two entries? returns the original reference?). Retry/
   backoff code is FORBIDDEN until this is documented — retry without proven
   idempotency is how double filings happen.
4. **To-the-cent reconciliation:** BEAIP-assessed amounts must equal our
   calculated `totalPayable` (and per-line amounts if returned) exactly. A
   mismatch is a STOP-the-line event. Triage order:
   - Rate data stale/incomplete — the seeded 43-code subset is NOT the full
     tariff; loading the full 1,544-code 2023 schedule
     (`prisma/data/hs-codes.json` drop-in, README "HS code data") is
     effectively a prerequisite for filing real shipments.
   - Rounding rules (ours: 2dp ROUND_HALF_UP per `money.ts`).
   - VAT base composition (ours: CIF + duty + excise + levy).
   - Apportionment differences (ours: largest-remainder).
   - Processing-fee handling (ours: 1% CIF clamped $10–$750 + VAT on fee).

**Result when:** N consecutive clean filings, rejection handled, duplicate
semantics documented, reconciliation exact, full tariff loaded — all evidenced
by persisted payloads.

## Gate 4 — Production promotion (owner sign-off via submit-change-control)

Checklist:

- [ ] Owner approves promotion (Class A).
- [ ] `BEAIP_MODE=production` + all four `BEAIP_*` values set in the deploy
      environment only (never in code — `.env` pattern).
- [ ] Neon DB password rotated (README security note) — precondition for real
      client data.
- [ ] Rollback plan: flipping `BEAIP_MODE=mock` reverts the integration (the
      factory in `index.ts` is the entire cutover — but note it caches the
      client instance per process; a redeploy/restart applies the flip).
- [ ] Monitoring expectation: every submission's `requestPayload`/
      `responsePayload` persisted; spot-audit the first real filings against
      Gate 3 evidence.

## Fenced wrong paths

- Inventing WSDL details or "fixing" the placeholder namespace by guesswork.
- Adding retry/backoff before the Gate 3 duplicate experiment.
- Filing real declarations while the 43-code subset is loaded, or with any
  reconciliation mismatch outstanding.
- Credentials anywhere but environment variables.
- Bypassing the staleness guard (`calculatedAt` checks in
  `declarations.service.ts`) or hand-editing `CustomsEntry.status`.
- Working around `shipments:submit` (BROKER+) — clerks prepare, brokers file.

## Provenance and maintenance

All repo claims verified 2026-07-09 against: `src/lib/beaip/*` (all four
files read in full), `src/server/services/declarations.service.ts`,
`src/app/api/shipments/[id]/submit/route.ts`,
`src/app/api/customs-entries/[id]/refresh/route.ts`, `src/lib/env.ts`,
`scripts/smoke.ts`, README BEAIP section. External/BEAIP-real-service claims
are labeled unverified-external throughout.

Re-verify before trusting:
- Mode selection + caching: `grep -n "BEAIP_MODE" src/lib/env.ts src/lib/beaip/index.ts`
- Placeholder namespace still placeholder: `grep -n "Placeholder namespace" src/lib/beaip/production-client.ts`
- Mock REJECT hook: `grep -n "REJECT" src/lib/beaip/mock-client.ts`
- Staleness guard: `grep -n "calculatedAt" src/server/services/declarations.service.ts`
- Entry-created-after-network-call gap (Gate 1 decision 4): read `submit()` order of operations
- refresh doesn't advance status: `grep -n "responsePayload" src/server/services/declarations.service.ts`
