-- Reference data is versioned in src/lib/customs/data. No arbitrary port or concession is inferred.
BEGIN;
ALTER TABLE "Manifest" ADD COLUMN "customsPortCode" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "cpcGroupCode" TEXT;
ALTER TABLE "LineItem" DROP CONSTRAINT "LineItem_import_cpc_check";
ALTER TABLE "LineItem" ALTER COLUMN "cpcCode" SET DEFAULT '400000';
ALTER TABLE "LineItem" ALTER COLUMN "unit" SET DEFAULT 'EA';

-- Use the migration owner's existing privileges, under schema locks, just as
-- the preceding migration does. FORCE RLS is restored before commit.
ALTER TABLE "Shipment" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "LineItem" NO FORCE ROW LEVEL SECURITY;
SET LOCAL row_security = off;

UPDATE "Shipment" s SET "cpcGroupCode" = CASE
  WHEN NOT EXISTS (SELECT 1 FROM "Invoice" i JOIN "LineItem" l ON l."invoiceId"=i.id WHERE i."shipmentId"=s.id) THEN '400'
  WHEN (SELECT count(DISTINCT l."cpcCode") FROM "Invoice" i JOIN "LineItem" l ON l."invoiceId"=i.id WHERE i."shipmentId"=s.id)=1
    THEN (SELECT min(l."cpcCode") FROM "Invoice" i JOIN "LineItem" l ON l."invoiceId"=i.id WHERE i."shipmentId"=s.id)
  ELSE NULL END;

-- Preserve finalized line data and all historical XML. Only unambiguous draft
-- aliases are migrated. A bare 4098 needs a broker-selected full concession CPC.
UPDATE "LineItem" l SET
  "cpcCode" = CASE WHEN l."cpcCode"='400' THEN '400000' ELSE l."cpcCode" END,
  "unit" = CASE l."unit" WHEN 'PCS' THEN 'EA' WHEN 'L' THEN 'LTR' WHEN 'KG' THEN 'KGM' ELSE l."unit" END
FROM "Invoice" i JOIN "Shipment" s ON i."shipmentId"=s.id
WHERE l."invoiceId"=i.id AND s.status='DRAFT';
UPDATE "Shipment" SET "calculatedAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP WHERE status='DRAFT';
ALTER TABLE "Shipment" ALTER COLUMN "cpcGroupCode" SET DEFAULT '400';
ALTER TABLE "Shipment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LineItem" FORCE ROW LEVEL SECURITY;
COMMIT;
