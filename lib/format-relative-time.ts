export function formatCompactTimeAgo(timestampSeconds: number, nowMs = Date.now()): string {
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0 || !Number.isFinite(nowMs)) {
    return "Unknown"
  }

  const timestampMs = timestampSeconds * 1_000
  if (!Number.isFinite(timestampMs) || timestampMs > nowMs) return "Unknown"

  const elapsedSeconds = Math.floor((nowMs - timestampMs) / 1_000)
  if (elapsedSeconds < 60) return "<1m ago"

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h ago`

  return `${Math.floor(elapsedHours / 24)}d ago`
}
