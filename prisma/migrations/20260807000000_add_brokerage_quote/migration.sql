-- CreateEnum
CREATE TYPE "BrokerageDocumentKind" AS ENUM ('INVOICE', 'QUOTE');

-- AlterTable
ALTER TABLE "BrokerageInvoice" ADD COLUMN     "kind" "BrokerageDocumentKind" NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "validUntil" TIMESTAMP(3),
ADD COLUMN     "convertedFromId" TEXT;

-- Replace the status list index with one that also leads on kind, so quote
-- and invoice list screens can filter cheaply.
DROP INDEX "BrokerageInvoice_organizationId_status_issueDate_idx";
CREATE INDEX "BrokerageInvoice_organizationId_kind_status_issueDate_idx" ON "BrokerageInvoice"("organizationId", "kind", "status", "issueDate" DESC);

-- A quote converts into at most one invoice (1:1 back-reference).
CREATE UNIQUE INDEX "BrokerageInvoice_convertedFromId_key" ON "BrokerageInvoice"("convertedFromId");
ALTER TABLE "BrokerageInvoice" ADD CONSTRAINT "BrokerageInvoice_convertedFromId_fkey" FOREIGN KEY ("convertedFromId") REFERENCES "BrokerageInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
