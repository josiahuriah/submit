-- Keep payment directions on the invoice independently of general notes.
ALTER TABLE "BrokerageInvoice" ADD COLUMN "paymentInstructions" TEXT;
