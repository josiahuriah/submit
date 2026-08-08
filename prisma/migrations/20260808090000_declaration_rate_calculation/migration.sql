-- Extend the tariff domain so customs duty and excise can each carry an
-- explicit basis and assessment unit. ADDITIVE is required for beer's
-- 10% ad-valorem + BSD 10 per imperial gallon rule.
ALTER TYPE "DutyBasis" ADD VALUE IF NOT EXISTS 'ADDITIVE';

CREATE TYPE "ExciseBasis" AS ENUM ('NONE', 'AD_VALOREM', 'SPECIFIC', 'COMPOUND', 'ADDITIVE');
CREATE TYPE "VolumeUnit" AS ENUM ('ML', 'CL', 'L', 'US_FL_OZ', 'IMP_FL_OZ', 'IMP_GAL');
CREATE TYPE "AlcoholStrengthBasis" AS ENUM ('ABV_PERCENT', 'US_PROOF');

ALTER TABLE "Organization"
  ADD COLUMN "companyRegistrationNumber" TEXT;

ALTER TABLE "Client"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "countryCode" TEXT,
  ADD COLUMN "postcode" TEXT;

ALTER TABLE "Supplier"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "postcode" TEXT;

ALTER TABLE "HSCodeRate"
  ADD COLUMN "exciseBasis" "ExciseBasis" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "exciseSpecificRate" DECIMAL(12,4),
  ADD COLUMN "exciseSpecificRateUnit" TEXT,
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "sourcePage" TEXT,
  ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the previous meaning of non-zero exciseRate rows (vehicles, etc.).
UPDATE "HSCodeRate"
SET "exciseBasis" = 'AD_VALOREM'
WHERE "exciseRate" <> 0;

ALTER TABLE "Shipment"
  ADD COLUMN "containerSealNumber" TEXT,
  ADD COLUMN "containerFullnessCode" TEXT,
  ADD COLUMN "declarationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "declarationFunctionCode" TEXT NOT NULL DEFAULT '9',
  ADD COLUMN "regimeCode" TEXT NOT NULL DEFAULT '4',
  ADD COLUMN "goodsLocationCode" TEXT,
  ADD COLUMN "warehouseCode" TEXT,
  ADD COLUMN "transportNationalityCode" TEXT,
  ADD COLUMN "netWeightKg" DECIMAL(12,3);

ALTER TABLE "Invoice"
  ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN "incotermCode" TEXT,
  ADD COLUMN "incotermLocation" TEXT;

ALTER TABLE "LineItem"
  ADD COLUMN "netWeightKg" DECIMAL(12,3),
  ADD COLUMN "packageCount" INTEGER,
  ADD COLUMN "packageTypeCode" TEXT,
  ADD COLUMN "unitsPerPackage" INTEGER,
  ADD COLUMN "unitVolume" DECIMAL(12,4),
  ADD COLUMN "volumeUnit" "VolumeUnit",
  ADD COLUMN "alcoholStrength" DECIMAL(6,3),
  ADD COLUMN "alcoholStrengthBasis" "AlcoholStrengthBasis",
  ADD COLUMN "fobValueBsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "dutyAssessmentQuantity" DECIMAL(18,6),
  ADD COLUMN "exciseBasis" "ExciseBasis" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "exciseSpecificRate" DECIMAL(12,4),
  ADD COLUMN "exciseSpecificRateUnit" TEXT,
  ADD COLUMN "exciseAssessmentQuantity" DECIMAL(18,6);

-- Preserve the previous meaning of frozen non-zero exciseRate rows.
UPDATE "LineItem"
SET "exciseBasis" = 'AD_VALOREM'
WHERE "exciseRate" <> 0;

ALTER TABLE "CustomsEntry"
  ADD COLUMN "functionCode" TEXT NOT NULL DEFAULT '9',
  ADD COLUMN "regimeCode" TEXT,
  ADD COLUMN "schemaVersion" TEXT,
  ADD COLUMN "mappingVersion" TEXT,
  ADD COLUMN "generatedAt" TIMESTAMP(3),
  ADD COLUMN "validationReport" JSONB;
