export function ingestRetryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(300_000, 2_000 * 2 ** Math.max(0, attempt - 1))
  return Math.round(base + base * 0.2 * random())
}
