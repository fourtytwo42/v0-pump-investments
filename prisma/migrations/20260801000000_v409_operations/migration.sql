CREATE TABLE IF NOT EXISTS "runtime_health_state" (
  "key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runtime_health_state_pkey" PRIMARY KEY ("key")
);

-- Exact individual-buy filters remain trade based. This partial covering index
-- bounds that path without adding write cost for sells.
CREATE INDEX IF NOT EXISTS "trades_recent_buy_filter_idx"
  ON "trades" ("timestamp", "amount_usd", "token_id", "user_address")
  WHERE "is_buy" = TRUE;

INSERT INTO "token_data_revisions" ("key", "revision", "updated_at")
VALUES ('tokens-pending', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
