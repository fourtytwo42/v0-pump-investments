export type QueueLifecycleStatus =
  | "UNKNOWN"
  | "BONDING"
  | "CURVE_COMPLETE"
  | "PUMPSWAP"
  | "NON_LAUNCHPAD"

export const LIFECYCLE_QUEUE_PRIORITY = {
  graduationHint: 120,
  activeUnknownTrade: 110,
  hotUnknown: 80,
  hotBonding: 40,
  fullUnknown: 30,
  fullBonding: 20,
  curveCompleteFollowup: 10,
} as const

export function lifecycleTradeRequest(
  status: QueueLifecycleStatus,
  hasGraduationHint: boolean,
): { reason: string; priority: number } | null {
  if (hasGraduationHint && (status === "UNKNOWN" || status === "BONDING")) {
    return {
      reason: "trade_graduation_hint",
      priority: LIFECYCLE_QUEUE_PRIORITY.graduationHint,
    }
  }
  if (status === "UNKNOWN") {
    return {
      reason: "active_unknown_trade",
      priority: LIFECYCLE_QUEUE_PRIORITY.activeUnknownTrade,
    }
  }
  return null
}

export function periodicLifecyclePriority(
  status: QueueLifecycleStatus,
  mode: "hot" | "full",
): number | null {
  if (mode === "hot") {
    if (status === "UNKNOWN") return LIFECYCLE_QUEUE_PRIORITY.hotUnknown
    if (status === "BONDING") return LIFECYCLE_QUEUE_PRIORITY.hotBonding
    return null
  }
  if (status === "UNKNOWN") return LIFECYCLE_QUEUE_PRIORITY.fullUnknown
  if (status === "BONDING") return LIFECYCLE_QUEUE_PRIORITY.fullBonding
  if (status === "CURVE_COMPLETE") return LIFECYCLE_QUEUE_PRIORITY.curveCompleteFollowup
  return null
}

export interface LifecycleFallbackCheck {
  priority: number
  attempts: number
}

export function selectLifecycleSingleFallbacks<T extends LifecycleFallbackCheck>(
  checks: T[],
  isMissing: (check: T) => boolean,
  maximum: number,
): T[] {
  if (maximum <= 0) return []
  const missing = checks.filter(isMissing)
  const selected = missing
    .filter((check) => check.priority >= LIFECYCLE_QUEUE_PRIORITY.hotUnknown)
    .sort((left, right) => right.priority - left.priority)
    .slice(0, maximum)

  if (selected.length < maximum) {
    const legacy = missing.find(
      (check) => check.attempts >= 2 && !selected.includes(check),
    )
    if (legacy) selected.push(legacy)
  }
  return selected
}
