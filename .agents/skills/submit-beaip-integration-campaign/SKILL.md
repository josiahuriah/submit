---
name: submit-beaip-integration-campaign
description: >-
  Decision-gated campaign to take Submit from TFP v1.4.4 review XML to verified
  filing with the Bahamas Customs Single Window / Click2Clear. Use for Customs
  onboarding, XML review, official common types/code masters, endpoint/auth
  design, UAT submissions, response reconciliation, or production go-live.
---

# Single Window integration campaign

Updated 2026-08-08. Work the gates in order. Never infer endpoint transport,
authentication, envelope, code-list values, acknowledgement semantics, status
mapping, or retry behavior from the XSD alone.

## Current boundary

Submit currently supports:

- tenant-scoped shipment → declaration mapping;
- a formal executable TFP field register and mandatory-field preflight;
- TFB_WCO_DEC v1.4.4 XML in XSD sequence order;
- structural XSD contract tests using the supplied schema plus a clearly
  labeled permissive common-types stub;
- versioned, auditable XML artifacts with authenticated download;
- predicted duty/tax calculation for broker review and later reconciliation.

Submit intentionally does **not** have a mock or production endpoint client,
submission or remote-status routes, endpoint credentials, SOAP assumptions, or a switch that
can advance a shipment to SUBMITTED. An earlier hypothetical SOAP/mock design
was removed because the government has not released step-4 transport docs.

## Gate ledger

| Gate | Evidence | Status |
|---|---|---|
| 0 — supplied artifacts understood | DEC spec, declaration XSD, sample instance analyzed | complete |
| 1 — stakeholder XML | mapper, preflight, formal matrix, downloadable exact XML, XSD contract test | complete 2026-08-08 |
| 2 — Customs file review | integration team validates a generated stakeholder file and returns findings/common types/code masters | pending external |
| 3 — endpoint contract | written endpoint, auth, envelope, acknowledgements, statuses, idempotency and timeout semantics | pending external |
| 4 — sandbox/UAT adapter | owner-approved adapter, attempt-first audit, response parser, test cases, reconciliation | pending |
| 5 — production | UAT certification, production test and explicit owner go-live approval | pending |

## Gate 1: review XML

Canonical artifacts:

- `docs/tfp/field-mapping-matrix.md`
- `src/lib/beaip/tfp-field-mapping.ts`
- `src/lib/beaip/wco-xml.ts`
- `src/server/services/declaration-mapper.ts`
- `src/server/services/declaration-artifacts.service.ts`
- `POST /api/shipments/:id/artifacts`
- `GET /api/customs-entries/:id/xml`

Required evidence:

```bash
npm run typecheck
npx vitest run tests/tfp-field-mapping.test.ts tests/wco-xml.test.ts
npm run wco:generate
```

The final command needs a calculated shipment and `xmllint`. A green result
proves structure against the supplied declaration XSD and stub; it does not
prove withheld common-type restrictions or Click2Clear business rules.

Before sending a file, confirm the brokerage's Company Registration Number.
It maps to mandatory `Declaration/Submitter/ID` and is deliberately distinct
from organization TIN and individual broker licence. Also label every warning
for provisional regime, office, transport, package, CPC and HS wire codes.

## Gate 2: Customs file review

Obtain in writing:

1. pass/fail output for the exact generated XML;
2. official `TFB_Common_Types.xsd`;
3. Regime, Port/Office, CPC, Transport Mode, Cargo Status, UOM, Package UOM,
   Currency, Warehouse, Document, Container and dynamic-field code masters;
4. confirmation of dotted versus undotted national HS representation;
5. conditional rules for amendments/cancellations, documents, exemptions,
   alcohol additional information and vehicle product characteristics.

Replace the permissive stub, update the formal matrix and add a regression for
every Customs finding. Do not weaken preflight merely to make a sample pass.

## Gate 3: endpoint contract

Do no endpoint coding until Customs documents:

- HTTP/SFTP/message-bus/SOAP/other transport and exact URL;
- TLS/client-certificate, token, signature or other authentication;
- whether the declaration is the request root or wrapped in another envelope;
- synchronous and asynchronous acknowledgements;
- business rejection/status vocabulary and correlation identifiers;
- duplicate detection/idempotency behavior;
- timeout/retry rules and whether a timed-out request may still be accepted;
- status-query/callback mechanism;
- sandbox credentials and broker registration identifiers.

These decisions are Class A. Record them in the matrix/README before code.

## Gate 4: adapter design and UAT

The future adapter must:

1. create a durable PENDING attempt containing the exact accepted XML and a
   stable correlation/idempotency key **before** any network call;
2. never silently retry a declaration after an ambiguous timeout;
3. persist verbatim request/envelope, raw response and parsed outcome;
4. map remote statuses through an explicit table, never string guessing;
5. keep the existing mapper/builder as the single XML source;
6. require `shipments:submit` (BROKER+) and explicit production fencing;
7. reconcile Customs-assessed amounts against frozen predicted line amounts,
   including fee VAT and rate units;
8. test success, schema failure, business rejection, auth failure, timeout,
   duplicate, status/callback and parser-tolerance cases.

Use Customs-provided UAT cases. Save every input file, acknowledgement,
assessment and reconciliation result as certification evidence.

## Gate 5: production

STOP unless all are true:

- Customs/UAT certification is written and all cases are archived;
- official production endpoint/auth details are separately configured;
- the owner explicitly approves activation;
- rollback means disabling new filing attempts, not switching to a mock;
- monitoring, alerting and an on-call/manual-recovery path exist;
- first production submissions are supervised and reconciled.

## Provenance

Derived from the supplied TFP GOV CBR DEC Message Specification v1.4.4,
TFB_WCO_DEC_v1.4.4.xsd, the government's stated ten-step onboarding sequence,
the formal mapping matrix, and the implemented artifact/calculation services.
Re-verify this skill whenever Customs releases a new artifact or endpoint rule.
