CREATE TABLE "browser_presence_snapshots" (
  "interval_started_at" TIMESTAMP(3) NOT NULL,
  "active_browsers" INTEGER NOT NULL,
  "active_window_seconds" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "browser_presence_snapshots_pkey" PRIMARY KEY ("interval_started_at")
);

CREATE INDEX "browser_presence_snapshots_created_at_idx"
  ON "browser_presence_snapshots"("created_at");
