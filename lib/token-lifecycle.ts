export const TOKEN_LIFECYCLE_STATUSES = [
  "UNKNOWN",
  "BONDING",
  "CURVE_COMPLETE",
  "PUMPSWAP",
  "NON_LAUNCHPAD",
] as const

export type TokenLifecycleStatus = (typeof TOKEN_LIFECYCLE_STATUSES)[number]
export type PublicTokenLifecycleStatus = Lowercase<TokenLifecycleStatus>

export interface PumpLifecyclePayload {
  mint?: unknown
  complete?: unknown
  pump_swap_pool?: unknown
  raydium_pool?: unknown
  pool_address?: unknown
  program?: unknown
  bonding_curve?: unknown
  associated_bonding_curve?: unknown
  real_token_reserves?: unknown
  total_supply?: unknown
}

export interface VerifiedLifecycle {
  status: Exclude<TokenLifecycleStatus, "UNKNOWN">
  pumpSwapPool: string | null
  bondingCurve: string | null
  associatedBondingCurve: string | null
  bondingProgress: number | null
}

export interface LifecycleTransition {
  next: TokenLifecycleStatus
  conflict: boolean
  repairedFalseGraduation?: boolean
}

const COMPLETED_STATES = new Set<TokenLifecycleStatus>(["CURVE_COMPLETE", "PUMPSWAP"])
const INITIAL_REAL_TOKEN_RATIO = 0.7931

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function deriveBondingProgress(payload: PumpLifecyclePayload): number | null {
  if (payload.complete === true || optionalString(payload.pump_swap_pool)) return 100

  const realTokenReserves = optionalNumber(payload.real_token_reserves)
  const totalSupply = optionalNumber(payload.total_supply)
  if (
    realTokenReserves === null ||
    totalSupply === null ||
    realTokenReserves < 0 ||
    totalSupply <= 0
  ) {
    return null
  }

  const initialRealTokenReserves = totalSupply * INITIAL_REAL_TOKEN_RATIO
  const progress = (1 - realTokenReserves / initialRealTokenReserves) * 100
  return Math.min(100, Math.max(0, progress))
}

export function classifyPumpSwapTradeEvidence(payload: {
  program?: unknown
  poolAddress?: unknown
  isBondingCurve?: unknown
}): VerifiedLifecycle | null {
  const program = optionalString(payload.program)?.toLowerCase()
  const pumpSwapPool = optionalString(payload.poolAddress)
  if (program !== "pump_amm" || !pumpSwapPool || payload.isBondingCurve === true) return null

  return {
    status: "PUMPSWAP",
    pumpSwapPool,
    bondingCurve: null,
    associatedBondingCurve: null,
    bondingProgress: 100,
  }
}

export function classifyLegacyRaydiumMigrationEvidence(payload: {
  program?: unknown
  poolAddress?: unknown
  isBondingCurve?: unknown
}): VerifiedLifecycle | null {
  const program = optionalString(payload.program)?.toLowerCase()
  const poolAddress = optionalString(payload.poolAddress)
  if (program !== "raydium_v4_amm" || !poolAddress || payload.isBondingCurve === true) return null

  return {
    status: "CURVE_COMPLETE",
    pumpSwapPool: null,
    bondingCurve: null,
    associatedBondingCurve: null,
    bondingProgress: 100,
  }
}

export function isCompletedLifecycle(status: TokenLifecycleStatus): boolean {
  return COMPLETED_STATES.has(status)
}

export function toPublicLifecycle(status: TokenLifecycleStatus): PublicTokenLifecycleStatus {
  return status.toLowerCase() as PublicTokenLifecycleStatus
}

export function classifyPumpLifecycle(payload: PumpLifecyclePayload): VerifiedLifecycle | null {
  const pumpSwapPool = optionalString(payload.pump_swap_pool)
  const raydiumPool = optionalString(payload.raydium_pool)
  const program = optionalString(payload.program)?.toLowerCase() ?? null
  const bondingCurve = optionalString(payload.bonding_curve)
  const associatedBondingCurve = optionalString(payload.associated_bonding_curve)

  if (pumpSwapPool) {
    return {
      status: "PUMPSWAP",
      pumpSwapPool,
      bondingCurve,
      associatedBondingCurve,
      bondingProgress: 100,
    }
  }

  // Pump's legacy Raydium migrations can retain complete=false indefinitely,
  // but the frontend response exposes the concrete migrated pool.
  if (program === "pump" && raydiumPool) {
    return {
      status: "CURVE_COMPLETE",
      pumpSwapPool: null,
      bondingCurve,
      associatedBondingCurve,
      bondingProgress: 100,
    }
  }

  if (program === "non_launchpad") {
    return {
      status: "NON_LAUNCHPAD",
      pumpSwapPool: null,
      bondingCurve,
      associatedBondingCurve,
      bondingProgress: null,
    }
  }

  if (payload.complete === true) {
    return {
      status: "CURVE_COMPLETE",
      pumpSwapPool: null,
      bondingCurve,
      associatedBondingCurve,
      bondingProgress: 100,
    }
  }

  if (payload.complete === false && program === "pump") {
    return {
      status: "BONDING",
      pumpSwapPool: null,
      bondingCurve,
      associatedBondingCurve,
      bondingProgress: deriveBondingProgress(payload),
    }
  }

  return null
}

export function reduceLifecycle(
  current: TokenLifecycleStatus,
  verified: VerifiedLifecycle,
): LifecycleTransition {
  if (current === "PUMPSWAP") {
    return { next: current, conflict: verified.status !== "PUMPSWAP" }
  }

  if (current === "CURVE_COMPLETE") {
    if (verified.status === "PUMPSWAP") {
      return { next: "PUMPSWAP", conflict: false }
    }
    return { next: current, conflict: verified.status !== "CURVE_COMPLETE" }
  }

  if (current === "NON_LAUNCHPAD") {
    return {
      next: verified.status === "PUMPSWAP" ? "PUMPSWAP" : current,
      conflict: verified.status !== "NON_LAUNCHPAD" && verified.status !== "PUMPSWAP",
    }
  }

  return { next: verified.status, conflict: false }
}

export function reduceLifecycleWithVenueRepair(
  current: TokenLifecycleStatus,
  verified: VerifiedLifecycle,
  evidence: { tradeVenue: string; pumpSwapPool: string | null },
): LifecycleTransition {
  if (
    current === "CURVE_COMPLETE" &&
    verified.status === "BONDING" &&
    evidence.tradeVenue === "PUMP_BONDING" &&
    !evidence.pumpSwapPool
  ) {
    return { next: "BONDING", conflict: false, repairedFalseGraduation: true }
  }

  return reduceLifecycle(current, verified)
}

export function lifecycleRetryDelayMs(attempts: number): number {
  const exponential = Math.min(300_000, 2_000 * 2 ** Math.max(0, attempts))
  const jitter = Math.floor(exponential * 0.2 * Math.random())
  return exponential + jitter
}

export function lifecycleRetrySchedule(
  attempts: number,
  maxAttempts: number,
  unresolvedCooldownMs: number,
  explicitDelayMs?: number | null,
): { delayMs: number; priority: number; coolingDown: boolean } {
  const coolingDown = attempts >= maxAttempts
  const delayMs = coolingDown
    ? Math.max(explicitDelayMs ?? 0, unresolvedCooldownMs)
    : explicitDelayMs ?? lifecycleRetryDelayMs(attempts)
  return {
    delayMs,
    priority: coolingDown ? 0 : Math.max(0, 100 - attempts),
    coolingDown,
  }
}
