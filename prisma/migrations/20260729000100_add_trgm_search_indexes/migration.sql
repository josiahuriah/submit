-- Text-search performance: pg_trgm GIN indexes.
--
-- Prisma's schema language cannot express trigram GIN indexes, so these live
-- in raw migration SQL. They were previously applied out-of-band by
-- prisma/apply-rls.ts, which made every `prisma migrate dev` report them as
-- schema drift and offer to reset the database. Owning them here keeps the
-- migration history and the live schema in agreement.
--
-- RLS policies deliberately stay out-of-band in prisma/sql/rls.sql: Prisma
-- does not track policies, so they cause no drift.
--
-- Idempotent (IF NOT EXISTS) so this replays safely onto a database that
-- already had the indexes applied by the old script.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "HSCode_description_trgm_idx" ON "HSCode" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Client_name_trgm_idx" ON "Client" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Supplier_name_trgm_idx" ON "Supplier" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Shipment_description_trgm_idx" ON "Shipment" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LineItem_description_trgm_idx" ON "LineItem" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LineItem_commercialDescription_trgm_idx" ON "LineItem" USING GIN ("commercialDescription" gin_trgm_ops);
