-- Preserve the VAT entered for each brokerage invoice line so the invoice
-- total remains auditable instead of retaining only an unexplained roll-up.
ALTER TABLE "BrokerageInvoiceItem"
ADD COLUMN "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
