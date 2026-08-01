export function deriveVerifiedBondingProgress(progress: number | null | undefined): number {
  if (progress === null || progress === undefined || !Number.isFinite(progress)) return 0
  return Math.min(99, Math.max(0, progress))
}
