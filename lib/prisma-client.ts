import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/generated/prisma/client"
import { Pool } from "pg"

type ClientProfile = "web" | "ingester" | "utility"

const PROFILE_LIMITS: Record<ClientProfile, number> = {
  web: 10,
  ingester: 15,
  utility: 3,
}

export function createPrismaClient(profile: ClientProfile = "web"): PrismaClient {
  // A non-routable local default lets Next collect route metadata at build time.
  // Production health remains unavailable until DATABASE_URL is supplied.
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/pump_investments"

  const prefix = profile.toUpperCase()
  const max = Number.parseInt(
    process.env[`DATABASE_${prefix}_POOL_MAX`] ?? String(PROFILE_LIMITS[profile]),
    10,
  )
  const connectionTimeoutMillis = Number.parseInt(
    process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? "5000",
    10,
  )
  const idleTimeoutMillis = Number.parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS ?? "30000", 10)

  const pool = new Pool({
    connectionString,
    max: Number.isFinite(max) ? max : PROFILE_LIMITS[profile],
    connectionTimeoutMillis,
    idleTimeoutMillis,
    allowExitOnIdle: profile !== "web",
  })
  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onPoolError: (error) => console.error(`[database:${profile}] idle pool error`, error),
  })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })
}
