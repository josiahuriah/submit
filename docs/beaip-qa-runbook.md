# Click2Clear QA submission runbook

Submit's outbound transport is disabled by default. Preparing, calculating,
generating, and downloading XML never communicates with Customs.

## Before enabling transport

1. Back up production and rehearse the repository migration on a separate Neon
   branch. During a maintenance window, run `npx prisma migrate deploy`,
   `npm run db:rls`, and `npx prisma migrate status` before deploying this app.
2. Confirm every invoice value was converted by the broker and entered in BSD.
3. Calculate the shipment successfully.
4. Download and review every generated CPC XML artifact.
5. Confirm the target is the government QA/UAT service, not production.

The migration deliberately stops if existing invoices contain a non-BSD
currency or an exchange rate other than 1. Those records must be corrected by
the broker; the migration will not relabel them.

Use the corrected migration checked into
`prisma/migrations/20260830160000_beaip_uat_foundation/migration.sql`, not the
earlier download. It runs atomically, permits the migration owner to convert
tenant rows under FORCE RLS, restores FORCE before commit, and invalidates
draft calculations. A failed data guard rolls back the entire migration.
`SHADOW_DATABASE_URL` is not required for deployment.

Production Vercel builds check migration history and the new RLS policies
without modifying the database. An early automatic deployment will stop until
both steps are complete; redeploy after the maintenance window.

## Private environment configuration

Put real values only in the deployment's private environment or `.env.local`:

```dotenv
BEAIP_TRANSPORT_MODE="disabled"
BEAIP_ENVIRONMENT="qa"
BEAIP_DECLARATION_SERVICE_URL=""
BEAIP_DECLARATION_SOAP_ACTION=""
BEAIP_USERNAME=""
BEAIP_PASSWORD=""
BEAIP_SENDER=""
BEAIP_RECEIVER="BESWS"
BEAIP_TIMEZONE="America/Nassau"
BEAIP_TIMEOUT_MS="15000"
BEAIP_MAX_RESPONSE_BYTES="1048576"
BEAIP_ALLOW_INSECURE_QA_HTTP="false"
```

If the government-supplied QA address is plain HTTP, set
`BEAIP_ALLOW_INSECURE_QA_HTTP="true"`. Submit permits this exception only when
`BEAIP_ENVIRONMENT="qa"`; production still requires HTTPS.

Set `BEAIP_TRANSPORT_MODE="live"` only for the controlled test window, then
restart the server so configuration is revalidated.

## Manual QA submission

1. Sign in as Broker, Admin, or Owner.
2. Open the shipment entry page.
3. Select whether the shipment is split by CPC in shipment editing.
4. Generate review XML.
5. Download and inspect each CPC artifact.
6. Click **Submit CPC … to QA** once for each artifact.
7. Record the displayed outcome, HTTP status, and raw response.
8. Check Click2Clear UAT using the artifact's `FunctionalReferenceID`.
9. Disable transport again while results are reviewed.

For a split shipment, CPC `400` and `4098` are separate declarations and
separate POST requests. Do not resubmit an acknowledged group merely because a
different group failed.

## Outcome meanings

| Outcome | Meaning | Next action |
|---|---|---|
| `ACKNOWLEDGED` | A recognizable positive response was received | Verify in UAT |
| `BUSINESS_REJECTED` | Click2Clear reported blocking validation errors | Correct data and generate a new immutable artifact |
| `SOAP_FAULT` | The SOAP service returned a fault | Review fault code/reason and the contract |
| `UNRECOGNIZED_RESPONSE` | Valid response received but its business shape is not yet mapped | Preserve it and use it to complete the response contract |
| `NETWORK_ERROR` | The request could not be completed | Diagnose connectivity before an explicit retry |
| `UNKNOWN` | A timeout occurred after transmission may have begun | Check UAT/reconcile before any retry |

Every repeat submission shows a duplicate warning and requires explicit broker
confirmation. Submit does not automatically retry and does not suggest an
amendment or cancellation workflow.
