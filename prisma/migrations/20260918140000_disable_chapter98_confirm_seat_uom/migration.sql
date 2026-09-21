-- User-approved reference policy: September 18, 2026.
UPDATE "HSCode" SET "isActive" = FALSE
WHERE regexp_replace(code, '[^0-9]', '', 'g') LIKE '98%';

UPDATE "HSCode" SET "unit" = 'EA'
WHERE regexp_replace(code, '[^0-9]', '', 'g') = '94012010';

-- Recalculation enforces the disabled chapter and the approved unit.
UPDATE "Shipment" SET "calculatedAt" = NULL WHERE status = 'DRAFT';
