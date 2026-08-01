export const MAX_TRACKING_WINDOW_MINUTES = 60
export const MIN_RETENTION_HOURS = 2

export function normalizeRetentionHours(raw: string | undefined, fallback = MIN_RETENTION_HOURS): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback
  return Math.max(MIN_RETENTION_HOURS, Number.isFinite(parsed) ? parsed : fallback)
}

export function normalizeRetentionMinutes(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback
  return Math.max(5, Number.isFinite(parsed) ? parsed : fallback)
}

export function retentionCutoff(nowMs: number, amount: number, unitMs: number): number {
  return nowMs - amount * unitMs
}
