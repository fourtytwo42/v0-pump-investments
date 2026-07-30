import { createPrismaClient } from "@/lib/prisma-client"

const prisma = createPrismaClient("utility")

async function main(): Promise<void> {
  const tokenRows = await prisma.$executeRawUnsafe(`
    INSERT INTO token_minute_aggregates (
      token_id,minute,volume_usd,volume_sol,buy_volume_usd,buy_volume_sol,
      sell_volume_usd,sell_volume_sol,buy_count,sell_count,
      last_trade_timestamp,updated_at
    )
    SELECT
      token_id,
      date_trunc('minute', to_timestamp(timestamp / 1000.0)),
      SUM(amount_usd),
      SUM(amount_sol),
      SUM(CASE WHEN is_buy THEN amount_usd ELSE 0 END),
      SUM(CASE WHEN is_buy THEN amount_sol ELSE 0 END),
      SUM(CASE WHEN NOT is_buy THEN amount_usd ELSE 0 END),
      SUM(CASE WHEN NOT is_buy THEN amount_sol ELSE 0 END),
      COUNT(*) FILTER (WHERE is_buy),
      COUNT(*) FILTER (WHERE NOT is_buy),
      MAX(timestamp),
      NOW()
    FROM trades
    GROUP BY token_id, 2
    ON CONFLICT (token_id,minute) DO UPDATE SET
      volume_usd=EXCLUDED.volume_usd,
      volume_sol=EXCLUDED.volume_sol,
      buy_volume_usd=EXCLUDED.buy_volume_usd,
      buy_volume_sol=EXCLUDED.buy_volume_sol,
      sell_volume_usd=EXCLUDED.sell_volume_usd,
      sell_volume_sol=EXCLUDED.sell_volume_sol,
      buy_count=EXCLUDED.buy_count,
      sell_count=EXCLUDED.sell_count,
      last_trade_timestamp=EXCLUDED.last_trade_timestamp,
      updated_at=NOW()
  `)
  const buyerRows = await prisma.$executeRawUnsafe(`
    INSERT INTO token_buyer_minute_aggregates (
      token_id,minute,buyer_address,buy_total_usd,buy_count,updated_at
    )
    SELECT
      token_id,
      date_trunc('minute', to_timestamp(timestamp / 1000.0)),
      user_address,
      SUM(amount_usd),
      COUNT(*),
      NOW()
    FROM trades
    WHERE is_buy
    GROUP BY token_id, 2, user_address
    ON CONFLICT (token_id,minute,buyer_address) DO UPDATE SET
      buy_total_usd=EXCLUDED.buy_total_usd,
      buy_count=EXCLUDED.buy_count,
      updated_at=NOW()
  `)
  const [raw, aggregated] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ volume: string; buys: string; sells: string }>>(`
      SELECT COALESCE(SUM(amount_usd),0)::text volume,
        COALESCE(SUM(amount_usd) FILTER (WHERE is_buy),0)::text buys,
        COALESCE(SUM(amount_usd) FILTER (WHERE NOT is_buy),0)::text sells
      FROM trades
    `),
    prisma.$queryRawUnsafe<Array<{ volume: string; buys: string; sells: string }>>(`
      SELECT COALESCE(SUM(volume_usd),0)::text volume,
        COALESCE(SUM(buy_volume_usd),0)::text buys,
        COALESCE(SUM(sell_volume_usd),0)::text sells
      FROM token_minute_aggregates
    `),
  ])
  const equivalent = (["volume", "buys", "sells"] as const).every(
    (field) => Math.abs(Number(raw[0][field]) - Number(aggregated[0][field])) < 0.000001,
  )
  console.log(JSON.stringify({ tokenRows, buyerRows, equivalent, raw: raw[0], aggregated: aggregated[0] }))
  if (!equivalent) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
