-- Submit v2.1.0 — initial migration
-- Matches prisma/schema.prisma. On a fresh database you can either run
-- `prisma migrate deploy` (uses this file) or `prisma db push` (derives the
-- same DDL from the schema).

-- Enums ----------------------------------------------------------------------
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'BROKER', 'CLERK', 'VIEWER');
CREATE TYPE "TransportMode" AS ENUM ('SEA', 'AIR', 'LAND');
CREATE TYPE "DutyBasis" AS ENUM ('AD_VALOREM', 'SPECIFIC', 'COMPOUND');
CREATE TYPE "ClientType" AS ENUM ('INDIVIDUAL', 'BUSINESS');
CREATE TYPE "ManifestStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CLEARED', 'CANCELLED');
CREATE TYPE "GoodsType" AS ENUM ('GENERAL', 'PERSONAL_EFFECTS', 'COMMERCIAL', 'VEHICLE', 'HAZARDOUS', 'PERISHABLE');
CREATE TYPE "PackageType" AS ENUM ('CONTAINER', 'PALLET', 'CARTON', 'CRATE', 'DRUM', 'BUNDLE', 'LOOSE', 'VEHICLE', 'OTHER');
CREATE TYPE "DocumentType" AS ENUM ('COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'AIRWAY_BILL', 'PACKING_LIST', 'PERMIT', 'CERTIFICATE_OF_ORIGIN', 'RECEIPT', 'OTHER');
CREATE TYPE "ExemptionType" AS ENUM ('NONE', 'FULL', 'PARTIAL', 'CONDITIONAL');
CREATE TYPE "CustomsEntryStatus" AS ENUM ('DRAFT', 'VALIDATED', 'SUBMITTED', 'UNDER_ASSESSMENT', 'ASSESSED', 'PAID', 'RELEASED', 'REJECTED', 'CANCELLED');
CREATE TYPE "DeclarationType" AS ENUM ('C13', 'C14', 'C17', 'C18', 'OTHER');
CREATE TYPE "BrokerageInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'OTHER');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'STATUS_CHANGE', 'LOGIN', 'LOGOUT');

-- Tables ---------------------------------------------------------------------
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "tinNumber" TEXT,
    "licenseNumber" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CLERK',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

CREATE TABLE "Port" (
    "id" TEXT NOT NULL,
    "unLocode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Port_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Port_unLocode_key" ON "Port"("unLocode");

CREATE TABLE "CustomsOffice" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomsOffice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomsOffice_code_key" ON "CustomsOffice"("code");

CREATE TABLE "ShippingAgent" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShippingAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShippingAgent_code_key" ON "ShippingAgent"("code");

CREATE TABLE "Carrier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "TransportMode" NOT NULL DEFAULT 'SEA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Carrier_code_key" ON "Carrier"("code");

CREATE TABLE "Vessel" (
    "id" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imoNumber" TEXT,
    "mode" "TransportMode" NOT NULL DEFAULT 'SEA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vessel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Vessel_imoNumber_key" ON "Vessel"("imoNumber");
CREATE INDEX "Vessel_carrierId_idx" ON "Vessel"("carrierId");

CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "originPortId" TEXT NOT NULL,
    "destinationPortId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Journey_originPortId_destinationPortId_key" ON "Journey"("originPortId", "destinationPortId");

CREATE TABLE "Voyage" (
    "id" TEXT NOT NULL,
    "vesselId" TEXT NOT NULL,
    "journeyId" TEXT,
    "voyageNumber" TEXT NOT NULL,
    "departureDate" TIMESTAMP(3),
    "arrivalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Voyage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Voyage_vesselId_voyageNumber_key" ON "Voyage"("vesselId", "voyageNumber");
CREATE INDEX "Voyage_journeyId_idx" ON "Voyage"("journeyId");

CREATE TABLE "HSCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "unit" TEXT,
    "sectionNumber" TEXT,
    "sectionName" TEXT,
    "chapterName" TEXT,
    "requiresPermit" BOOLEAN NOT NULL DEFAULT false,
    "permitType" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HSCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HSCode_code_key" ON "HSCode"("code");
CREATE INDEX "HSCode_chapter_idx" ON "HSCode"("chapter");
CREATE INDEX "HSCode_heading_idx" ON "HSCode"("heading");

CREATE TABLE "HSCodeRate" (
    "id" TEXT NOT NULL,
    "hsCodeId" TEXT NOT NULL,
    "dutyBasis" "DutyBasis" NOT NULL DEFAULT 'AD_VALOREM',
    "dutyRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "specificRate" DECIMAL(12,4),
    "specificRateUnit" TEXT,
    "vatRate" DECIMAL(6,4) NOT NULL DEFAULT 0.1000,
    "levyRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "processingFeeExempt" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "changeReason" TEXT,
    "gazetteRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HSCodeRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HSCodeRate_hsCodeId_effectiveFrom_idx" ON "HSCodeRate"("hsCodeId", "effectiveFrom");

CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientType" "ClientType" NOT NULL DEFAULT 'BUSINESS',
    "tinNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contactPerson" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Client_organizationId_isActive_idx" ON "Client"("organizationId", "isActive");

CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Supplier_organizationId_isActive_idx" ON "Supplier"("organizationId", "isActive");

CREATE TABLE "Manifest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "manifestNumber" TEXT NOT NULL,
    "voyageId" TEXT NOT NULL,
    "shippingAgentId" TEXT,
    "registeredAt" TIMESTAMP(3),
    "status" "ManifestStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Manifest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Manifest_organizationId_manifestNumber_key" ON "Manifest"("organizationId", "manifestNumber");
CREATE INDEX "Manifest_organizationId_status_createdAt_idx" ON "Manifest"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "Manifest_voyageId_idx" ON "Manifest"("voyageId");

CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "manifestId" TEXT,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "shipmentNumber" TEXT NOT NULL,
    "blNumber" TEXT,
    "containerNumber" TEXT,
    "declarationOfficeId" TEXT NOT NULL,
    "goodsType" "GoodsType" NOT NULL DEFAULT 'GENERAL',
    "packageType" "PackageType" NOT NULL DEFAULT 'CARTON',
    "packageCount" INTEGER NOT NULL DEFAULT 1,
    "transportMode" "TransportMode" NOT NULL DEFAULT 'SEA',
    "description" TEXT,
    "grossWeightKg" DECIMAL(12,3),
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "freightCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "insuranceCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalFobValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCifValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDuty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalVat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalLevy" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalExcise" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "processingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Shipment_organizationId_shipmentNumber_key" ON "Shipment"("organizationId", "shipmentNumber");
CREATE INDEX "Shipment_organizationId_status_createdAt_idx" ON "Shipment"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "Shipment_organizationId_clientId_idx" ON "Shipment"("organizationId", "clientId");
CREATE INDEX "Shipment_manifestId_idx" ON "Shipment"("manifestId");
CREATE INDEX "Shipment_blNumber_idx" ON "Shipment"("blNumber");

CREATE TABLE "ShipmentDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShipmentDocument_organizationId_idx" ON "ShipmentDocument"("organizationId");
CREATE INDEX "ShipmentDocument_shipmentId_idx" ON "ShipmentDocument"("shipmentId");

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BSD',
    "subTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");
CREATE INDEX "Invoice_shipmentId_idx" ON "Invoice"("shipmentId");
CREATE INDEX "Invoice_supplierId_idx" ON "Invoice"("supplierId");

CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "hsCodeId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "commercialDescription" TEXT,
    "pageNumber" INTEGER,
    "hsCode" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "unitPrice" DECIMAL(12,4) NOT NULL,
    "totalValue" DECIMAL(12,2) NOT NULL,
    "weightKg" DECIMAL(12,3),
    "countryOfOrigin" TEXT,
    "freightApportioned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "insuranceApportioned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherCostApportioned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cifValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dutyBasis" "DutyBasis" NOT NULL DEFAULT 'AD_VALOREM',
    "dutyRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "specificRate" DECIMAL(12,4),
    "specificRateUnit" TEXT,
    "vatRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "levyRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "dutyAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "levyAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "exemptionType" "ExemptionType" NOT NULL DEFAULT 'NONE',
    "exemptionRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LineItem_invoiceId_lineNumber_key" ON "LineItem"("invoiceId", "lineNumber");
CREATE INDEX "LineItem_organizationId_idx" ON "LineItem"("organizationId");
CREATE INDEX "LineItem_hsCodeId_idx" ON "LineItem"("hsCodeId");

CREATE TABLE "CustomsEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "entryNumber" TEXT,
    "declarationType" "DeclarationType" NOT NULL DEFAULT 'C13',
    "status" "CustomsEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "beaipReference" TEXT,
    "submittedAt" TIMESTAMP(3),
    "assessedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "totalPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomsEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomsEntry_organizationId_status_createdAt_idx" ON "CustomsEntry"("organizationId", "status", "createdAt" DESC);
CREATE INDEX "CustomsEntry_shipmentId_idx" ON "CustomsEntry"("shipmentId");
CREATE INDEX "CustomsEntry_beaipReference_idx" ON "CustomsEntry"("beaipReference");

CREATE TABLE "BrokerageInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "BrokerageInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrokerageInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrokerageInvoice_organizationId_invoiceNumber_key" ON "BrokerageInvoice"("organizationId", "invoiceNumber");
CREATE INDEX "BrokerageInvoice_organizationId_status_issueDate_idx" ON "BrokerageInvoice"("organizationId", "status", "issueDate" DESC);
CREATE INDEX "BrokerageInvoice_clientId_idx" ON "BrokerageInvoice"("clientId");

CREATE TABLE "BrokerageInvoiceItem" (
    "id" TEXT NOT NULL,
    "brokerageInvoiceId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "BrokerageInvoiceItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrokerageInvoiceItem_brokerageInvoiceId_idx" ON "BrokerageInvoiceItem"("brokerageInvoiceId");

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brokerageInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");
CREATE INDEX "Payment_brokerageInvoiceId_idx" ON "Payment"("brokerageInvoiceId");

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt" DESC);
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- Foreign keys ----------------------------------------------------------------
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vessel" ADD CONSTRAINT "Vessel_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_originPortId_fkey" FOREIGN KEY ("originPortId") REFERENCES "Port"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_destinationPortId_fkey" FOREIGN KEY ("destinationPortId") REFERENCES "Port"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Voyage" ADD CONSTRAINT "Voyage_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "Vessel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Voyage" ADD CONSTRAINT "Voyage_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HSCodeRate" ADD CONSTRAINT "HSCodeRate_hsCodeId_fkey" FOREIGN KEY ("hsCodeId") REFERENCES "HSCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_shippingAgentId_fkey" FOREIGN KEY ("shippingAgentId") REFERENCES "ShippingAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_declarationOfficeId_fkey" FOREIGN KEY ("declarationOfficeId") REFERENCES "CustomsOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_hsCodeId_fkey" FOREIGN KEY ("hsCodeId") REFERENCES "HSCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomsEntry" ADD CONSTRAINT "CustomsEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomsEntry" ADD CONSTRAINT "CustomsEntry_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerageInvoice" ADD CONSTRAINT "BrokerageInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerageInvoice" ADD CONSTRAINT "BrokerageInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrokerageInvoiceItem" ADD CONSTRAINT "BrokerageInvoiceItem_brokerageInvoiceId_fkey" FOREIGN KEY ("brokerageInvoiceId") REFERENCES "BrokerageInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_brokerageInvoiceId_fkey" FOREIGN KEY ("brokerageInvoiceId") REFERENCES "BrokerageInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
