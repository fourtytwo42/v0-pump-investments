ALTER TABLE "tokens"
  ADD COLUMN IF NOT EXISTS "bonding_progress" DOUBLE PRECISION;

UPDATE "tokens"
SET "bonding_progress" = 100
WHERE "lifecycle_status" IN ('CURVE_COMPLETE', 'PUMPSWAP');
