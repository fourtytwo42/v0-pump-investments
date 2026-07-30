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
  program?: unknown
  bonding_curve?: unknown
  associated_bonding_curve?: unknown
}

export interface VerifiedLifecycle {
  status: Exclude<TokenLifecycleStatus, "UNKNOWN">
  pumpSwapPool: string | null
  bondingCurve: string | null
  associatedBondingCurve: string | null
}

const COMPLETED_STATES = new Set<TokenLifecycleStatus>(["CURVE_COMPLETE", "PUMPSWAP"])

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

export function isCompletedLifecycle(status: TokenLifecycleStatus): boolean {
  return COMPLETED_STATES.has(status)
}

export function toPublicLifecycle(status: TokenLifecycleStatus): PublicTokenLifecycleStatus {
  return status.toLowerCase() as PublicTokenLifecycleStatus
}

export function classifyPumpLifecycle(payload: PumpLifecyclePayload): VerifiedLifecycle | null {
  const pumpSwapPool = optionalString(payload.pump_swap_pool)
  const program = optionalString(payload.program)?.toLowerCase() ?? null
  const bondingCurve = optionalString(payload.bonding_curve)
  const associatedBondingCurve = optionalString(payload.associated_bonding_curve)

  if (pumpSwapPool) {
    return {
      status: "PUMPSWAP",
      pumpSwapPool,
      bondingCurve,
      associatedBondingCurve,
    }
  }

  if (program === "non_launchpad") {
    return {
      status: "NON_LAUNCHPAD",
      pumpSwapPool: null,
      bondingCurve,
      associatedBondingCurve,
    }
  }

  if (payload.complete === true) {
    return {
      status: "CURVE_COMPLETE",
      pumpSwapPool: null,
      bondingCurve,
      associatedBondingCurve,
    }
  }

  if (payload.complete === false && program === "pump") {
    return {
      status: "BONDING",
      pumpSwapPool: null,
      bondingCurve,
      associatedBondingCurve,
    }
  }

  return null
}

export function reduceLifecycle(
  current: TokenLifecycleStatus,
  verified: VerifiedLifecycle,
): { next: TokenLifecycleStatus; conflict: boolean } {
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

export function lifecycleRetryDelayMs(attempts: number): number {
  const exponential = Math.min(300_000, 2_000 * 2 ** Math.max(0, attempts))
  const jitter = Math.floor(exponential * 0.2 * Math.random())
  return exponential + jitter
}
