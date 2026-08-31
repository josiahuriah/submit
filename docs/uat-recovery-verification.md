# UAT recovery verification — 2026-08-31

## Source and authorization

Recovered the application delta from the owner's **Design Endpoint Submission**
conversation, original commit `dab09155d721d7def8b9707cd0bdc2418ef4e45e`,
based on `d478143a6e9add0b7219549f87683867b1ee2036`.
The exported patch's SHA-256 matched
`447939f2318c51b7bf6d5e0c5e4a872de1586f4049c328e66c766536fa197bb3`.
The owner authorized saving the changes locally and pushing to `main`, then
confirmed exporting the single application delta without credentials or full
repository history. The resulting commit also includes the fixes below.

No production database was accessed or migrated. No request was sent to Customs.
Real environment files and credentials are excluded from version control.

## Corrections made during recovery

- Make the migration atomic and allow the non-superuser table owner to convert
  rows despite FORCE RLS, restoring FORCE before commit. Include referenced
  Organization/User tables; preserve historical XML and invalidate drafts.
- Treat an empty shadow database URL as absent for `migrate deploy`.
- Use the WS-Security PasswordText URI from the supplied SOAP template.
- Preserve processing-fee VAT when splitting declaration totals. Use a stable
  invoice order so calculations and XML select the same first freight item.
- Reject stale draft artifacts and pending attempts; preserve leading zeros
  in government response references.
- Update workflow assertions and local fixture fields to the recovered schema;
  clean submission attempts/batches before deleting demo artifacts.
- Stop Vercel production builds until the exact repository migration checksum
  is recorded and both new tables have enabled, forced tenant policies. This
  check performs SELECTs only; it never applies a migration.

## Evidence

| Check | Result |
|---|---|
| Original patch | Checksum verified; applied cleanly to the original base |
| Regression reproduction | Original SOAP PasswordText URI and missing fee VAT failed new assertions before correction; corrected cases passed |
| `npm test` | 85 tests in 12 files passed against an isolated local PostgreSQL database |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Optimized Next.js build passed with explicit local URLs and transport disabled |
| `npx tsx scripts/smoke.ts` | Passed: calculation, immutable review XML, and shipment stays DRAFT; no endpoint call |
| XML schema validation | The smoke artifact passed `xmllint` with the supplied declaration XSD and repository common-types stub |
| Original migration under owner role | Reproduced FORCE RLS failure with a non-superuser, non-BYPASSRLS table owner |
| Corrected migration under owner role | Non-BSD guard detected tenant rows; failure rolled back renames, values, and FORCE settings; success converted 1 kg to 2.205 lb and 0.5 kg to 1.102 lb, normalized HS/CPC, preserved historical XML, invalidated drafts, and restored isolation |
| New tenant models | Integration test confirms tenant stamping, cross-tenant read isolation, and rejected cross-tenant updates for batches and attempts; owner rehearsal confirms database policies |
| Vercel readiness guard | Passed for the migrated local database; deliberately failed for a database without the required migration-history record |
| Whitespace | `git diff --check` passed |

The temporary PostgreSQL server listened only on `127.0.0.1:56381`. Tests used
explicit local DATABASE_URL/DIRECT_URL, ignored dotenv files, and disabled
Customs transport. The build also overrode sensitive transport configuration.
The ignored local `prisma/seed.dev.ts` was converted to pounds/eight-digit HS
codes for repeatable local work; it is intentionally not added to Git.

## Deployment and remaining limits

Use `prisma/migrations/20260830160000_beaip_uat_foundation/migration.sql`,
not the earlier downloaded file. Back up production and rehearse on a separate
Neon branch, then use a maintenance window for `npx prisma migrate deploy`,
`npm run db:rls`, and `npx prisma migrate status`, followed by redeployment.
The previous application is incompatible with the renamed weight columns.
Do not use `db push`, `migrate dev`, or demo seeds against production.

The Vercel guard deliberately blocks an automatic production deployment while
schema prerequisites are absent. It applies only when VERCEL_ENV is production;
other deployment platforms must follow the runbook themselves.

No government acceptance, actual endpoint connectivity, production migration,
or complete concurrent-broker retry behavior is claimed. The common-types XSD
is permissive and official code masters/business rules remain unverified.
The pg client emits an existing overlapping-query deprecation warning during
workflow tests; all assertions pass. Dev seeds remain gitignored, so a fresh
clone still needs private test fixtures.

## File ledger

Class A changes are covered by the owner's recovery/push authorization;
production migration and Customs activation remain separate operations.
Class B changes have the evidence above. Class C records local provenance only.

| File | Class | Evidence / scope |
|---|---|---|
| `.agents/skills/submit-change-control/SKILL.md` | C | Provenance note; no application behavior change. |
| `.env.example` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `README.md` | B | Checked against the implemented workflow and deployment checks. |
| `docs/beaip-qa-runbook.md` | B | Checked against the implemented workflow and deployment checks. |
| `docs/tfp/generated/declaration-SHP-2026-00001.xml` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `docs/uat-recovery-verification.md` | B | Checked against the implemented workflow and deployment checks. |
| `package.json` | B | Positive/negative local database checks; production build and lint. |
| `prisma.config.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `prisma/migrations/20260830160000_beaip_uat_foundation/migration.sql` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `prisma/schema.prisma` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `prisma/seed.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `prisma/sql/rls.sql` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `prisma/tariff-import.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `scripts/check-production-schema.mjs` | B | Positive/negative local database checks; production build and lint. |
| `scripts/generate-wco-declaration.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `scripts/smoke.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/app/(app)/shipments/[id]/edit/shipment-edit-form.tsx` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/app/(app)/shipments/[id]/entry/add-invoice-card.tsx` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/app/(app)/shipments/[id]/entry/line-entry.tsx` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/app/(app)/shipments/[id]/entry/page.tsx` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/app/(app)/shipments/[id]/entry/review-xml-button.tsx` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/app/(app)/shipments/new/new-shipment-form.tsx` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/app/api/customs-entries/[id]/submit/route.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/beaip/references.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/beaip/tfp-field-mapping.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/beaip/transport/http-gateway.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/beaip/transport/response-parser.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/beaip/transport/soap-envelope.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/beaip/types.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/beaip/wco-xml.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/calculations/apportionment.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/calculations/duty-calculator.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/calculations/money.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/customs/normalization.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/data/declaration-artifacts.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/data/declaration-profile.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/data/line-items.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/data/shipment-actions.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/data/shipments.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/db/tenant-client.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/env.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/errors.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/types.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/lib/units/weight.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/lib/validation/schemas.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/server/repositories/shipments.repository.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/server/services/calculations.service.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/server/services/customs-submission.service.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/server/services/declaration-artifacts.service.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/server/services/declaration-mapper.ts` | A | Authorized recovery; migration, calculation, XML, tenant-isolation, or transport evidence below. |
| `src/server/services/hs-codes.service.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/server/services/invoices.service.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `src/server/services/shipments.service.ts` | B | Typecheck, lint, build, workflow tests, and smoke verification. |
| `tests/beaip-transport.test.ts` | B | 85-test suite and regression cases. |
| `tests/calculations.test.ts` | B | 85-test suite and regression cases. |
| `tests/customs-submission.test.ts` | B | 85-test suite and regression cases. |
| `tests/fresh-account-workflow.test.ts` | B | 85-test suite and regression cases. |
| `tests/shipment-update.test.ts` | B | 85-test suite and regression cases. |
| `tests/tariff-import.test.ts` | B | 85-test suite and regression cases. |
| `tests/tenant-isolation.test.ts` | B | 85-test suite and regression cases. |
| `tests/tfp-field-mapping.test.ts` | B | 85-test suite and regression cases. |
| `tests/wco-xml.test.ts` | B | 85-test suite and regression cases. |
| `tests/weight.test.ts` | B | 85-test suite and regression cases. |
| `tests/workflow-constraints.test.ts` | B | 85-test suite and regression cases. |
| `prisma/seed.dev.ts` (local, gitignored) | B | Converted development fixture only; full tests and smoke passed. |
