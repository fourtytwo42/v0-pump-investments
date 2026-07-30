DO $$ BEGIN
  CREATE TYPE "TokenLaunchSource" AS ENUM ('UNKNOWN', 'PUMP', 'MOONSHOT', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TokenTradeVenue" AS ENUM ('UNKNOWN', 'PUMP_BONDING', 'PUMPSWAP', 'RAYDIUM_V4', 'METEORA_DBC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tokens"
  ADD COLUMN IF NOT EXISTS "launch_source" "TokenLaunchSource" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "trade_venue" "TokenTradeVenue" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "source_verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trade_venue_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_timestamp_source" TEXT NOT NULL DEFAULT 'first_observed',
  ADD COLUMN IF NOT EXISTS "created_timestamp_verified_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "tokens_launch_source_trade_venue_idx"
  ON "tokens"("launch_source", "trade_venue");

CREATE TABLE IF NOT EXISTS "token_minute_aggregates" (
  "token_id" TEXT NOT NULL,
  "minute" TIMESTAMP(3) NOT NULL,
  "volume_usd" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "volume_sol" DECIMAL(24,9) NOT NULL DEFAULT 0,
  "buy_volume_usd" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "buy_volume_sol" DECIMAL(24,9) NOT NULL DEFAULT 0,
  "sell_volume_usd" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "sell_volume_sol" DECIMAL(24,9) NOT NULL DEFAULT 0,
  "buy_count" INTEGER NOT NULL DEFAULT 0,
  "sell_count" INTEGER NOT NULL DEFAULT 0,
  "last_trade_timestamp" BIGINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "token_minute_aggregates_pkey" PRIMARY KEY ("token_id", "minute"),
  CONSTRAINT "token_minute_aggregates_token_id_fkey"
    FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "token_minute_aggregates_minute_idx" ON "token_minute_aggregates"("minute");

CREATE TABLE IF NOT EXISTS "token_buyer_minute_aggregates" (
  "token_id" TEXT NOT NULL,
  "minute" TIMESTAMP(3) NOT NULL,
  "buyer_address" TEXT NOT NULL,
  "buy_total_usd" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "buy_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "token_buyer_minute_aggregates_pkey" PRIMARY KEY ("token_id", "minute", "buyer_address"),
  CONSTRAINT "token_buyer_minute_aggregates_token_id_fkey"
    FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "token_buyer_minute_aggregates_minute_idx"
  ON "token_buyer_minute_aggregates"("minute");

CREATE TABLE IF NOT EXISTS "token_dirty_mints" (
  "mint_address" TEXT NOT NULL,
  "change_kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "revision" BIGINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "token_dirty_mints_pkey" PRIMARY KEY ("mint_address")
);
CREATE INDEX IF NOT EXISTS "token_dirty_mints_revision_idx" ON "token_dirty_mints"("revision");

CREATE TABLE IF NOT EXISTS "token_revision_journal" (
  "id" BIGSERIAL NOT NULL,
  "revision" BIGINT NOT NULL,
  "mint_address" TEXT NOT NULL,
  "change_kind" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "token_revision_journal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "token_revision_journal_revision_idx" ON "token_revision_journal"("revision");
CREATE INDEX IF NOT EXISTS "token_revision_journal_mint_address_revision_idx"
  ON "token_revision_journal"("mint_address", "revision");

CREATE TABLE IF NOT EXISTS "token_image_status" (
  "token_id" TEXT NOT NULL,
  "resolved_url" TEXT,
  "content_type" TEXT,
  "byte_size" INTEGER,
  "cache_path" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "checked_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3),
  "last_error" TEXT,
  CONSTRAINT "token_image_status_pkey" PRIMARY KEY ("token_id"),
  CONSTRAINT "token_image_status_token_id_fkey"
    FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "token_image_status_status_next_attempt_at_idx"
  ON "token_image_status"("status", "next_attempt_at");

CREATE TABLE IF NOT EXISTS "sol_price_state" (
  "key" TEXT NOT NULL,
  "price_usd" DECIMAL(20,8) NOT NULL,
  "source" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sol_price_state_pkey" PRIMARY KEY ("key")
);

INSERT INTO "token_image_status" ("token_id", "status")
SELECT "id", 'unknown' FROM "tokens"
ON CONFLICT ("token_id") DO NOTHING;

WITH latest_program AS (
  SELECT DISTINCT ON (tr."token_id")
    tr."token_id",
    LOWER(COALESCE(tr."raw"->>'program', '')) AS program,
    LOWER(COALESCE(tr."raw"->>'platform', '')) AS platform,
    tr."timestamp"
  FROM "trades" tr
  WHERE tr."raw" IS NOT NULL
  ORDER BY tr."token_id", tr."timestamp" DESC
)
UPDATE "tokens" t
SET
  "launch_source" = CASE
    WHEN lp.program = 'pump' THEN 'PUMP'::"TokenLaunchSource"
    WHEN lp.program = 'meteora_dbc' AND lp.platform = 'moonshot' THEN 'MOONSHOT'::"TokenLaunchSource"
    ELSE t."launch_source"
  END,
  "trade_venue" = CASE
    WHEN lp.program = 'pump' THEN 'PUMP_BONDING'::"TokenTradeVenue"
    WHEN lp.program = 'pump_amm' THEN 'PUMPSWAP'::"TokenTradeVenue"
    WHEN lp.program = 'meteora_dbc' THEN 'METEORA_DBC'::"TokenTradeVenue"
    WHEN lp.program = 'raydium_v4_amm' THEN 'RAYDIUM_V4'::"TokenTradeVenue"
    ELSE t."trade_venue"
  END,
  "source_verified_at" = CASE
    WHEN lp.program = 'pump' OR (lp.program = 'meteora_dbc' AND lp.platform = 'moonshot')
      THEN CURRENT_TIMESTAMP
    ELSE t."source_verified_at"
  END,
  "trade_venue_updated_at" = CASE WHEN lp.program <> '' THEN CURRENT_TIMESTAMP ELSE t."trade_venue_updated_at" END
FROM latest_program lp
WHERE t."id" = lp."token_id";
