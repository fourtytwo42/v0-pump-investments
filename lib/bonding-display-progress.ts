export const BONDING_TARGET_SOL = 415

export function deriveMarketCapBondingProgress(
  marketCapUsd: number,
  solPriceUsd: number,
): number {
  if (
    !Number.isFinite(marketCapUsd) ||
    !Number.isFinite(solPriceUsd) ||
    marketCapUsd <= 0 ||
    solPriceUsd <= 0
  ) {
    return 0
  }

  const graduationMarketCapUsd = solPriceUsd * BONDING_TARGET_SOL
  return Math.min(99, Math.max(0, (marketCapUsd / graduationMarketCapUsd) * 100))
}
