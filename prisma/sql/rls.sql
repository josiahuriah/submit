-- =============================================================================
-- ROW LEVEL SECURITY — the tenant-isolation backstop layer.
-- =============================================================================
-- The Prisma tenant client (src/lib/db/tenant-client.ts) is the PRIMARY
-- enforcement layer; RLS exists so that even a bug in application code cannot
-- leak rows across organizations.
--
-- The org id is provided per-transaction with:
--     SELECT set_config('app.current_org_id', $orgId, true);
-- The third argument (true) makes the setting TRANSACTION-scoped, which is
-- REQUIRED for Neon's PgBouncer transaction-mode pooling — session-level
-- settings are unsafe there because connections are shared across requests.
--
-- current_setting(..., true) returns NULL instead of erroring when unset,
-- so a connection with no org context simply sees zero rows.
--
-- IMPORTANT (Neon): the default `neondb_owner` role owns the tables, and
-- table owners BYPASS RLS unless FORCE is applied — hence FORCE ROW LEVEL
-- SECURITY on every tenant table below.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'User', 'Client', 'Supplier', 'Manifest', 'Shipment', 'ShipmentDocument',
    'Invoice', 'LineItem', 'CustomsEntry', 'CustomsSubmissionBatch',
    'CustomsSubmissionAttempt', 'BrokerageInvoice', 'Payment', 'AuditLog'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_org_id'', true)) WITH CHECK ("organizationId" = current_setting(''app.current_org_id'', true))',
      t
    );
  END LOOP;
END $$;

-- BrokerageInvoiceItem has no organizationId column; scope it through its parent.
ALTER TABLE "BrokerageInvoiceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BrokerageInvoiceItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BrokerageInvoiceItem";
CREATE POLICY tenant_isolation ON "BrokerageInvoiceItem"
  USING (EXISTS (
    SELECT 1 FROM "BrokerageInvoice" bi
    WHERE bi."id" = "BrokerageInvoiceItem"."brokerageInvoiceId"
      AND bi."organizationId" = current_setting('app.current_org_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "BrokerageInvoice" bi
    WHERE bi."id" = "BrokerageInvoiceItem"."brokerageInvoiceId"
      AND bi."organizationId" = current_setting('app.current_org_id', true)
  ));

-- Organization itself: a tenant may only see its own row.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Organization";
CREATE POLICY tenant_isolation ON "Organization"
  USING ("id" = current_setting('app.current_org_id', true))
  WITH CHECK ("id" = current_setting('app.current_org_id', true));

-- NOTE: auth flows (login by email, registration) run before an org context
-- exists. Those queries go through the system client, which sets the
-- bypass flag below for the transaction.
DROP POLICY IF EXISTS system_bypass ON "User";
CREATE POLICY system_bypass ON "User"
  USING (current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on');
DROP POLICY IF EXISTS system_bypass ON "Organization";
CREATE POLICY system_bypass ON "Organization"
  USING (current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on');
DROP POLICY IF EXISTS system_bypass ON "AuditLog";
CREATE POLICY system_bypass ON "AuditLog"
  USING (current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on');
