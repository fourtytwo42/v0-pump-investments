CREATE TYPE "TokenLifecycleStatus" AS ENUM ('UNKNOWN', 'BONDING', 'CURVE_COMPLETE', 'PUMPSWAP', 'NON_LAUNCHPAD');

ALTER TABLE "tokens"
  ADD COLUMN "lifecycle_status" "TokenLifecycleStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "lifecycle_verified_at" TIMESTAMP(3),
  ADD COLUMN "pump_swap_pool" TEXT,
  ADD COLUMN "graduated_at" TIMESTAMP(3);

UPDATE "tokens"
SET "lifecycle_status" = 'UNKNOWN',
    "lifecycle_verified_at" = NULL,
    "pump_swap_pool" = NULL,
    "graduated_at" = NULL;

CREATE TABLE "token_lifecycle_checks" (
    "token_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_lifecycle_checks_pkey" PRIMARY KEY ("token_id")
);

CREATE TABLE "token_data_revisions" (
    "key" TEXT NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_data_revisions_pkey" PRIMARY KEY ("key")
);

INSERT INTO "token_data_revisions" ("key", "revision", "updated_at")
VALUES ('tokens', 0, NOW())
ON CONFLICT ("key") DO NOTHING;

CREATE INDEX "tokens_lifecycle_status_lifecycle_verified_at_idx" ON "tokens"("lifecycle_status", "lifecycle_verified_at");
CREATE INDEX "token_lifecycle_checks_next_attempt_at_priority_idx" ON "token_lifecycle_checks"("next_attempt_at", "priority");

ALTER TABLE "token_lifecycle_checks"
  ADD CONSTRAINT "token_lifecycle_checks_token_id_fkey"
  FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
