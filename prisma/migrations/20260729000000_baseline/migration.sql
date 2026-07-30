CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "mint_address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_uri" TEXT,
    "metadata_uri" TEXT,
    "twitter" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "description" TEXT,
    "creator_address" TEXT NOT NULL,
    "created_timestamp" BIGINT NOT NULL,
    "king_of_the_hill_timestamp" BIGINT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "bonding_curve" TEXT,
    "associated_bonding_curve" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "token_prices" (
    "token_id" TEXT NOT NULL,
    "price_sol" DECIMAL(65,30) NOT NULL,
    "price_usd" DECIMAL(65,30) NOT NULL,
    "market_cap_usd" DECIMAL(65,30) NOT NULL,
    "last_trade_timestamp" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_prices_pkey" PRIMARY KEY ("token_id")
);

CREATE TABLE "trades" (
    "id" SERIAL NOT NULL,
    "token_id" TEXT NOT NULL,
    "tx_signature" TEXT NOT NULL,
    "user_address" TEXT NOT NULL,
    "is_buy" BOOLEAN NOT NULL,
    "amount_sol" DECIMAL(65,30) NOT NULL,
    "amount_usd" DECIMAL(65,30) NOT NULL,
    "base_amount" DECIMAL(65,30) NOT NULL,
    "price_sol" DECIMAL(65,30) NOT NULL,
    "price_usd" DECIMAL(65,30) NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,
    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pump_candles_1m" (
    "id" SERIAL NOT NULL,
    "token_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(20,8) NOT NULL,
    "high" DECIMAL(20,8) NOT NULL,
    "low" DECIMAL(20,8) NOT NULL,
    "close" DECIMAL(20,8) NOT NULL,
    "volume_usd" DECIMAL(24,8) NOT NULL,
    "volume_sol" DECIMAL(24,8) NOT NULL,
    "trades" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pump_candles_1m_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pump_features_1m" (
    "id" SERIAL NOT NULL,
    "token_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "return" DECIMAL(20,8),
    "range" DECIMAL(20,8),
    "body" DECIMAL(20,8),
    "dlog_volume" DECIMAL(20,8),
    "ret_mean_15" DECIMAL(20,8),
    "ret_std_15" DECIMAL(20,8),
    "ret_mean_60" DECIMAL(20,8),
    "ret_std_60" DECIMAL(20,8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pump_features_1m_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pump_sol_prices" (
    "id" SERIAL NOT NULL,
    "hour_timestamp" BIGINT NOT NULL,
    "price_usd" DECIMAL(20,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pump_sol_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "token_market_caps" (
    "token_id" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "market_cap_usd" DECIMAL(24,8) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'trade',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_market_caps_pkey" PRIMARY KEY ("token_id","timestamp")
);

CREATE UNIQUE INDEX "tokens_mint_address_key" ON "tokens"("mint_address");
CREATE INDEX "tokens_completed_king_of_the_hill_timestamp_idx" ON "tokens"("completed", "king_of_the_hill_timestamp");
CREATE INDEX "tokens_created_timestamp_idx" ON "tokens"("created_timestamp");
CREATE UNIQUE INDEX "trades_tx_signature_key" ON "trades"("tx_signature");
CREATE INDEX "trades_token_id_timestamp_idx" ON "trades"("token_id", "timestamp");
CREATE INDEX "trades_timestamp_idx" ON "trades"("timestamp");
CREATE UNIQUE INDEX "pump_candles_1m_token_id_timestamp_key" ON "pump_candles_1m"("token_id", "timestamp");
CREATE INDEX "pump_candles_1m_token_id_timestamp_idx" ON "pump_candles_1m"("token_id", "timestamp");
CREATE INDEX "pump_candles_1m_timestamp_idx" ON "pump_candles_1m"("timestamp");
CREATE UNIQUE INDEX "pump_features_1m_token_id_timestamp_key" ON "pump_features_1m"("token_id", "timestamp");
CREATE INDEX "pump_features_1m_token_id_timestamp_idx" ON "pump_features_1m"("token_id", "timestamp");
CREATE INDEX "pump_features_1m_timestamp_idx" ON "pump_features_1m"("timestamp");
CREATE UNIQUE INDEX "pump_sol_prices_hour_timestamp_key" ON "pump_sol_prices"("hour_timestamp");
CREATE INDEX "pump_sol_prices_hour_timestamp_idx" ON "pump_sol_prices"("hour_timestamp");
CREATE INDEX "token_market_caps_timestamp_idx" ON "token_market_caps"("timestamp");
CREATE INDEX "token_market_caps_token_id_timestamp_idx" ON "token_market_caps"("token_id", "timestamp");

ALTER TABLE "token_prices" ADD CONSTRAINT "token_prices_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trades" ADD CONSTRAINT "trades_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pump_candles_1m" ADD CONSTRAINT "pump_candles_1m_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pump_features_1m" ADD CONSTRAINT "pump_features_1m_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_market_caps" ADD CONSTRAINT "token_market_caps_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
