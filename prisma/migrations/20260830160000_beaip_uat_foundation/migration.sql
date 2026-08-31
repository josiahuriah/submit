-- Canonical Click2Clear data and auditable QA submission foundation.

BEGIN;

-- FORCE RLS would hide tenant rows even from Neon's table owner. Permit the
-- migration owner to see affected tables and FK targets while holding schema
-- locks in this transaction; other roles keep their normal RLS policies.
-- Restore FORCE before commit. Any failed guard rolls everything back.
ALTER TABLE "Shipment" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "LineItem" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "CustomsEntry" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Organization" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "User" NO FORCE ROW LEVEL SECURITY;
SET LOCAL row_security = off;

ALTER TABLE "Shipment" ADD COLUMN "isSplitDeclaration" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Shipment" RENAME COLUMN "grossWeightKg" TO "grossWeightLb";
ALTER TABLE "Shipment" RENAME COLUMN "netWeightKg" TO "netWeightLb";
ALTER TABLE "LineItem" RENAME COLUMN "weightKg" TO "weightLb";
ALTER TABLE "LineItem" RENAME COLUMN "netWeightKg" TO "netWeightLb";

-- These columns contained kilograms before the rename. Convert the values,
-- rather than silently interpreting kilograms as pounds.
UPDATE "Shipment" SET
  "grossWeightLb" = ROUND("grossWeightLb" / 0.45359237, 3),
  "netWeightLb" = ROUND("netWeightLb" / 0.45359237, 3);
UPDATE "LineItem" SET
  "weightLb" = ROUND("weightLb" / 0.45359237, 3),
  "netWeightLb" = ROUND("netWeightLb" / 0.45359237, 3);

-- The first-item freight allocation changed. Require an explicit new
-- calculation for drafts; retain historical submitted amounts and XML.
UPDATE "Shipment" SET "calculatedAt" = NULL WHERE "status" = 'DRAFT';

-- Do not relabel historical foreign-currency values as BSD. An operator must
-- convert those invoices before applying this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Invoice" WHERE "currency" <> 'BSD' OR "exchangeRate" <> 1) THEN
    RAISE EXCEPTION 'Non-BSD invoices must be converted by the broker before this migration can continue';
  END IF;
END $$;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_currency_bsd_check" CHECK ("currency" = 'BSD');
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_exchange_rate_one_check" CHECK ("exchangeRate" = 1);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "HSCode"
    GROUP BY regexp_replace("code", '[^0-9]', '', 'g')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HS code normalization has collisions; consolidate the duplicate reference rows first';
  END IF;
END $$;
UPDATE "HSCode" SET "code" = regexp_replace("code", '[^0-9]', '', 'g');
UPDATE "LineItem" SET "hsCode" = regexp_replace("hsCode", '[^0-9]', '', 'g');
ALTER TABLE "HSCode" ADD CONSTRAINT "HSCode_eight_digit_check" CHECK ("code" ~ '^[0-9]{8}$');
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_eight_digit_hs_check" CHECK ("hsCode" ~ '^[0-9]{8}$');

UPDATE "LineItem" SET "cpcCode" = '400' WHERE "cpcCode" = '4000';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "LineItem" WHERE "cpcCode" NOT IN ('400', '4098')) THEN
    RAISE EXCEPTION 'Line items contain CPC values other than 400 or 4098; review them before migrating';
  END IF;
END $$;
ALTER TABLE "LineItem" ALTER COLUMN "cpcCode" SET DEFAULT '400';
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_import_cpc_check" CHECK ("cpcCode" IN ('400', '4098'));

CREATE TYPE "SubmissionAttemptOutcome" AS ENUM (
  'PENDING', 'ACKNOWLEDGED', 'BUSINESS_REJECTED', 'SOAP_FAULT',
  'NETWORK_ERROR', 'UNKNOWN', 'UNRECOGNIZED_RESPONSE'
);

CREATE TABLE "CustomsSubmissionBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "declarationCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomsSubmissionBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomsEntry"
  ADD COLUMN "submissionBatchId" TEXT,
  ADD COLUMN "declarationGroupCode" TEXT NOT NULL DEFAULT '400',
  ADD COLUMN "declarationSequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "functionalReferenceId" TEXT,
  ADD COLUMN "brokerReference" TEXT,
  ADD COLUMN "declarationHash" TEXT;

UPDATE "CustomsEntry" SET
  "functionalReferenceId" = COALESCE("entryNumber", 'LEGACY-' || "id"),
  "brokerReference" = COALESCE("entryNumber", 'LEGACY-' || "id"),
  "declarationHash" = 'legacy-unavailable-' || "id";

ALTER TABLE "CustomsEntry"
  ALTER COLUMN "functionalReferenceId" SET NOT NULL,
  ALTER COLUMN "brokerReference" SET NOT NULL,
  ALTER COLUMN "declarationHash" SET NOT NULL,
  ALTER COLUMN "declarationGroupCode" DROP DEFAULT,
  ALTER COLUMN "declarationSequence" DROP DEFAULT;

ALTER TABLE "CustomsEntry" ALTER COLUMN "requestPayload" TYPE TEXT USING
  CASE WHEN jsonb_typeof("requestPayload") = 'string' THEN "requestPayload" #>> '{}' ELSE "requestPayload"::text END;
ALTER TABLE "CustomsEntry" ALTER COLUMN "responsePayload" TYPE TEXT USING
  CASE WHEN jsonb_typeof("responsePayload") = 'string' THEN "responsePayload" #>> '{}' ELSE "responsePayload"::text END;

CREATE TABLE "CustomsSubmissionAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customsEntryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "messageId" TEXT NOT NULL,
  "outcome" "SubmissionAttemptOutcome" NOT NULL DEFAULT 'PENDING',
  "declarationHash" TEXT NOT NULL,
  "redactedSoapEnvelope" TEXT,
  "responsePayload" TEXT,
  "httpStatus" INTEGER,
  "soapFaultCode" TEXT,
  "soapFaultReason" TEXT,
  "beaipReference" TEXT,
  "businessErrors" JSONB,
  "resubmissionReason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CustomsSubmissionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomsSubmissionBatch_organizationId_shipmentId_createdAt_idx"
  ON "CustomsSubmissionBatch"("organizationId", "shipmentId", "createdAt" DESC);
CREATE UNIQUE INDEX "CustomsEntry_organizationId_functionalReferenceId_key"
  ON "CustomsEntry"("organizationId", "functionalReferenceId");
CREATE UNIQUE INDEX "CustomsEntry_submissionBatchId_declarationSequence_key"
  ON "CustomsEntry"("submissionBatchId", "declarationSequence");
CREATE UNIQUE INDEX "CustomsSubmissionAttempt_organizationId_messageId_key"
  ON "CustomsSubmissionAttempt"("organizationId", "messageId");
CREATE UNIQUE INDEX "CustomsSubmissionAttempt_customsEntryId_attemptNumber_key"
  ON "CustomsSubmissionAttempt"("customsEntryId", "attemptNumber");
CREATE INDEX "CustomsSubmissionAttempt_organizationId_customsEntryId_startedAt_idx"
  ON "CustomsSubmissionAttempt"("organizationId", "customsEntryId", "startedAt" DESC);

ALTER TABLE "CustomsSubmissionBatch" ADD CONSTRAINT "CustomsSubmissionBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsSubmissionBatch" ADD CONSTRAINT "CustomsSubmissionBatch_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsSubmissionBatch" ADD CONSTRAINT "CustomsSubmissionBatch_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsEntry" ADD CONSTRAINT "CustomsEntry_submissionBatchId_fkey"
  FOREIGN KEY ("submissionBatchId") REFERENCES "CustomsSubmissionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomsSubmissionAttempt" ADD CONSTRAINT "CustomsSubmissionAttempt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsSubmissionAttempt" ADD CONSTRAINT "CustomsSubmissionAttempt_customsEntryId_fkey"
  FOREIGN KEY ("customsEntryId") REFERENCES "CustomsEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Shipment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LineItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CustomsEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

COMMIT;
