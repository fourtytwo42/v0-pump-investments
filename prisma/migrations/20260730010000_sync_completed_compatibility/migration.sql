UPDATE "tokens"
SET "completed" = ("lifecycle_status" IN ('CURVE_COMPLETE', 'PUMPSWAP'));
